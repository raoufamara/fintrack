import { useCallback, useRef, useState } from 'react'
import type { PlaceResult } from '../lib/places'
import { GeolocationError } from '../services/placesService'
import { useGeolocation, usePlaces, useTripsStore, useTripsStoreApi } from '../store/TripsContext'

export type CurrentPlaceStatus = 'idle' | 'locating' | 'ready' | 'off' | 'error'

export const LOCATION_OFF_MESSAGE = 'Location is off. Search for a place instead.'
const GRANTED_KEY = 'trips:geolocation-granted'
const TIMEOUT_MS = 10_000
const MAX_AGE_MS = 5 * 60_000

function readGranted(): boolean {
  try {
    return window.localStorage.getItem(GRANTED_KEY) === '1'
  } catch {
    return false
  }
}

function rememberGranted(): void {
  try {
    window.localStorage.setItem(GRANTED_KEY, '1')
  } catch {
    // Private mode or blocked storage: the preference just is not remembered.
  }
}

/**
 * Finds where the user is. Nothing happens until `request()` is called from a
 * tap: the position is never requested on mount or in the background.
 */
export function useCurrentPlace() {
  const geolocation = useGeolocation()
  const places = usePlaces()
  const storeApi = useTripsStoreApi()
  const place = useTripsStore((s) => s.currentPlace)
  const [status, setStatus] = useState<CurrentPlaceStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [hasGranted, setHasGranted] = useState(readGranted)
  const inFlight = useRef(false)

  const request = useCallback(async (): Promise<PlaceResult | null> => {
    if (inFlight.current) return null
    inFlight.current = true
    setStatus('locating')
    setMessage(null)
    try {
      const pos = await geolocation.getCurrentPosition({ timeoutMs: TIMEOUT_MS, maximumAgeMs: MAX_AGE_MS })
      rememberGranted()
      setHasGranted(true)
      const found = await places.reverseGeocode(pos.lat, pos.lng)
      if (!found) {
        setStatus('error')
        setMessage('Couldn’t tell where you are. Search for a place instead.')
        return null
      }
      // Keep the exact position the user shared; the provider may return a nearby feature.
      const here: PlaceResult = { ...found, lat: found.lat ?? pos.lat, lng: found.lng ?? pos.lng }
      storeApi.getState().setCurrentPlace(here)
      setStatus('ready')
      return here
    } catch (err) {
      if (err instanceof GeolocationError) {
        setStatus('off')
        setMessage(LOCATION_OFF_MESSAGE)
      } else {
        setStatus('error')
        setMessage('Couldn’t look up your address right now. Search for a place instead.')
      }
      return null
    } finally {
      inFlight.current = false
    }
  }, [geolocation, places, storeApi])

  return { place, status, message, hasGranted, request }
}
