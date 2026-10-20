import type {
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
}
