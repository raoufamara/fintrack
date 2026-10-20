import { formatMoney } from './currency'
import { toDisplay } from './money'

/** The currency a member sees amounts in: their own choice, else the home currency, else the trip's. */
export function resolveDisplayCurrency(
  memberCurrency: string | null | undefined,
  homeCurrency: string | null | undefined,
  tripCurrency: string,
): string {
  return memberCurrency || homeCurrency || tripCurrency
}

export interface ShownCurrency {
  currency: string
  /** Latest rate: 1 unit of the trip currency in `currency`. */
  rate: number
}

export interface ShownAmount {
  /** The figure to read first: "≈ CA$9.92" when showing in my currency, else "€6.44". */
  main: string
  /** The trip-currency figure underneath, only when showing in my currency. */
  sub: string | null
}

/**
 * Formats a default-currency amount for display. With `shown` set, the main
 * figure is the approximate conversion (always prefixed with ≈) and the exact
 * trip-currency amount goes underneath. Never persist the converted figure.
 */
export function formatShown(
  minor: number,
  defaultCurrency: string,
  shown: ShownCurrency | null,
  options: { signed?: boolean } = {},
): ShownAmount {
  const sign = options.signed ? (minor > 0 ? '+ ' : minor < 0 ? '– ' : '') : ''
  const abs = options.signed ? Math.abs(minor) : minor
  if (!shown) return { main: `${sign}${formatMoney(abs, defaultCurrency)}`, sub: null }
  const converted = toDisplay(abs, defaultCurrency, shown.currency, shown.rate).minor
  return {
    main: `${sign}≈ ${formatMoney(converted, shown.currency)}`,
    sub: formatMoney(abs, defaultCurrency),
  }
}
