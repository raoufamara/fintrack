import type { ProviderTable, RateProvider } from './fxService'

const PRIMARY = (base: string, version: string) =>
  `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${version}/v1/currencies/${base}.json`
const FALLBACK = (base: string, version: string) =>
  version === 'latest'
    ? `https://latest.currency-api.pages.dev/v1/currencies/${base}.json`
    : `https://${version}.currency-api.pages.dev/v1/currencies/${base}.json`

/**
 * Turns `{ "date": "2026-10-11", "eur": { "mad": 10.82, ... } }` into upper-case codes.
 * Throws when the shape is not as expected.
 */
export function parseRateResponse(base: string, json: unknown): ProviderTable {
  const doc = json as Record<string, unknown> | null
  const table = doc?.[base.toLowerCase()]
  if (!doc || typeof doc.date !== 'string' || typeof table !== 'object' || table === null) {
    throw new Error('Unexpected rate response')
  }
  const rates: Record<string, number> = {}
  for (const [code, value] of Object.entries(table as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) rates[code.toUpperCase()] = value
  }
  if (Object.keys(rates).length === 0) throw new Error('Empty rate table')
  return { date: doc.date, rates }
}

export interface HttpProviderOptions {
  fetchFn?: typeof fetch
  timeoutMs?: number
}

/** fawazahmed0 currency-api via jsDelivr, with the pages.dev mirror as fallback. */
export function createHttpRateProvider({ fetchFn, timeoutMs = 5000 }: HttpProviderOptions = {}): RateProvider {
  const doFetch = fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))

  async function get(url: string, base: string): Promise<ProviderTable> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await doFetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseRateResponse(base, await res.json())
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    async fetchTable(base, date) {
      const code = base.toLowerCase()
      const version = date === 'latest' ? 'latest' : date
      try {
        return await get(PRIMARY(code, version), base)
      } catch {
        return await get(FALLBACK(code, version), base)
      }
    },
  }
}
