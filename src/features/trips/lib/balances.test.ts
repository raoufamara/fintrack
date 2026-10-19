import { describe, expect, it } from 'vitest'
import type { TripExpense, TripExpenseShare } from '../types'
import { computeBalances, suggestTransfers } from './balances'
import { toMinor } from './currency'
import { equalShares, mkExpense, mkSettlement } from './testFixtures'

const total = (m: ReadonlyMap<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

function addExpense(
  expenses: TripExpense[],
  shares: TripExpenseShare[],
  over: Partial<TripExpense> & Pick<TripExpense, 'paid_by' | 'amount' | 'currency'>,
  members: string[],
) {
  const e = mkExpense(over)
  expenses.push(e)
  shares.push(...equalShares(e.id, e.currency, toMinor(e.amount, e.currency), members))
  return e
}

describe('computeBalances', () => {
  it('sums to exactly 0 across mixed currencies', () => {
    const members = ['m1', 'm2', 'm3', 'm4']
    const expenses: TripExpense[] = []
    const shares: TripExpenseShare[] = []
    addExpense(expenses, shares, { paid_by: 'm1', amount: 100, currency: 'EUR', fx_rate: 1 }, members)
    addExpense(expenses, shares, { paid_by: 'm2', amount: 240, currency: 'MAD', fx_rate: 0.0924 }, ['m1', 'm2'])
    addExpense(expenses, shares, { paid_by: 'm3', amount: 12345, currency: 'JPY', fx_rate: 0.00611 }, members)
    addExpense(expenses, shares, { paid_by: 'm4', amount: 12.345, currency: 'KWD', fx_rate: 3.0137 }, ['m2', 'm3', 'm4'])
    addExpense(expenses, shares, { paid_by: 'm1', amount: 33.33, currency: 'USD', fx_rate: 0.9137 }, members)

    const { balances, pendingIds } = computeBalances(expenses, shares, [], 'EUR')
    expect(pendingIds).toEqual([])
    expect(total(balances)).toBe(0)
    expect(balances.size).toBe(4)
  })

  it('stays at 0 after settlements, including a foreign-currency one', () => {
    const members = ['a', 'b', 'c']
    const expenses: TripExpense[] = []
    const shares: TripExpenseShare[] = []
    addExpense(expenses, shares, { paid_by: 'a', amount: 90, currency: 'EUR' }, members)
    const { balances } = computeBalances(
      expenses,
      shares,
      [mkSettlement('b', 'a', 10), mkSettlement('c', 'a', 1000, 'JPY', 0.0061)],
      'EUR',
    )
    expect(total(balances)).toBe(0)
    expect(balances.get('b')).toBe(-2000)
    expect(balances.get('c')).toBe(-3000 + 610)
  })

  it('excludes pending expenses and reports their ids', () => {
    const members = ['a', 'b']
    const expenses: TripExpense[] = []
    const shares: TripExpenseShare[] = []
    addExpense(expenses, shares, { paid_by: 'a', amount: 50, currency: 'EUR' }, members)
    const pending = addExpense(
      expenses,
      shares,
      { paid_by: 'b', amount: 900, currency: 'THB', fx_rate: null, fx_source: null, amount_default: null },
      members,
    )
    const { balances, pendingIds } = computeBalances(expenses, shares, [], 'EUR')
    expect(pendingIds).toEqual([pending.id])
    expect(balances.get('a')).toBe(2500)
    expect(balances.get('b')).toBe(-2500)
    expect(total(balances)).toBe(0)
  })

  it('re-splits the converted total in proportion to the original shares', () => {
    // 100.00 MAD: a owes 70, b owes 30. At 0.1 -> 10.00 EUR, a owes 7.00, b owes 3.00.
    const e = mkExpense({ paid_by: 'a', amount: 100, currency: 'MAD', fx_rate: 0.1, split_mode: 'exact' })
    const shares: TripExpenseShare[] = [
      { expense_id: e.id, member_id: 'a', weight: 1, amount: 70 },
      { expense_id: e.id, member_id: 'b', weight: 1, amount: 30 },
    ]
    const { balances } = computeBalances([e], shares, [], 'EUR')
    expect(balances.get('a')).toBe(1000 - 700)
    expect(balances.get('b')).toBe(-300)
  })

  it('keeps the invariant when conversion creates odd cents', () => {
    const members = ['a', 'b', 'c']
    const expenses: TripExpense[] = []
    const shares: TripExpenseShare[] = []
    for (let i = 0; i < 25; i++) {
      addExpense(
        expenses,
        shares,
        { paid_by: members[i % 3] ?? 'a', amount: 10 + i * 1.37, currency: 'USD', fx_rate: 0.9137 + i / 1000 },
        members,
      )
    }
    expect(total(computeBalances(expenses, shares, [], 'EUR').balances)).toBe(0)
  })
})

describe('suggestTransfers', () => {
  function apply(balances: Map<string, number>, transfers: ReturnType<typeof suggestTransfers>) {
    const after = new Map(balances)
    for (const t of transfers) {
      after.set(t.from, (after.get(t.from) ?? 0) + t.amount)
      after.set(t.to, (after.get(t.to) ?? 0) - t.amount)
    }
    return after
  }

  it('brings everyone to 0', () => {
    const balances = new Map([['a', 5000], ['b', -1200], ['c', -2300], ['d', 700], ['e', -2200], ['f', -1]])
    balances.set('g', -(5000 + 700 - 1200 - 2300 - 2200 - 1))
    expect(total(balances)).toBe(0)
    const transfers = suggestTransfers(balances)
    for (const v of apply(balances, transfers).values()) expect(v).toBe(0)
    expect(transfers.length).toBeLessThanOrEqual(balances.size - 1)
    for (const t of transfers) expect(t.amount).toBeGreaterThan(0)
  })

  it('lists transfers involving the current member first', () => {
    const balances = new Map([['a', 3000], ['b', 2000], ['c', -2500], ['d', -2500]])
    const transfers = suggestTransfers(balances, 'd')
    const first = transfers[0]
    expect(first?.from === 'd' || first?.to === 'd').toBe(true)
    for (const v of apply(balances, transfers).values()) expect(v).toBe(0)
  })

  it('returns nothing when everyone is settled', () => {
    expect(suggestTransfers(new Map([['a', 0], ['b', 0]]))).toEqual([])
    expect(suggestTransfers(new Map())).toEqual([])
  })
})

describe('seed trip (Lisbon & Porto)', () => {
  const members = ['m1', 'm2', 'm3', 'm4'] // You, Sara, Malik, Inès
  const seed: Array<[string, number]> = [
    ['m2', 480.0],
    ['m1', 86.4],
    ['m3', 12.0],
    ['m4', 14.2],
    ['m3', 32.75],
    ['m1', 98.0],
    ['m2', 40.0],
  ]
  const expenses: TripExpense[] = []
  const shares: TripExpenseShare[] = []
  for (const [paidBy, amount] of seed) {
    addExpense(expenses, shares, { paid_by: paidBy, amount, currency: 'EUR' }, members)
  }

  it('totals 763.35', () => {
    const sum = expenses.reduce((acc, e) => acc + toMinor(e.amount, 'EUR'), 0)
    expect(sum).toBe(76335)
  })

  it('has You owing Sara 6.44 and balances summing to 0', () => {
    const { balances, pendingIds } = computeBalances(expenses, shares, [], 'EUR')
    expect(pendingIds).toEqual([])
    expect(total(balances)).toBe(0)
    expect(balances.get('m2')).toBe(32916) // Sara gets back 329.16 after per-expense cent rounding

    const transfers = suggestTransfers(balances, 'm1')
    const mine = transfers.find((t) => t.from === 'm1')
    expect(mine).toEqual({ from: 'm1', to: 'm2', amount: 644 })
    expect(transfers[0]).toEqual(mine)
    expect(transfers.find((t) => t.from === 'm3')).toEqual({ from: 'm3', to: 'm2', amount: 14609 })
    expect(transfers.find((t) => t.from === 'm4')).toEqual({ from: 'm4', to: 'm2', amount: 17663 })
  })
})
