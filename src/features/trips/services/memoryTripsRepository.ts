import { DEFAULT_CATEGORIES, isDuplicateCategoryName } from '../lib/categories'
import { minorUnits } from '../lib/currency'
import { todayISO } from '../lib/dates'
import { amountDefault } from '../lib/money'
import { IMPORT_NOTE, MAX_IMPORT_EXPENSES, MAX_IMPORT_MEMBERS, MAX_IMPORT_SETTLEMENTS } from '../lib/splitwiseImport'
import type { Trip, TripCategory, TripExpense, TripExpenseShare, TripMember, TripSettlement } from '../types'
import { newId } from './ids'
import { buildLisbonPortoSeed } from './memorySeed'
import {
  DUPLICATE_CODE,
  NetworkError,
  RepositoryError,
  type NewTripInput,
  type TripSnapshot,
  type TripsRepository,
} from './TripsRepository'

/** Shared storage, so several repositories (several users or devices) can see the same trips. */
export interface MemoryBackend {
  db: Map<string, TripSnapshot>
  listeners: Map<string, Set<() => void>>
  /** Last serialised snapshot per trip, used to detect changes. */
  seen: Map<string, string>
}

export function createMemoryBackend(seed: TripSnapshot[] = []): MemoryBackend {
  const db = new Map<string, TripSnapshot>()
  for (const snap of seed) db.set(snap.trip.id, structuredClone(snap))
  const seen = new Map([...db].map(([id, snap]) => [id, JSON.stringify(snap)]))
  return { db, listeners: new Map(), seen }
}

export interface MemoryRepositoryOptions {
  currentUserId: string
  /** Initial data. Defaults to the Lisbon & Porto sample trip; pass [] for a blank slate. Ignored with `backend`. */
  seed?: TripSnapshot[]
  /** Share storage with other repositories. */
  backend?: MemoryBackend
  /** Simulated network delay in ms. */
  latencyMs?: number
  /** Writes fail with a NetworkError while this returns false. Reads keep working (as if cached). */
  isOnline?: () => boolean
  /** Display name for members created by `joinTrip`. */
  displayName?: string
}

export interface MemoryTripsRepository extends TripsRepository {
  /** Changes a trip as if another device had, and notifies subscribers. Test and demo helper. */
  simulateRemote(tripId: string, mutate: (snap: TripSnapshot) => void): void
}

const AVATAR_COLORS = ['#FD6FB8', '#93D4D9', '#FDAC62', '#D0E2FF', '#B9A1FF', '#A8E6A1', '#FFD36B', '#F7B2B2']

const clone = <T,>(value: T): T => structuredClone(value)

