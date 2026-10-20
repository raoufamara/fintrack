import { describe, expect, it, vi } from 'vitest'
import { todayISO } from '../lib/dates'
import { buildSharedPayload, createMemorySharedTripRepository } from './memorySharedRepository'
import { buildLisbonPortoSeed, SEED_IDS } from './memorySeed'
import { createMemoryBackend, createMemoryTripsRepository } from './memoryTripsRepository'
import {
  createMemorySharedCache,
  createSupabaseSharedTripRepository,
  mapSharedPayload,
  withSharedCache,
} from './sharedTripRepository'
import { NetworkError } from './TripsRepository'

const USER = 'u-you'
const TOKEN = 'demo-share-token'

/** A seed with every private field filled in, to prove none of them reaches a guest. */
function privateSeed() {
  const seed = buildLisbonPortoSeed(USER, todayISO())
  seed.trip.archived_at = '2026-10-18T10:00:00.000Z'
  seed.expenses[0] = {
    ...seed.expenses[0]!,
    place_lat: 38.7139,
    place_lng: -9.1334,
    place_provider_id: 'N424242',
    client_id: 'client-secret-1',
    created_by: 'creator-user-id',
  }
  seed.categories[2] = { ...seed.categories[2]!, hidden_at: '2026-10-10T00:00:00.000Z', created_by_member: SEED_IDS.sara }
  seed.settlements.push({ id: 's1', trip_id: seed.trip.id, from_member: SEED_IDS.sara, to_member: SEED_IDS.you, amount: 5, currency: 'EUR', fx_rate: 1, client_id: 'settle-secret', created_at: '2026-10-17T10:00:00.000Z' })
  return seed
}

const FORBIDDEN_KEYS = ['invite_code', 'share_token', 'created_by', 'user_id', 'email', 'client_id', 'place_lat', 'place_lng', 'place_provider_id']

function keysDeep(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) value.forEach((v) => keysDeep(v, out))
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.add(k)
      keysDeep(v, out)
    }
  }
  return out
}

describe('guest payload (same stripping rules as get_shared_trip)', () => {
  const payload = buildSharedPayload(privateSeed())

  it('contains none of the private fields, at any depth', () => {
    const keys = keysDeep(payload)
    for (const forbidden of FORBIDDEN_KEYS) expect(keys.has(forbidden), forbidden).toBe(false)
    const text = JSON.stringify(payload)
    for (const secret of ['lisb0a1', 'client-secret-1', 'creator-user-id', 'settle-secret', 'N424242', '38.7139', '-9.1334', USER]) {
      expect(text).not.toContain(secret)
    }
    expect(text).not.toMatch(/@/)
  })

  it('reduces members to id, display name and colour', () => {
    expect(payload.members.map((m) => Object.keys(m).sort())).toEqual(Array(4).fill(['color', 'display_name', 'id']))
  })

  it('keeps what the read-only screens need', () => {
    expect(payload.shared_by).toBe('You')
    expect(payload.trip).toMatchObject({ name: 'Lisbon & Porto', default_currency: 'EUR', archived_at: '2026-10-18T10:00:00.000Z' })
    expect(payload.trip.start_date).toBeTruthy()
    // A hidden category that still has expenses is included, so rows keep their name.
    expect(payload.categories.find((c) => c.id === 'c-transport')).toMatchObject({ hidden_at: '2026-10-10T00:00:00.000Z' })
    expect(payload.settlements).toHaveLength(1)
    expect(payload.shares.length).toBe(28)
    expect(payload.expenses[0]).toMatchObject({ place_name: expect.any(String) })
  })

  it('maps into the regular domain types with the private fields empty', () => {
    const view = mapSharedPayload(payload)
    expect(view.sharedBy).toBe('You')
    expect(view.snapshot.members[0]).toMatchObject({ user_id: null, display_currency: null })
    expect(view.snapshot.trip).toMatchObject({ invite_code: '', share_token: '', created_by: '' })
    expect(view.snapshot.expenses[0]).toMatchObject({ place_lat: null, place_lng: null, place_provider_id: null, client_id: null })
    expect(() => mapSharedPayload({ nope: 1 })).toThrow()
  })
})

