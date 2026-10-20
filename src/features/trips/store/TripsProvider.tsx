import { useMemo, type ReactNode } from 'react'
import type { TripsRepository } from '../services/TripsRepository'
import { TripsContext, type TripsContextValue } from './TripsContext'
import { createTripStore } from './tripStore'

/** Provides the Trips store, built around the injected repository. */
export function TripsProvider({
  repository,
  children,
}: {
  repository: TripsRepository
  children: ReactNode
}) {
  const value = useMemo<TripsContextValue>(
    () => ({ store: createTripStore(repository), currentUserId: repository.currentUserId }),
    [repository],
  )
  return <TripsContext.Provider value={value}>{children}</TripsContext.Provider>
}
