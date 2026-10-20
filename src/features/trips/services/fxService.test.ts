import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpRateProvider, parseRateResponse } from './fxProviders'
import {
  HISTORICAL_LRU_SIZE,
  createFxService,
  formatAge,
  formatRate,
  type CachedTable,
  type FxStorage,
  type RateProvider,
} from './fxService'
import { createMemoryFxStorage } from './fxStorage'

/** Recorded-shape fixtures: what the API returns, lower-case codes. */
const EUR_LATEST = { date: '2026-10-19', eur: { mad: 10.82, usd: 1.08, jpy: 160, cad: 1.54, thb: 38 } }
const EUR_OLD = { date: '2026-10-01', eur: { mad: 10.5, usd: 1.1, jpy: 155, cad: 1.5, thb: 37 } }

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 9, 20, 12)

function fakeProvider(docs: Record<string, unknown>) {
  const calls: Array<[string, string]> = []
  const provider: RateProvider = {
    async fetchTable(base, date) {
      calls.push([base, date])
      const doc = docs[`${base}:${date}`]
      if (!doc) throw new Error('offline')
      return parseRateResponse(base, doc)
    },
  }
  return { provider, calls }
}

function setup(opts: { docs?: Record<string, unknown>; online?: boolean; storage?: FxStorage } = {}) {
  const state = { online: opts.online ?? true, now: NOW }
  const storage = opts.storage ?? createMemoryFxStorage()
  const { provider, calls } = fakeProvider(opts.docs ?? { 'EUR:latest': EUR_LATEST, 'EUR:2026-10-01': EUR_OLD })
  const fx = createFxService({ provider, storage, now: () => state.now, isOnline: () => state.online })
  return { fx, calls, storage, state }
}

const table = (base: string, date: string, over: Partial<CachedTable> = {}): CachedTable => ({
  base,
  date,
  fetchedAt: NOW - 2 * HOUR,
  usedAt: NOW - 2 * HOUR,
  rates: { MAD: 10.82, USD: 1.08, JPY: 160, CAD: 1.54 },
  ...over,
})

describe('parseRateResponse', () => {
  it('normalises codes to upper case', () => {
    expect(parseRateResponse('EUR', EUR_LATEST)).toEqual({
      date: '2026-10-19',
      rates: { MAD: 10.82, USD: 1.08, JPY: 160, CAD: 1.54, THB: 38 },
    })
  })
  it('rejects unexpected shapes', () => {
    expect(() => parseRateResponse('EUR', { date: '2026-10-19' })).toThrow()
    expect(() => parseRateResponse('EUR', { date: 1, eur: {} })).toThrow()
    expect(() => parseRateResponse('EUR', { date: '2026-10-19', eur: { mad: 'x' } })).toThrow()
    expect(() => parseRateResponse('EUR', null)).toThrow()
  })
})

