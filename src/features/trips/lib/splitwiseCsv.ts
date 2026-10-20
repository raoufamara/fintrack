import { toMinor } from './currency'

/**
 * Parser for Splitwise's "Export as spreadsheet" CSV. Pure and isolated, so it
 * can be adjusted quickly when a real export shows a difference.
 *
 * ASSUMED FORMAT (not yet verified against a real export; see docs/design/TRIPS.md):
 *
 *   Date,Description,Category,Cost,Currency,Sara Lopez,Malik B,Inès,Raouf
 *   2026-10-03,Airbnb Alfama,Hotel,480.00,EUR,360.00,-120.00,-120.00,-120.00
 *   2026-10-09,Malik B paid Sara Lopez,Payment,50.00,EUR,-50.00,50.00,0.00,0.00
 *
 *   2026-10-10,Total balance, , ,EUR,288.40,-91.60,-141.60,-55.20
 *
 * Columns are found by name (case-insensitive), so extra columns before
 * Currency are fine. Every column after Currency is a person; a cell is that
 * person's net effect on their balance for the row (positive = owed money).
 * "Total balance" rows (one per currency) are kept apart, for verification only.
 */

export interface SplitwiseRow {
  /** 1-based line in the file where the row starts. */
  line: number
  /** YYYY-MM-DD */
  date: string
  description: string
  category: string
  /** Upper-case ISO code. */
  currency: string
  /** Minor units of `currency`. */
  costMinor: number
  /** Net effect per person (same order as `people`), minor units of `currency`. */
  nets: number[]
  /** Category is "Payment". */
  isPayment: boolean
}

export interface SplitwiseTotal {
  line: number
  currency: string
  /** Per person (same order as `people`), minor units; null when the cell is empty. */
  balances: Array<number | null>
}

export interface ParseIssue {
  line: number
  message: string
}

export interface SplitwiseFile {
  /** Trimmed names of the person columns, in file order. */
  people: string[]
  rows: SplitwiseRow[]
  totals: SplitwiseTotal[]
  /** Things worth telling the user that do not stop the import. */
  warnings: string[]
  /** Rows that could not be read; they are left out. */
  issues: ParseIssue[]
}

export type SplitwiseParseResult =
  | { ok: true; file: SplitwiseFile }
  | { ok: false; message: string; expected: string }

export const EXPECTED_FORMAT =
  'A CSV with a header row containing Date, Description, Category, Cost and Currency, followed by one column per person. In Splitwise: open the group, then Settings, then "Export as spreadsheet".'

const fail = (message: string): SplitwiseParseResult => ({ ok: false, message, expected: EXPECTED_FORMAT })

// ---------------------------------------------------------------- tokenizer

export interface CsvRecord {
  /** 1-based line where the record starts. */
  line: number
  cells: string[]
}

/** The delimiter used by the first non-empty line: comma unless semicolons or tabs clearly win. */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ',': 0, ';': 0, '\t': 0 }
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (Object.values(counts).some((n) => n > 0)) break
    } else if (!inQuotes && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1
  }
  const comma = counts[','] ?? 0
  const semi = counts[';'] ?? 0
  const tab = counts['\t'] ?? 0
  if (semi > comma && semi >= tab) return ';'
  if (tab > comma && tab > semi) return '\t'
  return ','
}

/**
 * RFC 4180 tokenizer: quoted fields may contain delimiters, doubled quotes and
 * line breaks; LF, CRLF and CR all end a record. A quote in the middle of an
 * unquoted field is kept as text.
 */
export function tokenizeCsv(text: string, delimiter = ','): CsvRecord[] {
  const records: CsvRecord[] = []
  let cells: string[] = []
  let field = ''
  let inQuotes = false
  let afterQuote = false
  let line = 1
  let recordLine = 1
  let touched = false

  const endField = () => {
    cells.push(field)
    field = ''
    afterQuote = false
  }
  const endRecord = () => {
    endField()
    records.push({ line: recordLine, cells })
    cells = []
    touched = false
  }

  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
          afterQuote = true
        }
      } else {
        if (ch === '\n') line++
        field += ch
      }
      continue
    }
    if (ch === '"' && field === '' && !afterQuote) {
      inQuotes = true
      touched = true
      continue
    }
    if (ch === delimiter) {
      touched = true
      endField()
      continue
    }
    if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text.charAt(i + 1) === '\n') i++
      line++
      if (touched || field !== '' || cells.length > 0) endRecord()
      recordLine = line
      continue
    }
    touched = true
    field += ch
  }
  if (touched || field !== '' || cells.length > 0) endRecord()
  return records
}

