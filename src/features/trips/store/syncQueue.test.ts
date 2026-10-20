import { describe, expect, it } from 'vitest'
import { todayISO } from '../lib/dates'
import { splitAmount } from '../lib/money'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'
import { createMemoryBackend, createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { backoffMs, createMemoryQueueStorage } from '../services/syncQueue'
import { NetworkError, RepositoryError, type TripsRepository } from '../services/TripsRepository'
import { createTripStore, type SaveExpenseInput } from './tripStore'

const USER = 'u-you'
const { tripId, you, sara } = SEED_IDS

async function setup(over: Partial<TripsRepository> = {}) {
  const net = { online: true, now: 1_000_000 }
  const backend = createMemoryBackend([buildLisbonPortoSeed(USER, todayISO())])
  const base = createMemoryTripsRepository({ currentUserId: USER, backend, isOnline: () => net.online })
  const repo: TripsRepository = { ...base, ...over }
  const queueStorage = createMemoryQueueStorage()
  const store = createTripStore(repo, undefined, { queueStorage, now: () => net.now })
  await store.getState().loadTrips()
  const snap = () => store.getState().trips[tripId]!
  const server = () => backend.db.get(tripId)!
  return { store, net, queueStorage, snap, server, base }
}

function input(title: string, over: Partial<SaveExpenseInput> = {}): SaveExpenseInput {
  return {
    tripId, categoryId: 'c-food', title, amountMinor: 2400, paidBy: you, date: todayISO(), splitMode: 'equal',
    shares: splitAmount(2400, 'equal', [you, sara]), ...over,
  }
}

describe('retry queue', () => {
  it('keeps a write that failed for network reasons, tagged as not synced and persisted', async () => {
    const { store, net, snap, server, queueStorage } = await setup()
    net.online = false
    expect(await store.getState().saveExpense(input('Offline lunch'))).toBe(true)
    const e = snap().expenses.find((x) => x.title === 'Offline lunch')!
    expect(store.getState().unsynced[e.id]).toBe(true)
    expect(store.getState().queue).toHaveLength(1)
    expect(store.getState().queue[0]).toMatchObject({ op: 'saveExpense', clientId: e.client_id, attempts: 0, lastError: null, tripId })
    expect(server().expenses.some((x) => x.id === e.id)).toBe(false)
    expect(await queueStorage.load()).toHaveLength(1)
    expect(store.getState().toast).toBeNull()
  })

  it('does not queue server validation errors: they roll back with a toast', async () => {
    const { store, snap, queueStorage } = await setup()
    expect(await store.getState().saveExpense(input('Bad category', { categoryId: 'c-missing' }))).toBe(false)
    expect(snap().expenses.some((x) => x.title === 'Bad category')).toBe(false)
    expect(store.getState().queue).toHaveLength(0)
    expect(await queueStorage.load()).toHaveLength(0)
    expect(store.getState().toast?.kind).toBe('error')
  })

  it('flushes in order when the connection returns, then clears the tags', async () => {
    const { store, net, snap, server } = await setup()
    net.online = false
    await store.getState().saveExpense(input('First'))
    await store.getState().saveExpense(input('Second'))
    const first = snap().expenses.find((x) => x.title === 'First')!
    await store.getState().deleteExpense(tripId, 'e1')
    expect(store.getState().queue.map((q) => q.op)).toEqual(['saveExpense', 'saveExpense', 'deleteExpense'])

    net.online = true
    await store.getState().flushQueue(true)
    const titles = server().expenses.map((x) => x.title)
    expect(store.getState().queue).toHaveLength(0)
    expect(store.getState().unsynced).toEqual({})
    expect(server().expenses.some((x) => x.id === first.id)).toBe(true)
    expect(server().expenses.some((x) => x.title === 'Second')).toBe(true)
    expect(server().expenses.some((x) => x.id === 'e1')).toBe(false)
    expect(titles.indexOf('First')).toBeLessThan(titles.indexOf('Second'))
  })

  it('sends writes in the order they were made', async () => {
    const sent: string[] = []
    const { net, base } = await setup()
    const spy = createTripStore(
      { ...base, saveExpense: async (e, s) => { sent.push(`save:${e.title}`); return base.saveExpense(e, s) }, deleteExpense: async (id) => { sent.push(`delete:${id}`); return base.deleteExpense(id) } },
      undefined,
      { queueStorage: createMemoryQueueStorage(), now: () => net.now },
    )
    await spy.getState().loadTrips()
    net.online = false
    await spy.getState().saveExpense(input('A'))
    await spy.getState().deleteExpense(tripId, 'e1')
    await spy.getState().saveExpense(input('B'))
    net.online = true
    sent.length = 0 // forget the optimistic attempts that failed
    await spy.getState().flushQueue(true)
    expect(sent).toEqual(['save:A', 'delete:e1', 'save:B'])
  })

  it('backs off exponentially and honours the schedule unless forced', async () => {
    const { store, net } = await setup()
    net.online = false
    await store.getState().saveExpense(input('Slow'))
    await store.getState().flushQueue()
    const item = () => store.getState().queue[0]!
    expect(item()).toMatchObject({ attempts: 1, nextAttemptAt: net.now + backoffMs(1) })
    expect(item().lastError).toMatch(/network/i)
    expect(backoffMs(1)).toBe(2000)
    expect(backoffMs(3)).toBe(8000)
    expect(backoffMs(30)).toBe(300_000)

    const before = item().attempts
    await store.getState().flushQueue() // too early: nothing is attempted
    expect(item().attempts).toBe(before)
    net.now += 2500
    await store.getState().flushQueue()
    expect(item().attempts).toBe(2)
    await store.getState().flushQueue(true) // forced when the device comes back online
    expect(item().attempts).toBe(3)
  })

  it('replays safely when the server applied a write but the answer was lost', async () => {
    let lose = true
    const { net, base, server } = await setup()
    const flaky = createTripStore(
      {
        ...base,
        saveExpense: async (e, s) => {
          await base.saveExpense(e, s)
          if (lose) {
            lose = false
            throw new NetworkError()
          }
        },
      },
      undefined,
      { queueStorage: createMemoryQueueStorage(), now: () => net.now },
    )
    await flaky.getState().loadTrips()
    await flaky.getState().saveExpense(input('Once only'))
    expect(flaky.getState().queue).toHaveLength(1)
    await flaky.getState().flushQueue(true)
    expect(server().expenses.filter((x) => x.title === 'Once only')).toHaveLength(1)
    expect(flaky.getState().queue).toHaveLength(0)
  })

  it('treats a replay with the same client_id but a new id as the same expense', async () => {
    const { base, server } = await setup()
    const e = { ...server().expenses[0]!, id: 'x-1', client_id: 'c-1', title: 'Replay me' }
    const shares = server().shares.filter((s) => s.expense_id === server().expenses[0]!.id).map((s) => ({ ...s, expense_id: 'x-1' }))
    await base.saveExpense(e, shares)
    await base.saveExpense({ ...e, id: 'x-2' }, shares.map((s) => ({ ...s, expense_id: 'x-2' })))
    expect(server().expenses.filter((x) => x.client_id === 'c-1')).toHaveLength(1)
    expect(server().shares.filter((s) => s.expense_id === 'x-2')).toHaveLength(0)
  })

  it('collapses edits and lets a delete cancel a save that never left the phone', async () => {
    const { store, net, snap } = await setup()
    net.online = false
    await store.getState().saveExpense(input('Draft one'))
    const e = snap().expenses.find((x) => x.title === 'Draft one')!
    await store.getState().saveExpense(input('Draft one (edited)', { id: e.id }))
    expect(store.getState().queue).toHaveLength(1)
    expect(store.getState().queue[0]).toMatchObject({ payload: { expense: { title: 'Draft one (edited)' } } })
    await store.getState().deleteExpense(tripId, e.id)
    expect(store.getState().unsynced[e.id]).toBeUndefined()
    expect(store.getState().queue.filter((q) => q.op === 'saveExpense')).toHaveLength(0)
  })

  it('queues settlements and category changes too', async () => {
    const { store, net, server } = await setup()
    net.online = false
    expect((await store.getState().recordSettlement(tripId, you, sara, 644)).ok).toBe(true)
    await store.getState().updateCategory(tripId, 'c-food', { name: 'Restaurants' })
    await store.getState().reorderCategories(tripId, ['c-other', 'c-stay'])
    expect(store.getState().queue.map((q) => q.op)).toEqual(['recordSettlement', 'updateCategory', 'reorderCategories'])
    expect(Object.keys(store.getState().unsynced)).toHaveLength(1)
    net.online = true
    await store.getState().flushQueue(true)
    expect(server().settlements).toHaveLength(1)
    expect(server().categories.find((c) => c.id === 'c-food')?.name).toBe('Restaurants')
    expect(store.getState().queue).toHaveLength(0)
  })

  it('restores unsent writes after a restart', async () => {
    const { store, net, queueStorage, base } = await setup()
    net.online = false
    await store.getState().saveExpense(input('Survives restart'))
    net.online = true
    const restarted = createTripStore(base, undefined, { queueStorage, now: () => net.now })
    await restarted.getState().loadQueue()
    expect(restarted.getState().queue).toHaveLength(1)
    expect(Object.keys(restarted.getState().unsynced)).toHaveLength(1)
    await restarted.getState().flushQueue(true)
    expect(restarted.getState().queue).toHaveLength(0)
    expect((await base.getTrip(tripId))?.expenses.some((e) => e.title === 'Survives restart')).toBe(true)
  })
})

describe('refusals during a flush', () => {
  it('drops the item and says so', async () => {
    const net = { online: false, now: 1 }
    const backend = createMemoryBackend([buildLisbonPortoSeed(USER, todayISO())])
    const base = createMemoryTripsRepository({ currentUserId: USER, backend, isOnline: () => net.online })
    const refusing: TripsRepository = {
      ...base,
      saveExpense: async () => {
        throw new RepositoryError('Category does not belong to this trip', '22023')
      },
    }
    const store = createTripStore(refusing, undefined, { queueStorage: createMemoryQueueStorage(), now: () => net.now })
    await store.getState().loadTrips()
    // Fail the first attempt with a network error so the write is queued.
    const queued = createTripStore(
      { ...refusing, saveExpense: async () => { throw new NetworkError() } },
      undefined,
      { queueStorage: createMemoryQueueStorage(), now: () => net.now },
    )
    await queued.getState().loadTrips()
    await queued.getState().saveExpense(input('Refused later'))
    expect(queued.getState().queue).toHaveLength(1)
    // Now the same queue meets a server that refuses it.
    const item = queued.getState().queue
    const storage = createMemoryQueueStorage(item)
    const second = createTripStore(refusing, undefined, { queueStorage: storage, now: () => net.now })
    await second.getState().loadTrips()
    await second.getState().loadQueue()
    await second.getState().flushQueue(true)
    expect(second.getState().queue).toHaveLength(0)
    expect(second.getState().toast?.message).toMatch(/couldn't be synced/)
    expect(Object.keys(second.getState().unsynced)).toHaveLength(0)
  })
})
