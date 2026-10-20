import { describe, expect, it } from 'vitest'
import type { ImportExpenseInput, ImportTripPayload } from '../types'
import { createMemoryTripsRepository } from './memoryTripsRepository'
import { NetworkError, RepositoryError } from './TripsRepository'

const expense = (over: Partial<ImportExpenseInput> = {}): ImportExpenseInput => ({
  title: 'Dinner',
  amount: 30,
  currency: 'EUR',
  fx_rate: null,
  fx_source: null,
  fx_date: null,
  category_key: 'food',
  paid_by_key: 'a',
  split_mode: 'exact',
  date: '2026-10-03',
  note: 'Imported from Splitwise',
  shares: [{ member_key: 'a', amount: 10 }, { member_key: 'b', amount: 20 }],
  ...over,
})

const payload = (over: Partial<ImportTripPayload> = {}): ImportTripPayload => ({
  trip: { name: ' Lisbon ', default_currency: 'EUR', start_date: '2026-10-03', end_date: '2026-10-10' },
  members: [
    { key: 'a', display_name: 'Raouf', is_me: true },
    { key: 'b', display_name: 'Sara Lopez', is_me: false },
  ],
  expenses: [expense()],
  settlements: [{ from_key: 'b', to_key: 'a', amount: 5, date: '2026-10-09' }],
  ...over,
})

const fresh = () => createMemoryTripsRepository({ currentUserId: 'u1', seed: [] })

