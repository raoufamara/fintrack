import { describe, expect, it } from 'vitest'
import { computeBalances } from '../lib/balances'
import { toMinor } from '../lib/currency'
import { todayISO } from '../lib/dates'
import { splitAmount } from '../lib/money'
import { planCurrencyChange } from '../services/currencyChange'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'
import { createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { makeFx, seedWithPendingExpense } from '../testing/fxFixtures'
import { summarizeTrip } from './selectors'
import { createTripStore, type SaveExpenseInput } from './tripStore'

const USER = 'u-you'
const { tripId, you, sara } = SEED_IDS

async function setup(opts: { online?: boolean; cached?: boolean; pending?: boolean } = {}) {
  const { fx, network } = makeFx(opts)
  const pendingSeed = opts.pending ? seedWithPendingExpense(USER) : null
  const seed = pendingSeed?.seed ?? buildLisbonPortoSeed(USER, todayISO())
  const base = createMemoryTripsRepository({ currentUserId: USER, seed: [seed] })
  const store = createTripStore(base, fx)
  await store.getState().loadTrips()
  const snap = () => store.getState().trips[tripId]!
  return { store, base, fx, network, snap, pendingId: pendingSeed?.expenseId }
}

function madExpense(over: Partial<SaveExpenseInput> = {}): SaveExpenseInput {
  return {
    tripId,
    categoryId: 'c-food',
    title: 'Tagine lunch',
    amountMinor: 24000,
    paidBy: you,
    date: todayISO(),
    splitMode: 'equal',
    shares: splitAmount(24000, 'equal', [you, sara]),
    currency: 'MAD',
    fxRate: 1 / 10.82,
    fxSource: 'cache',
    fxDate: todayISO(),
    ...over,
  }
}

describe('saving foreign-currency expenses', () => {
  it('stores the original amount, rate fields and the server-style amount_default', async () => {
    const { store, snap, base } = await setup()
    expect(await store.getState().saveExpense(madExpense())).toBe(true)
    const e = snap().expenses.find((x) => x.title === 'Tagine lunch')!
    expect(e).toMatchObject({ amount: 240, currency: 'MAD', fx_source: 'cache', amount_default: 22.18 })
    expect(e.fx_rate).toBeCloseTo(0.0924, 4)
    expect(snap().shares.filter((s) => s.expense_id === e.id).map((s) => s.amount)).toEqual([120, 120])
    expect((await base.getTrip(tripId))?.expenses.find((x) => x.id === e.id)?.amount_default).toBe(22.18)
    // You paid 22.18 and owe 11.09 of it.
    expect(summarizeTrip(snap(), you).myBalance).toBe(-644 + 1109)
  })

  it('splits in the minor units of the expense currency (JPY has none)', async () => {
    const { store, snap } = await setup()
    await store.getState().saveExpense(
      madExpense({
        currency: 'JPY',
        amountMinor: 1000,
        shares: splitAmount(1000, 'equal', [you, sara, SEED_IDS.malik]),
        fxRate: 0.00625,
      }),
    )
    const e = snap().expenses.find((x) => x.currency === 'JPY')!
    expect(snap().shares.filter((s) => s.expense_id === e.id).map((s) => s.amount).sort()).toEqual([333, 333, 334])
    expect(e.amount).toBe(1000)
  })

  it('saves pending without a rate; balances exclude it and report it', async () => {
    const { store, snap } = await setup()
    await store.getState().saveExpense(madExpense({ fxRate: null, fxSource: null, fxDate: null }))
    const e = snap().expenses.find((x) => x.title === 'Tagine lunch')!
    expect(e).toMatchObject({ fx_rate: null, fx_source: null, amount_default: null })
    const summary = summarizeTrip(snap(), you)
    expect(summary.pendingCount).toBe(1)
    expect(summary.myBalance).toBe(-644)
    expect(summary.spent).toBe(76335)
    expect(computeBalances(snap().expenses, snap().shares, [], 'EUR').pendingIds).toEqual([e.id])
  })

  it('forces rate 1 for the trip currency', async () => {
    const { store, snap } = await setup()
    await store.getState().saveExpense(madExpense({ currency: 'EUR', amountMinor: 2400, shares: splitAmount(2400, 'equal', [you, sara]), fxRate: 9 }))
    expect(snap().expenses.find((x) => x.title === 'Tagine lunch')).toMatchObject({ fx_rate: 1, fx_source: 'same', amount_default: 24 })
  })
})

describe('reconciler', () => {
  it('converts a pending expense when rates become available and toasts', async () => {
    const { store, snap, network, pendingId, base } = await setup({ online: false, cached: false, pending: true })
    expect(await store.getState().reconcilePending()).toBe(0)
    expect(snap().expenses.find((e) => e.id === pendingId)?.fx_rate).toBeNull()

    network.online = true
    expect(await store.getState().reconcilePending()).toBe(1)
    const e = snap().expenses.find((x) => x.id === pendingId)!
    expect(e).toMatchObject({ fx_source: 'api' })
    expect(e.fx_rate).toBeCloseTo(1 / 38, 6)
    expect(e.amount_default).toBe(31.58)
    expect(store.getState().toast).toMatchObject({ kind: 'info', message: '1 pending expense converted' })
    expect((await base.getTrip(tripId))?.expenses.find((x) => x.id === pendingId)?.fx_rate).not.toBeNull()
    // Totals include it now.
    expect(summarizeTrip(snap(), you).pendingCount).toBe(0)
    expect(summarizeTrip(snap(), you).spent).toBe(76335 + 3158)
  })

  it('uses the cache offline when the rate is already saved', async () => {
    const { store, snap, pendingId } = await setup({ online: false, cached: true, pending: true })
    expect(await store.getState().reconcilePending()).toBe(1)
    expect(snap().expenses.find((x) => x.id === pendingId)?.fx_rate).not.toBeNull()
  })

  it('never overwrites a manual rate', async () => {
    const { store, snap } = await setup()
    await store.getState().saveExpense(madExpense({ fxRate: 0.1, fxSource: 'manual', fxDate: null }))
    const id = snap().expenses.find((x) => x.title === 'Tagine lunch')!.id
    expect(await store.getState().reconcilePending()).toBe(0)
    expect(snap().expenses.find((x) => x.id === id)).toMatchObject({ fx_rate: 0.1, fx_source: 'manual' })
  })

  it('does not overwrite a rate typed while it was looking one up', async () => {
    const { store, snap, pendingId } = await setup({ online: true, cached: false, pending: true })
    const run = store.getState().reconcilePending()
    // The user types a manual rate before the provider answers.
    await store.getState().saveExpense({
      tripId,
      id: pendingId,
      categoryId: 'c-food',
      title: 'Street food Bangkok',
      amountMinor: 120000,
      paidBy: you,
      date: todayISO(),
      splitMode: 'equal',
      shares: splitAmount(120000, 'equal', [you, sara, SEED_IDS.malik, SEED_IDS.ines]),
      currency: 'THB',
      fxRate: 0.03,
      fxSource: 'manual',
    })
    await run
    expect(snap().expenses.find((x) => x.id === pendingId)).toMatchObject({ fx_rate: 0.03, fx_source: 'manual' })
  })

  it('syncRates warms the cache and converts pending expenses', async () => {
    const { store, snap, pendingId, fx } = await setup({ online: true, cached: false, pending: true })
    expect(await fx.rateStatus('EUR')).toBeNull()
    await store.getState().syncRates(tripId)
    expect(await fx.rateStatus('EUR')).not.toBeNull()
    expect(snap().expenses.find((x) => x.id === pendingId)?.fx_rate).not.toBeNull()
  })
})

describe('changing the default currency', () => {
  async function withMad() {
    const ctx = await setup()
    await ctx.store.getState().saveExpense(madExpense())
    return ctx
  }

  it('plans rates per expense date and previews the new total', async () => {
    const { snap, fx } = await withMad()
    const plan = await planCurrencyChange(snap(), 'CAD', fx)
    expect(plan.missing).toEqual([])
    const today = todayISO()
    expect(plan.rates['MAD']?.[today]).toBeCloseTo(1.5406 / 10.82, 6)
    expect(plan.rates['EUR']?.['latest']).toBeCloseTo(1.5406, 6)
    // Seven EUR expenses plus 240 MAD.
    expect(plan.newTotal).toBeGreaterThan(toMinor(763.35 * 1.5, 'CAD'))
  })

  it('re-converts every expense and the totals match the preview', async () => {
    const { store, snap, fx } = await withMad()
    const plan = await planCurrencyChange(snap(), 'CAD', fx)
    const res = await store.getState().setDefaultCurrency(tripId, 'CAD', plan.rates)
    expect(res.ok).toBe(true)
    expect(snap().trip.default_currency).toBe('CAD')
    expect(snap().trip.budget_amount).toBeCloseTo(1200 * 1.5406, 2)
    const eur = snap().expenses.find((e) => e.id === 'e1')!
    expect(eur).toMatchObject({ currency: 'EUR', fx_source: 'api' })
    expect(eur.fx_rate).toBeCloseTo(1.5406, 6)
    const summary = summarizeTrip(snap(), you)
    expect(summary.spent).toBe(plan.newTotal)
    const { balances } = computeBalances(snap().expenses, snap().shares, snap().settlements, 'CAD')
    expect([...balances.values()].reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('blocks when a needed rate is unavailable offline', async () => {
    const { snap } = await withMad()
    const offline = makeFx({ online: false, cached: false })
    const plan = await planCurrencyChange(snap(), 'CAD', offline.fx)
    expect(plan.missing.sort()).toEqual(['EUR', 'MAD'])
  })

  it('leaves unconvertible pending expenses pending instead of blocking', async () => {
    const { snap } = await setup({ online: false, cached: false, pending: true })
    const offline = makeFx({ online: false, cached: false })
    const plan = await planCurrencyChange(snap(), 'EUR', offline.fx)
    expect(plan.missing).toEqual([])
    expect(plan.stillPending).toBe(1)
  })

  it('keeps settlements balanced after the change', async () => {
    const { fx, base } = await withMad()
    const trip = await base.getTrip(tripId)
    trip!.settlements.push({ id: 's1', trip_id: tripId, from_member: you, to_member: sara, amount: 5, currency: 'EUR', fx_rate: 1, created_at: new Date().toISOString() })
    const repo2 = createMemoryTripsRepository({ currentUserId: USER, seed: [trip!] })
    const store2 = createTripStore(repo2, fx)
    await store2.getState().loadTrips()
    const plan = await planCurrencyChange(store2.getState().trips[tripId]!, 'CAD', fx)
    await store2.getState().setDefaultCurrency(tripId, 'CAD', plan.rates)
    const s = store2.getState().trips[tripId]!
    expect(s.settlements[0]).toMatchObject({ currency: 'EUR' })
    expect(s.settlements[0]!.fx_rate).toBeCloseTo(1.5406, 6)
    const { balances } = computeBalances(s.expenses, s.shares, s.settlements, 'CAD')
    expect([...balances.values()].reduce((a, b) => a + b, 0)).toBe(0)
  })

  it('fails without changing anything when the budget rate is missing', async () => {
    const { store, snap } = await withMad()
    const res = await store.getState().setDefaultCurrency(tripId, 'CAD', { MAD: { [todayISO()]: 0.14 } })
    expect(res.ok).toBe(false)
    expect(snap().trip.default_currency).toBe('EUR')
    expect(store.getState().toast?.kind).toBe('error')
  })
})
