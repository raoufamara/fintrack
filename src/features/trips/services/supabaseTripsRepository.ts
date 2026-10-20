import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  Trip,
  TripCategory,
  TripExpense,
  TripExpenseShare,
  TripMember,
  TripSettlement,
} from '../types'
import { NetworkError, RepositoryError, type InvitePreview, type NewTripInput, type TripSnapshot, type TripsRepository } from './TripsRepository'

/**
 * Supabase implementation. The client is injected, so this file never imports
 * the app's own client and Trips stays free of the personal-budget code.
 */
export function createSupabaseTripsRepository(
  client: SupabaseClient,
  currentUserId: string,
): TripsRepository {
  type ExpenseRow = TripExpense & { trip_expense_shares?: TripExpenseShare[] }

  async function rows<T>(
    table: string,
    columns: string,
    opts: { tripId?: string; column?: string; order?: string } = {},
  ): Promise<T[]> {
    let query = client.from(table).select(columns)
    if (opts.tripId) query = query.eq(opts.column ?? 'trip_id', opts.tripId)
    if (opts.order) query = query.order(opts.order)
    const { data, error } = await query
    if (error) throw toError(error)
    return (data ?? []) as unknown as T[]
  }

  function group<T extends { trip_id: string }>(list: T[]): Map<string, T[]> {
    const map = new Map<string, T[]>()
    for (const row of list) {
      const bucket = map.get(row.trip_id)
      if (bucket) bucket.push(row)
      else map.set(row.trip_id, [row])
    }
    return map
  }

  async function fetchSnapshots(tripId?: string): Promise<TripSnapshot[]> {
    const [trips, members, categories, expenses, settlements] = await Promise.all([
      rows<Trip>('trips', '*', { tripId, column: 'id' }),
      rows<TripMember>('trip_members', '*', { tripId, order: 'created_at' }),
      rows<TripCategory>('trip_categories', '*', { tripId, order: 'sort_order' }),
      rows<ExpenseRow>('trip_expenses', '*, trip_expense_shares(*)', { tripId }),
      rows<TripSettlement>('trip_settlements', '*', { tripId, order: 'created_at' }),
    ])
    const membersBy = group(members)
    const categoriesBy = group(categories)
    const expensesBy = group(expenses)
    const settlementsBy = group(settlements)

    return trips.map((trip) => {
      const list = expensesBy.get(trip.id) ?? []
      return {
        trip,
        members: membersBy.get(trip.id) ?? [],
        categories: categoriesBy.get(trip.id) ?? [],
        expenses: list.map((row) => {
          const expense: ExpenseRow = { ...row }
          delete expense.trip_expense_shares
          return expense
        }),
        shares: list.flatMap((e) => e.trip_expense_shares ?? []),
        settlements: settlementsBy.get(trip.id) ?? [],
      }
    })
  }

  /** Postgres errors carry a 5-character code; fetch failures do not. */
  function toError(error: { message: string; code?: string }): RepositoryError {
    const networkLike = !error.code && /fetch|network|timeout|offline|failed/i.test(error.message)
    return networkLike ? new NetworkError(error.message) : new RepositoryError(error.message, error.code)
  }

  async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
    try {
      const { data, error } = await client.rpc(fn, args)
      if (error) throw toError(error)
      return data as T
    } catch (err) {
      if (err instanceof TypeError) throw new NetworkError(err.message)
      throw err
    }
  }

  return {
    currentUserId,

    listTrips: () => fetchSnapshots(),

    async getTrip(tripId) {
      return (await fetchSnapshots(tripId))[0] ?? null
    },

    createTrip: (input: NewTripInput) =>
      rpc<string>('create_trip', {
        p_name: input.name,
        p_default_currency: input.defaultCurrency,
        p_start: input.startDate,
        p_end: input.endDate,
        p_budget: input.budgetAmount,
        p_member_names: input.memberNames,
      }),

    async saveExpense(expense, shares) {
      await rpc('upsert_trip_expense', {
        p_expense: {
          id: expense.id,
          trip_id: expense.trip_id,
          category_id: expense.category_id,
          title: expense.title,
          amount: expense.amount,
          currency: expense.currency,
          fx_rate: expense.fx_rate,
          fx_source: expense.fx_source,
          fx_date: expense.fx_date,
          paid_by: expense.paid_by,
          split_mode: expense.split_mode,
          date: expense.date,
          note: expense.note,
          place_name: expense.place_name,
          place_address: expense.place_address,
          place_area: expense.place_area,
          place_city: expense.place_city,
          place_country: expense.place_country,
          place_lat: expense.place_lat,
          place_lng: expense.place_lng,
          place_provider_id: expense.place_provider_id,
          client_id: expense.client_id,
        },
        p_shares: shares.map((s) => ({ member_id: s.member_id, weight: s.weight, amount: s.amount })),
      })
    },

    async deleteExpense(expenseId) {
      await rpc('delete_trip_expense', { p_expense_id: expenseId })
    },

    async recordSettlement(settlement) {
      await rpc('record_settlement', {
        p_trip_id: settlement.trip_id,
        p_from: settlement.from_member,
        p_to: settlement.to_member,
        p_amount: settlement.amount,
        p_client_id: settlement.client_id ?? null,
      })
    },

    addMember: (tripId, name) => rpc<string>('add_trip_member', { p_trip_id: tripId, p_name: name }),

    async previewInvite(code) {
      const raw = await rpc<{
        trip_id: string
        name: string
        start_date: string | null
        end_date: string | null
        default_currency: string
        unclaimed: Array<{ id: string; display_name: string }>
      }>('preview_trip_invite', { p_code: code })
      const preview: InvitePreview = {
        tripId: raw.trip_id,
        name: raw.name,
        startDate: raw.start_date,
        endDate: raw.end_date,
        defaultCurrency: raw.default_currency,
        unclaimed: raw.unclaimed.map((m) => ({ id: m.id, displayName: m.display_name })),
      }
      return preview
    },

    joinTrip: (code, memberId) => rpc<string>('join_trip', { p_code: code, p_member_id: memberId }),

    async updateMyDisplayCurrency(memberId, currency) {
      const { error } = await client.from('trip_members').update({ display_currency: currency }).eq('id', memberId)
      if (error) throw toError(error)
    },

    subscribe(tripId, onChange) {
      const channel = client.channel(`trip-${tripId}`)
      const watched: Array<[string, string | null]> = [
        ['trips', 'id'],
        ['trip_members', 'trip_id'],
        ['trip_categories', 'trip_id'],
        ['trip_expenses', 'trip_id'],
        ['trip_settlements', 'trip_id'],
        // Shares have no trip_id: RLS limits the events to our trips, and a refetch is cheap.
        ['trip_expense_shares', null],
      ]
      for (const [table, column] of watched) {
        channel.on(
          'postgres_changes',
          { event: '*', schema: 'public', table, ...(column ? { filter: `${column}=eq.${tripId}` } : {}) },
          () => onChange(),
        )
      }
      channel.subscribe()
      return () => {
        void client.removeChannel(channel)
      }
    },

    async setDefaultCurrency(tripId, currency, rates) {
      await rpc('set_trip_default_currency', { p_trip_id: tripId, p_currency: currency, p_rates: rates })
    },

    createCategory: (tripId, input) =>
      rpc<string>('create_trip_category', {
        p_trip_id: tripId,
        p_name: input.name,
        p_icon: input.icon,
        p_color: input.color,
      }),

    async updateCategory(categoryId, patch) {
      const update: Record<string, unknown> = {}
      if (patch.name !== undefined) update.name = patch.name.trim()
      if (patch.icon !== undefined) update.icon = patch.icon
      if (patch.color !== undefined) update.color = patch.color
      if (patch.hidden !== undefined) update.hidden_at = patch.hidden ? new Date().toISOString() : null
      const { error } = await client.from('trip_categories').update(update).eq('id', categoryId)
      if (error) throw toError(error)
    },

    async deleteCategory(categoryId, moveTo) {
      await rpc('delete_trip_category', { p_category_id: categoryId, p_move_to: moveTo })
    },

    async reorderCategories(tripId, orderedIds) {
      await rpc('reorder_trip_categories', { p_trip_id: tripId, p_ordered_ids: orderedIds })
    },
  }
}
