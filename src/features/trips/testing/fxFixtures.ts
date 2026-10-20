import { todayISO } from '../lib/dates'
import { createFxService, type FxService } from '../services/fxService'
import { createMemoryFxStorage } from '../services/fxStorage'
import { createFixtureProvider, seededCache } from '../demo/fixtureRates'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'
import type { TripSnapshot } from '../services/TripsRepository'

/** Test helper: an fx service on the demo sample rates. `cached: false` starts with an empty cache. */
export function makeFx(opts: { online?: boolean; cached?: boolean; hoursAgo?: number } = {}) {
  const network = { online: opts.online ?? true }
  const fx: FxService = createFxService({
    provider: createFixtureProvider(),
    storage: createMemoryFxStorage(opts.cached === false ? {} : seededCache(opts.hoursAgo ?? 2)),
    isOnline: () => network.online,
  })
  return { fx, network }
}

/** The Lisbon & Porto seed plus one THB expense (1,200 THB paid by You, split equally) with no rate yet. */
export function seedWithPendingExpense(userId: string): { seed: TripSnapshot; expenseId: string } {
  const seed = buildLisbonPortoSeed(userId, todayISO())
  const id = 'e-thb'
  const at = new Date().toISOString()
  seed.expenses.push({
    ...seed.expenses[0]!,
    id,
    title: 'Street food Bangkok',
    category_id: 'c-food',
    amount: 1200,
    currency: 'THB',
    fx_rate: null,
    fx_source: null,
    fx_date: null,
    amount_default: null,
    paid_by: SEED_IDS.you,
    date: todayISO(),
    place_name: null,
    place_area: null,
    place_city: null,
    created_at: at,
    updated_at: at,
  })
  for (const m of seed.members) seed.shares.push({ expense_id: id, member_id: m.id, weight: 1, amount: 300 })
  return { seed, expenseId: id }
}
