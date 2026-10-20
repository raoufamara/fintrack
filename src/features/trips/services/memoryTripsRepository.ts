import { DEFAULT_CATEGORIES, isDuplicateCategoryName } from '../lib/categories'
import { todayISO } from '../lib/dates'
import { amountDefault } from '../lib/money'
import type { Trip, TripCategory, TripExpense, TripExpenseShare, TripMember, TripSettlement } from '../types'
import { newId } from './ids'
import { buildLisbonPortoSeed } from './memorySeed'
import {
  DUPLICATE_CODE,
  NetworkError,
  RepositoryError,
  type NewTripInput,
  type TripSnapshot,
  type TripsRepository,
} from './TripsRepository'

/** Shared storage, so several repositories (several users or devices) can see the same trips. */
export interface MemoryBackend {
  db: Map<string, TripSnapshot>
  listeners: Map<string, Set<() => void>>
  /** Last serialised snapshot per trip, used to detect changes. */
  seen: Map<string, string>
}

export function createMemoryBackend(seed: TripSnapshot[] = []): MemoryBackend {
  const db = new Map<string, TripSnapshot>()
  for (const snap of seed) db.set(snap.trip.id, structuredClone(snap))
  const seen = new Map([...db].map(([id, snap]) => [id, JSON.stringify(snap)]))
  return { db, listeners: new Map(), seen }
}

export interface MemoryRepositoryOptions {
  currentUserId: string
  /** Initial data. Defaults to the Lisbon & Porto sample trip; pass [] for a blank slate. Ignored with `backend`. */
  seed?: TripSnapshot[]
  /** Share storage with other repositories. */
  backend?: MemoryBackend
  /** Simulated network delay in ms. */
  latencyMs?: number
  /** Writes fail with a NetworkError while this returns false. Reads keep working (as if cached). */
  isOnline?: () => boolean
  /** Display name for members created by `joinTrip`. */
  displayName?: string
}

export interface MemoryTripsRepository extends TripsRepository {
  /** Changes a trip as if another device had, and notifies subscribers. Test and demo helper. */
  simulateRemote(tripId: string, mutate: (snap: TripSnapshot) => void): void
}

const AVATAR_COLORS = ['#FD6FB8', '#93D4D9', '#FDAC62', '#D0E2FF', '#B9A1FF', '#A8E6A1', '#FFD36B', '#F7B2B2']

const clone = <T,>(value: T): T => structuredClone(value)

