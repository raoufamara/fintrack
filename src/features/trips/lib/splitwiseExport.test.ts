import { describe, expect, it } from 'vitest'
import { createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'
import type { TripSnapshot } from '../services/TripsRepository'
import type { TripExpense, TripExpenseShare, TripSettlement } from '../types'
import { computeBalances } from './balances'
import realCsv from './__fixtures__/splitwise-real-export.csv?raw'
import { buildSplitwiseCsv, csvCell, exportFileName, formatPlainAmount, slugify } from './splitwiseExport'
import { parseSplitwiseCsv, tokenizeCsv } from './splitwiseCsv'
import { buildImportPayload, mapSplitwise, neededRates, rateKey, verifyAgainstTotals, type RateLookup } from './splitwiseImport'

const TODAY = '2026-10-20'

/** The Lisbon seed plus a USD expense with an uneven split, an awkward title, a self-paid expense and a payment. */
function richSeed(): TripSnapshot {
  const snap = buildLisbonPortoSeed('u1', TODAY)
  const base = snap.expenses[0]!
  const add = (over: Partial<TripExpense>, shares: Array<[string, number]>) => {
    const id = over.id!
    snap.expenses.push({ ...base, created_at: `${over.date}T20:00:00.000Z`, ...over })
    for (const [member_id, amount] of shares) {
      snap.shares.push({ expense_id: id, member_id, weight: 1, amount } as TripExpenseShare)
    }
  }
  const d = snap.expenses[0]!.date
  add(
    { id: 'x1', title: 'Café "Bica", Chiado', category_id: 'c-food', amount: 25.5, currency: 'USD', fx_rate: 0.9, fx_source: 'api', amount_default: 22.95, paid_by: SEED_IDS.sara, date: d },
    [[SEED_IDS.you, 10], [SEED_IDS.sara, 5.5], [SEED_IDS.malik, 10]],
  )
  add(
    { id: 'x2', title: '=SUM(A1)', category_id: 'c-other', amount: 9, currency: 'EUR', fx_rate: 1, fx_source: 'same', amount_default: 9, paid_by: SEED_IDS.ines, date: d },
    [[SEED_IDS.ines, 9]],
  )
  add(
    { id: 'x3', title: 'Pending taxi', category_id: 'c-transport', amount: 1200, currency: 'JPY', fx_rate: null, fx_source: null, amount_default: null, paid_by: SEED_IDS.malik, date: d },
    [[SEED_IDS.you, 400], [SEED_IDS.malik, 800]],
  )
  snap.settlements.push({
    id: 's1', trip_id: snap.trip.id, from_member: SEED_IDS.malik, to_member: SEED_IDS.sara, amount: 40, currency: 'EUR', fx_rate: 1,
    created_at: `${d}T12:00:00.000Z`,
  } as TripSettlement)
  return snap
}

const balancesByName = (snap: TripSnapshot) => {
  const { balances } = computeBalances(snap.expenses, snap.shares, snap.settlements, snap.trip.default_currency)
  return Object.fromEntries(snap.members.map((m) => [m.display_name, balances.get(m.id) ?? 0]))
}

async function roundTrip(snap: TripSnapshot, rates: Map<string, RateLookup | null> = new Map()) {
  const { csv } = buildSplitwiseCsv(snap, TODAY)
  const parsed = parseSplitwiseCsv(csv)
  if (!parsed.ok) throw new Error(parsed.message)
  const plan = mapSplitwise(parsed.file)
  const me = plan.members.find((m) => m.name === 'You')!
  const built = buildImportPayload(plan, {
    meKey: me.key, tripName: 'Round trip', defaultCurrency: snap.trip.default_currency,
    startDate: plan.startDate, endDate: plan.endDate, rates,
  })
  if (!built.ok) throw new Error(built.error)
  const repo = createMemoryTripsRepository({ currentUserId: 'u-new', seed: [] })
  const id = await repo.importTrip(built.payload)
  return { csv, parsed, plan, imported: (await repo.getTrip(id))! }
}

describe('csv helpers', () => {
  it('quotes per RFC 4180', () => {
    expect(csvCell('plain')).toBe('plain')
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('say "hi"')).toBe('"say ""hi"""')
    expect(csvCell('two\nlines')).toBe('"two\nlines"')
    expect(csvCell(' padded')).toBe('" padded"')
  })

  it('formats amounts with the currency decimals', () => {
    expect(formatPlainAmount(-1234, 'EUR')).toBe('-12.34')
    expect(formatPlainAmount(5, 'EUR')).toBe('0.05')
    expect(formatPlainAmount(1200, 'JPY')).toBe('1200')
    expect(formatPlainAmount(-1500, 'KWD')).toBe('-1.500')
  })

  it('builds the file name from the trip name and the date', () => {
    expect(slugify('Lisbon & Porto')).toBe('lisbon-porto')
    expect(slugify('Été à Nîmes!')).toBe('ete-a-nimes')
    expect(slugify('???')).toBe('trip')
    expect(exportFileName('Lisbon & Porto', '2026-10-20')).toBe('lisbon-porto-fintrack-2026-10-20.csv')
  })
})

