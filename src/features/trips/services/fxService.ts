/**
 * Exchange rates with an offline cache (spec section 7.2).
 *
 * Tables are stored per base currency. A rate between any two currencies is a
 * cross rate from one table: `from -> to = rates[to] / rates[from]`.
 * Everything here is injected (provider, storage, clock, connectivity) so it
 * can be tested without a network or a browser.
 */

const HOUR_MS = 3_600_000
export const REFRESH_AFTER_HOURS = 12
export const STALE_AFTER_HOURS = 24 * 7
export const HISTORICAL_LRU_SIZE = 60

/** A table as delivered by a provider. `rates` are keyed by upper-case code. */
export interface ProviderTable {
  /** Date of the rates, YYYY-MM-DD. */
  date: string
  rates: Record<string, number>
}

export interface RateProvider {
  /** Rejects when no source answers. `date` is 'latest' or YYYY-MM-DD. */
  fetchTable(base: string, date: string): Promise<ProviderTable>
}

/** A table as kept in the cache. */
export interface CachedTable {
  base: string
  /** Date of the rates, YYYY-MM-DD. */
  date: string
  /** Epoch ms when it was downloaded. */
  fetchedAt: number
  /** Epoch ms of the last time it answered a lookup (for the LRU). */
  usedAt: number
  rates: Record<string, number>
}

/** Minimal async key-value store (IndexedDB in the app, a Map in tests). */
export interface FxStorage {
  get(key: string): Promise<CachedTable | undefined>
  set(key: string, value: CachedTable): Promise<void>
  del(key: string): Promise<void>
  keys(): Promise<string[]>
}

export type FxSource = 'same' | 'cache' | 'api'

export interface FxRate {
  rate: number
  source: FxSource
  /** Hours since the table was downloaded; 0 for 'same' and 'api'. */
  ageHours: number
  /** Date of the table the rate came from; null for 'same'. */
  tableDate: string | null
}

export interface RateStatus {
  fetchedAt: number
  ageHours: number
  tableDate: string
  /** Older than 7 days. */
  stale: boolean
}

export interface FxService {
  /** Rate of 1 `from` in `to` on `date` (default: latest). Null when nothing is cached and we are offline. */
  getRate(from: string, to: string, date?: string): Promise<FxRate | null>
  /** Downloads and caches the latest table of `base` if online. Never throws. Returns whether it refreshed. */
  refreshLatest(base: string): Promise<boolean>
  /** Refreshes the latest table of `base` when missing or older than 12h. Never throws. */
  warm(base: string): Promise<boolean>
  /** Age of the latest table of `base`, or null when there is none. */
  rateStatus(base: string): Promise<RateStatus | null>
  isOnline(): boolean
}

export interface FxServiceOptions {
  provider: RateProvider
  storage: FxStorage
  now?: () => number
  isOnline?: () => boolean
}

const LATEST = 'latest'
const key = (base: string, date: string) => `fx:${base}:${date}`
const hoursSince = (then: number, now: number) => Math.max(0, (now - then) / HOUR_MS)

/** Rate from one table, treating the base itself as 1. */
function crossRate(table: { base: string; rates: Record<string, number> }, from: string, to: string): number | null {
  const rateOf = (code: string) => (code === table.base ? 1 : table.rates[code])
  const a = rateOf(from)
  const b = rateOf(to)
  if (!a || !b || !Number.isFinite(a) || !Number.isFinite(b)) return null
  return b / a
}

