import { useEffect } from 'react'
import { Outlet, useParams } from 'react-router-dom'
import { useGuest } from '../store/GuestContext'
import { useTripsStore, useTripsStoreApi } from '../store/TripsContext'
import { Screen, TripLoadError } from './Screen'
import { Toaster } from './Toaster'

const REFRESH_MS = 60_000

/**
 * Layout of the public view-only routes. A light refresh: when the tab regains
 * focus and every 60 seconds while visible. No realtime, no write queue.
 */
export function GuestRouteShell() {
  const { shareToken = '' } = useParams()
  const store = useTripsStoreApi()
  const guest = useGuest()
  const loaded = useTripsStore((x) => !!x.trips[shareToken])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void store.getState().refreshTrip(shareToken)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    const timer = setInterval(refresh, REFRESH_MS)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
      clearInterval(timer)
    }
  }, [store, shareToken])

  // The owner reset the link or turned sharing off while this page was open. (A link that was
  // never loaded shows the same message from the page itself, so a new link can still be opened.)
  if (guest?.meta.status === 'dead' && loaded) {
    return (
      <Screen>
        <TripLoadError message="" />
      </Screen>
    )
  }
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  )
}
