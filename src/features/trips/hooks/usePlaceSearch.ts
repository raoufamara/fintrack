import { useEffect, useState } from 'react'
import type { PlaceResult } from '../lib/places'
import type { LatLng } from '../services/placesService'
import { usePlaces } from '../store/TripsContext'

export type PlaceSearchStatus = 'idle' | 'loading' | 'ready' | 'error'

export const MIN_QUERY = 2
export const DEBOUNCE_MS = 300

/** Debounced place search. Stale requests are aborted; failures report 'error' so the UI can offer fallbacks. */
export function usePlaceSearch(query: string, near: LatLng | null) {
  const places = usePlaces()
  const [state, setState] = useState<{ status: PlaceSearchStatus; results: PlaceResult[] }>({
    status: 'idle',
    results: [],
  })
  const nearLat = near?.lat
  const nearLng = near?.lng

  useEffect(() => {
    const q = query.trim()
    if (q.length < MIN_QUERY) {
      setState({ status: 'idle', results: [] })
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, status: 'loading' }))
      const at = nearLat !== undefined && nearLng !== undefined ? { lat: nearLat, lng: nearLng } : null
      places
        .searchPlaces(q, at, controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) setState({ status: 'ready', results })
        })
        .catch(() => {
          if (!controller.signal.aborted) setState({ status: 'error', results: [] })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [places, query, nearLat, nearLng])

  return state
}
