import { DEFAULT_CATEGORIES } from '../lib/categories'
import { todayISO } from '../lib/dates'
import type { Trip, TripCategory, TripExpense, TripExpenseShare, TripMember } from '../types'
import { newId } from './ids'
import { buildLisbonPortoSeed } from './memorySeed'
import type { NewTripInput, TripSnapshot, TripsRepository } from './TripsRepository'

export interface MemoryRepositoryOptions {
  currentUserId: string
  /** Initial data. Defaults to the Lisbon & Porto sample trip; pass [] for a blank slate. */
  seed?: TripSnapshot[]
  /** Simulated network delay in ms. */
  latencyMs?: number
}

const AVATAR_COLORS = ['#FD6FB8', '#93D4D9', '#FDAC62', '#D0E2FF', '#B9A1FF', '#A8E6A1', '#FFD36B', '#F7B2B2']

const clone = <T,>(value: T): T => structuredClone(value)

/** In-memory implementation used by the demo and by tests. */
export function createMemoryTripsRepository(options: MemoryRepositoryOptions): TripsRepository {
  const { currentUserId, latencyMs = 0 } = options
  const db = new Map<string, TripSnapshot>()
  for (const snap of options.seed ?? [buildLisbonPortoSeed(currentUserId, todayISO())]) {
    db.set(snap.trip.id, clone(snap))
  }

  const wait = () => (latencyMs > 0 ? new Promise<void>((r) => setTimeout(r, latencyMs)) : Promise.resolve())

  return {
    currentUserId,

    async listTrips() {
      await wait()
      return [...db.values()].map(clone)
    },

    async getTrip(tripId) {
      await wait()
      const snap = db.get(tripId)
      return snap ? clone(snap) : null
    },

    async createTrip(input: NewTripInput) {
      await wait()
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
      await wait()
      const snap = db.get(expense.trip_id)
      if (!snap) throw new Error('Trip not found')
      if (!snap.categories.some((c) => c.id === expense.category_id)) {
        throw new Error('Category does not belong to this trip')
      }
      const sum = shares.reduce((acc, s) => acc + Math.round(s.amount * 1000), 0)
      if (sum !== Math.round(expense.amount * 1000)) {
        throw new Error('Shares must sum to the amount')
      }
      snap.expenses = snap.expenses.filter((e) => e.id !== expense.id).concat(clone(expense))
      snap.shares = snap.shares.filter((s) => s.expense_id !== expense.id).concat(clone(shares))
    },

    async deleteExpense(expenseId: string) {
      await wait()
      for (const snap of db.values()) {
        if (snap.expenses.some((e) => e.id === expenseId)) {
          snap.expenses = snap.expenses.filter((e) => e.id !== expenseId)
          snap.shares = snap.shares.filter((s) => s.expense_id !== expenseId)
          return
        }
      }
      throw new Error('Expense not found')
    },
  }
}