describe('memory shared repository', () => {
  it('serves an enabled link and treats unknown, disabled and reset links as dead', async () => {
    const backend = createMemoryBackend([privateSeed()])
    const owner = createMemoryTripsRepository({ currentUserId: USER, backend })
    const shared = createMemorySharedTripRepository(backend)
    expect((await shared.getSharedTrip(TOKEN)).status).toBe('ok')
    expect(await shared.getSharedTrip('nope')).toEqual({ status: 'dead' })

    await owner.setShareEnabled(SEED_IDS.tripId, false)
    expect(await shared.getSharedTrip(TOKEN)).toEqual({ status: 'dead' })
    await owner.setShareEnabled(SEED_IDS.tripId, true)
    expect((await shared.getSharedTrip(TOKEN)).status).toBe('ok')

    const fresh = await owner.rotateShareToken(SEED_IDS.tripId)
    expect(fresh).not.toBe(TOKEN)
    expect(await shared.getSharedTrip(TOKEN)).toEqual({ status: 'dead' })
    expect((await shared.getSharedTrip(fresh)).status).toBe('ok')
  })

  it('shows what members changed', async () => {
    const backend = createMemoryBackend([privateSeed()])
    const owner = createMemoryTripsRepository({ currentUserId: USER, backend })
    const shared = createMemorySharedTripRepository(backend)
    await owner.addMember(SEED_IDS.tripId, 'Alex')
    const result = await shared.getSharedTrip(TOKEN)
    expect(result.status === 'ok' && result.view.snapshot.members.map((m) => m.display_name)).toContain('Alex')
  })

  it('hands the invite code only to request_join_from_share, for an enabled link', async () => {
    const backend = createMemoryBackend([privateSeed()])
    const owner = createMemoryTripsRepository({ currentUserId: USER, backend })
    expect(await owner.requestJoinFromShare(TOKEN)).toBe('lisb0a1')
    await owner.setShareEnabled(SEED_IDS.tripId, false)
    await expect(owner.requestJoinFromShare(TOKEN)).rejects.toMatchObject({ code: 'P0002' })
    await expect(owner.requestJoinFromShare('nope')).rejects.toMatchObject({ code: 'P0002' })
  })
})

describe('saved copy', () => {
  function flaky() {
    const backend = createMemoryBackend([privateSeed()])
    const net = { online: true }
    const inner = createMemorySharedTripRepository(backend, { isOnline: () => net.online })
    const cache = createMemorySharedCache()
    return { net, backend, cache, repo: withSharedCache(inner, cache) }
  }

  it('falls back to the last payload when the network is down', async () => {
    const { net, repo } = flaky()
    const first = await repo.getSharedTrip(TOKEN)
    expect(first).toMatchObject({ status: 'ok', fromCache: false })
    net.online = false
    const second = await repo.getSharedTrip(TOKEN)
    expect(second).toMatchObject({ status: 'ok', fromCache: true })
    expect(second.status === 'ok' && second.view.snapshot.expenses).toHaveLength(7)
  })

  it('fails with a network error when nothing is saved for the token', async () => {
    const { net, repo } = flaky()
    net.online = false
    await expect(repo.getSharedTrip(TOKEN)).rejects.toBeInstanceOf(NetworkError)
  })

  it('forgets the saved copy when the link goes dead', async () => {
    const { net, repo, backend } = flaky()
    await repo.getSharedTrip(TOKEN)
    backend.db.get(SEED_IDS.tripId)!.trip.share_enabled = false
    expect(await repo.getSharedTrip(TOKEN)).toEqual({ status: 'dead' })
    net.online = false
    await expect(repo.getSharedTrip(TOKEN)).rejects.toBeInstanceOf(NetworkError)
  })
})

describe('supabase shared repository (anon rpc)', () => {
  it('returns dead for a null payload and maps a real one', async () => {
    const payload = buildSharedPayload(privateSeed())
    const rpc = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: payload, error: null })
    const repo = createSupabaseSharedTripRepository({ rpc } as never)
    expect(await repo.getSharedTrip('x')).toEqual({ status: 'dead' })
    const ok = await repo.getSharedTrip('y')
    expect(ok.status).toBe('ok')
    expect(rpc).toHaveBeenCalledWith('get_shared_trip', { p_token: 'x' })
  })

  it('reports a failed fetch as a network error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'TypeError: Failed to fetch' } })
    await expect(createSupabaseSharedTripRepository({ rpc } as never).getSharedTrip('x')).rejects.toBeInstanceOf(NetworkError)
    const thrown = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    await expect(createSupabaseSharedTripRepository({ rpc: thrown } as never).getSharedTrip('x')).rejects.toBeInstanceOf(NetworkError)
  })
})
