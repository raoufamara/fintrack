import { useEffect } from 'react'
import { useTripsStoreApi } from '../store/TripsContext'

/** Keeps a trip fresh while a screen is open: refreshes when it changes on another device. */
export function useTripWatch(tripId: string): void {
  const store = useTripsStoreApi()
  useEffect(() => {
    if (!tripId) return
    return store.getState().watchTrip(tripId)
  }, [store, tripId])
}
