import type { Trip, TripCategory, TripExpense, TripExpenseShare, TripMember } from '../types'
import { DEFAULT_CATEGORIES } from '../lib/categories'
import { fromMinor, toMinor } from '../lib/currency'
import { addDays } from '../lib/dates'
import { splitAmount } from '../lib/money'
import type { TripSnapshot } from './TripsRepository'

const AVATAR_COLORS = ['#FD6FB8', '#93D4D9', '#FDAC62', '#D0E2FF']

/** Fixed ids so tests and the demo can refer to people directly. */
export const SEED_IDS = {
  tripId: 'trip-lisbon',
  you: 'm1',
  sara: 'm2',
  malik: 'm3',
  ines: 'm4',
} as const

interface SeedExpense {
  id: string
  title: string
  category: string
  amount: string
  paidBy: string
  dayOffset: number
  place?: { name: string; area: string; city: string }
}

const SEED_EXPENSES: SeedExpense[] = [
  { id: 'e1', title: 'Airbnb Alfama · 4 nights', category: 'stay', amount: '480.00', paidBy: SEED_IDS.sara, dayOffset: 0, place: { name: 'Airbnb Alfama', area: 'Alfama', city: 'Lisbon' } },
  { id: 'e2', title: 'Time Out Market dinner', category: 'food', amount: '86.40', paidBy: SEED_IDS.you, dayOffset: 1, place: { name: 'Time Out Market', area: 'Cais do Sodré', city: 'Lisbon' } },
  { id: 'e3', title: 'Tram 28', category: 'transport', amount: '12.00', paidBy: SEED_IDS.malik, dayOffset: 1, place: { name: 'Tram 28', area: 'Graça', city: 'Lisbon' } },
  { id: 'e4', title: 'Pastéis de Belém', category: 'food', amount: '14.20', paidBy: SEED_IDS.ines, dayOffset: 2, place: { name: 'Pastéis de Belém', area: 'Belém', city: 'Lisbon' } },
  { id: 'e5', title: 'Pingo Doce', category: 'groceries', amount: '32.75', paidBy: SEED_IDS.malik, dayOffset: 3 },
  { id: 'e6', title: 'Train Lisbon → Porto', category: 'transport', amount: '98.00', paidBy: SEED_IDS.you, dayOffset: 3 },
  { id: 'e7', title: 'Livraria Lello tickets', category: 'activity', amount: '40.00', paidBy: SEED_IDS.sara, dayOffset: 4, place: { name: 'Livraria Lello', area: 'Vitória', city: 'Porto' } },
]

/**
 * The "Lisbon & Porto" sample trip: 4 people, 7 EUR expenses split equally,
 * total 763.35, where "You" owe Sara 6.44. The trip is ongoing around `today`.
 */
export function buildLisbonPortoSeed(userId: string, today: string): TripSnapshot {
  const start = addDays(today, -4)
  const created = `${start}T09:00:00.000Z`
  const trip: Trip = {
    id: SEED_IDS.tripId,
    name: 'Lisbon & Porto',
    default_currency: 'EUR',
    start_date: start,
    end_date: addDays(start, 7),
    budget_amount: 1200,
    invite_code: 'lisb0a1',
    share_token: 'demo-share-token',
    share_enabled: true,
    created_by: userId,
    archived_at: null,
    created_at: created,
  }
  const names: Array<[string, string, string | null]> = [
    [SEED_IDS.you, 'You', userId],
    [SEED_IDS.sara, 'Sara', null],
    [SEED_IDS.malik, 'Malik', null],
    [SEED_IDS.ines, 'Inès', null],
  ]
  const members: TripMember[] = names.map(([id, display_name, user_id], i) => ({
    id,
    trip_id: trip.id,
    display_name,
    user_id,
    color: AVATAR_COLORS[i] ?? '#DDDDDD',
    display_currency: null,
    created_at: created,
  }))
  const categories: TripCategory[] = DEFAULT_CATEGORIES.map((c, i) => ({
    id: `c-${c.key}`,
    trip_id: trip.id,
    key: c.key,
    name: c.name,
    icon: c.icon,
    color: c.color,
    sort_order: i,
    hidden_at: null,
    created_by_member: null,
    created_at: created,
    updated_at: created,
  }))

  const expenses: TripExpense[] = []
  const shares: TripExpenseShare[] = []
  SEED_EXPENSES.forEach((s, i) => {
    const date = addDays(start, s.dayOffset)
    const amount = Number(s.amount)
    const at = `${start}T${String(10 + i).padStart(2, '0')}:00:00.000Z`
    expenses.push({
      id: s.id,
      trip_id: trip.id,
      category_id: `c-${s.category}`,
      title: s.title,
      amount,
      currency: 'EUR',
      fx_rate: 1,
      fx_source: 'same',
      fx_date: null,
      amount_default: amount,
      paid_by: s.paidBy,
      split_mode: 'equal',
      date,
      note: null,
      place_name: s.place?.name ?? null,
      place_address: null,
      place_area: s.place?.area ?? null,
      place_city: s.place?.city ?? null,
      place_country: s.place ? 'PT' : null,
      place_lat: null,
      place_lng: null,
      place_provider_id: null,
      created_by: userId,
      client_id: null,
      created_at: at,
      updated_at: at,
    })
    const parts = splitAmount(
      toMinor(s.amount, 'EUR'),
      'equal',
      members.map((m) => m.id),
    )
    for (const [member_id, minor] of parts) {
      shares.push({ expense_id: s.id, member_id, weight: 1, amount: fromMinor(minor, 'EUR') })
    }
  })

  return { trip, members, categories, expenses, shares, settlements: [] }
}
