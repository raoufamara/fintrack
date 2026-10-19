import { describe, expect, it } from 'vitest'
import type { TripExpense, TripExpenseFilter, TripExpenseShare } from '../types'
import { toMinor } from './currency'
import {
  EMPTY_FILTER,
  NO_LOCATION,
  countActiveFilters,
  filterExpenses,
  parseFilter,
  serializeFilter,
} from './filter'
import { equalShares, mkExpense } from './testFixtures'

const MEMBERS = ['m1', 'm2', 'm3']
const ctx = { defaultCurrency: 'EUR', currentMemberId: 'm1' }

function build() {
  const expenses: TripExpense[] = []
  const shares: TripExpenseShare[] = []
  const add = (over: Partial<TripExpense> & Pick<TripExpense, 'paid_by'>, members = MEMBERS) => {
    const e = mkExpense({ ...over })
    expenses.push(e)
    shares.push(...equalShares(e.id, e.currency, toMinor(e.amount, e.currency), members))
    return e
  }
  const food1 = add({ paid_by: 'm1', category_id: 'c-food', title: 'Café da manhã', amount: 12, date: '2026-10-04', place_name: 'Pastéis de Belém', place_city: 'Lisbon' })
  const food2 = add({ paid_by: 'm2', category_id: 'c-food', title: 'Dinner', amount: 60, date: '2026-10-05', place_name: 'Cervejaria Ramiro', place_city: 'Lisbon' })
  const act = add({ paid_by: 'm2', category_id: 'c-act', title: 'Lello tickets', amount: 30, date: '2026-10-08', place_name: 'Livraria Lello', place_city: 'Porto' })
  const trans = add({ paid_by: 'm3', category_id: 'c-trans', title: 'Train', amount: 45, date: '2026-10-07' }, ['m2', 'm3'])
  const groc = add({ paid_by: 'm1', category_id: 'c-groc', title: 'Pingo Doce', amount: 20, date: '2026-10-06' })
  const pend = add({ paid_by: 'm3', category_id: 'c-food', title: 'Street food', amount: 300, currency: 'THB', fx_rate: null, fx_source: null, amount_default: null, date: '2026-10-06', place_city: 'Bangkok' })
  return { expenses, shares, food1, food2, act, trans, groc, pend }
}

const filter = (over: Partial<TripExpenseFilter>): TripExpenseFilter => ({ ...EMPTY_FILTER, ...over })

describe('filterExpenses', () => {
  const { expenses, shares, food1, food2, act, trans, groc, pend } = build()

  it('returns everything for the empty filter, with totals', () => {
    const r = filterExpenses(expenses, shares, EMPTY_FILTER, ctx)
    expect(r.items).toHaveLength(6)
    expect(r.pendingCount).toBe(1)
    expect(r.totalDefault).toBe(toMinor(12 + 60 + 30 + 45 + 20, 'EUR'))
    // m1 is in food1 (4.00), food2 (20.00), act (10.00), groc (6.67 -> 6.67 or 6.66), not trans
    expect(r.myShareDefault).toBe(400 + 2000 + 1000 + 667)
  })

  it('ORs within categories and renames do not matter (filters by id)', () => {
    const r = filterExpenses(expenses, shares, filter({ categoryIds: ['c-food', 'c-act'] }), ctx)
    expect(r.items.map((e) => e.id).sort()).toEqual([food1.id, food2.id, act.id, pend.id].sort())
    expect(r.totalDefault).toBe(toMinor(12 + 60 + 30, 'EUR'))
    expect(r.pendingCount).toBe(1)
  })

  it('a renamed category still filters by id', () => {
    // The expense rows reference category ids only; a rename changes no expense field.
    const renamed = [{ id: 'c-food', name: 'Restaurants' }]
    expect(renamed[0]?.id).toBe('c-food')
    const r = filterExpenses(expenses, shares, filter({ categoryIds: [renamed[0]?.id ?? ''] }), ctx)
    expect(r.items.map((e) => e.id)).toContain(food1.id)
    expect(r.items).toHaveLength(3)
  })

  it('ANDs across facets', () => {
    const r = filterExpenses(expenses, shares, filter({ categoryIds: ['c-food'], payer: 'm2' }), ctx)
    expect(r.items.map((e) => e.id)).toEqual([food2.id])
    const r2 = filterExpenses(expenses, shares, filter({ from: '2026-10-05', to: '2026-10-07' }), ctx)
    expect(r2.items.map((e) => e.id).sort()).toEqual([food2.id, trans.id, groc.id, pend.id].sort())
  })

  it('mine keeps only expenses the current member has a share in', () => {
    const r = filterExpenses(expenses, shares, filter({ mine: true }), ctx)
    expect(r.items.map((e) => e.id)).not.toContain(trans.id)
    expect(r.items).toHaveLength(5)
    const none = filterExpenses(expenses, shares, filter({ mine: true }), { ...ctx, currentMemberId: null })
    expect(none.items).toHaveLength(0)
  })

  it('computes each facet count with its own filter removed', () => {
    const f = filter({ categoryIds: ['c-act'], places: ['Lisbon'] })
    const r = filterExpenses(expenses, shares, f, ctx)
    // Category counts ignore the category selection but respect the place filter.
    expect(r.countByCategory).toEqual({ 'c-food': 2 })
    // Place counts ignore the place selection but respect the category filter.
    expect(r.countByPlace).toEqual({ Porto: 1 })
    expect(r.items).toHaveLength(0)

    const r2 = filterExpenses(expenses, shares, filter({ categoryIds: ['c-food'] }), ctx)
    expect(r2.countByCategory).toEqual({ 'c-food': 3, 'c-act': 1, 'c-trans': 1, 'c-groc': 1 })
    expect(r2.countByPlace).toEqual({ Lisbon: 2, Bangkok: 1 })
  })

  it('other facets still narrow facet counts', () => {
    const r = filterExpenses(expenses, shares, filter({ payer: 'm2' }), ctx)
    expect(r.countByCategory).toEqual({ 'c-food': 1, 'c-act': 1 })
    expect(r.countByPlace).toEqual({ Lisbon: 1, Porto: 1 })
  })

  it('excludes expenses without a location when a place is selected, and counts them', () => {
    const r = filterExpenses(expenses, shares, filter({ places: ['Lisbon'] }), ctx)
    expect(r.items.map((e) => e.id).sort()).toEqual([food1.id, food2.id].sort())
    // trans and groc have no location
    expect(r.hiddenNoLocationCount).toBe(2)
    expect(r.countByPlace[NO_LOCATION]).toBe(2)
  })

  it('includes no-location expenses when "none" is selected', () => {
    const r = filterExpenses(expenses, shares, filter({ places: ['Lisbon', NO_LOCATION] }), ctx)
    expect(r.items).toHaveLength(4)
    expect(r.hiddenNoLocationCount).toBe(0)
    const onlyNone = filterExpenses(expenses, shares, filter({ places: [NO_LOCATION] }), ctx)
    expect(onlyNone.items.map((e) => e.id).sort()).toEqual([trans.id, groc.id].sort())
  })

  it('reports no hidden expenses when no place is selected', () => {
    expect(filterExpenses(expenses, shares, EMPTY_FILTER, ctx).hiddenNoLocationCount).toBe(0)
  })

  it('hidden count respects the other facets', () => {
    const r = filterExpenses(expenses, shares, filter({ places: ['Lisbon'], categoryIds: ['c-groc'] }), ctx)
    expect(r.hiddenNoLocationCount).toBe(1)
  })

  it('searches title, place name and city, ignoring case and accents', () => {
    const ids = (q: string) =>
      filterExpenses(expenses, shares, filter({ q }), ctx).items.map((e) => e.id).sort()
    expect(ids('cafe')).toEqual([food1.id])
    expect(ids('CAFÉ')).toEqual([food1.id])
    expect(ids('pasteis')).toEqual([food1.id])
    expect(ids('belem')).toEqual([food1.id])
    expect(ids('ramiro')).toEqual([food2.id])
    expect(ids('lisbon')).toEqual([food1.id, food2.id].sort())
    expect(ids('PORTO')).toEqual([act.id])
    expect(ids('zzz')).toEqual([])
  })

  it('does not count pending expenses in totals and flags them', () => {
    const r = filterExpenses(expenses, shares, filter({ categoryIds: ['c-food'] }), ctx)
    expect(r.pendingCount).toBe(1)
    expect(r.items).toContain(pend)
    expect(r.totalDefault).toBe(toMinor(72, 'EUR'))
  })
})

