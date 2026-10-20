import type {
  ImportExpenseInput,
  ImportMemberInput,
  ImportSettlementInput,
  ImportTripPayload,
  FxSource,
  TripExpense,
  TripExpenseShare,
  TripSettlement,
} from '../types'
import { DEFAULT_CATEGORIES } from './categories'
import { computeBalances } from './balances'
import { fromMinor, minorUnits } from './currency'
import { toDefault } from './money'
import type { SplitwiseFile, SplitwiseTotal } from './splitwiseCsv'

/**
 * Maps a parsed Splitwise file to our model. Pure: no network, no clock.
 * See docs/design/TRIPS.md ("Import & export") for the rules.
 */

export const IMPORT_NOTE = 'Imported from Splitwise'
export const MAX_IMPORT_MEMBERS = 50
export const MAX_IMPORT_EXPENSES = 5000
export const MAX_IMPORT_SETTLEMENTS = 2000
export const PAYMENT_RATE_ERROR = 'Connect to the internet to import payments in other currencies'

export interface PlanMember {
  key: string
  name: string
}

export interface PlanExpense {
  line: number
  title: string
  date: string
  categoryKey: string
  currency: string
  amountMinor: number
  paidByKey: string
  /** Minor units of `currency`; sums to `amountMinor`, never contains 0. */
  shares: Array<{ memberKey: string; minor: number }>
}

export interface PlanSettlement {
  line: number
  fromKey: string
  toKey: string
  /** Minor units of `currency`. */
  amountMinor: number
  currency: string
  date: string
  /** Created to balance a row that had several payers. */
  balancing: boolean
}

export interface CategorySummaryItem {
  /** The Splitwise category as written ("(none)" when empty). */
  source: string
  key: string
  /** Our category name. */
  label: string
  count: number
}

export interface ImportPlan {
  tripName: string
  defaultCurrency: string
  startDate: string | null
  endDate: string | null
  members: PlanMember[]
  expenses: PlanExpense[]
  settlements: PlanSettlement[]
  /** Rows left out: zero amounts, nothing to record, or unreadable. */
  skipped: number
  warnings: string[]
  /** Rows that were refused ("Row 7: ..."). They count as skipped. */
  rowErrors: string[]
  /** Problems that stop the import. */
  errors: string[]
  categorySummary: CategorySummaryItem[]
}

// ----------------------------------------------------------- categories

/** Keywords per default category key. Checked in this order. */
const CATEGORY_KEYWORDS: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['stay', ['hotel', 'rent', 'lodging', 'accommodation', 'airbnb']],
  ['food', ['dining', 'food and drink', 'restaurant', 'liquor', 'coffee']],
  ['groceries', ['groceries', 'water']],
  ['transport', ['transportation', 'taxi', 'bus', 'train', 'plane', 'flight', 'car', 'gas', 'fuel', 'parking', 'bicycle']],
  ['activity', ['entertainment', 'movies', 'music', 'sports', 'games', 'tickets']],
  ['shopping', ['clothing', 'electronics', 'gifts', 'household', 'furniture']],
  ['fees', ['taxes', 'insurance', 'services', 'utilities', 'medical', 'cleaning']],
]

function words(text: string): string {
  const plain = text
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .join(' ')
  return ` ${plain} `
}

function matchKey(text: string): string | null {
  const hay = words(text)
  for (const [key, keywords] of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      if (hay.includes(` ${kw} `) || hay.includes(` ${kw}s `) || hay.includes(` ${kw}es `)) return key
    }
  }
  return null
}

/**
 * Our default category for a Splitwise category, falling back to the
 * description, then "other". "Entertainment - Other" is matched on the part
 * before " - ".
 */
export function guessCategoryKey(category: string, description = ''): string {
  const main = category.split(' - ')[0] ?? category
  return matchKey(main) ?? matchKey(description) ?? 'other'
}

const CATEGORY_LABELS = new Map(DEFAULT_CATEGORIES.map((c) => [c.key, c.name]))

