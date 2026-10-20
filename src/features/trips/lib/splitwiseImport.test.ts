import { describe, expect, it } from 'vitest'
import realCsv from './__fixtures__/splitwise-real-export.csv?raw'
import sampleCsv from './__fixtures__/splitwise-sample.csv?raw'
import { parseSplitwiseCsv, type SplitwiseFile } from './splitwiseCsv'
import {
  buildImportPayload,
  guessCategoryKey,
  mapSplitwise,
  neededRates,
  PAYMENT_RATE_ERROR,
  rateKey,
  tripNameFromFileName,
  verifyAgainstTotals,
  type ImportPlan,
  type RateLookup,
} from './splitwiseImport'

function load(text: string): SplitwiseFile {
  const r = parseSplitwiseCsv(text)
  if (!r.ok) throw new Error(r.message)
  return r.file
}
const HEADER = 'Date,Description,Category,Cost,Currency,Ann,Bob,Cy\n'
function planOf(rows: string, fileName?: string): ImportPlan {
  return mapSplitwise(load(HEADER + rows), { fileName })
}
const sharesOf = (plan: ImportPlan, i = 0) => Object.fromEntries(plan.expenses[i]!.shares.map((s) => [s.memberKey, s.minor]))

describe('mapSplitwise: expenses', () => {
  it('maps a single payer: negatives are shares, the payer keeps the rest', () => {
    const plan = planOf('2026-10-03,Hotel,Hotel,90.00,EUR,60.00,-30.00,-30.00\n')
    expect(plan.expenses).toHaveLength(1)
    expect(plan.expenses[0]).toMatchObject({ paidByKey: 'm0', amountMinor: 9000, currency: 'EUR', categoryKey: 'stay', title: 'Hotel' })
    expect(sharesOf(plan)).toEqual({ m0: 3000, m1: 3000, m2: 3000 })
    expect(plan.settlements).toEqual([])
  })

  it('omits the payer when they owe nothing (paid entirely for someone else)', () => {
    const plan = planOf('2026-10-03,Debt,Taxes,59.66,CAD,-59.66,59.66,0.00\n')
    expect(plan.expenses[0]!.paidByKey).toBe('m1')
    expect(sharesOf(plan)).toEqual({ m0: 5966 })
  })

  it('gives the odd cent to the payer share', () => {
    const plan = planOf('2026-10-03,Gas,Gas/fuel,6.29,CAD,3.14,-3.14,0.00\n')
    expect(sharesOf(plan)).toEqual({ m0: 315, m1: 314 })
  })

  it('splits a row with several payers into one expense plus balancing payments', () => {
    const two = planOf('2026-10-03,Dinner,Dining out,100.00,EUR,40.00,10.00,-50.00\n')
    expect(two.expenses[0]!.paidByKey).toBe('m0')
    // Cy owes 50; Ann's share is the rest (50). Bob's 10 becomes a balancing payment to Ann.
    expect(sharesOf(two)).toEqual({ m0: 5000, m2: 5000 })
    expect(two.settlements).toEqual([
      { line: 2, fromKey: 'm1', toKey: 'm0', amountMinor: 1000, currency: 'EUR', date: '2026-10-03', balancing: true },
    ])
    expect(two.warnings.join(' ')).toMatch(/Row 2 had several payers; recorded as one expense plus 1 balancing payment/)
  })

  it('keeps every net: the balances of a multi-payer row come out as in the file', () => {
    const csv = `${HEADER}2026-10-03,Dinner,Dining out,100.00,EUR,40.00,10.00,-50.00\n\n2026-10-04,Total balance, , ,EUR,40.00,10.00,-50.00\n`
    const file = load(csv)
    const v = verifyAgainstTotals(mapSplitwise(file), file.totals)
    expect(v).toEqual({ checked: true, matches: true, diffs: [] })
  })

  it('absorbs a cent of rounding into the payer share, with no warning', () => {
    const plan = planOf('2026-10-03,Lunch,Food,10.00,EUR,6.67,-3.33,-3.33\n')
    // Nets sum to +0.01: the payer's share absorbs it.
    expect(sharesOf(plan)).toEqual({ m0: 334, m1: 333, m2: 333 })
    expect(Object.values(sharesOf(plan)).reduce((a, b) => a + b, 0)).toBe(1000)
    expect(plan.warnings).toEqual([])
  })

  it('warns when the amounts are off by more than 2 minor units', () => {
    const plan = planOf('2026-10-03,Lunch,Food,10.00,EUR,7.00,-3.00,-3.00\n')
    expect(sharesOf(plan)).toEqual({ m0: 400, m1: 300, m2: 300 })
    expect(plan.warnings.join(' ')).toMatch(/off by 1.00 EUR/)
  })

  it('refuses a row whose shares cannot add up, and counts it as skipped', () => {
    const plan = planOf('2026-10-03,Odd,Food,10.00,EUR,1.00,-20.00,0.00\n')
    expect(plan.expenses).toHaveLength(0)
    expect(plan.rowErrors).toHaveLength(1)
    expect(plan.skipped).toBe(1)
  })

  it('skips a row where every net is 0, with a warning', () => {
    const plan = planOf('2026-10-03,Solo,Food,10.00,EUR,0.00,0.00,0.00\n')
    expect(plan.expenses).toEqual([])
    expect(plan.skipped).toBe(1)
    expect(plan.warnings.join(' ')).toMatch(/Row 2: nobody owes anything/)
  })

  it('skips a row with cost 0 with a warning', () => {
    const plan = planOf('2026-10-03,Free,Food,0.00,EUR,0.00,0.00,0.00\n')
    expect(plan.skipped).toBe(1)
    expect(plan.warnings.join(' ')).toMatch(/the cost is 0/)
  })

  it('keeps the currency of each row', () => {
    const plan = planOf('2026-10-03,a,Food,10.00,EUR,5.00,-5.00,0.00\n2026-10-04,b,Food,1200,JPY,600,-600,0\n')
    expect(plan.expenses.map((e) => [e.currency, e.amountMinor])).toEqual([['EUR', 1000], ['JPY', 1200]])
  })
})

