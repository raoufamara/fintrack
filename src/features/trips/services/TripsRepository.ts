import type {
  CategoryColorKey,
  Trip,
  TripCategory,
  TripExpense,
  TripExpenseShare,
  TripMember,
  TripSettlement,
} from '../types'

/** Everything the app knows about one trip. */
export interface TripSnapshot {
  trip: Trip
  members: TripMember[]
  categories: TripCategory[]
  expenses: TripExpense[]
  shares: TripExpenseShare[]
  settlements: TripSettlement[]
}

export interface CategoryInput {
  name: string
  icon: string
  color: CategoryColorKey
}

export interface CategoryPatch {
  name?: string
  icon?: string
  color?: CategoryColorKey
  hidden?: boolean
}

/** Error raised by a repository; `code` carries the Postgres code when known ('23505' = duplicate). */
export class RepositoryError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'RepositoryError'
    this.code = code
  }
}

export const DUPLICATE_CODE = '23505'

export interface NewTripInput {
  name: string
  defaultCurrency: string
  startDate: string | null
  endDate: string | null
  /** Major units of the default currency. */
  budgetAmount: number | null
  /** Names of the other members; the creator is added automatically. */
  memberNames: string[]
}

/**
 * Storage boundary of the Trips module. The store depends only on this
 * interface, so Trips can run against Supabase, in memory (demo, tests) or
 * against any other backend.
 */
export interface TripsRepository {
  /** The signed-in user; used to find the current member of a trip. */
  readonly currentUserId: string
  listTrips(): Promise<TripSnapshot[]>
  getTrip(tripId: string): Promise<TripSnapshot | null>
  /** Returns the new trip id. */
  createTrip(input: NewTripInput): Promise<string>
  /** Insert or update an expense and replace its shares. Idempotent on `expense.id`. */
  saveExpense(expense: TripExpense, shares: TripExpenseShare[]): Promise<void>
  deleteExpense(expenseId: string): Promise<void>
  /** Returns the new category id. Rejects with code '23505' on a duplicate name. */
  createCategory(tripId: string, input: CategoryInput): Promise<string>
  updateCategory(categoryId: string, patch: CategoryPatch): Promise<void>
  /** Reassigns the category's expenses to `moveTo` (required when it has any), then deletes it. */
  deleteCategory(categoryId: string, moveTo: string | null): Promise<void>
  /** Listed ids come first, in order; unlisted categories follow. */
  reorderCategories(tripId: string, orderedIds: string[]): Promise<void>
}
