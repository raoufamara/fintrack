import { toMinor } from '../lib/currency'
import { toDefault } from '../lib/money'
import type { FxService } from './fxService'
import type { RatesPayload, TripSnapshot } from './TripsRepository'

export interface CurrencyChangePlan {
  /** Payload for `setDefaultCurrency`. */
  rates: RatesPayload
  /** Group total in the new currency, minor units, pending expenses excluded. */
  newTotal: number
  /** Currencies whose rate is unavailable (offline and not cached). Non-empty means: block. */
  missing: string[]
  /** Pending expenses that still have no rate; they stay pending after the change. */
  stillPending: number
}

/**
 * Collects the rate of every expense currency on its date (plus what the
 * settlements and the budget need), and previews the new group total.
 */
export async function planCurrencyChange(
  snap: TripSnapshot,
  newCurrency: string,
  fx: FxService,
): Promise<CurrencyChangePlan> {
  const oldCurrency = snap.trip.default_currency
  const rates: RatesPayload = {}
  const missing = new Set<string>()
  let newTotal = 0
  let stillPending = 0

  const put = (ccy: string, date: string, rate: number) => {
    ;(rates[ccy] ??= {})[date] = rate
  }

  for (const e of snap.expenses) {
    const minor = toMinor(e.amount, e.currency)
    if (e.currency === newCurrency) {
      newTotal += minor
      continue
    }
    const wasPending = e.fx_rate === null && e.currency !== oldCurrency
    const r = await fx.getRate(e.currency, newCurrency, e.date)
    if (!r) {
      if (wasPending) stillPending += 1
      else missing.add(e.currency)
      continue
    }
    put(e.currency, e.date, r.rate)
    newTotal += toDefault(minor, e.currency, r.rate, newCurrency)
  }

  // Settlements and the budget are stated in the old default currency.
  const latestOld = await fx.getRate(oldCurrency, newCurrency)
  if (latestOld) put(oldCurrency, 'latest', latestOld.rate)
  const needsOld = snap.trip.budget_amount !== null || snap.settlements.some((s) => s.currency !== newCurrency)
  if (needsOld && !latestOld) missing.add(oldCurrency)

  return { rates, newTotal, missing: [...missing], stillPending }
}
