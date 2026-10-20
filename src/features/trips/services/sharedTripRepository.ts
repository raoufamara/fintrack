import type { SupabaseClient } from '@supabase/supabase-js'
import { createStore, get, set, type UseStore } from 'idb-keyval'
import type { Trip, TripCategory, TripExpense, TripExpenseShare, TripMember, TripSettlement } from '../types'
import { NetworkError, RepositoryError, type TripSnapshot } from './TripsRepository'

/** What a guest sees of a trip: the domain data plus who shared it. */
export interface SharedTripView {
  snapshot: TripSnapshot
  sharedBy: string | null
}

export type SharedTripResult =
  | { status: 'ok'; view: SharedTripView; fromCache: boolean }
  /** Unknown, reset or disabled link. */
  | { status: 'dead' }

/**
 * Read-only source for the public view-only link. Rejects with a NetworkError
 * when offline and nothing is saved for the token.
 */
export interface SharedTripRepository {
  getSharedTrip(token: string): Promise<SharedTripResult>
}

// --- payload (the JSON returned by get_shared_trip) -------------------------

type Row = Record<string, unknown>

/** Shape of `get_shared_trip(token)`. Private fields are stripped on the server. */
export interface SharedPayload {
  trip: Row
  shared_by: string | null
  members: Array<{ id: string; display_name: string; color: string }>
  categories: Row[]
  expenses: Row[]
  shares: Row[]
  settlements: Row[]
}

/**
 * Maps the guest payload into the regular domain types so the list, filters,
 * insights and balances can be reused. Fields the server withholds are filled
 * with empty values (invite_code, share_token, created_by, client_id, user_id,
 * coordinates); they are never present in the payload.
 */
export function mapSharedPayload(payload: unknown): SharedTripView {
  const p = payload as SharedPayload | null
  if (!p || typeof p !== 'object' || !p.trip || !Array.isArray(p.members) || !Array.isArray(p.expenses)) {
    throw new RepositoryError('Unexpected shared trip response')
  }
  const trip = { ...p.trip, invite_code: '', share_token: '', created_by: '' } as unknown as Trip
  const members: TripMember[] = p.members.map((m) => ({
    id: m.id,
    trip_id: trip.id,
    display_name: m.display_name,
    user_id: null,
    color: m.color,
    display_currency: null,
    created_at: '',
  }))
  const categories = (p.categories ?? []).map((c) => ({ created_by_member: null, ...c })) as unknown as TripCategory[]
  const expenses = (p.expenses ?? []).map((e) => ({
    place_lat: null,
    place_lng: null,
    place_provider_id: null,
    created_by: '',
    client_id: null,
    ...e,
  })) as unknown as TripExpense[]
  return {
    sharedBy: p.shared_by ?? null,
    snapshot: {
      trip,
      members,
      categories,
      expenses,
      shares: (p.shares ?? []) as unknown as TripExpenseShare[],
      settlements: (p.settlements ?? []) as unknown as TripSettlement[],
    },
  }
}

// --- Supabase (anon key) -----------------------------------------------------

/** Calls `get_shared_trip` with the anon key only. No session is involved. */
export function createSupabaseSharedTripRepository(client: SupabaseClient): SharedTripRepository {
  return {
    async getSharedTrip(token) {
      let result
      try {
        result = await client.rpc('get_shared_trip', { p_token: token })
      } catch (err) {
        throw new NetworkError(err instanceof Error ? err.message : undefined)
      }
      const { data, error } = result
      if (error) {
        const networkLike = !error.code && /fetch|network|timeout|offline|failed/i.test(error.message)
        throw networkLike ? new NetworkError(error.message) : new RepositoryError(error.message, error.code)
      }
      if (data === null || data === undefined) return { status: 'dead' }
      return { status: 'ok', view: mapSharedPayload(data), fromCache: false }
    },
  }
}

// --- cache -------------------------------------------------------------------

/** Keeps the last payload per token, so a guest can still open the link offline. */
export interface SharedCacheStorage {
  get(token: string): Promise<SharedTripView | undefined>
  set(token: string, view: SharedTripView): Promise<void>
  del(token: string): Promise<void>
}

export function createMemorySharedCache(): SharedCacheStorage {
  const map = new Map<string, SharedTripView>()
  return {
    async get(token) {
      const hit = map.get(token)
      return hit ? structuredClone(hit) : undefined
    },
    async set(token, view) {
      map.set(token, structuredClone(view))
    },
    async del(token) {
      map.delete(token)
    },
  }
}

/** IndexedDB cache with a memory fallback if IndexedDB is unavailable. */
export function createIdbSharedCache(dbName = 'fintrack-trips-shared'): SharedCacheStorage {
  const memory = createMemorySharedCache()
  let store: UseStore | null = null
  let broken = false
  const getStore = (): UseStore => (store ??= createStore(dbName, 'shared'))
  const key = (token: string) => `shared:${token}`
  return {
    async get(token) {
      if (!broken) {
        try {
          return await get<SharedTripView>(key(token), getStore())
        } catch {
          broken = true
        }
      }
      return memory.get(token)
    },
    async set(token, view) {
      if (!broken) {
        try {
          await set(key(token), view, getStore())
          return
        } catch {
          broken = true
        }
      }
      await memory.set(token, view)
    },
    async del(token) {
      await memory.del(token)
      if (!broken) {
        try {
          const { del } = await import('idb-keyval')
          await del(key(token), getStore())
        } catch {
          broken = true
        }
      }
    },
  }
}

/**
 * Remembers the last good payload per token and falls back to it when the
 * network is down. A dead link also forgets the saved copy.
 */
export function withSharedCache(inner: SharedTripRepository, cache: SharedCacheStorage): SharedTripRepository {
  return {
    async getSharedTrip(token) {
      try {
        const result = await inner.getSharedTrip(token)
        if (result.status === 'ok') await cache.set(token, result.view).catch(() => undefined)
        else await cache.del(token).catch(() => undefined)
        return result
      } catch (err) {
        if (err instanceof NetworkError || err instanceof TypeError) {
          const saved = await cache.get(token).catch(() => undefined)
          if (saved) return { status: 'ok', view: saved, fromCache: true }
          throw err instanceof NetworkError ? err : new NetworkError(err.message)
        }
        throw err
      }
    },
  }
}
