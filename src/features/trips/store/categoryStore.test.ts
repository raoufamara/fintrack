import { describe, expect, it, vi } from 'vitest'
import { todayISO } from '../lib/dates'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'
import { createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { DUPLICATE_CODE, RepositoryError, type TripsRepository } from '../services/TripsRepository'
import { usedCategoriesBySpend, visibleCategories } from './selectors'
import { createTripStore } from './tripStore'

const USER = 'u-you'
const { tripId } = SEED_IDS

async function setup(overrides: Partial<TripsRepository> = {}) {
  const base = createMemoryTripsRepository({ currentUserId: USER, seed: [buildLisbonPortoSeed(USER, todayISO())] })
  const repository: TripsRepository = { ...base, ...overrides }
  const store = createTripStore(repository)
  await store.getState().loadTrips()
  const snap = () => store.getState().trips[tripId]!
  return { store, base, snap }
}

describe('create and update category', () => {
  it('creates a custom category added by the current member', async () => {
    const { store, snap, base } = await setup()
    const res = await store.getState().createCategory(tripId, { name: '  Hammam & spa ', icon: 'sparkles', color: 'pink' })
    expect(res.ok).toBe(true)
    const created = snap().categories.find((c) => c.id === res.id)!
    expect(created).toMatchObject({ name: 'Hammam & spa', key: null, sort_order: 8, created_by_member: SEED_IDS.you })
    expect((await base.getTrip(tripId))?.categories).toHaveLength(9)
  })

  it('rejects a duplicate name case- and accent-insensitively, without calling the repo', async () => {
    const createCategory = vi.fn().mockResolvedValue('cat-cafe')
    const { store, snap } = await setup({ createCategory })
    await store.getState().createCategory(tripId, { name: 'Café', icon: 'coffee', color: 'rust' })
    createCategory.mockClear()
    expect(createCategory).toHaveBeenCalledTimes(0)
    const res = await store.getState().createCategory(tripId, { name: 'cafe', icon: 'coffee', color: 'rust' })
    expect(res).toMatchObject({ ok: false, duplicate: true })
    expect(res.error).toBe("There's already a category called cafe")
    expect(createCategory).not.toHaveBeenCalled()
    expect(snap().categories.filter((c) => c.name.startsWith('Caf') || c.name === 'cafe')).toHaveLength(1)
  })

  it('maps a server duplicate (23505) to an inline duplicate result with no toast', async () => {
    const { store } = await setup({
      createCategory: () => Promise.reject(new RepositoryError("There's already a category called X", DUPLICATE_CODE)),
    })
    const res = await store.getState().createCategory(tripId, { name: 'Fresh', icon: 'tag', color: 'grey' })
    expect(res.duplicate).toBe(true)
    expect(store.getState().toast).toBeNull()
  })

  it('renames, recolours and re-icons optimistically; expenses keep their category id', async () => {
    const { store, snap } = await setup()
    const res = await store.getState().updateCategory(tripId, 'c-food', { name: 'Restaurants', icon: 'pizza', color: 'teal' })
    expect(res.ok).toBe(true)
    expect(snap().categories.find((c) => c.id === 'c-food')).toMatchObject({ name: 'Restaurants', icon: 'pizza', color: 'teal', key: 'food' })
    expect(snap().expenses.filter((e) => e.category_id === 'c-food')).toHaveLength(2)
  })

  it('rejects renaming to an existing name but allows keeping its own', async () => {
    const { store } = await setup()
    expect((await store.getState().updateCategory(tripId, 'c-food', { name: 'transport' })).duplicate).toBe(true)
    expect((await store.getState().updateCategory(tripId, 'c-food', { name: 'FOOD & drinks' })).ok).toBe(true)
  })

  it('rolls back a failed update and toasts', async () => {
    const { store, snap } = await setup({ updateCategory: () => Promise.reject(new Error('boom')) })
    const res = await store.getState().updateCategory(tripId, 'c-food', { name: 'Nope' })
    expect(res.ok).toBe(false)
    expect(snap().categories.find((c) => c.id === 'c-food')?.name).toBe('Food & drinks')
    expect(store.getState().toast?.message).toContain('boom')
  })

  it('hides and shows a category', async () => {
    const { store, snap } = await setup()
    await store.getState().updateCategory(tripId, 'c-fees', { hidden: true })
    expect(visibleCategories(snap().categories).map((c) => c.id)).not.toContain('c-fees')
    await store.getState().updateCategory(tripId, 'c-fees', { hidden: false })
    expect(visibleCategories(snap().categories).map((c) => c.id)).toContain('c-fees')
  })

  it('refuses to hide the last visible category', async () => {
    const { store, snap } = await setup()
    for (const c of snap().categories.slice(1)) await store.getState().updateCategory(tripId, c.id, { hidden: true })
    expect(visibleCategories(snap().categories)).toHaveLength(1)
    const last = visibleCategories(snap().categories)[0]!
    const res = await store.getState().updateCategory(tripId, last.id, { hidden: true })
    expect(res.ok).toBe(false)
    expect(visibleCategories(snap().categories)).toHaveLength(1)
  })
})

describe('delete category', () => {
  it('moves expenses to the chosen category and deletes', async () => {
    const { store, snap, base } = await setup()
    const res = await store.getState().deleteCategory(tripId, 'c-activity', 'c-other')
    expect(res.ok).toBe(true)
    expect(snap().categories.some((c) => c.id === 'c-activity')).toBe(false)
    expect(snap().expenses.find((e) => e.id === 'e7')?.category_id).toBe('c-other')
    expect((await base.getTrip(tripId))?.expenses.find((e) => e.id === 'e7')?.category_id).toBe('c-other')
  })

  it('requires a target when the category has expenses, but not when empty', async () => {
    const { store, snap } = await setup()
    expect((await store.getState().deleteCategory(tripId, 'c-activity', null)).ok).toBe(false)
    expect(snap().categories.some((c) => c.id === 'c-activity')).toBe(true)
    expect((await store.getState().deleteCategory(tripId, 'c-fees', null)).ok).toBe(true)
  })

  it('rolls back a failed delete, including moved expenses', async () => {
    const { store, snap } = await setup({ deleteCategory: () => Promise.reject(new Error('denied')) })
    const res = await store.getState().deleteCategory(tripId, 'c-activity', 'c-other')
    expect(res.ok).toBe(false)
    expect(snap().categories.some((c) => c.id === 'c-activity')).toBe(true)
    expect(snap().expenses.find((e) => e.id === 'e7')?.category_id).toBe('c-activity')
  })

  it('refuses to delete the last visible category', async () => {
    const { store, snap } = await setup()
    for (const c of snap().categories.filter((c) => c.id !== 'c-other')) {
      await store.getState().updateCategory(tripId, c.id, { hidden: true })
    }
    const res = await store.getState().deleteCategory(tripId, 'c-other', 'c-stay')
    expect(res.ok).toBe(false)
    expect(snap().categories.some((c) => c.id === 'c-other')).toBe(true)
  })
})

describe('reorder and chips', () => {
  it('reorders optimistically and rolls back on failure', async () => {
    const { store, snap } = await setup()
    const ids = snap().categories.map((c) => c.id)
    const reversed = [...ids].reverse()
    await store.getState().reorderCategories(tripId, reversed)
    expect(visibleCategories(snap().categories).map((c) => c.id)).toEqual(reversed)

    const failing = await setup({ reorderCategories: () => Promise.reject(new Error('no')) })
    await failing.store.getState().reorderCategories(tripId, reversed)
    expect(visibleCategories(failing.snap().categories).map((c) => c.id)).toEqual(ids)
  })

  it('orders chips by spend, ties by sort_order, and only for used categories', async () => {
    const { snap } = await setup()
    // spend: stay 480, activity 40, transport 110, food 100.60, groceries 32.75
    expect(usedCategoriesBySpend(snap()).map((c) => c.id)).toEqual([
      'c-stay', 'c-transport', 'c-food', 'c-activity', 'c-groceries',
    ])
  })
})
