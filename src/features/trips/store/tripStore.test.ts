import { describe, expect, it, vi } from 'vitest'
import { todayISO } from '../lib/dates'
import { splitAmount } from '../lib/money'
import { createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'
import type { TripsRepository } from '../services/TripsRepository'
import { defaultCategoryId, findCurrentMember, summarizeTrip } from './selectors'
import { createTripStore, type SaveExpenseInput } from './tripStore'

const USER = 'u-you'
const TODAY = todayISO()
const { tripId, you, sara } = SEED_IDS

function setup(overrides: Partial<TripsRepository> = {}) {
  const base = createMemoryTripsRepository({
    currentUserId: USER,
    seed: [buildLisbonPortoSeed(USER, TODAY)],
  })
  const repository: TripsRepository = { ...base, ...overrides }
  const store = createTripStore(repository)
  return { store, repository, base }
}

const state = (s: ReturnType<typeof setup>['store']) => s.getState()
const balanceOf = (s: ReturnType<typeof setup>['store'], memberId: string) => {
  const snap = state(s).trips[tripId]
  if (!snap) throw new Error('trip not loaded')
  return summarizeTrip(snap, memberId).myBalance
}

function expenseInput(over: Partial<SaveExpenseInput> = {}): SaveExpenseInput {
  return {
    tripId,
    categoryId: 'c-food',
    title: 'Dinner',
    amountMinor: 2400,
    paidBy: you,
    date: TODAY,
    splitMode: 'equal',
    shares: splitAmount(2400, 'equal', [you, sara]),
    ...over,
  }
}

describe('tripStore: loading', () => {
  it('loads trips and computes the seed balances (You owe Sara 6.44)', async () => {
    const { store } = setup()
    await state(store).loadTrips()
    expect(state(store).listStatus).toBe('ready')
    expect(state(store).tripOrder).toEqual([tripId])
    const snap = state(store).trips[tripId]!
    const me = findCurrentMember(snap, USER)
    expect(me?.id).toBe(you)
    const summary = summarizeTrip(snap, me?.id)
    expect(summary.spent).toBe(76335)
    expect(summary.myBalance).toBe(-644)
    expect(summary.myTransfer).toEqual({ from: you, to: sara, amount: 644 })
  })

  it('reports a list error', async () => {
    const { store } = setup({ listTrips: () => Promise.reject(new Error('offline')) })
    await state(store).loadTrips()
    expect(state(store).listStatus).toBe('error')
    expect(state(store).listError).toBe('offline')
  })

  it('reports an error for a missing trip', async () => {
    const { store } = setup()
    await state(store).loadTrip('nope')
    expect(state(store).tripStatus['nope']).toBe('error')
  })
})

describe('tripStore: expenses', () => {
  it('adds an expense and updates balances', async () => {
    const { store, base } = setup()
    await state(store).loadTrips()
    expect(await state(store).saveExpense(expenseInput())).toBe(true)

    const snap = state(store).trips[tripId]!
    expect(snap.expenses).toHaveLength(8)
    const added = snap.expenses.find((e) => e.title === 'Dinner')!
    expect(added.amount).toBe(24)
    expect(added.date).toBe(TODAY)
    expect(added.created_by).toBe(USER)
    expect(snap.shares.filter((s) => s.expense_id === added.id).map((s) => s.amount)).toEqual([12, 12])

    // You paid 24.00 and share 12.00: +12.00 on top of -6.44.
    expect(balanceOf(store, you)).toBe(-644 + 1200)
    expect(balanceOf(store, sara)).toBe(32916 - 1200)

    // The repository got it too.
    expect((await base.getTrip(tripId))?.expenses).toHaveLength(8)
  })

  it('edits an expense in place and keeps balances summing to zero', async () => {
    const { store } = setup()
    await state(store).loadTrips()
    await state(store).saveExpense(expenseInput())
    const id = state(store).trips[tripId]!.expenses.find((e) => e.title === 'Dinner')!.id

    await state(store).saveExpense(
      expenseInput({
        id,
        title: 'Dinner (edited)',
        amountMinor: 3001,
        shares: splitAmount(3001, 'equal', [you, sara]),
      }),
    )
    const snap = state(store).trips[tripId]!
    expect(snap.expenses).toHaveLength(8)
    expect(snap.expenses.find((e) => e.id === id)?.title).toBe('Dinner (edited)')
    expect(snap.shares.filter((s) => s.expense_id === id)).toHaveLength(2)
    const total = snap.members.reduce((acc, m) => acc + summarizeTrip(snap, m.id).myBalance, 0)
    expect(total).toBe(0)
  })

  it('deletes an expense and restores balances', async () => {
    const { store, base } = setup()
    await state(store).loadTrips()
    await state(store).saveExpense(expenseInput())
    const id = state(store).trips[tripId]!.expenses.find((e) => e.title === 'Dinner')!.id

    expect(await state(store).deleteExpense(tripId, id)).toBe(true)
    expect(state(store).trips[tripId]!.expenses).toHaveLength(7)
    expect(state(store).trips[tripId]!.shares.some((s) => s.expense_id === id)).toBe(false)
    expect(balanceOf(store, you)).toBe(-644)
    expect((await base.getTrip(tripId))?.expenses).toHaveLength(7)
  })

  it('applies the change optimistically, before the repository answers', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const { store } = setup({ saveExpense: () => gate })
    await state(store).loadTrips()

    const pending = state(store).saveExpense(expenseInput())
    expect(state(store).trips[tripId]!.expenses).toHaveLength(8)
    release()
    await pending
    expect(state(store).trips[tripId]!.expenses).toHaveLength(8)
  })

  it('rolls back a failed add and shows an error toast', async () => {
    const { store } = setup({ saveExpense: vi.fn().mockRejectedValue(new Error('boom')) })
    await state(store).loadTrips()
    expect(await state(store).saveExpense(expenseInput())).toBe(false)
    expect(state(store).trips[tripId]!.expenses).toHaveLength(7)
    expect(state(store).trips[tripId]!.shares).toHaveLength(28)
    expect(balanceOf(store, you)).toBe(-644)
    expect(state(store).toast?.kind).toBe('error')
    expect(state(store).toast?.message).toContain('boom')
  })

  it('rolls back a failed edit to the previous values', async () => {
    const { store, base } = setup()
    await state(store).loadTrips()
    const original = state(store).trips[tripId]!.expenses.find((e) => e.id === 'e2')!
    const failing = createTripStore({ ...base, saveExpense: () => Promise.reject(new Error('nope')) })
    await failing.getState().loadTrips()

    const ok = await failing.getState().saveExpense(
      expenseInput({
        id: 'e2',
        title: 'Changed',
        amountMinor: 5000,
        shares: splitAmount(5000, 'equal', [you, sara]),
      }),
    )
    expect(ok).toBe(false)
    const after = failing.getState().trips[tripId]!
    expect(after.expenses.find((e) => e.id === 'e2')).toEqual(original)
    expect(after.shares.filter((s) => s.expense_id === 'e2')).toHaveLength(4)
  })

  it('rolls back a failed delete', async () => {
    const { store } = setup({ deleteExpense: () => Promise.reject(new Error('denied')) })
    await state(store).loadTrips()
    expect(await state(store).deleteExpense(tripId, 'e1')).toBe(false)
    expect(state(store).trips[tripId]!.expenses.some((e) => e.id === 'e1')).toBe(true)
    expect(state(store).trips[tripId]!.shares.filter((s) => s.expense_id === 'e1')).toHaveLength(4)
    expect(balanceOf(store, you)).toBe(-644)
    expect(state(store).toast?.kind).toBe('error')
  })

  it('refuses a split that does not add up', async () => {
    const { store } = setup()
    await state(store).loadTrips()
    const ok = await state(store).saveExpense(
      expenseInput({ shares: new Map([[you, 1000], [sara, 1000]]) }),
    )
    expect(ok).toBe(false)
    expect(state(store).trips[tripId]!.expenses).toHaveLength(7)
    expect(state(store).toast?.message).toMatch(/add up/)
  })
})