describe('mapSplitwise: payments', () => {
  it('turns a Payment row into a settlement from the positive person to the negative one', () => {
    const plan = planOf('2026-10-09,Bob paid Ann,Payment,50.00,EUR,-50.00,50.00,0.00\n')
    expect(plan.expenses).toEqual([])
    expect(plan.settlements).toEqual([
      { line: 2, fromKey: 'm1', toKey: 'm0', amountMinor: 5000, currency: 'EUR', date: '2026-10-09', balancing: false },
    ])
  })

  it('decomposes a payment between more than two people greedily', () => {
    const plan = planOf('2026-10-09,Group payment,Payment,60.00,EUR,-60.00,40.00,20.00\n')
    expect(plan.settlements.map((s) => [s.fromKey, s.toKey, s.amountMinor])).toEqual([
      ['m1', 'm0', 4000],
      ['m2', 'm0', 2000],
    ])
  })

  it('treats "Settle all balances" as a payment, not as spending', () => {
    const plan = planOf('2026-10-09,Settle all balances,General,198.34,CAD,198.34,-198.34,0.00\n')
    expect(plan.expenses).toEqual([])
    expect(plan.settlements).toHaveLength(1)
    expect(plan.settlements[0]).toMatchObject({ fromKey: 'm0', toKey: 'm1', amountMinor: 19834 })
  })

  it('does not use the names in descriptions', () => {
    const plan = planOf('2026-10-09,Zed paid Yan,Payment,5.00,EUR,-5.00,5.00,0.00\n')
    expect(plan.settlements[0]).toMatchObject({ fromKey: 'm1', toKey: 'm0' })
    expect(plan.members.map((m) => m.name)).toEqual(['Ann', 'Bob', 'Cy'])
  })

  it('refuses a payment with no receiver', () => {
    expect(planOf('2026-10-09,x,Payment,5.00,EUR,5.00,0.00,0.00\n').rowErrors).toHaveLength(1)
  })
})