/** In-memory implementation used by the demo and by tests. */
export function createMemoryTripsRepository(options: MemoryRepositoryOptions): MemoryTripsRepository {
  const { currentUserId, latencyMs = 0, isOnline = () => true } = options
  const backend =
    options.backend ?? createMemoryBackend(options.seed ?? [buildLisbonPortoSeed(currentUserId, todayISO())])
  const { db } = backend

  const isMember = (snap: TripSnapshot) => snap.members.some((m) => m.user_id === currentUserId)
  const requireTrip = (tripId: string): TripSnapshot => {
    const snap = db.get(tripId)
    if (!snap || !isMember(snap)) throw new RepositoryError('Not a member of this trip', '42501')
    return snap
  }

  /** Tells subscribers of every trip that changed since the last time we looked. */
  const notifyChanged = () => {
    for (const [id, snap] of db) {
      const json = JSON.stringify(snap)
      if (backend.seen.get(id) !== json) {
        backend.seen.set(id, json)
        backend.listeners.get(id)?.forEach((cb) => cb())
      }
    }
  }

  const findCategory = (categoryId: string) => {
    for (const snap of db.values()) {
      const category = snap.categories.find((c) => c.id === categoryId)
      if (category) return { snap, category }
    }
    return null
  }

  const wait = () => (latencyMs > 0 ? new Promise<void>((r) => setTimeout(r, latencyMs)) : Promise.resolve())
  /** Start of a write: simulated latency, then the network check. */
  const write = async () => {
    await wait()
    if (!isOnline()) throw new NetworkError()
  }

  const repo: MemoryTripsRepository = {
    currentUserId,

    simulateRemote(tripId, mutate) {
      const snap = db.get(tripId)
      if (!snap) throw new Error('Trip not found')
      mutate(snap)
      notifyChanged()
    },

    subscribe(tripId, onChange) {
      const set = backend.listeners.get(tripId) ?? new Set<() => void>()
      set.add(onChange)
      backend.listeners.set(tripId, set)
      return () => {
        set.delete(onChange)
      }
    },

    async setShareEnabled(tripId, enabled) {
      await write()
      requireTrip(tripId).trip.share_enabled = enabled
    },

    async rotateShareToken(tripId) {
      await write()
      const trip = requireTrip(tripId).trip
      trip.share_token = newId().replace(/-/g, '')
      return trip.share_token
    },

    async requestJoinFromShare(shareToken) {
      await wait()
      const snap = [...db.values()].find((s) => s.trip.share_token === shareToken && s.trip.share_enabled)
      if (!snap) throw new RepositoryError('This link no longer works', 'P0002')
      return snap.trip.invite_code
    },

    async recordSettlement(settlement) {
      await write()
      const snap = requireTrip(settlement.trip_id)
      if (snap.settlements.some((s) => s.client_id && s.client_id === settlement.client_id)) return
      if (settlement.from_member === settlement.to_member) {
        throw new RepositoryError('A settlement needs two different members', '22023')
      }
      if (!(settlement.amount > 0)) throw new RepositoryError('Amount must be positive', '22023')
      const ids = new Set(snap.members.map((m) => m.id))
      if (!ids.has(settlement.from_member) || !ids.has(settlement.to_member)) {
        throw new RepositoryError('Both members must belong to this trip', '22023')
      }
      const stored: TripSettlement = { ...clone(settlement), currency: snap.trip.default_currency, fx_rate: 1 }
      snap.settlements.push(stored)
    },

    async addMember(tripId, name) {
      await write()
      const snap = requireTrip(tripId)
      const trimmed = name.trim()
      if (trimmed.length < 1 || trimmed.length > 40) throw new RepositoryError('Name must be 1-40 characters', '22023')
      const member: TripMember = {
        id: newId(),
        trip_id: tripId,
        display_name: trimmed,
        user_id: null,
        color: AVATAR_COLORS[snap.members.length % AVATAR_COLORS.length] ?? '#DDDDDD',
        display_currency: null,
        created_at: new Date().toISOString(),
      }
      snap.members.push(member)
      return member.id
    },

    async previewInvite(code) {
      await wait()
      const wanted = code.trim().toLowerCase()
      const snap = [...db.values()].find((s) => s.trip.invite_code === wanted)
      if (!snap) throw new RepositoryError('Invalid invite code', 'P0002')
      return {
        tripId: snap.trip.id,
        name: snap.trip.name,
        startDate: snap.trip.start_date,
        endDate: snap.trip.end_date,
        defaultCurrency: snap.trip.default_currency,
        unclaimed: snap.members.filter((m) => m.user_id === null).map((m) => ({ id: m.id, displayName: m.display_name })),
      }
    },

    async joinTrip(code, memberId) {
      await write()
      const wanted = code.trim().toLowerCase()
      const snap = [...db.values()].find((s) => s.trip.invite_code === wanted)
      if (!snap) throw new RepositoryError('Invalid invite code', 'P0002')
      const existing = snap.members.find((m) => m.user_id === currentUserId)
      if (existing) return existing.id
      if (memberId) {
        const target = snap.members.find((m) => m.id === memberId)
        if (!target) throw new RepositoryError('Member not found in this trip', 'P0002')
        if (target.user_id !== null) throw new RepositoryError('This member has already been claimed', DUPLICATE_CODE)
        target.user_id = currentUserId
        return target.id
      }
      const member: TripMember = {
        id: newId(),
        trip_id: snap.trip.id,
        display_name: options.displayName ?? 'New member',
        user_id: currentUserId,
        color: AVATAR_COLORS[snap.members.length % AVATAR_COLORS.length] ?? '#DDDDDD',
        display_currency: null,
        created_at: new Date().toISOString(),
      }
      snap.members.push(member)
      return member.id
    },

    async updateMyDisplayCurrency(memberId, currency) {
      await write()
      for (const snap of db.values()) {
        const m = snap.members.find((x) => x.id === memberId)
        if (m) {
          if (m.user_id !== currentUserId) {
            throw new RepositoryError('Only the member themself can change their display currency', '42501')
          }
          m.display_currency = currency
          return
        }
      }
      throw new RepositoryError('Member not found', 'P0002')
    },


    async listTrips() {
      await wait()
      return [...db.values()].filter(isMember).map(clone)
    },

    async getTrip(tripId) {
      await wait()
      const snap = db.get(tripId)
      return snap && isMember(snap) ? clone(snap) : null
    },

    async createTrip(input: NewTripInput) {
      await write()
      const now = new Date().toISOString()
      const trip: Trip = {
        id: newId(),
        name: input.name.trim(),
        default_currency: input.defaultCurrency,
        start_date: input.startDate,
        end_date: input.endDate,
        budget_amount: input.budgetAmount,
        invite_code: newId().slice(0, 8),
        share_token: newId().replace(/-/g, ''),
        share_enabled: true,
        created_by: currentUserId,
        archived_at: null,
        created_at: now,
      }
      const names = ['You', ...input.memberNames.map((n) => n.trim()).filter(Boolean)]
      const members: TripMember[] = names.map((display_name, i) => ({
        id: newId(),
        trip_id: trip.id,
        display_name,
        user_id: i === 0 ? currentUserId : null,
        color: AVATAR_COLORS[i % AVATAR_COLORS.length] ?? '#DDDDDD',
        display_currency: null,
        created_at: now,
      }))
      const categories: TripCategory[] = DEFAULT_CATEGORIES.map((c, i) => ({
        id: newId(),
        trip_id: trip.id,
        key: c.key,
        name: c.name,
        icon: c.icon,
        color: c.color,
        sort_order: i,
        hidden_at: null,
        created_by_member: null,
        created_at: now,
        updated_at: now,
      }))
      db.set(trip.id, { trip, members, categories, expenses: [], shares: [], settlements: [] })
      return trip.id
    },

    async importTrip(payload) {
      await write()
      const bad = (message: string): never => {
        throw new RepositoryError(message, '22023')
      }
      // Mirrors supabase/migrations/003_trip_import.sql: validate everything, then store, all or nothing.
      const name = payload.trip.name.trim()
      if (name.length < 1 || name.length > 80) bad('Trip name must be 1-80 characters')
      const currency = payload.trip.default_currency.trim().toUpperCase()
      if (!/^[A-Z]{3}$/.test(currency)) bad('Invalid currency code')
      const { start_date: start, end_date: end } = payload.trip
      if (start && end && end < start) bad('The end date is before the start date')
      if (payload.members.length === 0) bad('members must be a non-empty JSON array')
      if (payload.members.length > MAX_IMPORT_MEMBERS) bad(`Too many members (at most ${MAX_IMPORT_MEMBERS})`)
      if (payload.expenses.length > MAX_IMPORT_EXPENSES) bad(`Too many expenses (at most ${MAX_IMPORT_EXPENSES})`)
      if (payload.settlements.length > MAX_IMPORT_SETTLEMENTS) bad(`Too many settlements (at most ${MAX_IMPORT_SETTLEMENTS})`)
      if (payload.members.filter((m) => m.is_me).length !== 1) bad('Exactly one member must be marked is_me')

      const now = Date.now()
      const stamp = (offset = 0) => new Date(now + offset).toISOString()
      const tripId = newId()
      const memberIds = new Map<string, string>()
      const members: TripMember[] = payload.members.map((m, i) => {
        const key = m.key.trim()
        if (key === '') bad(`Member ${i + 1} needs a key`)
        if (memberIds.has(key)) bad(`Duplicate member key ${key}`)
        const display = m.display_name.trim()
        if (display.length < 1 || display.length > 40) bad(`Member ${i + 1} name must be 1-40 characters`)
        const id = newId()
        memberIds.set(key, id)
        return {
          id,
          trip_id: tripId,
          display_name: display,
          user_id: m.is_me ? currentUserId : null,
          color: AVATAR_COLORS[i % AVATAR_COLORS.length] ?? '#DDDDDD',
          display_currency: null,
          created_at: stamp(),
        }
      })
      const categories: TripCategory[] = DEFAULT_CATEGORIES.map((c, i) => ({
        id: newId(), trip_id: tripId, key: c.key, name: c.name, icon: c.icon, color: c.color, sort_order: i,
        hidden_at: null, created_by_member: null, created_at: stamp(), updated_at: stamp(),
      }))
      const categoryIds = new Map(categories.map((c) => [c.key as string, c.id]))

      const expenses: TripExpense[] = []
      const shares: TripExpenseShare[] = []
      payload.expenses.forEach((e, i) => {
        const label = `Expense ${i + 1}`
        const title = e.title.trim()
        if (title.length < 1 || title.length > 120) bad(`${label}: title must be 1-120 characters`)
        if (!(e.amount > 0)) bad(`${label}: amount must be positive`)
        const ccy = e.currency.trim().toUpperCase()
        if (!/^[A-Z]{3}$/.test(ccy)) bad(`${label}: invalid currency code`)
        const categoryId = categoryIds.get(e.category_key)
        if (!categoryId) bad(`${label}: unknown category`)
        const paidBy = memberIds.get(e.paid_by_key)
        if (!paidBy) bad(`${label}: payer is not a member of this trip`)
        if (!['equal', 'exact', 'shares'].includes(e.split_mode)) bad(`${label}: invalid split mode`)
        const same = ccy === currency
        const rate = same ? 1 : e.fx_rate
        if (rate !== null && !(rate > 0)) bad(`${label}: fx_rate must be positive`)
        if (!Array.isArray(e.shares) || e.shares.length === 0) bad(`${label}: shares must be a non-empty JSON array`)
        const seen = new Set<string>()
        let sum = 0
        for (const s of e.shares) {
          if (!memberIds.has(s.member_key) || !(s.amount >= 0)) bad(`${label}: shares contain an invalid member or amount`)
          if (seen.has(s.member_key)) bad(`${label}: duplicate member in shares`)
          seen.add(s.member_key)
          sum += Math.round(s.amount * 1000)
        }
        if (sum !== Math.round(e.amount * 1000)) bad(`${label}: shares must sum to the amount`)
        const id = newId()
        const at = stamp(i)
        expenses.push({
          id, trip_id: tripId, category_id: categoryId!, title, amount: e.amount, currency: ccy,
          fx_rate: rate, fx_source: rate === null ? null : same ? 'same' : e.fx_source,
          fx_date: e.fx_date, amount_default: amountDefault(e.amount, ccy, rate, currency),
          paid_by: paidBy!, split_mode: e.split_mode, date: e.date || todayISO(),
          note: e.note.trim() || IMPORT_NOTE,
          place_name: null, place_address: null, place_area: null, place_city: null, place_country: null,
          place_lat: null, place_lng: null, place_provider_id: null,
          created_by: currentUserId, client_id: null, created_at: at, updated_at: at,
        })
        for (const s of e.shares) {
          shares.push({ expense_id: id, member_id: memberIds.get(s.member_key)!, weight: 1, amount: s.amount })
        }
      })

      const settlements: TripSettlement[] = payload.settlements.map((s, i) => {
        const label = `Settlement ${i + 1}`
        const from = memberIds.get(s.from_key)
        const to = memberIds.get(s.to_key)
        if (!from || !to) bad(`${label}: both members must belong to this trip`)
        if (from === to) bad(`${label}: a settlement needs two different members`)
        const places = 10 ** minorUnits(currency)
        const amount = Math.round(s.amount * places) / places
        if (!(amount > 0)) bad(`${label}: amount must be positive`)
        return {
          id: newId(), trip_id: tripId, from_member: from!, to_member: to!, amount, currency, fx_rate: 1,
          client_id: null, created_at: s.date ? `${s.date}T12:00:00.000Z` : stamp(),
        }
      })

      const trip: Trip = {
        id: tripId, name, default_currency: currency, start_date: start, end_date: end, budget_amount: null,
        invite_code: newId().slice(0, 8), share_token: newId().replace(/-/g, ''), share_enabled: true,
        created_by: currentUserId, archived_at: null, created_at: stamp(),
      }
      db.set(tripId, { trip, members, categories, expenses, shares, settlements })
      return tripId
    },

    async saveExpense(expense: TripExpense, shares: TripExpenseShare[]) {
      await write()
      const snap = db.get(expense.trip_id)
      if (!snap) throw new Error('Trip not found')
      if (!snap.categories.some((c) => c.id === expense.category_id)) {
        throw new Error('Category does not belong to this trip')
      }
      const sum = shares.reduce((acc, s) => acc + Math.round(s.amount * 1000), 0)
      if (sum !== Math.round(expense.amount * 1000)) {
        throw new Error('Shares must sum to the amount')
      }
      // Idempotent on client_id, like the server: a replay resolves to the expense it created.
      const byClient = expense.client_id ? snap.expenses.find((e) => e.client_id === expense.client_id) : undefined
      if (byClient && byClient.id !== expense.id) {
        expense = { ...expense, id: byClient.id }
        shares = shares.map((s) => ({ ...s, expense_id: byClient.id }))
      }
      // Mirror the server: same-currency expenses get rate 1, and amount_default is computed here.
      const same = expense.currency === snap.trip.default_currency
      const rate = same ? 1 : expense.fx_rate
      const stored: TripExpense = {
        ...clone(expense),
        fx_rate: rate,
        fx_source: rate === null ? null : same ? 'same' : expense.fx_source,
        amount_default: amountDefault(expense.amount, expense.currency, rate, snap.trip.default_currency),
      }
      snap.expenses = snap.expenses.filter((e) => e.id !== expense.id).concat(stored)
      snap.shares = snap.shares.filter((s) => s.expense_id !== expense.id).concat(clone(shares))
    },

    async deleteExpense(expenseId: string) {
      await write()
      for (const snap of db.values()) {
        if (snap.expenses.some((e) => e.id === expenseId)) {
          snap.expenses = snap.expenses.filter((e) => e.id !== expenseId)
          snap.shares = snap.shares.filter((s) => s.expense_id !== expenseId)
          return
        }
      }
      throw new Error('Expense not found')
    },

    async setDefaultCurrency(tripId, currency, rates) {
      await write()
      const snap = db.get(tripId)
      if (!snap) throw new Error('Trip not found')
      const old = snap.trip.default_currency
      if (old === currency) return
      const pick = (ccy: string, date: string): number | null => {
        const r = rates[ccy]?.[date] ?? rates[ccy]?.['latest']
        return r !== undefined && r > 0 ? r : null
      }
      // Validate everything first so a failure changes nothing (the server is transactional).
      const settlementRates = snap.settlements.map((s) => {
        if (s.currency === currency) return 1
        const r = pick(s.currency, s.created_at.slice(0, 10))
        if (r === null) throw new Error(`Missing rate for settlement currency ${s.currency}`)
        return r
      })
      let budget = snap.trip.budget_amount
      if (budget !== null) {
        const r = rates[old]?.['latest']
        if (r === undefined || r <= 0) throw new Error(`Missing latest rate for ${old} (needed to convert the budget)`)
        budget = Math.round(budget * r * 100) / 100
      }
      for (const e of snap.expenses) {
        if (e.currency === currency) {
          e.fx_rate = 1
          e.fx_source = 'same'
        } else {
          const r = pick(e.currency, e.date)
          e.fx_rate = r
          e.fx_source = r === null ? null : 'api'
        }
        e.amount_default = amountDefault(e.amount, e.currency, e.fx_rate, currency)
      }
      snap.settlements.forEach((s, i) => (s.fx_rate = settlementRates[i] ?? 1))
      snap.trip.budget_amount = budget
      snap.trip.default_currency = currency
    },

    async createCategory(tripId, input) {
      await write()
      const snap = db.get(tripId)
      if (!snap) throw new Error('Trip not found')
      const name = input.name.trim()
      if (name.length < 1 || name.length > 24) throw new Error('Name must be 1-24 characters')
      if (isDuplicateCategoryName(name, snap.categories)) {
        throw new RepositoryError(`There's already a category called ${name}`, DUPLICATE_CODE)
      }
      const now = new Date().toISOString()
      const me = snap.members.find((m) => m.user_id === currentUserId)
      const category: TripCategory = {
        id: newId(),
        trip_id: tripId,
        key: null,
        name,
        icon: input.icon,
        color: input.color,
        sort_order: Math.max(-1, ...snap.categories.map((c) => c.sort_order)) + 1,
        hidden_at: null,
        created_by_member: me?.id ?? null,
        created_at: now,
        updated_at: now,
      }
      snap.categories.push(category)
      return category.id
    },

    async updateCategory(categoryId, patch) {
      await write()
      const found = findCategory(categoryId)
      if (!found) throw new Error('Category not found')
      const { snap, category } = found
      if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (name.length < 1 || name.length > 24) throw new Error('Name must be 1-24 characters')
        if (isDuplicateCategoryName(name, snap.categories, categoryId)) {
          throw new RepositoryError(`There's already a category called ${name}`, DUPLICATE_CODE)
        }
        category.name = name
      }
      if (patch.hidden === true && category.hidden_at === null) {
        if (!snap.categories.some((c) => c.id !== categoryId && c.hidden_at === null)) {
          throw new Error('The last visible category cannot be hidden')
        }
        category.hidden_at = new Date().toISOString()
      }
      if (patch.hidden === false) category.hidden_at = null
      if (patch.icon !== undefined) category.icon = patch.icon
      if (patch.color !== undefined) category.color = patch.color
      category.updated_at = new Date().toISOString()
    },

    async deleteCategory(categoryId, moveTo) {
      await write()
      const found = findCategory(categoryId)
      if (!found) throw new Error('Category not found')
      const { snap, category } = found
      if (category.hidden_at === null && !snap.categories.some((c) => c.id !== categoryId && c.hidden_at === null)) {
        throw new Error('The last visible category cannot be deleted')
      }
      const affected = snap.expenses.filter((e) => e.category_id === categoryId)
      if (moveTo !== null) {
        if (moveTo === categoryId || !snap.categories.some((c) => c.id === moveTo)) {
          throw new Error('Target category does not belong to this trip')
        }
      } else if (affected.length > 0) {
        throw new Error(`Category has ${affected.length} expenses; move_to is required`)
      }
      for (const e of affected) e.category_id = moveTo as string
      snap.categories = snap.categories.filter((c) => c.id !== categoryId)
    },

    async reorderCategories(tripId, orderedIds) {
      await write()
      const snap = db.get(tripId)
      if (!snap) throw new Error('Trip not found')
      if (new Set(orderedIds).size !== orderedIds.length || orderedIds.some((id) => !snap.categories.some((c) => c.id === id))) {
        throw new Error('ordered_ids must be distinct categories of this trip')
      }
      const rest = snap.categories
        .filter((c) => !orderedIds.includes(c.id))
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((c) => c.id)
      ;[...orderedIds, ...rest].forEach((id, i) => {
        const c = snap.categories.find((x) => x.id === id)
        if (c) c.sort_order = i
      })
    },
  }

  // After every write, tell subscribers (other devices) about what changed.
  const target = repo as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>
  for (const name of [
    'createTrip', 'importTrip', 'saveExpense', 'deleteExpense', 'setDefaultCurrency', 'createCategory', 'updateCategory',
    'deleteCategory', 'reorderCategories', 'setShareEnabled', 'rotateShareToken', 'recordSettlement', 'addMember', 'joinTrip', 'updateMyDisplayCurrency',
  ]) {
    const original = target[name]
    if (!original) continue
    target[name] = async (...args) => {
      const result = await original(...args)
      notifyChanged()
      return result
    }
  }
  return repo
}
