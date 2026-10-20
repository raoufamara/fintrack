import { useMemo } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Outlet } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { createHttpRateProvider } from './services/fxProviders'
import { createFxService } from './services/fxService'
import { createIdbFxStorage } from './services/fxStorage'
import {
  createIdbSharedCache,
  createSupabaseSharedTripRepository,
  withSharedCache,
} from './services/sharedTripRepository'
import { GuestProvider } from './store/GuestProvider'

/**
 * Wires the public view-only routes to Supabase with the ANON key only: it reads
 * through the get_shared_trip function and never touches the auth store or a
 * session. The last payload per link is kept in IndexedDB for offline opening.
 */
export function PublicTripsProvider() {
  const shared = useMemo(
    () => withSharedCache(createSupabaseSharedTripRepository(supabase as unknown as SupabaseClient), createIdbSharedCache()),
    [],
  )
  const fx = useMemo(
    () =>
      createFxService({
        provider: createHttpRateProvider(),
        storage: createIdbFxStorage(),
        isOnline: () => navigator.onLine,
      }),
    [],
  )
  return (
    <GuestProvider shared={shared} fx={fx}>
      <Outlet />
    </GuestProvider>
  )
}
