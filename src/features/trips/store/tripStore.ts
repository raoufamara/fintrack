import { createStore, type StoreApi } from 'zustand/vanilla'
import { fromMinor } from '../lib/currency'
import { amountDefault } from '../lib/money'
import { createNullFxService, type FxService } from '../services/fxService'
import { isDuplicateCategoryName, CATEGORY_NAME_MAX } from '../lib/categories'
import {
  DUPLICATE_CODE,
  type CategoryInput,
  type CategoryPatch,
  type NewTripInput,
  type RatesPayload,
  type TripSnapshot,
  type TripsRepository,
} from '../services/TripsRepository'
import { newId } from '../services/ids'
import type { FxSource, SplitMode, TripCategory, TripExpense, TripExpenseShare } from '../types'

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface Toast {
  id: number
  kind: 'error' | 'info'
  message: string
}

/** What the expense form hands to the store. Amounts are integer minor units. */
export interface SaveExpenseInput {
  tripId: string
  /** Present when editing. */
  id?: string
  categoryId: string
  title: string
  amountMinor: number
  paidBy: string
  date: string
  note?: string | null
  splitMode: SplitMode
  /** Per-member shares in minor units of `currency`; must sum to `amountMinor`. */
  shares: ReadonlyMap<string, number>
  /** Expense currency. Defaults to the trip default currency. */
  currency?: string
  /** 1 unit of `currency` in the trip default currency; null leaves the expense pending. */
  fxRate?: number | null
  fxSource?: FxSource | null
  fxDate?: string | null
}

/** Unsaved expense form, kept while the user visits another screen (e.g. Categories). */
export interface ExpenseDraft {
  amount: string
  title: string
  categoryId: string | undefined
  paidBy: string
  splitIds: string[]
  date: string
  currency: string
  /** Typed rate text when the user overrode the cached rate. */
  manualRate: string | null
}

export interface CategoryResult {
  ok: boolean
  /** Message for inline display. */
  error?: string
  /** True when the failure was a duplicate name. */
  duplicate?: boolean
  id?: string
}

export interface TripsState {
  trips: Record<string, TripSnapshot>
  tripOrder: string[]
  listStatus: LoadStatus
  listError: string | null
  tripStatus: Record<string, LoadStatus>
  tripError: Record<string, string>
  toast: Toast | null
  drafts: Record<string, ExpenseDraft>

  loadTrips: () => Promise<void>
  loadTrip: (tripId: string) => Promise<void>
  createTrip: (input: NewTripInput) => Promise<string | null>
  saveExpense: (input: SaveExpenseInput) => Promise<boolean>
  deleteExpense: (tripId: string, expenseId: string) => Promise<boolean>
  createCategory: (tripId: string, input: CategoryInput) => Promise<CategoryResult>
  updateCategory: (tripId: string, categoryId: string, patch: CategoryPatch) => Promise<CategoryResult>
  /** `moveTo` is required when the category has expenses. */
  deleteCategory: (tripId: string, categoryId: string, moveTo: string | null) => Promise<CategoryResult>
  reorderCategories: (tripId: string, orderedIds: string[]) => Promise<CategoryResult>
  saveDraft: (key: string, draft: ExpenseDraft) => void
  clearDraft: (key: string) => void
  /** Converts pending expenses (no rate yet) with cached or fetched rates; never touches manual rates. Returns how many. */
  reconcilePending: (tripId?: string) => Promise<number>
  /** Refreshes stale rate tables for the loaded trips, then reconciles pending expenses. */
  syncRates: (tripId?: string) => Promise<void>
  setDefaultCurrency: (tripId: string, currency: string, rates: RatesPayload) => Promise<CategoryResult>
  showToast: (kind: Toast['kind'], message: string) => void
  dismissToast: () => void
}

export type TripsStore = StoreApi<TripsState>

const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