describe('parseFilter / serializeFilter', () => {
  const full: TripExpenseFilter = {
    categoryIds: ['4f9c-1', '8a2d-2'],
    places: ['Lisbon', NO_LOCATION],
    payer: 'm2',
    mine: true,
    from: '2026-10-03',
    to: '2026-10-10',
    q: 'tram',
  }

  it('round-trips through the URL', () => {
    const params = serializeFilter(full)
    const reparsed = parseFilter(new URLSearchParams(params.toString()))
    expect(reparsed).toEqual(full)
  })

  it('round-trips the empty filter to an empty query', () => {
    expect(serializeFilter(EMPTY_FILTER).toString()).toBe('')
    expect(parseFilter(new URLSearchParams(''))).toEqual(EMPTY_FILTER)
  })

  it('uses the documented param names', () => {
    const params = serializeFilter(full)
    expect([...params.keys()].sort()).toEqual(['cat', 'from', 'mine', 'payer', 'place', 'q', 'to'])
    expect(params.get('mine')).toBe('1')
  })

  it('round-trips awkward values (commas, percent, accents, spaces)', () => {
    const f: TripExpenseFilter = {
      ...EMPTY_FILTER,
      places: ['Washington, D.C.', '100%', 'São Paulo'],
      q: 'café & crème',
    }
    expect(parseFilter(new URLSearchParams(serializeFilter(f).toString()))).toEqual(f)
  })

  it('parses the spec example and ignores junk', () => {
    const f = parseFilter(
      new URLSearchParams('cat=a,b&place=Lisbon,none&payer=m1&from=2026-10-03&to=nope&mine=1&q=tram'),
    )
    expect(f).toEqual({
      categoryIds: ['a', 'b'],
      places: ['Lisbon', 'none'],
      payer: 'm1',
      mine: true,
      from: '2026-10-03',
      to: null,
      q: 'tram',
    })
    expect(parseFilter(new URLSearchParams('cat=,,a,a&mine=0')).categoryIds).toEqual(['a'])
    expect(parseFilter(new URLSearchParams('mine=0')).mine).toBe(false)
  })
})

describe('countActiveFilters', () => {
  it('counts non-chip filters', () => {
    expect(countActiveFilters(EMPTY_FILTER)).toBe(0)
    expect(
      countActiveFilters({ ...EMPTY_FILTER, categoryIds: ['a'], places: ['x'], mine: true, from: '2026-01-01', to: '2026-01-02' }),
    ).toBe(3)
  })
})