// ------------------------------------------------------------------ values

const norm = (s: string) => s.replace(/^\uFEFF/, '').trim().toLowerCase()

type Amount = { kind: 'blank' } | { kind: 'ok'; minor: number } | { kind: 'bad' }

/** Reads "12.50", " -1 234,5 ", "(3.00)", "€4" or a minus sign in any dash style, into minor units of `currency`. */
export function parseAmount(raw: string, currency: string): Amount {
  let text = raw
    .replace(/[−‒–—]/g, '-')
    .replace(/[\s\u00A0\u202F]/g, '')
  if (text === '') return { kind: 'blank' }
  const parens = /^\(.*\)$/.test(text)
  text = text.replace(/[^\d.,+-]/g, '')
  if (!/\d/.test(text)) return { kind: 'bad' }
  if (parens && !text.startsWith('-')) text = `-${text}`
  // Both separators present: the later one is the decimal mark.
  const lastDot = text.lastIndexOf('.')
  const lastComma = text.lastIndexOf(',')
  if (lastDot >= 0 && lastComma >= 0) {
    text = lastComma > lastDot ? text.replace(/\./g, '').replace(',', '.') : text.replace(/,/g, '')
  }
  try {
    return { kind: 'ok', minor: toMinor(text, currency) }
  } catch {
    return { kind: 'bad' }
  }
}

interface RawDate {
  /** Set when unambiguous. */
  iso: string | null
  /** The two readings of a numeric a/b/yyyy date. */
  dmy: string | null
  mdy: string | null
  /** True when only one of dmy/mdy is a real date or the numbers settle it. */
  ambiguous: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')

function realDate(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2200) return null
  const probe = new Date(Date.UTC(y, m - 1, d))
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** YYYY-MM-DD is preferred; DD/MM/YYYY and MM/DD/YYYY are fallbacks. Returns null for anything else. */
function readDate(raw: string): RawDate | null {
  const text = raw.trim()
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/.exec(text)
  if (iso) {
    const d = realDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
    return d ? { iso: d, dmy: null, mdy: null, ambiguous: false } : null
  }
  const num = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s.*)?$/.exec(text)
  if (num) {
    const a = Number(num[1])
    const b = Number(num[2])
    const y = Number(num[3])
    const dmy = realDate(y, b, a)
    const mdy = realDate(y, a, b)
    if (dmy && mdy && a !== b) return { iso: null, dmy, mdy, ambiguous: true }
    const only = dmy ?? mdy
    return only ? { iso: only, dmy: dmy && a > 12 ? dmy : null, mdy: mdy && b > 12 ? mdy : null, ambiguous: false } : null
  }
  return null
}

// ------------------------------------------------------------------ parser

const COLUMN_NAMES = {
  date: ['date'],
  description: ['description', 'title'],
  category: ['category'],
  cost: ['cost', 'amount'],
  currency: ['currency'],
} as const

function findColumn(header: string[], names: readonly string[]): number {
  return header.findIndex((cell) => names.includes(norm(cell)))
}

