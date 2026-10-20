import type { MemoryBackend } from './memoryTripsRepository'
import { mapSharedPayload, type SharedPayload, type SharedTripRepository } from './sharedTripRepository'
import { NetworkError, type TripSnapshot } from './TripsRepository'

/**
 * Builds the guest payload with the same stripping rules as the SQL function
 * get_shared_trip: no invite_code, share_token or created_by on the trip; members
 * reduced to id, display_name and color; no created_by, client_id, coordinates or
 * provider id on expenses; no created_by_member on categories; no client_id on
 * settlements; no user ids or emails anywhere.
 */
export function buildSharedPayload(snap: TripSnapshot): SharedPayload {
  const omit = <T extends object>(row: T, keys: string[]): Record<string, unknown> => {
    const out = { ...row } as Record<string, unknown>
    for (const k of keys) delete out[k]
    return out
  }
  const creator = snap.members.find((m) => m.user_id === snap.trip.created_by)
  const expenseIds = new Set(snap.expenses.map((e) => e.id))
  return structuredClone({
    trip: omit(snap.trip, ['invite_code', 'share_token', 'created_by']),
    shared_by: creator?.display_name ?? null,
    members: snap.members.map((m) => ({ id: m.id, display_name: m.display_name, color: m.color })),
    categories: snap.categories.map((c) => omit(c, ['created_by_member'])),
    expenses: [...snap.expenses]
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.created_at < b.created_at ? 1 : -1))
      .map((e) => omit(e, ['created_by', 'client_id', 'place_lat', 'place_lng', 'place_provider_id'])),
    shares: snap.shares.filter((s) => expenseIds.has(s.expense_id)).map((s) => ({ ...s })),
    settlements: snap.settlements.map((s) => omit(s, ['client_id'])),
  })
}

/** In-memory `get_shared_trip`: null (dead) unless sharing is enabled and the token matches. */
export function createMemorySharedTripRepository(
  backend: MemoryBackend,
  options: { isOnline?: () => boolean; latencyMs?: number } = {},
): SharedTripRepository {
  const { isOnline = () => true, latencyMs = 0 } = options
  return {
    async getSharedTrip(token) {
      if (latencyMs > 0) await new Promise((r) => setTimeout(r, latencyMs))
      if (!isOnline()) throw new NetworkError()
      const snap = [...backend.db.values()].find((s) => s.trip.share_token === token && s.trip.share_enabled)
      if (!snap) return { status: 'dead' }
      return { status: 'ok', view: mapSharedPayload(buildSharedPayload(snap)), fromCache: false }
    },
  }
}