describe('tripStore: create trip and default category', () => {
  it('creates a trip with the 8 default categories and the current member', async () => {
    const { store } = setup()
    await state(store).loadTrips()
    const id = await state(store).createTrip({
      name: 'Morocco',
      defaultCurrency: 'MAD',
      startDate: null,
      endDate: null,
      budgetAmount: null,
      memberNames: ['Sara', 'Malik'],
    })
    expect(id).not.toBeNull()
    const snap = state(store).trips[id!]!
    expect(snap.categories).toHaveLength(8)
    expect(snap.members.map((m) => m.display_name)).toEqual(['You', 'Sara', 'Malik'])
    expect(findCurrentMember(snap, USER)?.display_name).toBe('You')
    expect(state(store).tripOrder[0]).toBe(id)
    // No expenses yet: default to "Other".
    const other = snap.categories.find((c) => c.key === 'other')!
    expect(defaultCategoryId(snap, findCurrentMember(snap, USER)?.id)).toBe(other.id)
  })

  it('defaults to the category the member used last', async () => {
    const { store } = setup()
    await state(store).loadTrips()
    const snap = () => state(store).trips[tripId]!
    // You's latest seeded expense is the train (transport).
    expect(defaultCategoryId(snap(), you)).toBe('c-transport')
    await new Promise((r) => setTimeout(r, 5))
    await state(store).saveExpense(expenseInput({ categoryId: 'c-activity' }))
    expect(defaultCategoryId(snap(), you)).toBe('c-activity')
    // Someone else's expenses do not matter.
    expect(defaultCategoryId(snap(), SEED_IDS.ines)).toBe('c-food')
  })
})
