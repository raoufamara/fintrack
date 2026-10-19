import currenciesData from './currencies.json'

export interface CurrencyInfo {
  code: string
  name: string
  symbol: string
  minorUnits: number
  countries: string[]
}

export const CURRENCIES: readonly CurrencyInfo[] = currenciesData

const BY_CODE: ReadonlyMap<string, CurrencyInfo> = new Map(
  CURRENCIES.map((c) => [c.code, c]),
)

const DEFAULT_MINOR_UNITS = 2

export function getCurrency(code: string): CurrencyInfo | undefined {
  return BY_CODE.get(code.toUpperCase())
}

/** Number of decimal places of the currency (JPY 0, EUR 2, KWD 3). Unknown codes use 2. */
export function minorUnits(code: string): number {
  return getCurrency(code)?.minorUnits ?? DEFAULT_MINOR_UNITS
}

/**
 * Parses a user-entered decimal amount into integer minor units.
 * Accepts "12.5", "12,50", " 1 234.5 " and numbers. Digits beyond the
 * currency's precision are rounded half up on the decimal string, so
 * 1.005 EUR is 101 cents regardless of binary floating point.
 * Throws RangeError on input that is not a finite number.
 */
export function toMinor(input: string | number, code: string): number {
  const m = minorUnits(code)
  let text: string
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new RangeError(`Invalid amount: ${input}`)
    text = input.toFixed(m + 6)
  } else {
    text = input.replace(/\s/g, '')
    // A single comma with no dot is a decimal separator ("12,50"); otherwise commas are grouping.
    const commas = text.split(',').length - 1
    text = commas === 1 && !text.includes('.') ? text.replace(',', '.') : text.replace(/,/g, '')
  }
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(text)
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) {
    throw new RangeError(`Invalid amount: ${String(input)}`)
  }
  const sign = match[1] === '-' ? -1 : 1
  const intPart = match[2] || '0'
  const frac = match[3] ?? ''
  const kept = frac.slice(0, m).padEnd(m, '0')
  let minor = Number(intPart + kept)
  if (frac.length > m && Number(frac.charAt(m)) >= 5) minor += 1
  return sign * minor
}

/** Integer minor units to a plain decimal number in major units. */
export function fromMinor(minor: number, code: string): number {
  return minor / 10 ** minorUnits(code)
}

/** Formats minor units with Intl.NumberFormat, e.g. "€12.50" or "¥1,200". */
export function formatMoney(minor: number, code: string, locale?: string): string {
  const m = minorUnits(code)
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: code,
    minimumFractionDigits: m,
    maximumFractionDigits: m,
  }).format(minor / 10 ** m)
}
