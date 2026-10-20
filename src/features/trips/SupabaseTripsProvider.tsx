import { useMemo } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Outlet } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { createHttpRateProvider } from './services/fxProviders'
import { createFxService } from './services/fxService'
import { createIdbFxStorage } from './services/fxStorage'
import { createBrowserGeolocation, createPhotonProvider } from './services/placesService'
import { createIdbQueueStorage } from './services/syncQueue'
import { createSupabaseTripsRepository } from './services/supabaseTripsRepository'
import { TripsProvider } from './store/TripsProvider'

/**
 * Connects Trips to the app's Supabase client and signed-in user, and to the
 * live exchange-rate API with an IndexedDB cache.
 * This is the only file in the module that touches the app's own client or
 * auth store, which keeps the rest of the module standalone.
 */
export function SupabaseTripsProvider() {
  const userId = useAuthStore((s) => s.user?.id)
  const homeCurrency = useAuthStore((s) => s.profile?.currency ?? null)
  const repository = useMemo(
    () => (userId ? createSupabaseTripsRepository(supabase as unknown as SupabaseClient, userId) : null),
    [userId],
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
  const queueStorage = useMemo(() => createIdbQueueStorage(), [])
  const places = useMemo(() => createPhotonProvider(), [])
  const geolocation = useMemo(() => createBrowserGeolocation(), [])
  if (!repository) return null
  return (
    <TripsProvider repository={repository} fx={fx} places={places} geolocation={geolocation} queueStorage={queueStorage} homeCurrency={homeCurrency}>
      <Outlet />
    </TripsProvider>
  )
}