/** In-memory implementation used by the demo and by tests. */
export function createMemoryTripsRepository(options: MemoryRepositoryOptions): MemoryTripsRepository {
  const { currentUserId, latencyMs = 0, isOnline = () => true } = options
  const backend =
    options.backend ?? createMemoryBackend(options.seed ?? [buildLisbonPortoSeed(currentUserId, todayISO())])
  const { db } = backend

  const isMember = (snap: TripSnapshot) => snap.members.some((m) => m.user_id === currentUserId)
  const requireTrip = (tripId: string): TripSnapshot => {
    const snap = db.get(tripId)
    if (!snap || !isMember(snap)) throw new RepositoryError('Not a member of this trip', '42501')
    return snap
  }

  /** Tells subscribers of every trip that changed since the last time we looked. */
  const notifyChanged = () => {
    for (const [id, snap] of db) {
      const json = JSON.stringify(snap)
      if (backend.seen.get(id) !== json) {
        backend.seen.set(id, json)
        backend.listeners.get(id)?.forEach((cb) => cb())
      }
    }
  }

  const findCategory = (categoryId: string) => {
    for (const snap of db.values()) {
      const category = snap.categories.find((c) => c.id === categoryId)
      if (category) return { snap, category }
    }
    return null
  }

  const wait = () => (latencyMs > 0 ? new Promise<void>((r) => setTimeout(r, latencyMs)) : Promise.resolve())
  /** Start of a write: simulated latency, then the network check. */
  const write = async () => {
    await wait()
    if (!isOnline()) throw new NetworkError()
  }

  const repo: MemoryTripsRepository = {
    currentUserId,

    simulateRemote(tripId, mutate) {
      const snap = db.get(tripId)
      if (!snap) throw new Error('Trip not found')
      mutate(snap)
      notifyChanged()
    },

    subscribe(tripId, onChange) {
      const set = backend.listeners.get(tripId) ?? new Set<() => void>()
      set.add(onChange)
      backend.listeners.set(tripId, set)
      return () => {
        set.delete(onChange)
      }
    },

    async recordSettlement(settlement) {
      await write()
      const snap = requireTrip(settlement.trip_id)
      if (snap.settlements.some((s) => s.client_id && s.client_id === settlement.client_id)) return
      if (settlement.from_member === settlement.to_member) {
        throw new RepositoryError('A settlement needs two different members', '22023')
      }
      if (!(settlement.amount > 0)) throw new RepositoryError('Amount must be positive', '22023')
      const ids = new Set(snap.members.map((m) => m.id))
      if (!ids.has(settlement.from_member) || !ids.has(settlement.to_member)) {
        throw new RepositoryError('Both members must belong to this trip', '22023')
      }
      const stored: TripSettlement = { ...clone(settlement), currency: snap.trip.default_currency, fx_rate: 1 }
      snap.settlements.push(stored)
    },

    async addMember(tripId, name) {
      await write()
      const snap = requireTrip(tripId)
      const trimmed = name.trim()
      if (trimmed.length < 1 || trimmed.length > 40) throw new RepositoryError('Name must be 1-40 characters', '22023')
      const member: TripMember = {
        id: newId(),
        trip_id: tripId,
        display_name: trimmed,
        user_id: null,
        color: AVATAR_COLORS[snap.members.length % AVATAR_COLORS.length] ?? '#DDDDDD',
        display_currency: null,
        created_at: new Date().toISOString(),
      }
      snap.members.push(member)
      return member.id
    },

    async previewInvite(code) {
      await wait()
      const wanted = code.trim().toLowerCase()
      const snap = [...db.values()].find((s) => s.trip.invite_code === wanted)
      if (!snap) throw new RepositoryError('Invalid invite code', 'P0002')
      return {
        tripId: snap.trip.id,
        name: snap.trip.name,
        startDate: snap.trip.start_date,
        endDate: snap.trip.end_date,
        defaultCurrency: snap.trip.default_currency,
        unclaimed: snap.members.filter((m) => m.user_id === null).map((m) => ({ id: m.id, displayName: m.display_name })),
      }
    },

    async joinTrip(code, memberId) {
      await write()
      const wanted = code.trim().toLowerCase()
      const snap = [...db.values()].find((s) => s.trip.invite_code === wanted)
      if (!snap) throw new RepositoryError('Invalid invite code', 'P0002')
      const existing = snap.members.find((m) => m.user_id === currentUserId)
      if (existing) return existing.id
      if (memberId) {
        const target = snap.members.find((m) => m.id === memberId)
        if (!target) throw new RepositoryError('Member not found in this trip', 'P0002')
        if (target.user_id !== null) throw new RepositoryError('This member has already been claimed', DUPLICATE_CODE)
        target.user_id = currentUserId
        return target.id
      }
      const member: TripMember = {
        id: newId(),
        trip_id: snap.trip.id,
        display_name: options.displayName ?? 'New member',
        user_id: currentUserId,
        color: AVATAR_COLORS[snap.members.length % AVATAR_COLORS.length] ?? '#DDDDDD',
        display_currency: null,
        created_at: new Date().toISOString(),
      }
      snap.members.push(member)
      return member.id
    },

    async updateMyDisplayCurrency(memberId, currency) {
      await write()
      for (const snap of db.values()) {
        const m = snap.members.find((x) => x.id === memberId)
        if (m) {
          if (m.user_id !== currentUserId) {
            throw new RepositoryError('Only the member themself can change their display currency', '42501')
          }
          m.display_currency = currency
          return
        }
      }
      throw new RepositoryError('Member not found', 'P0002')
    },


    async listTrips() {
      await wait()
      return [...db.values()].filter(isMember).map(clone)
    },

    async getTrip(tripId) {
      await wait()
      const snap = db.get(tripId)
      return snap && isMember(snap) ? clone(snap) : null
    },

    async createTrip(input: NewTripInput) {
      await write()
      const now = new Date().toISOString()
      const trip: Trip = {
        id: newId(),
        name: input.name.trim(),
        default_currency: input.defaultCurrency,
        start_date: input.startDate,
        end_date: input.endDate,
        budget_amount: input.budgetAmount,
        invite_code: newId().slice(0, 8),
        share_token: newId().replace(/-/g, ''),
        share_enabled: true,
        created_by: currentUserId,
        archived_at: null,
        created_at: now,
      }
      const names = ['You', ...input.memberNames.map((n) => n.trim()).filter(Boolean)]
      const members: TripMember[] = names.map((display_name, i) => ({
        id: newId(),
        trip_id: trip.id,
        display_name,
        user_id: i === 0 ? currentUserId : null,
        color: AVATAR_COLORS[i % AVATAR_COLORS.length] ?? '#DDDDDD',
        display_currency: null,
        created_at: now,
      }))
      const categories: TripCategory[] = DEFAULT_CATEGORIES.map((c, i) => ({
        id: newId(),
        trip_id: trip.id,
        key: c.key,
        name: c.name,
        icon: c.icon,
        color: c.color,
        sort_order: i,
        hidden_at: null,
        created_by_member: null,
        created_at: now,
        updated_at: now,
      }))
      db.set(trip.id, { trip, members, categories, expenses: [], shares: [], settlements: [] })
      return trip.id
    },

    async saveExpense(expense: TripExpense, shares: TripExpenseShare[]) {
      await write()
      const snap = db.get(expense.trip_id)
      if (!snap) throw new Error('Trip not found')
      if (!snap.categories.some((c) => c.id === expense.category_id)) {
        throw new Error('Category does not belong to this trip')
      }
      const sum = shares.reduce((acc, s) => acc + Math.round(s.amount * 1000), 0)
      if (sum !== Math.round(expense.amount * 1000)) {
        throw new Error('Shares must sum to the amount')
      }
      // Idempotent on client_id, like the server: a replay resolves to the expense it created.
      const byClient = expense.client_id ? snap.expenses.find((e) => e.client_id === expense.client_id) : undefined
      if (byClient && byClient.id !== expense.id) {
        expense = { ...expense, id: byClient.id }
        shares = shares.map((s) => ({ ...s, expense_id: byClient.id }))
      }
      // Mirror the server: same-currency expenses get rate 1, and amount_default is computed here.
      const same = expense.currency === snap.trip.default_currency
      const rate = same ? 1 : expense.fx_rate
      const stored: TripExpense = {
        ...clone(expense),
        fx_rate: rate,
        fx_source: rate === null ? null : same ? 'same' : expense.fx_source,
        amount_default: amountDefault(expense.amount, expense.currency, rate, snap.trip.default_currency),
      }
      snap.expenses = snap.expenses.filter((e) => e.id !== expense.id).concat(stored)
      snap.shares = snap.shares.filter((s) => s.expense_id !== expense.id).concat(clone(shares))
    },

    async deleteExpense(expenseId: string) {
      await write()
      for (const snap of db.values()) {
        if (snap.expenses.some((e) => e.id === expenseId)) {
          snap.expenses = snap.expenses.filter((e) => e.id !== expenseId)
          snap.shares = snap.shares.filter((s) => s.expense_id !== expenseId)
          return
        }
      }
      throw new Error('Expense not found')
    },

    async setDefaultCurrency(tripId, currency, rates) {
      await write()
      const snap = db.get(tripId)
      if (!snap) throw new Error('Trip not found')
      const old = snap.trip.default_currency
      if (old === currency) return
      const pick = (ccy: string, date: string): number | null => {
        const r = rates[ccy]?.[date] ?? rates[ccy]?.['latest']
        return r !== undefined && r > 0 ? r : null
      }
      // Validate everything first so a failure changes nothing (the server is transactional).
      const settlementRates = snap.settlements.map((s) => {
        if (s.currency === currency) return 1
        const r = pick(s.currency, s.created_at.slice(0, 10))
        if (r === null) throw new Error(`Missing rate for settlement currency ${s.currency}`)
        return r
      })
      let budget = snap.trip.budget_amount
      if (budget !== null) {
        const r = rates[old]?.['latest']
        if (r === undefined || r <= 0) throw new Error(`Missing latest rate for ${old} (needed to convert the budget)`)
        budget = Math.round(budget * r * 100) / 100
      }
      for (const e of snap.expenses) {
        if (e.currency === currency) {
          e.fx_rate = 1
          e.fx_source = 'same'
        } else {
          const r = pick(e.currency, e.date)
          e.fx_rate = r
          e.fx_source = r === null ? null : 'api'
        }
        e.amount_default = amountDefault(e.amount, e.currency, e.fx_rate, currency)
      }
      snap.settlements.forEach((s, i) => (s.fx_rate = settlementRates[i] ?? 1))
      snap.trip.budget_amount = budget
      snap.trip.default_currency = currency
    },

    async createCategory(tripId, input) {
      await write()
      const snap = db.get(tripId)
      if (!snap) throw new Error('Trip not found')
      const name = input.name.trim()
      if (name.length < 1 || name.length > 24) throw new Error('Name must be 1-24 characters')
      if (isDuplicateCategoryName(name, snap.categories)) {
        throw new RepositoryError(`There's already a category called ${name}`, DUPLICATE_CODE)
      }
      const now = new Date().toISOString()
      const me = snap.members.find((m) => m.user_id === currentUserId)
      const category: TripCategory = {
        id: newId(),
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
      snap.categories.push(category)
      return category.id
    },

    async updateCategory(categoryId, patch) {
      await write()
      const found = findCategory(categoryId)
      if (!found) throw new Error('Category not found')
      const { snap, category } = found
      if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (name.length < 1 || name.length > 24) throw new Error('Name must be 1-24 characters')
        if (isDuplicateCategoryName(name, snap.categories, categoryId)) {
          throw new RepositoryError(`There's already a category called ${name}`, DUPLICATE_CODE)
        }
        category.name = name
      }
      if (patch.hidden === true && category.hidden_at === null) {
        if (!snap.categories.some((c) => c.id !== categoryId && c.hidden_at === null)) {
          throw new Error('The last visible category cannot be hidden')
        }
        category.hidden_at = new Date().toISOString()
      }
      if (patch.hidden === false) category.hidden_at = null
      if (patch.icon !== undefined) category.icon = patch.icon
      if (patch.color !== undefined) category.color = patch.color
      category.updated_at = new Date().toISOString()
    },

    async deleteCategory(categoryId, moveTo) {
      await write()
      const found = findCategory(categoryId)
      if (!found) throw new Error('Category not found')
      const { snap, category } = found
      if (category.hidden_at === null && !snap.categories.some((c) => c.id !== categoryId && c.hidden_at === null)) {
        throw new Error('The last visible category cannot be deleted')
      }
      const affected = snap.expenses.filter((e) => e.category_id === categoryId)
      if (moveTo !== null) {
        if (moveTo === categoryId || !snap.categories.some((c) => c.id === moveTo)) {
          throw new Error('Target category does not belong to this trip')
        }
      } else if (affected.length > 0) {
        throw new Error(`Category has ${affected.length} expenses; move_to is required`)
      }
      for (const e of affected) e.category_id = moveTo as string
      snap.categories = snap.categories.filter((c) => c.id !== categoryId)
    },

    async reorderCategories(tripId, orderedIds) {
      await write()
      const snap = db.get(tripId)
      if (!snap) throw new Error('Trip not found')
      if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !snap.categories.some((c) => c.id === id))) {
        throw new Error('ordered_ids must be distinct categories of this trip')
      }
      const rest = snap.categories
        .filter((c) => !orderedIds.includes(c.id))
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => c.id)
      ;[...orderedIds, ...rest].forEach((id, i) => {
        const c = snap.categories.find((x) => x.id === id)
        if (c) c.sort_order = i
      })
    },
  }

  // After every write, tell subscribers (other devices) about what changed.
  const target = repo as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  for (const name of [
    'createTrip', 'saveExpense', 'deleteExpense', 'setDefaultCurrency', 'createCategory', 'updateCategory',
    'deleteCategory', 'reorderCategories', 'recordSettlement', 'addMember', 'joinTrip', 'updateMyDisplayCurrency',
  ]) {
    const original = target[name]
    if (!original) continue
    target[name] = async (...args) => {
      const result = await original(...args)
      notifyChanged()
      return result
    }
  }
  return repo
}