describe('memory repository importTrip', () => {
  it('creates the trip, members, default categories, expenses and payments', async () => {
    const repo = fresh()
    const id = await repo.importTrip(payload())
    const snap = (await repo.getTrip(id))!
    expect(snap.trip).toMatchObject({ name: 'Lisbon', default_currency: 'EUR', created_by: 'u1', start_date: '2026-10-03' })
    expect(snap.members.map((m) => [m.display_name, m.user_id])).toEqual([['Raouf', 'u1'], ['Sara Lopez', null]])
    expect(snap.categories.map((c) => c.key)).toEqual(['stay', 'food', 'transport', 'activity', 'groceries', 'shopping', 'fees', 'other'])
    expect(snap.expenses).toHaveLength(1)
    const e = snap.expenses[0]!
    expect(e).toMatchObject({ title: 'Dinner', fx_rate: 1, fx_source: 'same', amount_default: 30, note: 'Imported from Splitwise', client_id: null, created_by: 'u1' })
    expect(snap.categories.find((c) => c.id === e.category_id)!.key).toBe('food')
    expect(snap.members.find((m) => m.id === e.paid_by)!.display_name).toBe('Raouf')
    expect(snap.shares.map((s) => s.amount).sort()).toEqual([10, 20])
    expect(snap.settlements[0]).toMatchObject({ amount: 5, currency: 'EUR', fx_rate: 1, client_id: null })
    expect(snap.settlements[0]!.created_at.slice(0, 10)).toBe('2026-10-09')
    expect((await repo.listTrips()).map((s) => s.trip.id)).toEqual([id])
  })

  it('computes amount_default like the server for foreign currencies and keeps pending ones pending', async () => {
    const repo = fresh()
    const id = await repo.importTrip(
      payload({
        expenses: [
          expense({ title: 'Taxi', amount: 10.05, currency: 'USD', fx_rate: 0.5, fx_source: 'api', fx_date: '2026-10-04', shares: [{ member_key: 'a', amount: 10.05 }] }),
          expense({ title: 'Lunch', amount: 20, currency: 'MAD', shares: [{ member_key: 'b', amount: 20 }] }),
        ],
        settlements: [],
      }),
    )
    const snap = (await repo.getTrip(id))!
    expect(snap.expenses.find((e) => e.title === 'Taxi')).toMatchObject({ fx_rate: 0.5, fx_source: 'api', amount_default: 5.02 })
    expect(snap.expenses.find((e) => e.title === 'Lunch')).toMatchObject({ fx_rate: null, fx_source: null, amount_default: null })
  })

  it('keeps the order of the file when sorted by creation time', async () => {
    const repo = fresh()
    const id = await repo.importTrip(payload({ expenses: [expense({ title: 'first' }), expense({ title: 'second' })], settlements: [] }))
    const [x, y] = (await repo.getTrip(id))!.expenses
    expect(x!.created_at < y!.created_at).toBe(true)
  })

  const rejects: Array<[string, Partial<ImportTripPayload>, RegExp]> = [
    ['shares that do not sum to the amount', { expenses: [expense({ shares: [{ member_key: 'a', amount: 10 }, { member_key: 'b', amount: 19 }] })] }, /sum to the amount/],
    ['a negative share', { expenses: [expense({ shares: [{ member_key: 'a', amount: 40 }, { member_key: 'b', amount: -10 }] })] }, /invalid member or amount/],
    ['a duplicate share', { expenses: [expense({ shares: [{ member_key: 'a', amount: 15 }, { member_key: 'a', amount: 15 }] })] }, /duplicate member/],
    ['a share for an unknown member', { expenses: [expense({ shares: [{ member_key: 'zz', amount: 30 }] })] }, /invalid member or amount/],
    ['no shares', { expenses: [expense({ shares: [] })] }, /non-empty/],
    ['an unknown payer', { expenses: [expense({ paid_by_key: 'zz' })] }, /payer/],
    ['an unknown category', { expenses: [expense({ category_key: 'nope' })] }, /unknown category/],
    ['an empty title', { expenses: [expense({ title: '   ' })] }, /title/],
    ['a title over 120 characters', { expenses: [expense({ title: 'x'.repeat(121) })] }, /title/],
    ['a zero amount', { expenses: [expense({ amount: 0, shares: [{ member_key: 'a', amount: 0 }] })] }, /amount must be positive/],
    ['a bad currency code', { expenses: [expense({ currency: 'EURO' })] }, /currency/],
    ['a zero exchange rate', { expenses: [expense({ currency: 'USD', fx_rate: 0 })] }, /fx_rate/],
    ['a bad split mode', { expenses: [expense({ split_mode: 'weird' as never })] }, /split mode/],
    ['a payment to oneself', { settlements: [{ from_key: 'a', to_key: 'a', amount: 5, date: '2026-10-09' }] }, /two different members/],
    ['a payment of 0', { settlements: [{ from_key: 'a', to_key: 'b', amount: 0, date: '2026-10-09' }] }, /positive/],
    ['a payment with an unknown member', { settlements: [{ from_key: 'a', to_key: 'zz', amount: 5, date: '2026-10-09' }] }, /belong to this trip/],
    ['no member marked as you', { members: [{ key: 'a', display_name: 'A', is_me: false }] }, /is_me/],
    ['two members marked as you', { members: [{ key: 'a', display_name: 'A', is_me: true }, { key: 'b', display_name: 'B', is_me: true }] }, /is_me/],
    ['duplicate member keys', { members: [{ key: 'a', display_name: 'A', is_me: true }, { key: 'a', display_name: 'B', is_me: false }] }, /Duplicate member key/],
    ['a blank member name', { members: [{ key: 'a', display_name: ' ', is_me: true }] }, /name must be 1-40/],
    ['an empty trip name', { trip: { name: ' ', default_currency: 'EUR', start_date: null, end_date: null } }, /Trip name/],
    ['an invalid default currency', { trip: { name: 'T', default_currency: 'EU', start_date: null, end_date: null } }, /currency/],
    ['an end date before the start date', { trip: { name: 'T', default_currency: 'EUR', start_date: '2026-10-10', end_date: '2026-10-01' } }, /end date/],
  ]
  it.each(rejects)('rejects %s and stores nothing', async (_label, over, message) => {
    const repo = fresh()
    const error = await repo.importTrip(payload(over)).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(RepositoryError)
    expect((error as RepositoryError).message).toMatch(message)
    expect((error as RepositoryError).code).toBe('22023')
    expect(await repo.listTrips()).toEqual([])
  })

  it('rolls back everything when a later expense is bad', async () => {
    const repo = fresh()
    await expect(
      repo.importTrip(payload({ expenses: [expense(), expense({ shares: [{ member_key: 'a', amount: 1 }] })] })),
    ).rejects.toThrow(/Expense 2/)
    expect(await repo.listTrips()).toEqual([])
  })

  it('enforces the size limits', async () => {
    const repo = fresh()
    const many = Array.from({ length: 51 }, (_, i) => ({ key: `k${i}`, display_name: `P${i}`, is_me: i === 0 }))
    await expect(repo.importTrip(payload({ members: many, expenses: [], settlements: [] }))).rejects.toThrow(/Too many members/)
    const fiftyOne = Array.from({ length: 5001 }, () => expense())
    await expect(repo.importTrip(payload({ expenses: fiftyOne }))).rejects.toThrow(/Too many expenses/)
    const pays = Array.from({ length: 2001 }, () => ({ from_key: 'a', to_key: 'b', amount: 1, date: '2026-10-09' }))
    await expect(repo.importTrip(payload({ settlements: pays }))).rejects.toThrow(/Too many settlements/)
    const fifty = Array.from({ length: 50 }, (_, i) => ({ key: `k${i}`, display_name: `P${i}`, is_me: i === 0 }))
    await expect(repo.importTrip(payload({ members: fifty, expenses: [], settlements: [] }))).resolves.toBeTruthy()
  })

  it('fails with a network error while offline', async () => {
    const repo = createMemoryTripsRepository({ currentUserId: 'u1', seed: [], isOnline: () => false })
    await expect(repo.importTrip(payload())).rejects.toBeInstanceOf(NetworkError)
  })
})
