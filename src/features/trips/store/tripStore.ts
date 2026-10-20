import { createStore, type StoreApi } from 'zustand/vanilla'
import { fromMinor } from '../lib/currency'
import type { NewTripInput, TripSnapshot, TripsRepository } from '../services/TripsRepository'
import { newId } from '../services/ids'
import type { SplitMode, TripExpense, TripExpenseShare } from '../types'

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
  /** Per-member shares in minor units; must sum to `amountMinor`. */
  shares: ReadonlyMap<string, number>
}

export interface TripsState {
  trips: Record<string, TripSnapshot>
  tripOrder: string[]
  listStatus: LoadStatus
  listError: string | null
  tripStatus: Record<string, LoadStatus>
  tripError: Record<string, string>
  toast: Toast | null

  loadTrips: () => Promise<void>
  loadTrip: (tripId: string) => Promise<void>
  createTrip: (input: NewTripInput) => Promise<string | null>
  saveExpense: (input: SaveExpenseInput) => Promise<boolean>
  deleteExpense: (tripId: string, expenseId: string) => Promise<boolean>
  showToast: (kind: Toast['kind'], message: string) => void
  dismissToast: () => void
}

export type TripsStore = StoreApi<TripsState>

const messageOf = (err: unknown) => (err instanceof Error ? err.message : 'Something went wrong')

/** Creates the Trips store around an injected repository. */
export function createTripStore(repository: TripsRepository): TripsStore {
  let toastSeq = 0

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

    return {
      trips: {},
      tripOrder: [],
      listStatus: 'idle',
      listError: null,
      tripStatus: {},
      tripError: {},
      toast: null,

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
        const currency = snap.trip.default_currency
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
          fx_rate: 1,
          fx_source: 'same',
          fx_date: null,
          amount_default: amount,
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
