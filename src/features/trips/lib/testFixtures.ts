import type { TripExpense, TripExpenseShare, TripSettlement } from '../types'
import { fromMinor } from './currency'
import { splitAmount } from './money'

/** Test-only builders. Not exported from the module. */

let counter = 0

export function mkExpense(over: Partial<TripExpense> & Pick<TripExpense, 'paid_by'>): TripExpense {
  counter += 1
  return {
    id: `e${counter}`,
    trip_id: 't1',
    category_id: 'c-other',
    title: `Expense ${counter}`,
    amount: 10,
    currency: 'EUR',
    fx_rate: 1,
    fx_source: 'same',
    fx_date: null,
    amount_default: 10,
    split_mode: 'equal',
    date: '2026-10-04',
    note: null,
    place_name: null,
    place_address: null,
    place_area: null,
    place_city: null,
    place_country: null,
    place_lat: null,
    place_lng: null,
    place_provider_id: null,
    created_by: 'u1',
    client_id: null,
    created_at: '2026-10-04T10:00:00Z',
    updated_at: '2026-10-04T10:00:00Z',
    ...over,
  }
}

/** Equal shares in the expense's own currency for the given minor-unit total. */
export function equalShares(
  expenseId: string,
  currency: string,
  totalMinor: number,
  memberIds: string[],
): TripExpenseShare[] {
  const parts = splitAmount(totalMinor, 'equal', memberIds)
  return [...parts].map(([member_id, minor]) => ({
    expense_id: expenseId,
    member_id,
    weight: 1,
    amount: fromMinor(minor, currency),
  }))
}

export function mkSettlement(
  from: string,
  to: string,
  amount: number,
  currency = 'EUR',
  fx_rate = 1,
): TripSettlement {
  counter += 1
  return {
    id: `s${counter}`,
    trip_id: 't1',
    from_member: from,
    to_member: to,
    amount,
    currency,
    fx_rate,
    created_at: '2026-10-09T10:00:00Z',
  }
}
