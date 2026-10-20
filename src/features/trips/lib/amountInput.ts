import { fromMinor, minorUnits } from './currency'

/**
 * Cleans what a user types into an amount field: keeps digits and one decimal
 * separator, and cuts the fraction to the currency's minor units
 * (so JPY accepts no decimals and KWD accepts three).
 */
export function sanitizeAmountInput(text: string, currency: string): string {
  const max = minorUnits(currency)
  let out = ''
  let seenSeparator = false
  for (const ch of text) {
    if (ch >= '0' && ch <= '9') out += ch
    else if ((ch === '.' || ch === ',') && !seenSeparator && max > 0) {
      seenSeparator = true
      out += '.'
    }
  }
  const dot = out.indexOf('.')
  return dot >= 0 ? out.slice(0, dot + 1 + max) : out
}

/** Minor units as an editable plain string ("12.50", "1200"). */
export function minorToInput(minor: number, currency: string): string {
  return fromMinor(minor, currency).toFixed(minorUnits(currency))
}
