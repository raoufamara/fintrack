import { useMemo } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Outlet } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuthStore } from '@/stores/authStore'
import { createSupabaseTripsRepository } from './services/supabaseTripsRepository'
import { TripsProvider } from './store/TripsProvider'

/**
 * Connects Trips to the app's Supabase client and signed-in user.
 * This is the only file in the module that touches the app's own client or
 * auth store, which keeps the rest of the module standalone.
 */
export function SupabaseTripsProvider() {
  const userId = useAuthStore((s) => s.user?.id)
  const repository = useMemo(
    () => (userId ? createSupabaseTripsRepository(supabase as unknown as SupabaseClient, userId) : null),
    [userId],
  )
  if (!repository) return null
  return (
    <TripsProvider repository={repository}>
      <Outlet />
    </TripsProvider>
  )
}