describe('categories', () => {
  const key = (c: string, d = '') => guessCategoryKey(c, d)

  it('maps the keyword lists, case-insensitively', () => {
    expect(key('Hotel')).toBe('stay')
    expect(key('RENT')).toBe('stay')
    expect(key('Dining out')).toBe('food')
    expect(key('Food and drink')).toBe('food')
    expect(key('Liquor')).toBe('food')
    expect(key('Groceries')).toBe('groceries')
    expect(key('Taxi')).toBe('transport')
    expect(key('Gas/fuel')).toBe('transport')
    expect(key('Bus/train')).toBe('transport')
    expect(key('Movies')).toBe('activity')
    expect(key('Clothing')).toBe('shopping')
    expect(key('Medical expenses')).toBe('fees')
    expect(key('Insurance')).toBe('fees')
  })

  it('maps the categories seen in a real export', () => {
    const real: Record<string, string> = {
      Water: 'groceries', 'Dining out': 'food', Groceries: 'groceries', Taxes: 'fees',
      'Entertainment - Other': 'activity', 'Bus/train': 'transport', 'Gas/fuel': 'transport', Sports: 'activity',
      Taxi: 'transport', 'Transportation - Other': 'transport', General: 'other', 'Life - Other': 'other', Parking: 'transport',
    }
    for (const [from, to] of Object.entries(real)) expect(key(from), from).toBe(to)
  })

  it('falls back to the description, then to other', () => {
    expect(key('General', 'Airbnb Alfama')).toBe('stay')
    expect(key('General', 'Chedraui')).toBe('other')
    expect(key('', '')).toBe('other')
    expect(key('Uncategorized')).toBe('other')
  })

  it('summarises the mapping for the preview', () => {
    const plan = planOf('2026-10-03,a,Hotel,9.00,EUR,6.00,-3.00,-3.00\n2026-10-04,b,Hotel,9.00,EUR,6.00,-3.00,-3.00\n2026-10-05,c,Dining out,9.00,EUR,6.00,-3.00,-3.00\n')
    expect(plan.categorySummary).toEqual([
      { source: 'Hotel', key: 'stay', label: 'Stay', count: 2 },
      { source: 'Dining out', key: 'food', label: 'Food & drinks', count: 1 },
    ])
  })
})

describe('trip facts', () => {
  it('names the trip from the file name', () => {
    expect(tripNameFromFileName('lisbon-trip_2026-10-10_export.csv', null, null)).toBe('Lisbon Trip')
    expect(tripNameFromFileName('morocco_with_friends (1).csv', null, null)).toBe('Morocco With Friends')
  })

  it('falls back to a name from the dates when nothing meaningful is left', () => {
    expect(tripNameFromFileName('Splitwise_expenses_Oct_20.csv', '2024-02-09', '2024-02-27')).toBe('Trip · Feb 2024')
    expect(tripNameFromFileName('Splitwise_expenses_Oct_20.csv', '2024-02-09', '2024-03-04')).toBe('Trip · Feb – Mar 2024')
    expect(tripNameFromFileName('Splitwise_expenses_Oct_20.csv', '2023-12-30', '2024-01-04')).toBe('Trip · Dec 2023 – Jan 2024')
    expect(tripNameFromFileName(undefined, null, null)).toBe('Imported trip')
  })

  it('takes dates from the expenses and the most frequent currency as default', () => {
    const plan = planOf('2026-10-05,a,Food,9.00,EUR,6.00,-3.00,-3.00\n2026-10-03,b,Food,9.00,USD,6.00,-3.00,-3.00\n2026-10-09,c,Food,9.00,USD,6.00,-3.00,-3.00\n')
    expect(plan.startDate).toBe('2026-10-03')
    expect(plan.endDate).toBe('2026-10-09')
    expect(plan.defaultCurrency).toBe('USD')
  })

  it('blocks an empty file', () => {
    expect(planOf('').errors).toHaveLength(1)
  })
})