describe('getRate', () => {
  it('is 1 for the same currency without touching the cache or network', async () => {
    const { fx, calls } = setup()
    expect(await fx.getRate('EUR', 'EUR')).toEqual({ rate: 1, source: 'same', ageHours: 0, tableDate: null })
    expect(calls).toEqual([])
  })

  it('computes cross rates from a cached table of any base', async () => {
    const storage = createMemoryFxStorage({ 'fx:EUR:latest': table('EUR', '2026-10-19') })
    const { fx, calls } = setup({ storage, online: false })
    const mad = await fx.getRate('MAD', 'EUR')
    expect(mad?.rate).toBeCloseTo(1 / 10.82, 10)
    expect(mad).toMatchObject({ source: 'cache', tableDate: '2026-10-19' })
    expect(mad?.ageHours).toBeCloseTo(2, 5)
    // MAD -> USD across the EUR table; EUR -> MAD inverse.
    expect((await fx.getRate('MAD', 'USD'))?.rate).toBeCloseTo(1.08 / 10.82, 10)
    expect((await fx.getRate('EUR', 'MAD'))?.rate).toBeCloseTo(10.82, 10)
    expect(calls).toEqual([])
  })

  it('prefers the exact-date table over the latest one', async () => {
    const storage = createMemoryFxStorage({
      'fx:EUR:latest': table('EUR', '2026-10-19'),
      'fx:EUR:2026-10-01': table('EUR', '2026-10-01', { rates: { MAD: 10.5 } }),
    })
    const { fx } = setup({ storage, online: false })
    expect((await fx.getRate('MAD', 'EUR', '2026-10-01'))?.rate).toBeCloseTo(1 / 10.5, 10)
    expect((await fx.getRate('MAD', 'EUR', '2026-10-02'))?.rate).toBeCloseTo(1 / 10.82, 10)
    expect((await fx.getRate('MAD', 'EUR'))?.tableDate).toBe('2026-10-19')
  })

  it('uses the latest cache however old when offline', async () => {
    const storage = createMemoryFxStorage({
      'fx:EUR:latest': table('EUR', '2026-09-01', { fetchedAt: NOW - 40 * 24 * HOUR }),
    })
    const { fx } = setup({ storage, online: false })
    const r = await fx.getRate('USD', 'EUR', '2026-09-15')
    expect(r?.source).toBe('cache')
    expect(r?.ageHours).toBeCloseTo(960, 5)
  })

  it('returns null offline with an empty cache (the expense becomes pending)', async () => {
    const { fx, calls } = setup({ online: false })
    expect(await fx.getRate('THB', 'EUR')).toBeNull()
    expect(calls).toEqual([])
  })

  it('fetches, caches and returns source api when online and uncached', async () => {
    const { fx, calls, storage } = setup()
    const r = await fx.getRate('MAD', 'EUR')
    expect(r).toMatchObject({ source: 'api', ageHours: 0, tableDate: '2026-10-19' })
    expect(r?.rate).toBeCloseTo(1 / 10.82, 10)
    expect(calls).toEqual([['EUR', 'latest']])
    expect(await storage.keys()).toEqual(['fx:EUR:latest'])
    // Second lookup is served from the cache.
    expect((await fx.getRate('USD', 'EUR'))?.source).toBe('cache')
    expect(calls).toHaveLength(1)
  })

  it('fetches a historical table for a backdated expense when nothing is cached', async () => {
    const { fx, calls, storage } = setup()
    const r = await fx.getRate('MAD', 'EUR', '2026-10-01')
    expect(r?.tableDate).toBe('2026-10-01')
    expect(calls).toEqual([['EUR', '2026-10-01']])
    expect(await storage.keys()).toEqual(['fx:EUR:2026-10-01'])
  })

  it('is pending when the provider fails or lacks the currency', async () => {
    const failing = setup({ docs: {} })
    expect(await failing.fx.getRate('MAD', 'EUR')).toBeNull()
    const lacking = setup()
    expect(await lacking.fx.getRate('XYZ', 'EUR')).toBeNull()
  })
})

describe('refresh, warm and status', () => {
  it('refreshLatest downloads when online and never throws when it fails', async () => {
    const ok = setup()
    expect(await ok.fx.refreshLatest('EUR')).toBe(true)
    expect(await ok.storage.keys()).toEqual(['fx:EUR:latest'])
    expect(await setup({ online: false }).fx.refreshLatest('EUR')).toBe(false)
    expect(await setup({ docs: {} }).fx.refreshLatest('EUR')).toBe(false)
  })

  it('warm only refreshes a missing or older-than-12h table', async () => {
    const { fx, calls, state } = setup()
    expect(await fx.warm('EUR')).toBe(true)
    expect(await fx.warm('EUR')).toBe(false)
    state.now += 11 * HOUR
    expect(await fx.warm('EUR')).toBe(false)
    state.now += 2 * HOUR
    expect(await fx.warm('EUR')).toBe(true)
    expect(calls).toHaveLength(2)
  })

  it('reports staleness after 7 days', async () => {
    const storage = createMemoryFxStorage({ 'fx:EUR:latest': table('EUR', '2026-10-19', { fetchedAt: NOW - 2 * HOUR }) })
    const { fx, state } = setup({ storage, online: false })
    expect(await fx.rateStatus('EUR')).toMatchObject({ stale: false, tableDate: '2026-10-19' })
    state.now += 164 * HOUR
    expect((await fx.rateStatus('EUR'))?.stale).toBe(false)
    state.now += 3 * HOUR
    expect((await fx.rateStatus('EUR'))?.stale).toBe(true)
    expect(await setup({ online: false }).fx.rateStatus('EUR')).toBeNull()
  })
})