describe('buildSplitwiseCsv', () => {
  it('writes the expected text for the Lisbon trip', () => {
    const snap = buildLisbonPortoSeed('u1', TODAY)
    snap.expenses = snap.expenses.slice(0, 2)
    snap.shares = snap.shares.filter((s) => s.expense_id === 'e1' || s.expense_id === 'e2')
    snap.settlements.push({
      id: 's1', trip_id: snap.trip.id, from_member: SEED_IDS.ines, to_member: SEED_IDS.sara, amount: 50, currency: 'EUR', fx_rate: 1,
      created_at: `${snap.expenses[1]!.date}T12:00:00.000Z`,
    } as TripSettlement)
    const { csv, fileName } = buildSplitwiseCsv(snap, TODAY)
    const d1 = snap.expenses[0]!.date
    const d2 = snap.expenses[1]!.date
    expect(fileName).toBe('lisbon-porto-fintrack-2026-10-20.csv')
    expect(csv).toBe(
      [
        'Date,Description,Category,Cost,Currency,You,Sara,Malik,Inès',
        '',
        `${d1},Airbnb Alfama · 4 nights,Stay,480.00,EUR,-120.00,360.00,-120.00,-120.00`,
        `${d2},Time Out Market dinner,Food & drinks,86.40,EUR,64.80,-21.60,-21.60,-21.60`,
        `${d2},Inès paid Sara,Payment,50.00,EUR,0.00,-50.00,0.00,50.00`,
        '',
        `${d2},Total balance,,,EUR,-55.20,288.40,-141.60,-91.60`,
        '',
      ].join('\r\n'),
    )
  })

  it('uses CRLF, quotes awkward cells, defuses formulas and keeps each currency in its own Total row', () => {
    const { csv } = buildSplitwiseCsv(richSeed(), TODAY)
    expect(csv).toMatch(/\r\n$/)
    expect(csv).toContain('"Café ""Bica"", Chiado"')
    expect(csv).toContain(",'=SUM(A1),")
    const rows = tokenizeCsv(csv)
    const totals = rows.filter((r) => r.cells[1] === 'Total balance')
    expect(totals.map((r) => r.cells[4])).toEqual(['EUR', 'JPY', 'USD'])
    expect(rows.find((r) => r.cells[2] === 'Payment')!.cells[1]).toBe('Malik paid Sara')
    expect(rows.every((r) => r.cells.length === 9 || r.cells.length === 1)).toBe(true)
  })

  it('writes only the header for an empty trip', () => {
    const snap = buildLisbonPortoSeed('u1', TODAY)
    snap.expenses = []
    snap.shares = []
    expect(buildSplitwiseCsv(snap, TODAY).csv).not.toContain('Total balance')
  })
})

describe('round trip: export, then import', () => {
  it('recreates the same balances on the sample trip (single currency)', async () => {
    const snap = buildLisbonPortoSeed('u1', TODAY)
    const { imported, parsed } = await roundTrip(snap)
    expect(balancesByName(imported)).toEqual(balancesByName(snap))
    expect(imported.expenses).toHaveLength(snap.expenses.length)
    expect(parsed.ok && parsed.file.issues).toEqual([])
  })

  it('recreates the same balances with several currencies, uneven splits, odd titles and a payment', async () => {
    const snap = richSeed()
    const rates = new Map<string, RateLookup | null>()
    for (const e of snap.expenses) if (e.currency !== 'EUR' && e.fx_rate !== null) rates.set(rateKey(e.currency, e.date), { rate: e.fx_rate, source: 'cache', tableDate: e.date })
    const { imported, plan, csv } = await roundTrip(snap, rates)
    expect(balancesByName(imported)).toEqual(balancesByName(snap))
    // The expense paid by someone for themselves only changes nothing and is left out.
    expect(plan.skipped).toBe(1)
    expect(imported.expenses).toHaveLength(snap.expenses.length - 1)
    expect(imported.settlements).toHaveLength(1)
    expect(imported.expenses.find((e) => e.title.startsWith('Café'))?.title).toBe('Café "Bica", Chiado')
    // The pending JPY expense has no rate here; the other currencies are verified on their own.
    const reparsed = parseSplitwiseCsv(csv)
    if (!reparsed.ok) throw new Error('unreadable')
    expect(verifyAgainstTotals(plan, reparsed.file.totals)).toEqual({ checked: true, matches: true, diffs: [] })
  })

  it('verifies against its own Total balance rows in every currency', async () => {
    const snap = richSeed()
    const { plan, parsed } = await roundTrip(snap)
    expect(neededRates(plan, 'EUR').length).toBeGreaterThan(0)
    expect(parsed.ok && verifyAgainstTotals(plan, parsed.file.totals).matches).toBe(true)
  })

  it('round-trips the real Splitwise export too: import, export, re-parse, same balances', async () => {
    const parsed = parseSplitwiseCsv(realCsv)
    if (!parsed.ok) throw new Error(parsed.message)
    const plan = mapSplitwise(parsed.file)
    const built = buildImportPayload(plan, {
      meKey: 'm0', tripName: 'Mexico', defaultCurrency: 'CAD', startDate: plan.startDate, endDate: plan.endDate, rates: new Map(),
    })
    if (!built.ok) throw new Error(built.error)
    const repo = createMemoryTripsRepository({ currentUserId: 'u-new', seed: [] })
    const first = (await repo.getTrip(await repo.importTrip(built.payload)))!
    expect(first.expenses).toHaveLength(53)
    expect(first.settlements).toHaveLength(4)

    const { csv } = buildSplitwiseCsv(first, TODAY)
    const again = parseSplitwiseCsv(csv)
    if (!again.ok) throw new Error(again.message)
    const plan2 = mapSplitwise(again.file)
    expect(plan2.expenses.length).toBeGreaterThan(40)
    expect(verifyAgainstTotals(plan2, again.file.totals)).toMatchObject({ checked: true, matches: true })
    const built2 = buildImportPayload(plan2, { meKey: 'm0', tripName: 'Again', defaultCurrency: 'CAD', startDate: null, endDate: null, rates: new Map() })
    if (!built2.ok) throw new Error(built2.error)
    const second = (await repo.getTrip(await repo.importTrip(built2.payload)))!
    expect(balancesByName(second)).toEqual(balancesByName(first))
    expect(second.settlements).toHaveLength(4)
  })
})
