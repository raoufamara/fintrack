import type {
  FilterContext,
  FilterResult,
  TripExpense,
  TripExpenseFilter,
  TripExpenseShare,
} from '../types'
import {
  expenseSharesDefault,
  expenseTotalDefault,
  groupSharesByExpense,
} from './balances'

/** Sentinel used in `places` and `countByPlace` for expenses without a location. */
export const NO_LOCATION = 'none'

export const EMPTY_FILTER: Readonly<TripExpenseFilter> = {
  categoryIds: [],
  places: [],
  payer: null,
  mine: false,
  from: null,
  to: null,
  q: '',
}

type Facet = 'category' | 'place'

/** Case- and accent-insensitive form used for search. */
export function normalizeSearch(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * Place key of an expense: its city, else its place name, else 'none'.
 * (Phase 5 always stores a city with a picked place; the name fallback keeps
 * free-text places filterable.)
 */
export function placeKey(expense: Pick<TripExpense, 'place_city' | 'place_name'>): string {
  const city = expense.place_city?.trim()
  if (city) return city
  const name = expense.place_name?.trim()
  return name ? name : NO_LOCATION
}

function matches(
  expense: TripExpense,
  memberIdsWithShare: ReadonlySet<string> | undefined,
  filter: TripExpenseFilter,
  currentMemberId: string | null,
  omit?: Facet,
): boolean {
  if (omit !== 'category' && filter.categoryIds.length > 0) {
    if (!filter.categoryIds.includes(expense.category_id)) return false
  }
  if (omit !== 'place' && filter.places.length > 0) {
    if (!filter.places.includes(placeKey(expense))) return false
  }
  if (filter.payer && expense.paid_by !== filter.payer) return false
  if (filter.mine) {
    if (!currentMemberId || !memberIdsWithShare?.has(currentMemberId)) return false
  }
  if (filter.from && expense.date < filter.from) return false
  if (filter.to && expense.date > filter.to) return false
  const q = normalizeSearch(filter.q)
  if (q) {
    const haystack = normalizeSearch(
      [expense.title, expense.place_name, expense.place_city].filter(Boolean).join(' '),
    )
    if (!haystack.includes(q)) return false
  }
  return true
}

/**
 * Applies the filter (OR within a facet, AND across facets) and computes
 * totals and facet counts. Each facet's counts are computed with that facet's
 * own filter removed, so chips show what selecting them would add.
 */
export function filterExpenses(
  expenses: readonly TripExpense[],
  shares: readonly TripExpenseShare[],
  filter: TripExpenseFilter,
  ctx: FilterContext,
): FilterResult {
  const sharesByExpense = groupSharesByExpense(shares)
  const memberSets = new Map<string, Set<string>>()
  for (const [expenseId, list] of sharesByExpense) {
    memberSets.set(expenseId, new Set(list.map((s) => s.member_id)))
  }
  const test = (e: TripExpense, omit?: Facet) =>
    matches(e, memberSets.get(e.id), filter, ctx.currentMemberId, omit)

  const items: TripExpense[] = []
  const countByCategory: Record<string, number> = {}
  const countByPlace: Record<string, number> = {}
  let hiddenNoLocationCount = 0
  const placeFilterHidesNone =
    filter.places.length > 0 && !filter.places.includes(NO_LOCATION)

  for (const e of expenses) {
    const passesCategoryAndOthers = test(e, 'category')
    const passesPlaceAndOthers = test(e, 'place')
    const passesAll = test(e)

    if (passesAll) items.push(e)
    if (passesCategoryAndOthers) {
      countByCategory[e.category_id] = (countByCategory[e.category_id] ?? 0) + 1
    }
    if (passesPlaceAndOthers) {
      const key = placeKey(e)
      countByPlace[key] = (countByPlace[key] ?? 0) + 1
      if (placeFilterHidesNone && key === NO_LOCATION) hiddenNoLocationCount += 1
    }
  }

  let totalDefault = 0
  let myShareDefault = 0
  let pendingCount = 0
  for (const e of items) {
    const total = expenseTotalDefault(e, ctx.defaultCurrency)
    if (total === null) {
      pendingCount += 1
      continue
    }
    totalDefault += total
    if (ctx.currentMemberId) {
      const split = expenseSharesDefault(e, sharesByExpense.get(e.id) ?? [], ctx.defaultCurrency)
      myShareDefault += split?.get(ctx.currentMemberId) ?? 0
    }
  }

  return {
    items,
    totalDefault,
    myShareDefault,
    pendingCount,
    countByCategory,
    countByPlace,
    hiddenNoLocationCount,
  }
}

// --- URL (de)serialisation -------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function encodeItem(item: string): string {
  return item.replace(/%/g, '%25').replace(/,/g, '%2C')
}

function decodeItem(item: string): string {
  return item.replace(/%2C/gi, ',').replace(/%25/g, '%')
}

function parseList(value: string | null): string[] {
  if (!value) return []
  const out: string[] = []
  for (const part of value.split(',')) {
    const item = decodeItem(part)
    if (item !== '' && !out.includes(item)) out.push(item)
  }
  return out
}

function parseDate(value: string | null): string | null {
  return value && DATE_RE.test(value) ? value : null
}

/** Reads `cat`, `place`, `payer`, `from`, `to`, `mine` and `q` from a query string. */
export function parseFilter(params: URLSearchParams): TripExpenseFilter {
  return {
    categoryIds: parseList(params.get('cat')),
    places: parseList(params.get('place')),
    payer: params.get('payer') || null,
    mine: params.get('mine') === '1',
    from: parseDate(params.get('from')),
    to: parseDate(params.get('to')),
    q: (params.get('q') ?? '').trim(),
  }
}

/** Inverse of `parseFilter`. Default values are omitted. */
export function serializeFilter(filter: TripExpenseFilter): URLSearchParams {
  const params = new URLSearchParams()
  if (filter.categoryIds.length > 0) {
    params.set('cat', filter.categoryIds.map(encodeItem).join(','))
  }
  if (filter.places.length > 0) {
    params.set('place', filter.places.map(encodeItem).join(','))
  }
  if (filter.payer) params.set('payer', filter.payer)
  if (filter.from) params.set('from', filter.from)
  if (filter.to) params.set('to', filter.to)
  if (filter.mine) params.set('mine', '1')
  const q = filter.q.trim()
  if (q) params.set('q', q)
  return params
}

/** Number of active filters outside the category chips (badge on the filter button). */
export function countActiveFilters(filter: TripExpenseFilter): number {
  return (
    (filter.places.length > 0 ? 1 : 0) +
    (filter.payer ? 1 : 0) +
    (filter.mine ? 1 : 0) +
    (filter.from || filter.to ? 1 : 0)
  )
}
