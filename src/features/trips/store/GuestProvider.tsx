import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import { guestDisplayCurrency } from '../lib/localeCurrency'
import { createNullFxService, type FxService } from '../services/fxService'
import { createGuestTripsRepository } from '../services/guestTripsRepository'
import type { SharedTripRepository } from '../services/sharedTripRepository'
import { GuestContext, type GuestContextValue, type GuestMeta } from './GuestContext'
import { TripsProvider } from './TripsProvider'

const pickKey = (tripId: string) => `trip-guest:${tripId}`

function readPick(tripId: string): string | null {
  try {
    return window.localStorage.getItem(pickKey(tripId))
  } catch {
    return null
  }
}

function writePick(tripId: string, memberId: string | null): void {
  try {
    if (memberId) window.localStorage.setItem(pickKey(tripId), memberId)
    else window.localStorage.removeItem(pickKey(tripId))
  } catch {
    // The choice just is not remembered.
  }
}

/**
 * Provider for the public view-only routes. It builds a read-only repository
 * from the shared source, so no session, auth store or queue is involved.
 */
export function GuestProvider({
  shared,
  fx,
  children,
}: {
  shared: SharedTripRepository
  fx?: FxService
  children: ReactNode
}) {
  const [meta, setMeta] = useState<GuestMeta>({ status: 'idle', sharedBy: null, fromCache: false })
  const [picks, setPicks] = useState<Record<string, string | null>>({})
  const picksRef = useRef(picks)
  picksRef.current = picks

  const repository = useMemo(
    () =>
      createGuestTripsRepository(shared, (next) =>
        // Same answer again: keep the old object so nothing re-renders in a loop.
        setMeta((prev) => (prev.status === next.status && prev.sharedBy === next.sharedBy && prev.fromCache === next.fromCache ? prev : next)),
      ),
    [shared],
  )
  const service = useMemo(() => fx ?? createNullFxService(), [fx])
  const homeCurrency = useMemo(() => guestDisplayCurrency(), [])

  const getPick = useCallback((tripId: string, memberIds: readonly string[]) => {
    const id = tripId in picksRef.current ? picksRef.current[tripId] : readPick(tripId)
    return id && memberIds.includes(id) ? id : null
  }, [])
  const setPick = useCallback((tripId: string, memberId: string | null) => {
    writePick(tripId, memberId)
    setPicks((p) => ({ ...p, [tripId]: memberId }))
  }, [])

  const value = useMemo<GuestContextValue>(() => ({ meta, getPick: (t, ids) => getPick(t, ids), setPick }), [meta, getPick, setPick, picks]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <GuestContext.Provider value={value}>
      <TripsProvider repository={repository} fx={service} homeCurrency={homeCurrency} readOnly>
        {children}
      </TripsProvider>
    </GuestContext.Provider>
  )
}
