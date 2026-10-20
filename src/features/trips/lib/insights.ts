import type { TripExpense, TripExpenseShare } from '../types'
import { expenseSharesDefault, expenseTotalDefault, groupSharesByExpense } from './balances'
import { toMinor } from './currency'
import { daysBetween } from './dates'
import { NO_LOCATION, placeKey } from './filter'

export type InsightsMode = 'group' | 'mine'

export interface InsightRow {
  key: string
  /** Minor units of the default currency. */
  amount: number
  /** Whole percent of the total. */
  pct: number
}

export interface CurrencyRow {
  currency: string
  /** Minor units of `currency`. */
  originalMinor: number
  /** The same, converted to the default currency at each expense's saved rate. */
  defaultMinor: number
}

export interface Insights {
  spent: number
  perDay: number
  days: number
  /** Budget minus spent; null in "My share" mode or without a budget. */
  left: number | null
  byCategory: InsightRow[]
  /** Cities by amount, with "none" (no location) always last. */
  byPlace: InsightRow[]
  byCurrency: CurrencyRow[]
  /** Expenses left out because their rate is pending. */
  pendingCount: number
}

export interface InsightsInput {
  expenses: readonly TripExpense[]
  shares: readonly TripExpenseShare[]
  defaultCurrency: string
  mode: InsightsMode
  /** The current member, for "My share". */
  memberId: string | null
  budgetMinor: number | null
  tripStart: string | null
  tripEnd: string | null
  today: string
}

const pct = (part: number, total: number) => (total > 0 ? Math.round((part * 100) / total) : 0)

/**
 * Spend breakdowns. "My share" uses each expense's share converted exactly like
 * `computeBalances` (the converted total re-split by the original shares), so the
 * numbers agree with the balances screen.
 */
export function computeInsights(input: InsightsInput): Insights {
  const sharesBy = groupSharesByExpense(input.shares)
  const categories = new Map<string, number>()
  const places = new Map<string, number>()
  const currencies = new Map<string, CurrencyRow>()
  let spent = 0
  let pendingCount = 0
  let earliest: string | null = null

  for (const e of input.expenses) {
    const mine = input.mode === 'mine'
    const list = sharesBy.get(e.id) ?? []
    const myShare = mine && input.memberId ? list.find((s) => s.member_id === input.memberId) : undefined
    if (mine && !myShare) continue

    const total = expenseTotalDefault(e, input.defaultCurrency)
    if (total === null) {
      pendingCount += 1
      continue
    }
    const amount = mine
      ? (expenseSharesDefault(e, list, input.defaultCurrency)?.get(input.memberId ?? '') ?? 0)
      : total

    spent += amount
    categories.set(e.category_id, (categories.get(e.category_id) ?? 0) + amount)
    const place = placeKey(e)
    places.set(place, (places.get(place) ?? 0) + amount)
    if (earliest === null || e.date < earliest) earliest = e.date

    if (e.currency !== input.defaultCurrency) {
      const originalMinor = toMinor(mine ? (myShare?.amount ?? 0) : e.amount, e.currency)
      const row = currencies.get(e.currency) ?? { currency: e.currency, originalMinor: 0, defaultMinor: 0 }
      row.originalMinor += originalMinor
      row.defaultMinor += amount
      currencies.set(e.currency, row)
    }
  }

  const start = input.tripStart ?? earliest ?? input.today
  const elapsed = daysBetween(start, input.today) + 1
  const length = input.tripStart && input.tripEnd ? daysBetween(input.tripStart, input.tripEnd) + 1 : Number.POSITIVE_INFINITY
  const days = Math.max(1, Math.min(elapsed, length))

  const rows = (map: Map<string, number>): InsightRow[] =>
    [...map].map(([key, amount]) => ({ key, amount, pct: pct(amount, spent) }))

  return {
    spent,
    days,
    perDay: Math.round(spent / days),
    left: input.mode === 'group' && input.budgetMinor !== null ? input.budgetMinor - spent : null,
    byCategory: rows(categories).sort((a, b) => b.amount - a.amount || (a.key < b.key ? -1 : 1)),
    byPlace: rows(places).sort(
      (a, b) =>
        (a.key === NO_LOCATION ? 1 : 0) - (b.key === NO_LOCATION ? 1 : 0) ||
        b.amount - a.amount ||
        (a.key < b.key ? -1 : 1),
    ),
    byCurrency: [...currencies.values()].sort((a, b) => b.defaultMinor - a.defaultMinor),
    pendingCount,
  }
}
