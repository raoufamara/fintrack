import { describe, expect, it } from 'vitest'
import { buildLisbonPortoSeed } from '../services/memorySeed'
import {
  freeTextPlace, formatDistance, haversineKm, highlightParts, inferCity, placeFromExpense,
  placeLabel, placeLine, placeToFields, usedPlaces,
} from './places'

const seed = buildLisbonPortoSeed('u', '2026-10-20')

describe('places helpers', () => {
  it('computes distances', () => {
    // Porto Ribeira to Lisbon is about 275 km.
    expect(haversineKm({ lat: 41.1406, lng: -8.6112 }, { lat: 38.7223, lng: -9.1393 })).toBeGreaterThan(270)
    expect(haversineKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1 })).toBe(0)
    expect(formatDistance(0.34)).toBe('340 m')
    expect(formatDistance(1.234)).toBe('1.2 km')
    expect(formatDistance(42.4)).toBe('42 km')
  })

  it('labels places like the prototype', () => {
    expect(placeLabel('Time Out Market', 'Lisbon')).toBe('Time Out Market, Lisbon')
    expect(placeLabel('Lisbon', 'Lisbon')).toBe('Lisbon')
    expect(placeLabel('Stall', null)).toBe('Stall')
    expect(placeLabel(null, null)).toBe('')
    expect(placeLine({ name: 'A', area: 'Bolhão', city: 'Porto' })).toBe('Bolhão, Porto')
    expect(placeLine({ name: 'Bolhão', area: 'Bolhão', city: 'Porto' })).toBe('Porto')
  })

  it('round-trips a place through expense fields, keeping coordinates as a pair', () => {
    const place = { name: 'Café', address: 'R. A 1', area: 'Bolhão', city: 'Porto', country: 'pt', lat: 41.1, lng: -8.6, providerId: 'N1' }
    const fields = placeToFields(place)
    expect(fields).toMatchObject({ place_name: 'Café', place_country: 'PT', place_lat: 41.1, place_lng: -8.6, place_provider_id: 'N1' })
    expect(placeFromExpense(fields)).toMatchObject({ name: 'Café', city: 'Porto', providerId: 'N1' })
    expect(placeToFields({ ...place, lng: null }).place_lat).toBeNull()
    expect(placeToFields(null).place_name).toBeNull()
    expect(placeFromExpense(placeToFields(null))).toBeNull()
  })

  it('lists used places, most recent first, distinct, at most 8', () => {
    const used = usedPlaces(seed.expenses)
    expect(used.map((p) => p.name)).toEqual(['Livraria Lello', 'Pastéis de Belém', 'Tram 28', 'Time Out Market', 'Airbnb Alfama'])
    expect(usedPlaces(seed.expenses, 2)).toHaveLength(2)
    const dup = [...seed.expenses, { ...seed.expenses[1]!, id: 'dup' }]
    expect(usedPlaces(dup).filter((p) => p.name === 'Time Out Market')).toHaveLength(1)
  })

  it('infers the city of a free-text place', () => {
    expect(inferCity('Marrakech', seed.expenses)).toBe('Marrakech')
    expect(inferCity(null, seed.expenses)).toBe('Porto') // the latest located expense
    expect(inferCity(null, [])).toBeNull()
    expect(freeTextPlace('  Night market stall ', 'Porto')).toMatchObject({ name: 'Night market stall', city: 'Porto', lat: null, providerId: null })
  })

  it('highlights the matching part, ignoring case and accents', () => {
    expect(highlightParts('Café Santiago', 'cafe sant')).toEqual([
      { text: 'Café Sant', bold: true },
      { text: 'iago', bold: false },
    ])
    expect(highlightParts('Majestic Café', 'caf')).toEqual([
      { text: 'Majestic ', bold: false },
      { text: 'Caf', bold: true },
      { text: 'é', bold: false },
    ])
    expect(highlightParts('Abc', 'zz')).toEqual([{ text: 'Abc', bold: false }])
    expect(highlightParts('Abc', '')).toEqual([{ text: 'Abc', bold: false }])
  })
})