describe('verification', () => {
  it('matches the synthetic fixture', () => {
    const file = load(sampleCsv)
    const plan = mapSplitwise(file, { fileName: 'lisbon.csv' })
    expect(plan.expenses).toHaveLength(6)
    expect(plan.settlements).toHaveLength(1)
    expect(verifyAgainstTotals(plan, file.totals)).toEqual({ checked: true, matches: true, diffs: [] })
  })

  it('reports each differing person with both figures', () => {
    const file = load(sampleCsv.replace('249.16,-118.84', '249.16,-117.84'))
    const v = verifyAgainstTotals(mapSplitwise(file), file.totals)
    expect(v.matches).toBe(false)
    expect(v.diffs).toEqual([{ member: 'Malik B', currency: 'EUR', splitwise: -11784, ours: -11884 }])
  })

  it('tolerates one minor unit per member', () => {
    const file = load(sampleCsv.replace('249.16', '249.17'))
    expect(verifyAgainstTotals(mapSplitwise(file), file.totals).matches).toBe(true)
  })

  it('verifies each currency on its own, using all Total rows', () => {
    const csv = `${HEADER}2026-10-03,a,Food,10.00,EUR,5.00,-5.00,0.00\n2026-10-04,b,Food,1000,JPY,-500,500,0\n\n2026-10-05,Total balance, , ,EUR,5.00,-5.00,0.00\n2026-10-05,Total balance, , ,JPY,-500,500,0\n`
    const file = load(csv)
    expect(verifyAgainstTotals(mapSplitwise(file), file.totals).matches).toBe(true)
    const wrong = load(csv.replace('JPY,-500,500,0\n', 'JPY,-400,400,0\n').replace(/(Total balance, , ,JPY,-500,500,0)/, '$1'))
    expect(verifyAgainstTotals(mapSplitwise(wrong), wrong.totals).matches).toBe(false)
  })

  it('says nothing was checked when there is no Total balance row', () => {
    const file = load(`${HEADER}2026-10-03,a,Food,10.00,EUR,5.00,-5.00,0.00\n`)
    expect(verifyAgainstTotals(mapSplitwise(file), file.totals)).toEqual({ checked: false, matches: true, diffs: [] })
  })
})

describe('buildImportPayload', () => {
  const csv = `${HEADER}2026-10-03,Lunch,Dining out,10.00,EUR,5.00,-5.00,0.00\n2026-10-04,Taxi,Taxi,1200,JPY,600,-600,0\n2026-10-05,Bob paid Ann,Payment,500,JPY,-500,500,0\n`
  const plan = mapSplitwise(load(csv))
  const opts = (rates: Map<string, RateLookup | null>) => ({
    meKey: 'm2',
    tripName: ' Lisbon ',
    defaultCurrency: 'EUR',
    startDate: plan.startDate,
    endDate: plan.endDate,
    rates,
  })

  it('lists the rates it needs', () => {
    expect(neededRates(plan, 'EUR')).toEqual([
      { currency: 'JPY', date: '2026-10-04' },
      { currency: 'JPY', date: '2026-10-05' },
    ])
  })

  it('builds the payload with converted payments, fx on foreign expenses and the creator marked', () => {
    const rates = new Map<string, RateLookup | null>([
      [rateKey('JPY', '2026-10-04'), { rate: 0.0062, source: 'api', tableDate: '2026-10-04' }],
      [rateKey('JPY', '2026-10-05'), { rate: 0.0062, source: 'cache', tableDate: '2026-10-05' }],
    ])
    const r = buildImportPayload(plan, opts(rates))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payload.trip).toEqual({ name: 'Lisbon', default_currency: 'EUR', start_date: '2026-10-03', end_date: '2026-10-04' })
    expect(r.payload.members.filter((m) => m.is_me).map((m) => m.display_name)).toEqual(['Cy'])
    expect(r.payload.expenses[0]).toMatchObject({ fx_rate: 1, fx_source: 'same', split_mode: 'exact', note: 'Imported from Splitwise', category_key: 'food' })
    expect(r.payload.expenses[1]).toMatchObject({ currency: 'JPY', amount: 1200, fx_rate: 0.0062, fx_source: 'api', fx_date: '2026-10-04', category_key: 'transport' })
    expect(r.payload.settlements).toEqual([{ from_key: 'm1', to_key: 'm0', amount: 3.1, date: '2026-10-05' }])
    expect(r.pendingExpenses).toBe(0)
  })

  it('saves foreign expenses without a rate as pending and warns', () => {
    const rates = new Map<string, RateLookup | null>([[rateKey('JPY', '2026-10-05'), { rate: 0.0062, source: 'cache', tableDate: null }]])
    const r = buildImportPayload(plan, opts(rates))
    expect(r.ok && r.pendingExpenses).toBe(1)
    if (r.ok) {
      expect(r.payload.expenses[1]).toMatchObject({ fx_rate: null, fx_source: null })
      expect(r.warnings.join(' ')).toMatch(/convert later/)
    }
  })

  it('blocks the import when a payment in another currency has no rate', () => {
    const r = buildImportPayload(plan, opts(new Map()))
    expect(r).toEqual({ ok: false, error: PAYMENT_RATE_ERROR })
  })

  it('refuses a missing "you", a blank name and reversed dates', () => {
    const rates = new Map<string, RateLookup | null>()
    expect(buildImportPayload(plan, { ...opts(rates), meKey: 'zz' }).ok).toBe(false)
    expect(buildImportPayload(plan, { ...opts(rates), tripName: '  ' }).ok).toBe(false)
    expect(buildImportPayload(plan, { ...opts(rates), startDate: '2026-10-09', endDate: '2026-10-01' }).ok).toBe(false)
  })
})

