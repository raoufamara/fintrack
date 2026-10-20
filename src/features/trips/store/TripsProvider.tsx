import { useEffect, useMemo, type ReactNode } from 'react'
import { createNullFxService, type FxService } from '../services/fxService'
import {
  createNullGeolocation,
  createNullPlacesProvider,
  type GeolocationSource,
  type PlacesProvider,
} from '../services/placesService'
import { RETRY_INTERVAL_MS, type QueueStorage } from '../services/syncQueue'
import type { TripsRepository } from '../services/TripsRepository'
import { TripsContext, type TripsContextValue } from './TripsContext'
import { createTripStore } from './tripStore'

interface TripsProviderProps {
  repository: TripsRepository
  fx?: FxService
  places?: PlacesProvider
  geolocation?: GeolocationSource
  /** Where unsent writes are kept across restarts. Defaults to memory. */
  queueStorage?: QueueStorage
  /** The user's home currency, the default for "show in my currency". */
  homeCurrency?: string | null
  /** Public view-only mode: no queue, no online handlers. */
  readOnly?: boolean
  children: ReactNode
}

/**
 * Provides the Trips store, built around the injected repository and rate
 * service. When the device comes back online it sends queued writes, refreshes
 * stale rates and converts pending expenses; queued writes are also retried
 * every 30 seconds while any remain.
 */
export function TripsProvider({
  repository,
  fx,
  places,
  geolocation,
  queueStorage,
  homeCurrency = null,
  readOnly = false,
  children,
}: TripsProviderProps) {
  const value = useMemo<TripsContextValue>(() => {
    const service = fx ?? createNullFxService()
    return {
      store: createTripStore(repository, service, { queueStorage }),
      currentUserId: repository.currentUserId,
      fx: service,
      places: places ?? createNullPlacesProvider(),
      geolocation: geolocation ?? createNullGeolocation(),
      homeCurrency,
    }
  }, [repository, fx, places, geolocation, queueStorage, homeCurrency])

  useEffect(() => {
    if (readOnly) return
    const { store } = value
    // App start: pick up writes left over from the last session.
    void store.getState().loadQueue().then(() => store.getState().flushQueue(true))
    const onOnline = () => {
      void store
        .getState()
        .flushQueue(true)
        .then(() => store.getState().syncRates())
    }
    window.addEventListener('online', onOnline)
    const timer = setInterval(() => {
      if (store.getState().queue.length > 0) void store.getState().flushQueue()
    }, RETRY_INTERVAL_MS)
    return () => {
      window.removeEventListener('online', onOnline)
      clearInterval(timer)
    }
  }, [value, readOnly])

  return <TripsContext.Provider value={value}>{children}</TripsContext.Provider>
}