// ----------------------------------------------------------- trip name

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH_WORDS = /^(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|june?|july?|aug(ust)?|sep(t|tember)?|oct(ober)?|nov(ember)?|dec(ember)?)$/i
const NOISE_WORDS = /^(splitwise|expenses?|export(ed)?|csv)$/i

const monthLabel = (iso: string) => `${(MONTHS[Number(iso.slice(5, 7)) - 1] ?? '').replace(/^./, (c) => c.toUpperCase())}`

/** "Trip · Feb 2024" or "Trip · Feb – Mar 2024" from the trip dates. */
export function fallbackTripName(start: string | null, end: string | null): string {
  if (!start) return 'Imported trip'
  const last = end ?? start
  const sameMonth = start.slice(0, 7) === last.slice(0, 7)
  if (sameMonth) return `Trip · ${monthLabel(start)} ${start.slice(0, 4)}`
  if (start.slice(0, 4) === last.slice(0, 4)) return `Trip · ${monthLabel(start)} – ${monthLabel(last)} ${start.slice(0, 4)}`
  return `Trip · ${monthLabel(start)} ${start.slice(0, 4)} – ${monthLabel(last)} ${last.slice(0, 4)}`
}

/**
 * Trip name from the file name: drops the extension, "export", "splitwise",
 * "expenses", dates and month names, turns underscores and dashes into
 * spaces and capitalises words. When nothing is left, a name from the dates.
 */
export function tripNameFromFileName(fileName: string | undefined, start: string | null, end: string | null): string {
  const base = (fileName ?? '')
    .replace(/^.*[\\/]/, '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/\(\d+\)\s*$/, '')
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\d{1,2}[-.]\d{1,2}[-.]\d{4}/g, ' ')
  const kept = base
    .split(/[\s_-]+/)
    .filter((w) => w !== '' && !NOISE_WORDS.test(w) && !MONTH_WORDS.test(w) && !/^\d+$/.test(w))
  if (kept.length === 0) return fallbackTripName(start, end)
  return kept
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
    .slice(0, 80)
}

// ------------------------------------------------------------- mapping

const isPaymentRow = (category: string, description: string) =>
  category.trim().toLowerCase() === 'payment' || /^settle all balances$/i.test(description.trim())

/** Differences of up to this many minor units are rounding noise. */
const ROUNDING_TOLERANCE = 2

const fmt = (minor: number, currency: string) => (minor / 10 ** minorUnits(currency)).toFixed(minorUnits(currency))

/** Index of the largest value; the first one wins a tie. */
function largest(items: ReadonlyArray<{ i: number; v: number }>): { i: number; v: number } | undefined {
  let best: { i: number; v: number } | undefined
  for (const it of items) if (!best || it.v > best.v) best = it
  return best
}