describe('real Splitwise export', () => {
  const file = load(realCsv)
  const plan = mapSplitwise(file, { fileName: 'Splitwise_expenses_Oct_20.csv' })

  it('imports every row: 53 expenses and 4 payments, nothing skipped', () => {
    expect(file.rows).toHaveLength(57)
    expect(plan.expenses).toHaveLength(53)
    expect(plan.settlements).toHaveLength(4)
    expect(plan.skipped).toBe(0)
    expect(plan.rowErrors).toEqual([])
    expect(plan.errors).toEqual([])
  })

  it('counts "Settle all balances" among the payments, so spending is not inflated', () => {
    expect(plan.expenses.some((e) => /settle all balances/i.test(e.title))).toBe(false)
    const settle = plan.settlements.find((s) => s.amountMinor === 19834)
    expect(settle).toMatchObject({ fromKey: 'm0', toKey: 'm1', balancing: false })
    const spent = plan.expenses.reduce((a, e) => a + e.amountMinor, 0)
    const rowsTotal = file.rows.filter((r) => !r.isPayment && !/^settle/i.test(r.description)).reduce((a, r) => a + r.costMinor, 0)
    expect(spent).toBe(rowsTotal)
  })

  it('reads the people from the column headers', () => {
    expect(plan.members.map((m) => m.name)).toEqual(['Sam', 'Alex Martin'])
  })

  it('handles an expense paid entirely for the other person', () => {
    const debt = plan.expenses.find((e) => e.title === 'Debt')!
    expect(debt.paidByKey).toBe('m1')
    expect(debt.shares).toEqual([{ memberKey: 'm0', minor: 5966 }])
    const club = plan.expenses.find((e) => e.title === 'Beach club' && e.amountMinor === 3933)!
    expect(club.paidByKey).toBe('m0')
    expect(club.shares).toEqual([{ memberKey: 'm1', minor: 3933 }])
  })

  it('gives the odd cent to the payer (Gas 6.29 paid by Sam, share 3.15)', () => {
    const gas = plan.expenses.find((e) => e.title === 'Gas' && e.amountMinor === 629 && e.paidByKey === 'm0' && e.date === '2024-02-13')!
    expect(gas.shares.find((s) => s.memberKey === 'm0')!.minor).toBe(315)
    expect(gas.shares.find((s) => s.memberKey === 'm1')!.minor).toBe(314)
  })

  it('maps the categories', () => {
    const by = (source: string) => plan.categorySummary.filter((c) => c.source === source).map((c) => c.key)
    expect(by('Water')).toEqual(['groceries'])
    expect(by('Entertainment - Other')).toEqual(['activity'])
    expect(by('Transportation - Other')).toEqual(['transport'])
    expect(by('Life - Other')).toEqual(['other'])
    expect(by('General')).toEqual(['other'])
    expect(by('Taxes')).toEqual(['fees'])
  })

  it('names the trip from the dates, in CAD', () => {
    expect(plan.tripName).toBe('Trip · Feb – Mar 2024')
    expect(plan.defaultCurrency).toBe('CAD')
    expect(plan.startDate).toBe('2024-02-09')
  })

  it('matches the Total balance row (0.00 / 0.00)', () => {
    expect(verifyAgainstTotals(plan, file.totals)).toEqual({ checked: true, matches: true, diffs: [] })
  })
})
