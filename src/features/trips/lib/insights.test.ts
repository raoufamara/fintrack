import { describe, expect, it } from 'vitest'
import { computeBalances } from './balances'
import { addDays, todayISO } from './dates'
import { computeInsights, type InsightsInput } from './insights'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'

const TODAY = todayISO()
const seed = buildLisbonPortoSeed('u', TODAY)

function insights(over: Partial<InsightsInput> = {}) {
  return computeInsights({
    expenses: seed.expenses,
    shares: seed.shares,
    defaultCurrency: 'EUR',
    mode: 'group',
    memberId: SEED_IDS.you,
    budgetMinor: 120000,
    tripStart: seed.trip.start_date,
    tripEnd: seed.trip.end_date,
    today: TODAY,
    ...over,
  })
}

describe('computeInsights', () => {
  it('sums the group total and ranks categories and places', () => {
    const r = insights()
    expect(r.spent).toBe(76335)
    expect(r.byCategory.map((c) => [c.key, c.amount, c.pct])).toEqual([
      ['c-stay', 48000, 63],
      ['c-transport', 11000, 14],
      ['c-food', 10060, 13],
      ['c-activity', 4000, 5],
      ['c-groceries', 3275, 4],
    ])
    expect(r.byPlace.map((p) => [p.key, p.amount])).toEqual([
      ['Lisbon', 59260],
      ['Porto', 4000],
      ['none', 13075], // "No location" is always last
    ])
  })

  it('computes per day over the days elapsed, capped to the trip length, at least 1', () => {
    expect(insights().days).toBe(5) // started 4 days ago
    expect(insights().perDay).toBe(Math.round(76335 / 5))
    expect(insights({ today: addDays(seed.trip.end_date!, 10) }).days).toBe(8) // trip is 8 days long
    expect(insights({ today: addDays(seed.trip.start_date!, -3) }).days).toBe(1)
    // Without trip dates the first expense starts the clock.
    expect(insights({ tripStart: null, tripEnd: null }).days).toBe(5)
  })

  it('shows what is left of the budget in group mode only', () => {
    expect(insights().left).toBe(120000 - 76335)
    expect(insights({ budgetMinor: null }).left).toBeNull()
    expect(insights({ mode: 'mine' }).left).toBeNull()
    expect(insights({ budgetMinor: 50000 }).left).toBe(50000 - 76335) // over budget goes negative
  })

  it('computes My share consistently with the balances', () => {
    const mine = insights({ mode: 'mine' })
    // You paid 184.40 and are 6.44 in debt, so your share is 190.84.
    expect(mine.spent).toBe(19084)
    const { balances } = computeBalances(seed.expenses, seed.shares, [], 'EUR')
    const paid = seed.expenses.filter((e) => e.paid_by === SEED_IDS.you).reduce((a, e) => a + Math.round(e.amount * 100), 0)
    expect(paid - mine.spent).toBe(balances.get(SEED_IDS.you))
    // Everyone's shares add up to the group total.
    const total = seed.members.reduce((acc, m) => acc + insights({ mode: 'mine', memberId: m.id }).spent, 0)
    expect(total).toBe(76335)
    expect(mine.byCategory.reduce((a, c) => a + c.amount, 0)).toBe(mine.spent)
  })

  it('skips expenses the member has no share in, in My share', () => {
    const without = seed.shares.filter((s) => s.expense_id !== 'e2' || s.member_id !== SEED_IDS.you)
    const r = insights({ mode: 'mine', shares: without })
    expect(r.byCategory.find((c) => c.key === 'c-food')?.amount).toBe(355) // only the Pastéis share remains
  })

  it('builds the by-currency card and leaves pending expenses out with a count', () => {
    const base = seed.expenses[0]!
    const mad = { ...base, id: 'm1', currency: 'MAD', amount: 1840, fx_rate: 0.0924, fx_source: 'cache' as const, amount_default: 170, paid_by: SEED_IDS.you }
    const pending = { ...base, id: 'm2', currency: 'THB', amount: 900, fx_rate: null, fx_source: null, amount_default: null }
    const shares = [
      ...seed.shares,
      ...seed.members.flatMap((m) => [
        { expense_id: 'm1', member_id: m.id, weight: 1, amount: 460 },
        { expense_id: 'm2', member_id: m.id, weight: 1, amount: 225 },
      ]),
    ]
    const r = insights({ expenses: [...seed.expenses, mad, pending], shares })
    expect(r.pendingCount).toBe(1)
    expect(r.byCurrency).toEqual([{ currency: 'MAD', originalMinor: 184000, defaultMinor: 17002 }])
    expect(r.spent).toBe(76335 + 17002)
    const mine = insights({ expenses: [...seed.expenses, mad, pending], shares, mode: 'mine' })
    expect(mine.byCurrency[0]).toMatchObject({ currency: 'MAD', originalMinor: 46000 })
  })

  it('handles an empty trip', () => {
    const r = insights({ expenses: [], shares: [] })
    expect(r).toMatchObject({ spent: 0, perDay: 0, byCategory: [], byPlace: [], byCurrency: [] })
  })
})
