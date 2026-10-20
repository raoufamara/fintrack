/**
 * Domain types for the Trips module. They mirror the `trip_*` tables from
 * supabase/migrations/002_trips.sql. Amounts are decimal numbers in major
 * units exactly as Supabase returns `numeric` columns; the `lib/` helpers turn
 * them into integer minor units before doing any arithmetic.
 */

export type CategoryColorKey =
  | 'blue'
  | 'rust'
  | 'teal'
  | 'purple'
  | 'green'
  | 'pink'
  | 'grey'

export type FxSource = 'cache' | 'api' | 'manual' | 'same'

export type SplitMode = 'equal' | 'exact' | 'shares'

export interface Trip {
  id: string
  name: string
  /** ISO 4217. Totals and balances are expressed in this currency. */
  default_currency: string
  start_date: string | null
  end_date: string | null
  /** In `default_currency`. */
  budget_amount: number | null
  invite_code: string
  share_token: string
  share_enabled: boolean
  created_by: string
  archived_at: string | null
  created_at: string
}

export interface TripMember {
  id: string
  trip_id: string
  display_name: string
  /** Null until the member is claimed by an account. */
  user_id: string | null
  color: string
  /** Personal "show in" currency; null means the user's home currency. */
  display_currency: string | null
  created_at: string
}

export interface TripCategory {
  id: string
  trip_id: string
  /** Set on seeded rows only ('stay', 'food', ...); null for custom ones. */
  key: string | null
  name: string
  /** Lucide icon name from the curated list. */
  icon: string
  color: CategoryColorKey
  sort_order: number
  hidden_at: string | null
  created_by_member: string | null
  created_at: string
  updated_at: string
}

export interface TripExpense {
  id: string
  trip_id: string
  category_id: string
  title: string
  /** In `currency`. */
  amount: number
  currency: string
  /** 1 unit of `currency` in the trip default currency. Null means pending. */
  fx_rate: number | null
  fx_source: FxSource | null
  fx_date: string | null
  /** Null while the rate is pending. */
  amount_default: number | null
  paid_by: string
  split_mode: SplitMode
  /** YYYY-MM-DD */
  date: string
  note: string | null
  place_name: string | null
  place_address: string | null
  place_area: string | null
  place_city: string | null
  place_country: string | null
  place_lat: number | null
  place_lng: number | null
  place_provider_id: string | null
  created_by: string
  client_id: string | null
  created_at: string
  updated_at: string
}

export interface TripExpenseShare {
  expense_id: string
  member_id: string
  weight: number
  /** The member's share, in the expense's original currency. */
  amount: number
}

export interface TripSettlement {
  id: string
  trip_id: string
  from_member: string
  to_member: string
  amount: number
  currency: string
  fx_rate: number
  /** Idempotency key from the retry queue. */
  client_id?: string | null
  created_at: string
}

/** URL-synced filter state for the expense list (spec section 6). */
export interface TripExpenseFilter {
  /** Empty means all categories. */
  categoryIds: string[]
  /** City names, or the sentinel 'none' for expenses without a location. */
  places: string[]
  /** Member id of the payer. */
  payer: string | null
  /** Only expenses the current member has a share in. */
  mine: boolean
  /** Inclusive lower bound, YYYY-MM-DD. */
  from: string | null
  /** Inclusive upper bound, YYYY-MM-DD. */
  to: string | null
  /** Free text over title, place name and city; case and accent insensitive. */
  q: string
  // Reserved for later: currencies: string[]
}

export interface Transfer {
  from: string
  to: string
  /** Minor units of the trip default currency. */
  amount: number
}

export interface FilterContext {
  defaultCurrency: string
  /** The viewing member; needed for `mine` and `myShareDefault`. */
  currentMemberId: string | null
}

export interface FilterResult {
  items: TripExpense[]
  /** Minor units of the default currency, pending expenses excluded. */
  totalDefault: number
  /** The current member's share of `items`, minor units of the default currency. */
  myShareDefault: number
  pendingCount: number
  /** Counts per category id, computed with the category facet removed. */
  countByCategory: Record<string, number>
  /** Counts per place key (city, or 'none'), computed with the place facet removed. */
  countByPlace: Record<string, number>
  /** Expenses without a location that the place facet is currently hiding. */
  hiddenNoLocationCount: number
}

/**
 * Wire format of the `import_trip` RPC (supabase/migrations/003_trip_import.sql).
 * Rows refer to each other by client-side keys; the server resolves them to ids.
 * Amounts are decimals in major units.
 */
export interface ImportMemberInput {
  key: string
  display_name: string
  /** Exactly one member: the importing user's own. */
  is_me: boolean
}

export interface ImportShareInput {
  member_key: string
  /** In the expense's currency. */
  amount: number
}

export interface ImportExpenseInput {
  title: string
  amount: number
  currency: string
  /** Null leaves the expense pending. */
  fx_rate: number | null
  fx_source: FxSource | null
  fx_date: string | null
  /** One of the seeded category keys ('stay', 'food', ...). */
  category_key: string
  paid_by_key: string
  split_mode: SplitMode
  date: string
  note: string
  shares: ImportShareInput[]
}

export interface ImportSettlementInput {
  from_key: string
  to_key: string
  /** In the trip default currency. */
  amount: number
  date: string
}

export interface ImportTripPayload {
  trip: {
    name: string
    default_currency: string
    start_date: string | null
    end_date: string | null
  }
  members: ImportMemberInput[]
  expenses: ImportExpenseInput[]
  settlements: ImportSettlementInput[]
}
