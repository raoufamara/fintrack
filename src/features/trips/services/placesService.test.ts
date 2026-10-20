import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPhotonProvider, mapPhotonFeature, parsePhotonResponse } from './placesService'

/** Recorded-shape fixtures: Photon returns GeoJSON with [lon, lat] coordinates. */
const SANTIAGO = {
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [-8.6063, 41.1479] },
  properties: {
    osm_id: 4711,
    osm_type: 'N',
    name: 'Café Santiago',
    street: 'Rua de Passos Manuel',
    housenumber: '226',
    district: 'Bolhão',
    locality: 'Santo Ildefonso',
    city: 'Porto',
    countrycode: 'PT',
  },
}
const SEARCH = {
  type: 'FeatureCollection',
  features: [
    SANTIAGO,
    SANTIAGO, // duplicate of the same OSM object
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-8.62, 41.15] },
      properties: { osm_id: 99, osm_type: 'W', name: 'Santiago Bar', suburb: 'Cedofeita', town: 'Matosinhos', countrycode: 'pt' },
    },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: {} }, // nothing usable
  ],
}

const ok = (doc: unknown) => ({ ok: true, status: 200, json: async () => doc }) as unknown as Response

describe('Photon mapping', () => {
  it('maps properties to a place', () => {
    expect(mapPhotonFeature(SANTIAGO)).toEqual({
      name: 'Café Santiago',
      address: 'Rua de Passos Manuel 226',
      area: 'Bolhão',
      city: 'Porto',
      country: 'PT',
      lat: 41.1479,
      lng: -8.6063,
      providerId: 'N4711',
      distanceKm: null,
    })
  })

  it('falls back through area and city properties and uppercases the country', () => {
    const p = mapPhotonFeature(SEARCH.features[2]!)!
    expect(p).toMatchObject({ area: 'Cedofeita', city: 'Matosinhos', country: 'PT', providerId: 'W99' })
    const village = mapPhotonFeature({ properties: { name: 'X', village: 'Aldeia', county: 'Condado' } })!
    expect(village.city).toBe('Aldeia')
    expect(mapPhotonFeature({ properties: { name: 'X', county: 'Condado' } })!.city).toBe('Condado')
    expect(mapPhotonFeature({ properties: { name: 'X', locality: 'L' } })!.area).toBe('L')
  })

  it('uses the street as the name when a feature has none, and skips empty features', () => {
    expect(mapPhotonFeature({ properties: { street: 'Rua A', housenumber: '3' } })?.name).toBe('Rua A 3')
    expect(mapPhotonFeature({ properties: {} })).toBeNull()
  })

  it('dedupes by provider id and computes distances when a reference point is known', () => {
    const places = parsePhotonResponse(SEARCH, { lat: 41.1406, lng: -8.6112 })
    expect(places.map((p) => p.providerId)).toEqual(['N4711', 'W99'])
    expect(places[0]!.distanceKm).toBeGreaterThan(0.5)
    expect(places[0]!.distanceKm).toBeLessThan(1.5)
    expect(parsePhotonResponse(SEARCH)[0]!.distanceKm).toBeNull()
  })

  it('rejects an unexpected response shape', () => {
    expect(() => parsePhotonResponse({ nope: 1 })).toThrow()
  })
})

describe('Photon provider', () => {
  afterEach(() => vi.useRealTimers())

  it('builds the search URL with limit, language and the bias point', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok(SEARCH))
    const provider = createPhotonProvider({ fetchFn })
    await provider.searchPlaces('café sant')
    const plain = new URL(fetchFn.mock.calls[0]![0] as string)
    expect(plain.origin + plain.pathname).toBe('https://photon.komoot.io/api/')
    expect(plain.searchParams.get('q')).toBe('café sant')
    expect(plain.searchParams.get('limit')).toBe('8')
    expect(plain.searchParams.get('lang')).toBe('en')
    expect(plain.searchParams.has('lat')).toBe(false)

    await provider.searchPlaces('café', { lat: 41.14, lng: -8.61 })
    const biased = new URL(fetchFn.mock.calls[1]![0] as string)
    expect(biased.searchParams.get('lat')).toBe('41.14')
    expect(biased.searchParams.get('lon')).toBe('-8.61')
  })

  it('reverse geocodes to the first feature', async () => {
    const fetchFn = vi.fn().mockResolvedValue(ok({ features: [SANTIAGO] }))
    const place = await createPhotonProvider({ fetchFn }).reverseGeocode(41.1479, -8.6063)
    const url = new URL(fetchFn.mock.calls[0]![0] as string)
    expect(url.origin + url.pathname).toBe('https://photon.komoot.io/reverse')
    expect(url.searchParams.get('lat')).toBe('41.1479')
    expect(url.searchParams.get('lon')).toBe('-8.6063')
    expect(place?.name).toBe('Café Santiago')
    expect(await createPhotonProvider({ fetchFn: vi.fn().mockResolvedValue(ok({ features: [] })) }).reverseGeocode(0, 0)).toBeNull()
  })

  it('rejects on HTTP errors', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 503 } as Response)
    await expect(createPhotonProvider({ fetchFn }).searchPlaces('x')).rejects.toThrow('HTTP 503')
  })

  it('aborts a request that takes longer than 5 seconds', async () => {
    vi.useFakeTimers()
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))),
    )
    const pending = createPhotonProvider({ fetchFn }).searchPlaces('slow')
    const assertion = expect(pending).rejects.toThrow('aborted')
    await vi.advanceTimersByTimeAsync(5000)
    await assertion
  })

  it('cancels a stale search through the caller signal', async () => {
    let seen: AbortSignal | undefined
    const fetchFn = vi.fn().mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          seen = init.signal ?? undefined
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const controller = new AbortController()
    const pending = createPhotonProvider({ fetchFn }).searchPlaces('caf', null, controller.signal)
    const assertion = expect(pending).rejects.toThrow('aborted')
    expect(seen?.aborted).toBe(false)
    controller.abort()
    await assertion
    expect(seen?.aborted).toBe(true)
  })
})
