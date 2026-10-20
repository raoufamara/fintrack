import { DEFAULT_CATEGORIES, isDuplicateCategoryName } from '../lib/categories'
import { todayISO } from '../lib/dates'
import type { Trip, TripCategory, TripExpense, TripExpenseShare, TripMember } from '../types'
import { newId } from './ids'
import { buildLisbonPortoSeed } from './memorySeed'
import {
  DUPLICATE_CODE,
  RepositoryError,
  type NewTripInput,
  type TripSnapshot,
  type TripsRepository,
} from './TripsRepository'

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

  const findCategory = (categoryId: string) => {
    for (const snap of db.values()) {
      const category = snap.categories.find((c) => c.id === categoryId)
      if (category) return { snap, category }
    }
    return null
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

    async createCategory(tripId, input) {
      await wait()
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
      await wait()
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
      await wait()
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
      await wait()
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
}
