import { haversineKm, type PlaceResult } from '../lib/places'

export interface LatLng {
  lat: number
  lng: number
}

/** Place search and reverse geocoding (spec section 7.1). Rejects when the service cannot answer. */
export interface PlacesProvider {
  searchPlaces(query: string, near?: LatLng | null, signal?: AbortSignal): Promise<PlaceResult[]>
  reverseGeocode(lat: number, lng: number, signal?: AbortSignal): Promise<PlaceResult | null>
}

/** Position source. Only called after a user tap. Rejects with `{ code: 'denied' | 'unavailable' | 'timeout' }`. */
export interface GeolocationSource {
  getCurrentPosition(options: { timeoutMs: number; maximumAgeMs: number }): Promise<LatLng>
}

export type GeolocationErrorCode = 'denied' | 'unavailable' | 'timeout'

export class GeolocationError extends Error {
  readonly code: GeolocationErrorCode
  constructor(code: GeolocationErrorCode) {
    super(code)
    this.name = 'GeolocationError'
    this.code = code
  }
}

/** Wraps `navigator.geolocation`. */
export function createBrowserGeolocation(): GeolocationSource {
  return {
    getCurrentPosition({ timeoutMs, maximumAgeMs }) {
      return new Promise((resolve, reject) => {
        if (typeof navigator === 'undefined' || !navigator.geolocation) {
          reject(new GeolocationError('unavailable'))
          return
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
          (err) => reject(new GeolocationError(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable')),
          { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: maximumAgeMs },
        )
      })
    },
  }
}

export function createNullGeolocation(): GeolocationSource {
  return { getCurrentPosition: () => Promise.reject(new GeolocationError('unavailable')) }
}

export function createNullPlacesProvider(): PlacesProvider {
  const fail = () => Promise.reject(new Error('Places are not available'))
  return { searchPlaces: fail, reverseGeocode: fail }
}

// --- Photon (https://photon.komoot.io) ---------------------------------------

interface PhotonFeature {
  geometry?: { coordinates?: number[] }
  properties?: Record<string, unknown>
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)

/** Maps one Photon GeoJSON feature to a place, or null when it has nothing usable. */
export function mapPhotonFeature(feature: PhotonFeature, near?: LatLng | null): PlaceResult | null {
  const p = feature.properties ?? {}
  const coords = feature.geometry?.coordinates
  const lng = Array.isArray(coords) && typeof coords[0] === 'number' ? coords[0] : null
  const lat = Array.isArray(coords) && typeof coords[1] === 'number' ? coords[1] : null
  const street = str(p.street)
  const house = str(p.housenumber)
  const address = street ? (house ? `${street} ${house}` : street) : null
  const city = str(p.city) ?? str(p.town) ?? str(p.village) ?? str(p.county)
  const name = str(p.name) ?? address ?? city
  if (!name) return null
  const osmType = str(p.osm_type)
  const osmId = p.osm_id
  const country = str(p.countrycode)
  return {
    name,
    address,
    area: str(p.district) ?? str(p.locality) ?? str(p.suburb),
    city,
    country: country ? country.toUpperCase() : null,
    lat,
    lng,
    providerId: osmType && (typeof osmId === 'number' || typeof osmId === 'string') ? `${osmType}${osmId}` : null,
    distanceKm: near && lat !== null && lng !== null ? haversineKm(near, { lat, lng }) : null,
  }
}

export function parsePhotonResponse(json: unknown, near?: LatLng | null): PlaceResult[] {
  const features = (json as { features?: unknown } | null)?.features
  if (!Array.isArray(features)) throw new Error('Unexpected places response')
  const out: PlaceResult[] = []
  const seen = new Set<string>()
  for (const f of features) {
    const place = mapPhotonFeature(f as PhotonFeature, near)
    if (!place) continue
    if (place.providerId) {
      if (seen.has(place.providerId)) continue
      seen.add(place.providerId)
    }
    out.push(place)
  }
  return out
}

export interface PhotonOptions {
  fetchFn?: typeof fetch
  timeoutMs?: number
  baseUrl?: string
}

export function createPhotonProvider({
  fetchFn,
  timeoutMs = 5000,
  baseUrl = 'https://photon.komoot.io',
}: PhotonOptions = {}): PlacesProvider {
  const doFetch = fetchFn ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init))

  /** One request with its own 5 s timeout; aborts early when the caller's signal fires. */
  async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    const onAbort = () => controller.abort()
    if (signal?.aborted) controller.abort()
    signal?.addEventListener('abort', onAbort)
    try {
      const res = await doFetch(url, { signal: controller.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.json()
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  return {
    async searchPlaces(query, near, signal) {
      const params = new URLSearchParams({ q: query, limit: '8', lang: 'en' })
      if (near) {
        params.set('lat', String(near.lat))
        params.set('lon', String(near.lng))
      }
      return parsePhotonResponse(await getJson(`${baseUrl}/api/?${params}`, signal), near)
    },
    async reverseGeocode(lat, lng, signal) {
      const params = new URLSearchParams({ lat: String(lat), lon: String(lng), lang: 'en' })
      const places = parsePhotonResponse(await getJson(`${baseUrl}/reverse?${params}`, signal), { lat, lng })
      return places[0] ?? null
    },
  }
}
