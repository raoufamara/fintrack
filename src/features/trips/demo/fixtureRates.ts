import type { CachedTable, ProviderTable, RateProvider } from '../services/fxService'
import { todayISO } from '../lib/dates'

/** Demo-only sample rates: units of each currency per 1 EUR. */
export const PER_EUR: Record<string, number> = {
  EUR: 1,
  USD: 1.08,
  CAD: 1.5406,
  GBP: 0.86,
  MAD: 10.82,
  JPY: 160,
  THB: 38,
  CHF: 0.95,
  MXN: 20.5,
  VND: 27000,
}

/** A table of `base` derived from the EUR sample rates (the base itself is left out, as in the real API). */
export function fixtureTable(base: string, date: string = todayISO()): ProviderTable {
  const baseRate = PER_EUR[base]
  if (!baseRate) throw new Error(`No sample rates for ${base}`)
  const rates: Record<string, number> = {}
  for (const [code, perEur] of Object.entries(PER_EUR)) if (code !== base) rates[code] = perEur / baseRate
  return { date, rates }
}

export function createFixtureProvider(): RateProvider {
  return {
    async fetchTable(base, date) {
      await new Promise((r) => setTimeout(r, 80))
      return fixtureTable(base, date === 'latest' ? todayISO() : date)
    },
  }
}

/** Tables as if downloaded `hoursAgo` hours ago, for pre-filling the cache. */
export function seededCache(hoursAgo = 2): Record<string, CachedTable> {
  const stamp = Date.now() - hoursAgo * 3_600_000
  const out: Record<string, CachedTable> = {}
  for (const base of Object.keys(PER_EUR)) {
    const t = fixtureTable(base)
    out[`fx:${base}:latest`] = { base, date: t.date, fetchedAt: stamp, usedAt: stamp, rates: t.rates }
  }
  return out
}