describe('cache robustness', () => {
  it('evicts the least recently used historical tables beyond 60 and keeps latest tables', async () => {
    const initial: Record<string, CachedTable> = { 'fx:EUR:latest': table('EUR', '2026-10-19') }
    for (let i = 0; i < HISTORICAL_LRU_SIZE; i++) {
      const date = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`
      initial[`fx:EUR:${date}-${i}`] = table('EUR', date, { usedAt: NOW - (1000 - i) * HOUR })
    }
    const storage = createMemoryFxStorage(initial)
    const { fx } = setup({ storage, docs: { 'EUR:2026-10-01': EUR_OLD }, online: true })
    // Offline-style miss that fetches a 61st historical table.
    await fx.getRate('XYZ', 'EUR', '2026-10-01').catch(() => null)
    const keys = await storage.keys()
    const historical = keys.filter((k) => !k.endsWith(':latest'))
    expect(historical).toHaveLength(HISTORICAL_LRU_SIZE)
    expect(keys).toContain('fx:EUR:latest')
    expect(keys).toContain('fx:EUR:2026-10-01')
    expect(keys).not.toContain('fx:EUR:2026-01-01-0') // the oldest was evicted
  })

  it('works when the storage throws on every call (IndexedDB unavailable)', async () => {
    const broken: FxStorage = {
      get: () => Promise.reject(new Error('idb')),
      set: () => Promise.reject(new Error('idb')),
      del: () => Promise.reject(new Error('idb')),
      keys: () => Promise.reject(new Error('idb')),
    }
    const { fx } = setup({ storage: broken })
    expect((await fx.getRate('MAD', 'EUR'))?.source).toBe('api')
    expect(await fx.rateStatus('EUR')).toBeNull()
    const offline = setup({ storage: broken, online: false })
    expect(await offline.fx.getRate('MAD', 'EUR')).toBeNull()
  })
})

describe('http provider', () => {
  afterEach(() => vi.useRealTimers())

  const ok = (doc: unknown) => ({ ok: true, status: 200, json: async () => doc }) as unknown as Response

  it('uses the primary URL first, with lower-case codes', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(EUR_LATEST))
    const t = await createHttpRateProvider({ fetchFn }).fetchTable('EUR', 'latest')
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(fetchFn.mock.calls[0]![0]).toBe('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/eur.json')
    expect(t.rates.MAD).toBe(10.82)
  })

  it('falls back to the mirror when the primary fails, for latest and dated tables', async () => {
    const fetchFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(ok(EUR_LATEST))
      .mockResolvedValueOnce({ ok: false, status: 404 } as Response)
      .mockResolvedValueOnce(ok(EUR_OLD))
    const provider = createHttpRateProvider({ fetchFn })
    await provider.fetchTable('EUR', 'latest')
    expect(fetchFn.mock.calls[1]![0]).toBe('https://latest.currency-api.pages.dev/v1/currencies/eur.json')
    const old = await provider.fetchTable('EUR', '2026-10-01')
    expect(fetchFn.mock.calls[2]![0]).toBe('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@2026-10-01/v1/currencies/eur.json')
    expect(fetchFn.mock.calls[3]![0]).toBe('https://2026-10-01.currency-api.pages.dev/v1/currencies/eur.json')
    expect(old.date).toBe('2026-10-01')
  })

  it('rejects when both sources fail', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new Error('down'))
    await expect(createHttpRateProvider({ fetchFn }).fetchTable('EUR', 'latest')).rejects.toThrow()
    expect(fetchFn).toHaveBeenCalledTimes(2)
  })

  it('aborts a request after the timeout and then tries the mirror', async () => {
    vi.useFakeTimers()
    const fetchFn = vi
      .fn()
      .mockImplementationOnce(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      .mockResolvedValueOnce(ok(EUR_LATEST))
    const pending = createHttpRateProvider({ fetchFn, timeoutMs: 5000 }).fetchTable('EUR', 'latest')
    await vi.advanceTimersByTimeAsync(5000)
    const t = await pending
    expect(fetchFn).toHaveBeenCalledTimes(2)
    expect(t.date).toBe('2026-10-19')
  })
})

describe('formatting', () => {
  it('formats ages and rates', () => {
    expect(formatAge(0.2)).toBe('just now')
    expect(formatAge(2.2)).toBe('2h ago')
    expect(formatAge(72)).toBe('3d ago')
    expect(formatRate(0.0924)).toBe('0.0924')
    expect(formatRate(1.5406)).toBe('1.5406')
    expect(formatRate(160)).toBe('160.00')
  })
})