/** Creates the Trips store around an injected repository. */
export function createTripStore(repository: TripsRepository, fx: FxService = createNullFxService()): TripsStore {
  let toastSeq = 0
  let reconciling = false

  return createStore<TripsState>()((set, get) => {
    /** Applies `fn` to one trip snapshot, if loaded. */
    const patchTrip = (tripId: string, fn: (snap: TripSnapshot) => TripSnapshot) =>
      set((state) => {
        const snap = state.trips[tripId]
        return snap ? { trips: { ...state.trips, [tripId]: fn(snap) } } : state
      })

    const putExpense = (tripId: string, expense: TripExpense, shares: TripExpenseShare[]) =>
      patchTrip(tripId, (snap) => ({
        ...snap,
        expenses: snap.expenses.filter((e) => e.id !== expense.id).concat(expense),
        shares: snap.shares.filter((s) => s.expense_id !== expense.id).concat(shares),
      }))

    const dropExpense = (tripId: string, expenseId: string) =>
      patchTrip(tripId, (snap) => ({
        ...snap,
        expenses: snap.expenses.filter((e) => e.id !== expenseId),
        shares: snap.shares.filter((s) => s.expense_id !== expenseId),
      }))

    const putCategories = (tripId: string, categories: TripCategory[]) =>
      patchTrip(tripId, (snap) => ({ ...snap, categories }))

    /** Maps a repository failure to a result, toasting unless it is an inline duplicate error. */
    const failure = (err: unknown, what: string): CategoryResult => {
      const duplicate = (err as { code?: string }).code === DUPLICATE_CODE
      const message = messageOf(err)
      if (!duplicate) get().showToast('error', `Couldn't ${what}. ${message}`)
      return { ok: false, error: message, duplicate }
    }
    const invalid = (error: string): CategoryResult => ({ ok: false, error })

    return {
      trips: {},
      tripOrder: [],
      listStatus: 'idle',
      listError: null,
      tripStatus: {},
      tripError: {},
      toast: null,
      drafts: {},

      async loadTrips() {
        set({ listStatus: 'loading', listError: null })
        try {
          const snapshots = await repository.listTrips()
          const trips: Record<string, TripSnapshot> = {}
          for (const s of snapshots) trips[s.trip.id] = s
          set((state) => ({
            trips: { ...state.trips, ...trips },
            tripOrder: snapshots.map((s) => s.trip.id),
            tripStatus: {
              ...state.tripStatus,
              ...Object.fromEntries(snapshots.map((s) => [s.trip.id, 'ready' as const])),
            },
            listStatus: 'ready',
          }))
        } catch (err) {
          set({ listStatus: 'error', listError: messageOf(err) })
        }
      },

      async loadTrip(tripId) {
        set((state) => ({ tripStatus: { ...state.tripStatus, [tripId]: 'loading' } }))
        try {
          const snap = await repository.getTrip(tripId)
          if (!snap) throw new Error('This trip does not exist or you are not a member.')
          set((state) => ({
            trips: { ...state.trips, [tripId]: snap },
            tripOrder: state.tripOrder.includes(tripId) ? state.tripOrder : [tripId, ...state.tripOrder],
            tripStatus: { ...state.tripStatus, [tripId]: 'ready' },
            tripError: { ...state.tripError, [tripId]: '' },
          }))
        } catch (err) {
          set((state) => ({
            tripStatus: { ...state.tripStatus, [tripId]: 'error' },
            tripError: { ...state.tripError, [tripId]: messageOf(err) },
          }))
        }
      },

      async createTrip(input) {
        try {
          const id = await repository.createTrip(input)
          const snap = await repository.getTrip(id)
          if (!snap) throw new Error('The trip was created but could not be loaded.')
          set((state) => ({
            trips: { ...state.trips, [id]: snap },
            tripOrder: [id, ...state.tripOrder.filter((t) => t !== id)],
            tripStatus: { ...state.tripStatus, [id]: 'ready' },
          }))
          return id
        } catch (err) {
          get().showToast('error', `Couldn't create the trip. ${messageOf(err)}`)
          return null
        }
      },

      async saveExpense(input) {
        const snap = get().trips[input.tripId]
        if (!snap) {
          get().showToast('error', 'Trip not loaded.')
          return false
        }
        const defaultCurrency = snap.trip.default_currency
        const currency = input.currency ?? defaultCurrency
        const same = currency === defaultCurrency
        const fxRate = same ? 1 : (input.fxRate ?? null)
        let total = 0
        for (const minor of input.shares.values()) total += minor
        if (input.amountMinor <= 0 || total !== input.amountMinor) {
          get().showToast('error', 'The split must add up to the amount.')
          return false
        }

        const previous = input.id ? snap.expenses.find((e) => e.id === input.id) : undefined
        const previousShares = previous ? snap.shares.filter((s) => s.expense_id === previous.id) : []
        const now = new Date().toISOString()
        const amount = fromMinor(input.amountMinor, currency)
        const id = input.id ?? newId()
        const expense: TripExpense = {
          // Place and rate fields carry over when editing.
          place_name: null, place_address: null, place_area: null, place_city: null,
          place_country: null, place_lat: null, place_lng: null, place_provider_id: null,
          created_by: repository.currentUserId,
          client_id: newId(),
          created_at: now,
          ...previous,
          id,
          trip_id: input.tripId,
          category_id: input.categoryId,
          title: input.title.trim(),
          amount,
          currency,
          fx_rate: fxRate,
          fx_source: fxRate === null ? null : same ? 'same' : (input.fxSource ?? 'cache'),
          fx_date: same ? null : (input.fxDate ?? null),
          amount_default: amountDefault(amount, currency, fxRate, defaultCurrency),
          paid_by: input.paidBy,
          split_mode: input.splitMode,
          date: input.date,
          note: input.note ?? null,
          updated_at: now,
        }
        const shares: TripExpenseShare[] = [...input.shares].map(([member_id, minor]) => ({
          expense_id: id,
          member_id,
          weight: 1,
          amount: fromMinor(minor, currency),
        }))

        putExpense(input.tripId, expense, shares)
        try {
          await repository.saveExpense(expense, shares)
          return true
        } catch (err) {
          if (previous) putExpense(input.tripId, previous, previousShares)
          else dropExpense(input.tripId, id)
          get().showToast('error', `Couldn't save the expense. ${messageOf(err)}`)
          return false
        }
      },

      async deleteExpense(tripId, expenseId) {
        const snap = get().trips[tripId]
        const previous = snap?.expenses.find((e) => e.id === expenseId)
        if (!snap || !previous) return false
        const previousShares = snap.shares.filter((s) => s.expense_id === expenseId)

        dropExpense(tripId, expenseId)
        try {
          await repository.deleteExpense(expenseId)
          return true
        } catch (err) {
          putExpense(tripId, previous, previousShares)
          get().showToast('error', `Couldn't delete the expense. ${messageOf(err)}`)
          return false
        }
      },

      async createCategory(tripId, input) {
        const snap = get().trips[tripId]
        if (!snap) return invalid('Trip not loaded.')
        const name = input.name.trim()
        if (name.length < 1) return invalid('Give the category a name')
        if (name.length > CATEGORY_NAME_MAX) return invalid(`Use ${CATEGORY_NAME_MAX} characters or fewer`)
        if (isDuplicateCategoryName(name, snap.categories)) {
          return { ok: false, duplicate: true, error: `There's already a category called ${name}` }
        }
        // The id comes from the server, so this one waits for the answer.
        try {
          const id = await repository.createCategory(tripId, { ...input, name })
          const now = new Date().toISOString()
          const me = snap.members.find((m) => m.user_id === repository.currentUserId)
          const created: TripCategory = {
            id,
            trip_id: tripId,
            key: null,
            name,
            icon: input.icon,
            color: input.color,
            sort_order: Math.max(-1, ...snap.categories.map((c) => c.sort_order)) + 1,
            hidden_at: null,
            created_by_member: me?.id ?? null,
            created_at: now,
            updated_at: now,
          }
          patchTrip(tripId, (s) => ({ ...s, categories: s.categories.filter((c) => c.id !== id).concat(created) }))
          return { ok: true, id }
        } catch (err) {
          return failure(err, 'add the category')
        }
      },

      async updateCategory(tripId, categoryId, patch) {
        const snap = get().trips[tripId]
        const previous = snap?.categories.find((c) => c.id === categoryId)
        if (!snap || !previous) return invalid('Category not found.')
        const name = patch.name?.trim()
        if (patch.name !== undefined) {
          if (!name) return invalid('Give the category a name')
          if (name.length > CATEGORY_NAME_MAX) return invalid(`Use ${CATEGORY_NAME_MAX} characters or fewer`)
          if (isDuplicateCategoryName(name, snap.categories, categoryId)) {
            return { ok: false, duplicate: true, error: `There's already a category called ${name}` }
          }
        }
        if (
          patch.hidden === true &&
          previous.hidden_at === null &&
          !snap.categories.some((c) => c.id !== categoryId && c.hidden_at === null)
        ) {
          return invalid('Your trip needs at least one visible category.')
        }

        const now = new Date().toISOString()
        const next: TripCategory = {
          ...previous,
          name: name ?? previous.name,
          icon: patch.icon ?? previous.icon,
          color: patch.color ?? previous.color,
          hidden_at: patch.hidden === undefined ? previous.hidden_at : patch.hidden ? (previous.hidden_at ?? now) : null,
          updated_at: now,
        }
        putCategories(tripId, snap.categories.map((c) => (c.id === categoryId ? next : c)))
        try {
          await repository.updateCategory(categoryId, { ...patch, ...(name !== undefined ? { name } : {}) })
          return { ok: true, id: categoryId }
        } catch (err) {
          const current = get().trips[tripId]
          if (current) putCategories(tripId, current.categories.map((c) => (c.id === categoryId ? previous : c)))
          return failure(err, 'update the category')
        }
      },

      async deleteCategory(tripId, categoryId, moveTo) {
        const snap = get().trips[tripId]
        const previous = snap?.categories.find((c) => c.id === categoryId)
        if (!snap || !previous) return invalid('Category not found.')
        const moved = snap.expenses.filter((e) => e.category_id === categoryId)
        if (previous.hidden_at === null && !snap.categories.some((c) => c.id !== categoryId && c.hidden_at === null)) {
          return invalid('Your trip needs at least one visible category.')
        }
        if (moved.length > 0 && (moveTo === null || moveTo === categoryId || !snap.categories.some((c) => c.id === moveTo))) {
          return invalid(`Choose a category to move its ${moved.length} expenses to.`)
        }

        const movedIds = new Set(moved.map((e) => e.id))
        patchTrip(tripId, (s) => ({
          ...s,
          categories: s.categories.filter((c) => c.id !== categoryId),
          expenses: s.expenses.map((e) => (movedIds.has(e.id) && moveTo ? { ...e, category_id: moveTo } : e)),
        }))
        try {
          await repository.deleteCategory(categoryId, moveTo)
          return { ok: true, id: categoryId }
        } catch (err) {
          patchTrip(tripId, (s) => ({
            ...s,
            categories: s.categories.concat(previous),
            expenses: s.expenses.map((e) => (movedIds.has(e.id) ? { ...e, category_id: categoryId } : e)),
          }))
          return failure(err, 'delete the category')
        }
      },

      async reorderCategories(tripId, orderedIds) {
        const snap = get().trips[tripId]
        if (!snap) return invalid('Trip not loaded.')
        const previous = snap.categories
        const rest = [...previous].sort((a, b) => a.sort_order - b.sort_order).map((c) => c.id).filter((id) => !orderedIds.includes(id))
        const order = new Map([...orderedIds, ...rest].map((id, i) => [id, i]))
        putCategories(tripId, previous.map((c) => ({ ...c, sort_order: order.get(c.id) ?? c.sort_order })))
        try {
          await repository.reorderCategories(tripId, orderedIds)
          return { ok: true }
        } catch (err) {
          putCategories(tripId, previous)
          return failure(err, 'reorder the categories')
        }
      },

      saveDraft(key, draft) {
        set((state) => ({ drafts: { ...state.drafts, [key]: draft } }))
      },

      clearDraft(key) {
        set((state) => {
          if (!(key in state.drafts)) return state
          const drafts = { ...state.drafts }
          delete drafts[key]
          return { drafts }
        })
      },

      async reconcilePending(tripId) {
        if (reconciling) return 0
        reconciling = true
        let converted = 0
        try {
          for (const id of tripId ? [tripId] : Object.keys(get().trips)) {
            const snap = get().trips[id]
            if (!snap) continue
            const defaultCurrency = snap.trip.default_currency
            const pending = snap.expenses.filter(
              (e) => e.fx_rate === null && e.currency !== defaultCurrency && e.fx_source !== 'manual',
            )
            for (const e of pending) {
              const rate = await fx.getRate(e.currency, defaultCurrency, e.date)
              if (!rate || rate.source === 'same') continue
              // Re-read: the user may have typed a manual rate while we were waiting.
              const current = get().trips[id]?.expenses.find((x) => x.id === e.id)
              if (!current || current.fx_rate !== null || current.fx_source === 'manual') continue
              const next: TripExpense = {
                ...current,
                fx_rate: rate.rate,
                fx_source: 'api',
                fx_date: rate.tableDate,
                amount_default: amountDefault(current.amount, current.currency, rate.rate, defaultCurrency),
                updated_at: new Date().toISOString(),
              }
              const shares = get().trips[id]?.shares.filter((s) => s.expense_id === e.id) ?? []
              putExpense(id, next, shares)
              try {
                await repository.saveExpense(next, shares)
                converted += 1
              } catch {
                putExpense(id, current, shares)
              }
            }
          }
        } finally {
          reconciling = false
        }
        if (converted > 0) {
          get().showToast('info', `${converted} pending ${converted === 1 ? 'expense' : 'expenses'} converted`)
        }
        return converted
      },

      async syncRates(tripId) {
        const ids = tripId ? [tripId] : Object.keys(get().trips)
        const bases = new Set(ids.flatMap((id) => (get().trips[id] ? [get().trips[id]!.trip.default_currency] : [])))
        await Promise.all([...bases].map((b) => fx.warm(b)))
        await get().reconcilePending(tripId)
      },

      async setDefaultCurrency(tripId, currency, rates) {
        try {
          await repository.setDefaultCurrency(tripId, currency, rates)
          const fresh = await repository.getTrip(tripId)
          if (!fresh) throw new Error('Trip not found')
          set((state) => ({ trips: { ...state.trips, [tripId]: fresh } }))
          return { ok: true }
        } catch (err) {
          return failure(err, 'change the default currency')
        }
      },

      showToast(kind, message) {
        toastSeq += 1
        set({ toast: { id: toastSeq, kind, message } })
      },

      dismissToast() {
        set({ toast: null })
      },
    }
  })
}