export function mapSplitwise(file: SplitwiseFile, options: { fileName?: string } = {}): ImportPlan {
  const members: PlanMember[] = file.people.map((name, i) => ({ key: `m${i}`, name }))
  const keyOf = (i: number) => `m${i}`
  const warnings = [...file.warnings]
  const rowErrors = file.issues.map((x) => `Row ${x.line}: ${x.message}`)
  const expenses: PlanExpense[] = []
  const settlements: PlanSettlement[] = []
  const summary = new Map<string, CategorySummaryItem>()
  let skipped = file.issues.length

  const skip = (line: number, why: string) => {
    skipped++
    warnings.push(`Row ${line}: ${why}; skipped.`)
  }
  const refuse = (line: number, why: string) => {
    skipped++
    rowErrors.push(`Row ${line}: ${why}`)
  }

  for (const row of file.rows) {
    if (row.costMinor === 0) {
      skip(row.line, 'the cost is 0')
      continue
    }
    if (row.costMinor < 0) {
      refuse(row.line, 'the cost is negative')
      continue
    }
    const pos = row.nets.flatMap((v, i) => (v > 0 ? [{ i, v }] : []))
    const neg = row.nets.flatMap((v, i) => (v < 0 ? [{ i, v: -v }] : []))

    if (pos.length === 0 && neg.length === 0) {
      skip(row.line, 'nobody owes anything (paid and used by the same person)')
      continue
    }

    if (isPaymentRow(row.category, row.description)) {
      if (pos.length === 0 || neg.length === 0) {
        refuse(row.line, 'a payment needs one person who paid and one who received')
        continue
      }
      // Greedy: largest payer against largest receiver.
      const payers = pos.map((p) => ({ ...p }))
      const receivers = neg.map((p) => ({ ...p }))
      let moved = 0
      while (payers.length > 0 && receivers.length > 0) {
        const from = largest(payers)!
        const to = largest(receivers)!
        const amount = Math.min(from.v, to.v)
        settlements.push({
          line: row.line,
          fromKey: keyOf(from.i),
          toKey: keyOf(to.i),
          amountMinor: amount,
          currency: row.currency,
          date: row.date,
          balancing: false,
        })
        moved += amount
        from.v -= amount
        to.v -= amount
        if (from.v === 0) payers.splice(payers.indexOf(from), 1)
        if (to.v === 0) receivers.splice(receivers.indexOf(to), 1)
      }
      const left = Math.max(
        payers.reduce((a, p) => a + p.v, 0),
        receivers.reduce((a, p) => a + p.v, 0),
      )
      if (left > ROUNDING_TOLERANCE) {
        warnings.push(`Row ${row.line}: the payment amounts don't match (${fmt(left, row.currency)} ${row.currency} left over).`)
      }
      if (moved === 0) skipped++
      continue
    }

    if (pos.length === 0) {
      refuse(row.line, 'somebody owes money but nobody paid')
      continue
    }

    const payer = largest(pos)!
    const others = pos.filter((p) => p !== payer)
    const sum = row.nets.reduce((a, v) => a + v, 0)
    if (Math.abs(sum) > ROUNDING_TOLERANCE) {
      warnings.push(
        `Row ${row.line}: the amounts were off by ${fmt(Math.abs(sum), row.currency)} ${row.currency}; the difference went to the payer's share.`,
      )
    }

    const shares = new Map<string, number>()
    let othersTotal = 0
    for (const n of neg) {
      shares.set(keyOf(n.i), n.v)
      othersTotal += n.v
    }
    const payerShare = row.costMinor - othersTotal
    if (payerShare < 0) {
      refuse(row.line, "the shares don't add up to the cost")
      continue
    }
    if (payerShare > 0) shares.set(keyOf(payer.i), payerShare)

    const categoryKey = guessCategoryKey(row.category, row.description)
    const sourceLabel = row.category.trim() || '(none)'
    const sumKey = `${sourceLabel.toLowerCase()}|${categoryKey}`
    const item = summary.get(sumKey)
    if (item) item.count++
    else summary.set(sumKey, { source: sourceLabel, key: categoryKey, label: CATEGORY_LABELS.get(categoryKey) ?? 'Other', count: 1 })

    expenses.push({
      line: row.line,
      title: (row.description || row.category || 'Expense').slice(0, 120),
      date: row.date,
      categoryKey,
      currency: row.currency,
      amountMinor: row.costMinor,
      paidByKey: keyOf(payer.i),
      shares: [...shares].map(([memberKey, minor]) => ({ memberKey, minor })),
    })

    if (others.length > 0) {
      for (const j of others) {
        settlements.push({
          line: row.line,
          fromKey: keyOf(j.i),
          toKey: keyOf(payer.i),
          amountMinor: j.v,
          currency: row.currency,
          date: row.date,
          balancing: true,
        })
      }
      warnings.push(
        `Row ${row.line} had several payers; recorded as one expense plus ${others.length} balancing ${others.length === 1 ? 'payment' : 'payments'}.`,
      )
    }
  }

  // Trip facts.
  const dated = expenses.length > 0 ? expenses.map((e) => e.date) : settlements.map((s) => s.date)
  const sorted = [...dated].sort()
  const startDate = sorted[0] ?? null
  const endDate = sorted[sorted.length - 1] ?? null

  const counts = new Map<string, number>()
  for (const r of file.rows) if (r.costMinor > 0) counts.set(r.currency, (counts.get(r.currency) ?? 0) + 1)
  let defaultCurrency = file.totals[0]?.currency ?? 'EUR'
  let best = 0
  for (const [ccy, n] of counts) {
    if (n > best) {
      best = n
      defaultCurrency = ccy
    }
  }

  const errors: string[] = []
  if (expenses.length + settlements.length === 0) errors.push('There is nothing to import in this file: no expenses or payments were found.')
  if (members.length > MAX_IMPORT_MEMBERS) errors.push(`This file has ${members.length} people; a trip can have at most ${MAX_IMPORT_MEMBERS}.`)
  if (expenses.length > MAX_IMPORT_EXPENSES) errors.push(`This file has ${expenses.length} expenses; a trip can have at most ${MAX_IMPORT_EXPENSES}.`)
  if (settlements.length > MAX_IMPORT_SETTLEMENTS) errors.push(`This file has ${settlements.length} payments; a trip can have at most ${MAX_IMPORT_SETTLEMENTS}.`)

  return {
    tripName: tripNameFromFileName(options.fileName, startDate, endDate),
    defaultCurrency,
    startDate,
    endDate,
    members,
    expenses,
    settlements,
    skipped,
    warnings,
    rowErrors,
    errors,
    categorySummary: [...summary.values()].sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
  }
}

