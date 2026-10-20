import { formatMoney } from '../lib/currency'
import { computeBalances, suggestTransfers } from '../lib/balances'
import { filterExpenses, EMPTY_FILTER } from '../lib/filter'
import type { Transfer, TripCategory, TripExpense, TripMember } from '../types'
import type { TripSnapshot } from '../services/TripsRepository'

export function findCurrentMember(snap: TripSnapshot, userId: string): TripMember | undefined {
  return snap.members.find((m) => m.user_id === userId)
}

export function visibleCategories(categories: readonly TripCategory[]): TripCategory[] {
  return categories
    .filter((c) => c.hidden_at === null)
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** Newest first: by date, then by creation time. */
export function sortExpenses(expenses: readonly TripExpense[]): TripExpense[] {
  return [...expenses].sort(
    (a, b) =>
      (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) ||
      (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0),
  )
}

/**
 * Category pre-selected in the add-expense form: the one this member used on
 * their most recent expense in this trip, else "Other", else the first visible one.
 */
export function defaultCategoryId(snap: TripSnapshot, memberId: string | undefined): string | undefined {
  const visible = visibleCategories(snap.categories)
  if (memberId) {
    const last = [...snap.expenses]
      .filter((e) => e.paid_by === memberId)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))[0]
    if (last && visible.some((c) => c.id === last.category_id)) return last.category_id
  }
  return (visible.find((c) => c.key === 'other') ?? visible[0])?.id
}

export interface TripSummary {
  /** Minor units of the default currency, pending expenses excluded. */
  spent: number
  pendingCount: number
  expenseCount: number
  /** Positive: the current member gets money back. */
  myBalance: number
  /** First settle-up transfer involving the current member. */
  myTransfer: Transfer | null
  transfers: Transfer[]
}

export function summarizeTrip(snap: TripSnapshot, currentMemberId: string | undefined): TripSummary {
  const currency = snap.trip.default_currency
  const filtered = filterExpenses(snap.expenses, snap.shares, EMPTY_FILTER, {
    defaultCurrency: currency,
    currentMemberId: currentMemberId ?? null,
  })
  const { balances } = computeBalances(snap.expenses, snap.shares, snap.settlements, currency)
  const transfers = suggestTransfers(balances, currentMemberId)
  const myTransfer =
    transfers.find((t) => t.from === currentMemberId || t.to === currentMemberId) ?? null
  return {
    spent: filtered.totalDefault,
    pendingCount: filtered.pendingCount,
    expenseCount: snap.expenses.length,
    myBalance: currentMemberId ? (balances.get(currentMemberId) ?? 0) : 0,
    myTransfer,
    transfers,
  }
}

/** "You owe Sara €6.44", "Sara owes you €10.00", "All settled up" or "No expenses yet". */
export function balanceLine(snapshot: TripSnapshot, userId: string): string {
  const me = findCurrentMember(snapshot, userId)
  const summary = summarizeTrip(snapshot, me?.id)
  const name = (id: string) => snapshot.members.find((m) => m.id === id)?.display_name ?? '?'
  const money = (minor: number) => formatMoney(minor, snapshot.trip.default_currency)
  const t = summary.myTransfer
  if (t) {
    return t.from === me?.id
      ? `You owe ${name(t.to)} ${money(t.amount)}`
      : `${name(t.from)} owes you ${money(t.amount)}`
  }
  return snapshot.expenses.length > 0 ? 'All settled up' : 'No expenses yet'
}

export function isOngoing(trip: { start_date: string | null; end_date: string | null }, today: string): boolean {
  return !!trip.start_date && !!trip.end_date && today >= trip.start_date && today <= trip.end_date
}

