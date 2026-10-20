import { haversineKm, type PlaceResult } from '../lib/places'
import { normalizeSearch } from '../lib/filter'
import {
  GeolocationError,
  type GeolocationSource,
  type LatLng,
  type PlacesProvider,
} from '../services/placesService'

/** Demo-only sample places (coordinates are approximate). */
const raw: Array<[string, string, string, string, number, number]> = [
  ['Café Santiago', 'R. de Passos Manuel 226', 'Bolhão', 'Porto', 41.1479, -8.6063],
  ['Majestic Café', 'R. de Santa Catarina 112', 'Bolhão', 'Porto', 41.1473, -8.6064],
  ['Mercado do Bolhão', 'R. Formosa', 'Bolhão', 'Porto', 41.1494, -8.6068],
  ['Taberna dos Mercadores', 'R. dos Mercadores 36', 'Ribeira', 'Porto', 41.1404, -8.6144],
  ['Torre dos Clérigos', 'R. de São Filipe de Nery', 'Vitória', 'Porto', 41.1458, -8.6139],
  ['Livraria Lello', 'R. das Carmelitas 144', 'Vitória', 'Porto', 41.1468, -8.615],
  ['Castelo de São Jorge', 'R. de Santa Cruz do Castelo', 'Alfama', 'Lisbon', 38.7139, -9.1334],
  ['LX Factory', 'R. Rodrigues de Faria 103', 'Alcântara', 'Lisbon', 38.7035, -9.1786],
  ['Cervejaria Ramiro', 'Av. Almirante Reis 1', 'Intendente', 'Lisbon', 38.7226, -9.1357],
  ['Time Out Market', 'Av. 24 de Julho 49', 'Cais do Sodré', 'Lisbon', 38.7068, -9.1458],
  ['Pastéis de Belém', 'R. de Belém 84', 'Belém', 'Lisbon', 38.6975, -9.2031],
  ['Jemaa el-Fnaa', 'Place Jemaa el-Fnaa', 'Medina', 'Marrakech', 31.6258, -7.9892],
  ['Café des Épices', 'Place Rahba Kedima 75', 'Medina', 'Marrakech', 31.631, -7.9873],
  ['Le Jardin', 'Souk Jeld Sidi Abdelaziz 32', 'Medina', 'Marrakech', 31.633, -7.988],
  ['Hammam de la Rose', 'Rue Dar el Bacha 130', 'Medina', 'Marrakech', 31.6362, -7.989],
  ['Jardin Majorelle', 'Rue Yves St Laurent', 'Guéliz', 'Marrakech', 31.6417, -8.0033],
]

export const FIXTURE_PLACES: PlaceResult[] = raw.map(([name, address, area, city, lat, lng], i) => ({
  name,
  address,
  area,
  city,
  country: city === 'Marrakech' ? 'MA' : 'PT',
  lat,
  lng,
  providerId: `N${9000 + i}`,
}))

/** Simulated device positions for `?loc=`. */
export const DEMO_POSITIONS: Record<string, LatLng> = {
  porto: { lat: 41.1406, lng: -8.6112 }, // Ribeira
  marrakech: { lat: 31.6295, lng: -7.9811 },
}

export function createFixturePlacesProvider(isOnline: () => boolean): PlacesProvider {
  const wait = () => new Promise((r) => setTimeout(r, 90))
  return {
    async searchPlaces(query, near, signal) {
      await wait()
      if (signal?.aborted) throw new Error('aborted')
      if (!isOnline()) throw new Error('offline')
      const q = normalizeSearch(query)
      const hits = FIXTURE_PLACES.filter((p) =>
        normalizeSearch([p.name, p.address, p.area, p.city].filter(Boolean).join(' ')).includes(q),
      ).map((p) => ({ ...p, distanceKm: near && p.lat !== null && p.lng !== null ? haversineKm(near, { lat: p.lat, lng: p.lng }) : null }))
      if (near) hits.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0))
      return hits.slice(0, 8)
    },
    async reverseGeocode(lat, lng) {
      await wait()
      if (!isOnline()) throw new Error('offline')
      const nearest = FIXTURE_PLACES.reduce((best, p) =>
        haversineKm({ lat, lng }, { lat: p.lat!, lng: p.lng! }) < haversineKm({ lat, lng }, { lat: best.lat!, lng: best.lng! }) ? p : best,
      )
      // Like a street-level reverse lookup: the area as the name.
      return { ...nearest, name: nearest.area ?? nearest.name, address: null, providerId: null }
    },
  }
}

export function createFixtureGeolocation(loc: string | null): GeolocationSource {
  return {
    async getCurrentPosition() {
      await new Promise((r) => setTimeout(r, 120))
      const pos = DEMO_POSITIONS[loc ?? 'porto']
      if (loc === 'off' || !pos) throw new GeolocationError('denied')
      return pos
    },
  }
}