// -------------------------------------------------------- verification

export interface BalanceDiff {
  member: string
  currency: string
  /** Minor units of `currency`. */
  splitwise: number
  ours: number
}

export interface VerificationResult {
  /** False when the file has no Total balance row, so nothing was compared. */
  checked: boolean
  matches: boolean
  diffs: BalanceDiff[]
}

const BALANCE_TOLERANCE = 1

/**
 * Compares the balances of the mapped data with the file's Total balance rows,
 * per currency and in each row's own currency (before any conversion).
 */
export function verifyAgainstTotals(plan: ImportPlan, totals: readonly SplitwiseTotal[]): VerificationResult {
  if (totals.length === 0) return { checked: false, matches: true, diffs: [] }
  const diffs: BalanceDiff[] = []
  const currencies = [...new Set(totals.map((t) => t.currency))]
  for (const currency of currencies) {
    const expenses: TripExpense[] = []
    const shares: TripExpenseShare[] = []
    plan.expenses.forEach((e, n) => {
      if (e.currency !== currency) return
      const id = `e${n}`
      expenses.push({ id, paid_by: e.paidByKey, amount: fromMinor(e.amountMinor, currency), currency, fx_rate: 1 } as TripExpense)
      for (const s of e.shares) shares.push({ expense_id: id, member_id: s.memberKey, weight: 1, amount: fromMinor(s.minor, currency) })
    })
    const pays = plan.settlements
      .filter((s) => s.currency === currency)
      .map((s) => ({ from_member: s.fromKey, to_member: s.toKey, amount: fromMinor(s.amountMinor, currency), currency, fx_rate: 1 }) as TripSettlement)
    const { balances } = computeBalances(expenses, shares, pays, currency)

    // Several Total rows for one currency are added up.
    const expected = new Map<string, number>()
    for (const t of totals.filter((x) => x.currency === currency)) {
      t.balances.forEach((v, i) => expected.set(`m${i}`, (expected.get(`m${i}`) ?? 0) + (v ?? 0)))
    }
    for (const m of plan.members) {
      const splitwise = expected.get(m.key) ?? 0
      const ours = balances.get(m.key) ?? 0
      if (Math.abs(splitwise - ours) > BALANCE_TOLERANCE) diffs.push({ member: m.name, currency, splitwise, ours })
    }
  }
  return { checked: true, matches: diffs.length === 0, diffs }
}

// -------------------------------------------------------------- payload

export interface RateLookup {
  rate: number
  source: 'same' | 'cache' | 'api'
  tableDate: string | null
}

export const rateKey = (currency: string, date: string) => `${currency}|${date}`

