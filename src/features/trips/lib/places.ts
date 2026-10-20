import type { TripExpense } from '../types'

/** A place as picked by the user or returned by a places provider. */
export interface PlaceResult {
  name: string
  address: string | null
  area: string | null
  city: string | null
  /** ISO 3166-1 alpha-2. */
  country: string | null
  lat: number | null
  lng: number | null
  /** Provider reference, e.g. "N123456" (OSM type + id). Null for free text. */
  providerId: string | null
  /** Distance from the reference point in km, when known. Never stored. */
  distanceKm?: number | null
}

export type PlaceFields = Pick<
  TripExpense,
  | 'place_name' | 'place_address' | 'place_area' | 'place_city'
  | 'place_country' | 'place_lat' | 'place_lng' | 'place_provider_id'
>

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** "1.2 km", "340 m". */
export function formatDistance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000 / 10) * 10} m` : `${km.toFixed(km < 10 ? 1 : 0)} km`
}

/** "{name}, {city}", or just the name when there is no city or it equals the name. */
export function placeLabel(name: string | null, city: string | null): string {
  if (!name) return city ?? ''
  return !city || city === name ? name : `${name}, ${city}`
}

/** Secondary line of a place: "{area}, {city}". */
export function placeLine(place: Pick<PlaceResult, 'area' | 'city' | 'name'>): string {
  return [place.area && place.area !== place.name ? place.area : null, place.city && place.city !== place.name ? place.city : null]
    .filter(Boolean)
    .join(', ')
}

export const EMPTY_PLACE_FIELDS: PlaceFields = {
  place_name: null, place_address: null, place_area: null, place_city: null,
  place_country: null, place_lat: null, place_lng: null, place_provider_id: null,
}

export function placeToFields(place: PlaceResult | null): PlaceFields {
  if (!place) return { ...EMPTY_PLACE_FIELDS }
  const hasCoords = place.lat !== null && place.lng !== null
  return {
    place_name: place.name,
    place_address: place.address,
    place_area: place.area,
    place_city: place.city,
    place_country: place.country ? place.country.toUpperCase().slice(0, 2) : null,
    // Coordinates only travel as a pair (the database enforces it).
    place_lat: hasCoords ? place.lat : null,
    place_lng: hasCoords ? place.lng : null,
    place_provider_id: place.providerId,
  }
}

export function placeFromExpense(e: PlaceFields): PlaceResult | null {
  if (!e.place_name && !e.place_city) return null
  return {
    name: e.place_name ?? e.place_city ?? '',
    address: e.place_address,
    area: e.place_area,
    city: e.place_city,
    country: e.place_country,
    lat: e.place_lat,
    lng: e.place_lng,
    providerId: e.place_provider_id,
  }
}

function samePlace(a: PlaceResult, b: PlaceResult): boolean {
  if (a.providerId && b.providerId) return a.providerId === b.providerId
  return a.name === b.name && a.city === b.city
}

/** Distinct places already used on the trip, most recent expense first (works offline). */
export function usedPlaces(expenses: readonly TripExpense[], max = 8): PlaceResult[] {
  const sorted = [...expenses].sort(
    (a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.created_at < b.created_at ? 1 : -1),
  )
  const out: PlaceResult[] = []
  for (const e of sorted) {
    const place = placeFromExpense(e)
    if (place && !out.some((p) => samePlace(p, place))) out.push(place)
    if (out.length >= max) break
  }
  return out
}

/** A free-text place: typed text as the name, no coordinates. */
export function freeTextPlace(text: string, city: string | null): PlaceResult {
  return { name: text.trim(), address: null, area: null, city, country: null, lat: null, lng: null, providerId: null }
}

/** City for a free-text place: the current reverse-geocoded city, else the city of the latest located expense. */
export function inferCity(currentCity: string | null, expenses: readonly TripExpense[]): string | null {
  if (currentCity) return currentCity
  return usedPlaces(expenses, 50).find((p) => p.city)?.city ?? null
}

/** Splits `text` so the part matching `query` (case and accent insensitive) can be shown in bold. */
export function highlightParts(text: string, query: string): Array<{ text: string; bold: boolean }> {
  const fold = (t: string) => t.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase()
  const q = fold(query.trim())
  if (!q) return [{ text, bold: false }]
  // Map each original character to its normalised form so indexes stay aligned.
  let plain = ''
  const map: number[] = []
  for (let i = 0; i < text.length; i++) {
    for (const ch of fold(text.charAt(i))) {
      plain += ch
      map.push(i)
    }
  }
  const at = plain.indexOf(q)
  if (at < 0) return [{ text, bold: false }]
  const start = map[at] ?? 0
  const end = (map[at + q.length - 1] ?? text.length - 1) + 1
  return [
    { text: text.slice(0, start), bold: false },
    { text: text.slice(start, end), bold: true },
    { text: text.slice(end), bold: false },
  ].filter((p) => p.text !== '')
}
