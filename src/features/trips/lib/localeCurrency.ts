import { CURRENCIES } from './currency'

/** The currency of the browser locale's region ("en-CA" gives CAD), or null when it cannot be told. */
export function currencyForLocale(locale: string | undefined): string | null {
  if (!locale) return null
  try {
    const region = new Intl.Locale(locale).maximize().region
    if (!region) return null
    const country = new Intl.DisplayNames(['en'], { type: 'region' }).of(region)
    if (!country) return null
    return CURRENCIES.find((c) => c.countries.includes(country))?.code ?? null
  } catch {
    return null
  }
}

const KEY = 'trips:guest-display-currency'

/** A guest's display currency: remembered on this device, else derived from the locale. */
export function guestDisplayCurrency(locale: string | undefined = typeof navigator === 'undefined' ? undefined : navigator.language): string | null {
  try {
    const saved = window.localStorage.getItem(KEY)
    if (saved) return saved
  } catch {
    // storage blocked: derive each time
  }
  const derived = currencyForLocale(locale)
  if (derived) {
    try {
      window.localStorage.setItem(KEY, derived)
    } catch {
      // not remembered
    }
  }
  return derived
}
