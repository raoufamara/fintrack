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

/** The request could not reach the server (offline, DNS, timeout). Worth retrying later. */
export class NetworkError extends RepositoryError {
  constructor(message = 'Network unavailable') {
    super(message, 'network')
    this.name = 'NetworkError'
  }
}

/** True for failures that a retry can fix, as opposed to validation errors that it cannot. */
export function isNetworkError(err: unknown): boolean {
  return err instanceof NetworkError || err instanceof TypeError
}

export interface InvitePreview {
  tripId: string
  name: string
  startDate: string | null
  endDate: string | null
  defaultCurrency: string
  unclaimed: Array<{ id: string; displayName: string }>
}

/** `{ "<CCY>": { "<expense date>": rate, "latest": rate } }`, rates to the new default currency. */
export type RatesPayload = Record<string, Record<string, number>>

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
  /** Re-converts every expense (and settlements and budget) into `currency`. See `RatesPayload`. */
  setDefaultCurrency(tripId: string, currency: string, rates: RatesPayload): Promise<void>
  /** Idempotent on `settlement.client_id`. The amount is in the trip default currency. */
  recordSettlement(settlement: TripSettlement): Promise<void>
  /** Adds a name-only member; returns its id. */
  addMember(tripId: string, name: string): Promise<string>
  /** Trip and unclaimed members behind an invite code. Rejects with code 'P0002' for an unknown code. */
  previewInvite(code: string): Promise<InvitePreview>
  /** Claims `memberId` (or creates a member when null). Returns the caller's member id. Rejects with '23505' when already claimed. */
  joinTrip(code: string, memberId: string | null): Promise<string>
  /** Sets the caller's own personal "show in" currency (null = follow home currency). */
  updateMyDisplayCurrency(memberId: string, currency: string | null): Promise<void>
  /** Calls `onChange` when the trip changes elsewhere (another device). Returns an unsubscribe function. */
  subscribe(tripId: string, onChange: () => void): () => void
  /** Returns the new category id. Rejects with code '23505' on a duplicate name. */
  createCategory(tripId: string, input: CategoryInput): Promise<string>
  updateCategory(categoryId: string, patch: CategoryPatch): Promise<void>
  /** Reassigns the category's expenses to `moveTo` (required when it has any), then deletes it. */
  deleteCategory(categoryId: string, moveTo: string | null): Promise<void>
  /** Listed ids come first, in order; unlisted categories follow. */
  reorderCategories(tripId: string, orderedIds: string[]): Promise<void>
}
