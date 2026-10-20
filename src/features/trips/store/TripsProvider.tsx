import { useEffect, useMemo, type ReactNode } from 'react'
import { createNullFxService, type FxService } from '../services/fxService'
import type { TripsRepository } from '../services/TripsRepository'
import { TripsContext, type TripsContextValue } from './TripsContext'
import { createTripStore } from './tripStore'

/**
 * Provides the Trips store, built around the injected repository and rate
 * service. When the device comes back online it refreshes stale rates and
 * converts pending expenses.
 */
export function TripsProvider({
  repository,
  fx,
  children,
}: {
  repository: TripsRepository
  fx?: FxService
  children: ReactNode
}) {
  const value = useMemo<TripsContextValue>(() => {
    const service = fx ?? createNullFxService()
    return { store: createTripStore(repository, service), currentUserId: repository.currentUserId, fx: service }
  }, [repository, fx])

  useEffect(() => {
    const onOnline = () => void value.store.getState().syncRates()
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [value])

  return <TripsContext.Provider value={value}>{children}</TripsContext.Provider>
}