/** Every (currency, date) pair that needs a rate to the default currency. */
export function neededRates(plan: ImportPlan, defaultCurrency: string): Array<{ currency: string; date: string }> {
  const seen = new Map<string, { currency: string; date: string }>()
  for (const x of [...plan.expenses, ...plan.settlements]) {
    if (x.currency !== defaultCurrency) seen.set(rateKey(x.currency, x.date), { currency: x.currency, date: x.date })
  }
  return [...seen.values()]
}

export interface BuildOptions {
  meKey: string
  tripName: string
  defaultCurrency: string
  startDate: string | null
  endDate: string | null
  /** Rates from `rateKey(currency, date)`; null or missing means unavailable. */
  rates: ReadonlyMap<string, RateLookup | null>
}

export type BuildResult =
  | { ok: true; payload: ImportTripPayload; pendingExpenses: number; warnings: string[] }
  | { ok: false; error: string }

/** Turns the plan plus the chosen options into the `import_trip` payload. */
export function buildImportPayload(plan: ImportPlan, opts: BuildOptions): BuildResult {
  const name = opts.tripName.trim()
  if (name.length < 1 || name.length > 80) return { ok: false, error: 'Give the trip a name (80 characters at most).' }
  if (!/^[A-Z]{3}$/.test(opts.defaultCurrency)) return { ok: false, error: 'Choose a default currency.' }
  if (opts.startDate && opts.endDate && opts.endDate < opts.startDate) {
    return { ok: false, error: 'The end date is before the start date.' }
  }
  if (!plan.members.some((m) => m.key === opts.meKey)) return { ok: false, error: 'Choose which person is you.' }

  const members: ImportMemberInput[] = plan.members.map((m) => ({
    key: m.key,
    display_name: m.name.slice(0, 40).trim() || 'Member',
    is_me: m.key === opts.meKey,
  }))

  const warnings: string[] = []
  let pendingExpenses = 0
  const expenses: ImportExpenseInput[] = plan.expenses.map((e) => {
    const same = e.currency === opts.defaultCurrency
    const found = same ? null : (opts.rates.get(rateKey(e.currency, e.date)) ?? null)
    if (!same && !found) pendingExpenses++
    const source: FxSource | null = same ? 'same' : found ? (found.source === 'api' ? 'api' : 'cache') : null
    return {
      title: e.title,
      amount: fromMinor(e.amountMinor, e.currency),
      currency: e.currency,
      fx_rate: same ? 1 : (found?.rate ?? null),
      fx_source: source,
      fx_date: same ? null : (found?.tableDate ?? null),
      category_key: e.categoryKey,
      paid_by_key: e.paidByKey,
      split_mode: 'exact',
      date: e.date,
      note: IMPORT_NOTE,
      shares: e.shares.map((s) => ({ member_key: s.memberKey, amount: fromMinor(s.minor, e.currency) })),
    }
  })
  if (pendingExpenses > 0) {
    warnings.push(
      `${pendingExpenses} ${pendingExpenses === 1 ? 'expense has' : 'expenses have'} no exchange rate yet. ${pendingExpenses === 1 ? 'It' : 'They'} will convert later, when rates are available.`,
    )
  }

  const settlements: ImportSettlementInput[] = []
  for (const s of plan.settlements) {
    let minor = s.amountMinor
    if (s.currency !== opts.defaultCurrency) {
      const found = opts.rates.get(rateKey(s.currency, s.date)) ?? null
      if (!found) return { ok: false, error: PAYMENT_RATE_ERROR }
      minor = toDefault(s.amountMinor, s.currency, found.rate, opts.defaultCurrency)
    }
    if (minor <= 0) {
      warnings.push(`A payment on ${s.date} converts to nothing and was left out.`)
      continue
    }
    settlements.push({ from_key: s.fromKey, to_key: s.toKey, amount: fromMinor(minor, opts.defaultCurrency), date: s.date })
  }

  return {
    ok: true,
    pendingExpenses,
    warnings,
    payload: {
      trip: { name, default_currency: opts.defaultCurrency, start_date: opts.startDate, end_date: opts.endDate },
      members,
      expenses,
      settlements,
    },
  }
}