/** Parses the text of a Splitwise export. Never throws. */
export function parseSplitwiseCsv(input: string): SplitwiseParseResult {
  const text = input.replace(/^\uFEFF/, '')
  if (text.trim() === '') return fail('This file is empty.')

  const records = tokenizeCsv(text, detectDelimiter(text))
  const headerAt = records.slice(0, 20).findIndex((r) => {
    const cells = r.cells.map(norm)
    return cells.includes('date') && cells.includes('cost') && cells.includes('currency')
  })
  if (headerAt < 0) return fail("This doesn't look like a Splitwise export: the header row (Date, Description, Category, Cost, Currency) wasn't found.")
  const header = records[headerAt]!
  const cols = {
    date: findColumn(header.cells, COLUMN_NAMES.date),
    description: findColumn(header.cells, COLUMN_NAMES.description),
    category: findColumn(header.cells, COLUMN_NAMES.category),
    cost: findColumn(header.cells, COLUMN_NAMES.cost),
    currency: findColumn(header.cells, COLUMN_NAMES.currency),
  }
  const peopleCols: Array<{ col: number; name: string }> = []
  header.cells.forEach((cell, col) => {
    const name = cell.replace(/^\uFEFF/, '').trim()
    if (col > cols.currency && name !== '') peopleCols.push({ col, name })
  })
  if (peopleCols.length === 0) return fail('No person columns were found after the Currency column.')

  const people = peopleCols.map((p) => p.name)
  const warnings: string[] = []
  const issues: ParseIssue[] = []
  const rows: SplitwiseRow[] = []
  const totals: SplitwiseTotal[] = []
  const pending: Array<{ row: SplitwiseRow; date: RawDate }> = []

  const seenNames = new Set<string>()
  for (const name of people) {
    const key = name.toLowerCase()
    if (seenNames.has(key)) warnings.push(`Two people are both called "${name}". They are kept apart by their column.`)
    seenNames.add(key)
  }

  const cell = (record: CsvRecord, col: number) => (col >= 0 ? (record.cells[col] ?? '') : '')

  for (const record of records.slice(headerAt + 1)) {
    if (record.cells.every((c) => c.trim() === '')) continue
    const description = cell(record, cols.description).trim()
    const currency = cell(record, cols.currency).trim().toUpperCase()

    if (/^total balance\b/i.test(description) || /^total balance\b/i.test(cell(record, cols.date).trim())) {
      if (!/^[A-Z]{3}$/.test(currency)) {
        warnings.push(`Line ${record.line}: a "Total balance" row without a currency was ignored.`)
        continue
      }
      const balances = peopleCols.map((p) => {
        const parsed = parseAmount(cell(record, p.col), currency)
        return parsed.kind === 'ok' ? parsed.minor : null
      })
      totals.push({ line: record.line, currency, balances })
      continue
    }

    const issue = (message: string) => issues.push({ line: record.line, message })
    const date = readDate(cell(record, cols.date))
    if (!date) {
      issue(`The date "${cell(record, cols.date).trim()}" isn't one I can read (expected YYYY-MM-DD).`)
      continue
    }
    if (!/^[A-Z]{3}$/.test(currency)) {
      issue(`The currency "${cell(record, cols.currency).trim()}" isn't a 3-letter code.`)
      continue
    }
    const cost = parseAmount(cell(record, cols.cost), currency)
    if (cost.kind !== 'ok') {
      issue(`The cost "${cell(record, cols.cost).trim()}" isn't a number.`)
      continue
    }
    let bad: string | null = null
    const nets = peopleCols.map((p) => {
      const parsed = parseAmount(cell(record, p.col), currency)
      if (parsed.kind === 'bad') bad = `${p.name}: "${cell(record, p.col).trim()}"`
      return parsed.kind === 'ok' ? parsed.minor : 0
    })
    if (bad) {
      issue(`A person's amount isn't a number (${bad}).`)
      continue
    }
    const category = cell(record, cols.category).trim()
    const row: SplitwiseRow = {
      line: record.line,
      date: date.iso ?? '',
      description,
      category,
      currency,
      costMinor: cost.minor,
      nets,
      isPayment: category.toLowerCase() === 'payment',
    }
    rows.push(row)
    pending.push({ row, date })
  }

  // Dates. YYYY-MM-DD is taken as is. For a/b/yyyy, a value above 12 settles the
  // order for that row and for the whole file; with no hint at all the rows are
  // read as day/month and flagged.
  const evidence = { dmy: 0, mdy: 0 }
  for (const { date } of pending) {
    if (date.dmy && !date.ambiguous) evidence.dmy++
    if (date.mdy && !date.ambiguous) evidence.mdy++
  }
  const fileOrder: 'dmy' | 'mdy' | null = evidence.dmy > evidence.mdy ? 'dmy' : evidence.mdy > evidence.dmy ? 'mdy' : null
  const mixed = evidence.dmy > 0 && evidence.mdy > 0
  let guessed = 0
  let example = ''
  for (const { row, date } of pending) {
    if (date.iso) row.date = date.iso
    else {
      const order = fileOrder ?? 'dmy'
      row.date = (order === 'dmy' ? date.dmy : date.mdy) ?? date.dmy ?? date.mdy ?? ''
      if (fileOrder === null || mixed) {
        guessed++
        if (!example) example = `${row.date} (line ${row.line})`
      }
    }
  }
  if (guessed > 0) {
    warnings.push(
      `${guessed} ${guessed === 1 ? 'date is' : 'dates are'} ambiguous (day/month or month/day). ${guessed === 1 ? 'It was' : 'They were'} read as ${
        (fileOrder ?? 'dmy') === 'dmy' ? 'day/month/year' : 'month/day/year'
      }, for example ${example}. Check the dates after importing.`,
    )
  }

  return { ok: true, file: { people, rows, totals, warnings, issues } }
}