export function createFxService({ provider, storage, now = Date.now, isOnline = () => true }: FxServiceOptions): FxService {
  const safe = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn()
    } catch {
      return fallback
    }
  }

  async function readTables(filter: (k: string) => boolean): Promise<Array<{ key: string; table: CachedTable }>> {
    const keys = (await safe(() => storage.keys(), [])).filter(filter)
    const out: Array<{ key: string; table: CachedTable }> = []
    for (const k of keys) {
      const table = await safe(() => storage.get(k), undefined)
      if (table) out.push({ key: k, table })
    }
    return out
  }

  async function touch(k: string, table: CachedTable): Promise<void> {
    await safe(() => storage.set(k, { ...table, usedAt: now() }), undefined)
  }

  async function evictHistorical(): Promise<void> {
    const historical = await readTables((k) => k.startsWith('fx:') && !k.endsWith(`:${LATEST}`))
    if (historical.length <= HISTORICAL_LRU_SIZE) return
    historical.sort((a, b) => a.table.usedAt - b.table.usedAt)
    for (const { key: k } of historical.slice(0, historical.length - HISTORICAL_LRU_SIZE)) {
      await safe(() => storage.del(k), undefined)
    }
  }

  async function download(base: string, date: string): Promise<CachedTable | null> {
    if (!isOnline()) return null
    try {
      const fetched = await provider.fetchTable(base, date)
      const stamp = now()
      const table: CachedTable = { base, date: fetched.date, fetchedAt: stamp, usedAt: stamp, rates: fetched.rates }
      await safe(() => storage.set(key(base, date), table), undefined)
      if (date !== LATEST) await evictHistorical()
      return table
    } catch {
      return null
    }
  }

  async function getRate(from: string, to: string, date?: string): Promise<FxRate | null> {
    if (from === to) return { rate: 1, source: 'same', ageHours: 0, tableDate: null }

    // 2. A cached table for exactly that date.
    if (date && date !== LATEST) {
      const exact = await readTables((k) => k.endsWith(`:${date}`))
      for (const { key: k, table } of exact) {
        const rate = crossRate(table, from, to)
        if (rate !== null) {
          await touch(k, table)
          return { rate, source: 'cache', ageHours: hoursSince(table.fetchedAt, now()), tableDate: table.date }
        }
      }
    }

    // 3. The freshest latest table, of any base, that knows both currencies.
    const latest = (await readTables((k) => k.endsWith(`:${LATEST}`))).sort(
      (a, b) => b.table.fetchedAt - a.table.fetchedAt,
    )
    for (const { table } of latest) {
      const rate = crossRate(table, from, to)
      if (rate !== null) {
        return { rate, source: 'cache', ageHours: hoursSince(table.fetchedAt, now()), tableDate: table.date }
      }
    }

    // 4. Online: fetch (one table of base `to` answers every expense of a trip).
    const wanted = date && date !== LATEST ? date : LATEST
    const downloaded = await download(to, wanted)
    if (downloaded) {
      const rate = crossRate(downloaded, from, to)
      if (rate !== null) return { rate, source: 'api', ageHours: 0, tableDate: downloaded.date }
    }
    // 5. Pending.
    return null
  }

  async function refreshLatest(base: string): Promise<boolean> {
    return (await download(base, LATEST)) !== null
  }

  async function rateStatus(base: string): Promise<RateStatus | null> {
    const own = await safe(() => storage.get(key(base, LATEST)), undefined)
    const table =
      own ??
      (await readTables((k) => k.endsWith(`:${LATEST}`))).sort((a, b) => b.table.fetchedAt - a.table.fetchedAt)[0]?.table
    if (!table) return null
    const ageHours = hoursSince(table.fetchedAt, now())
    return { fetchedAt: table.fetchedAt, ageHours, tableDate: table.date, stale: ageHours > STALE_AFTER_HOURS }
  }

  async function warm(base: string): Promise<boolean> {
    const own = await safe(() => storage.get(key(base, LATEST)), undefined)
    if (own && hoursSince(own.fetchedAt, now()) <= REFRESH_AFTER_HOURS) return false
    return refreshLatest(base)
  }

  return { getRate, refreshLatest, warm, rateStatus, isOnline }
}

/** A service that knows no rates and is always offline. Default when none is injected. */
export function createNullFxService(): FxService {
  return {
    async getRate(from, to) {
      return from === to ? { rate: 1, source: 'same', ageHours: 0, tableDate: null } : null
    },
    async refreshLatest() {
      return false
    },
    async warm() {
      return false
    },
    async rateStatus() {
      return null
    },
    isOnline: () => false,
  }
}

/** "just now", "2h ago", "3d ago". */
export function formatAge(ageHours: number): string {
  if (ageHours < 1) return 'just now'
  if (ageHours < 48) return `${Math.round(ageHours)}h ago`
  return `${Math.round(ageHours / 24)}d ago`
}

/** Compact rate text: 160.00, 1.5406, 0.0924. */
export function formatRate(rate: number): string {
  return rate >= 100 ? rate.toFixed(2) : rate >= 1 ? rate.toFixed(4) : rate.toPrecision(3)
}
