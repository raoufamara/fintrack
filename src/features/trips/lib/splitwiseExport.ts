import type { TripSnapshot } from '../services/TripsRepository'
import type { TripExpenseShare } from '../types'
import { computeBalances } from './balances'
import { minorUnits, toMinor } from './currency'
import { todayISO } from './dates'

/**
 * Builds a CSV in the layout of Splitwise's "Export as spreadsheet": Date,
 * Description, Category, Cost, Currency, then one column per member holding
 * that member's net effect on their balance. Payments are rows with Category
 * "Payment"; after a blank line come "Total balance" rows, one per currency.
 * Importing the file again (lib/splitwiseCsv.ts) recreates the same balances.
 */

const CRLF = '\r\n'

/** Cells that a spreadsheet could run as a formula get a leading apostrophe. */
function defuse(text: string): string {
  return /^[=+@\t\r]/.test(text) || /^-(?!\d)/.test(text) ? `'${text}` : text
}

/** RFC 4180: quote when the cell holds a comma, quote, line break or edge spaces. */
export function csvCell(value: string): string {
  return /[",\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

const csvLine = (cells: string[]) => cells.map(csvCell).join(',')

/** Minor units as a plain decimal with the currency's number of decimals: -1234 EUR -> "-12.34". */
export function formatPlainAmount(minor: number, currency: string): string {
  const digits = minorUnits(currency)
  const abs = Math.abs(minor)
  const base = 10 ** digits
  const whole = Math.floor(abs / base)
  const frac = String(abs % base).padStart(digits, '0')
  return `${minor < 0 ? '-' : ''}${whole}${digits > 0 ? `.${frac}` : ''}`
}

/** "Lisbon & Porto" -> "lisbon-porto" */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'trip'
}

export function exportFileName(tripName: string, today: string = todayISO()): string {
  return `${slugify(tripName)}-fintrack-${today}.csv`
}

export interface BuiltCsv {
  fileName: string
  /** RFC 4180 text with CRLF line endings, no byte order mark. */
  csv: string
}

export function buildSplitwiseCsv(snapshot: TripSnapshot, today: string = todayISO()): BuiltCsv {
  const { trip, members, categories, expenses, shares, settlements } = snapshot
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const memberName = new Map(members.map((m) => [m.id, m.display_name]))
  const sharesBy = new Map<string, TripExpenseShare[]>()
  for (const s of shares) {
    const list = sharesBy.get(s.expense_id)
    if (list) list.push(s)
    else sharesBy.set(s.expense_id, [s])
  }

  interface Line {
    date: string
    at: string
    cells: string[]
  }
  const lines: Line[] = []
  const netCells = (nets: Map<string, number>, currency: string) =>
    members.map((m) => formatPlainAmount(nets.get(m.id) ?? 0, currency))

  for (const e of expenses) {
    const nets = new Map<string, number>()
    nets.set(e.paid_by, toMinor(e.amount, e.currency))
    for (const s of sharesBy.get(e.id) ?? []) {
      nets.set(s.member_id, (nets.get(s.member_id) ?? 0) - toMinor(s.amount, e.currency))
    }
    lines.push({
      date: e.date,
      at: e.created_at,
      cells: [
        e.date,
        defuse(e.title),
        defuse(categoryName.get(e.category_id) ?? ''),
        formatPlainAmount(toMinor(e.amount, e.currency), e.currency),
        e.currency,
        ...netCells(nets, e.currency),
      ],
    })
  }

  for (const s of settlements) {
    const minor = toMinor(s.amount, s.currency)
    const date = s.created_at.slice(0, 10)
    lines.push({
      date,
      at: s.created_at,
      cells: [
        date,
        defuse(`${memberName.get(s.from_member) ?? '?'} paid ${memberName.get(s.to_member) ?? '?'}`),
        'Payment',
        formatPlainAmount(minor, s.currency),
        s.currency,
        ...netCells(
          new Map([
            [s.from_member, minor],
            [s.to_member, -minor],
          ]),
          s.currency,
        ),
      ],
    })
  }

  lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.at < b.at ? -1 : a.at > b.at ? 1 : 0))

  const out = [csvLine(['Date', 'Description', 'Category', 'Cost', 'Currency', ...members.map((m) => defuse(m.display_name))]), '']
  for (const l of lines) out.push(csvLine(l.cells))

  // One Total balance row per currency present, each balanced in its own currency.
  const currencies = [
    ...new Set([...expenses.map((e) => e.currency), ...settlements.map((s) => s.currency)]),
  ].sort()
  if (currencies.length > 0) {
    out.push('')
    const lastDate = lines[lines.length - 1]?.date ?? today
    for (const currency of currencies) {
      const { balances } = computeBalances(
        expenses.filter((e) => e.currency === currency),
        shares,
        settlements.filter((s) => s.currency === currency),
        currency,
      )
      out.push(
        csvLine([lastDate, 'Total balance', '', '', currency, ...members.map((m) => formatPlainAmount(balances.get(m.id) ?? 0, currency))]),
      )
    }
  }
  return { fileName: exportFileName(trip.name, today), csv: out.join(CRLF) + CRLF }
}
