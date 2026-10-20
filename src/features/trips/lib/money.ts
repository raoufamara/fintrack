import { fromMinor, minorUnits, toMinor } from './currency'

export type SplitMode = 'equal' | 'exact' | 'shares'

/**
 * Splits `total` into integer parts proportional to non-negative integer
 * `weights` using the largest remainder method. The parts always sum to `total`.
 * Leftover units go to the largest fractional remainders; ties are broken by
 * ascending key, so the result never depends on input order.
 */
export function allocate(
  total: number,
  weights: ReadonlyMap<string, number>,
): Map<string, number> {
  if (!Number.isSafeInteger(total) || total < 0) {
    throw new RangeError(`Total must be a non-negative integer, got ${total}`)
  }
  if (weights.size === 0) throw new RangeError('At least one member is required')
  const keys = [...weights.keys()].sort(compareKeys)
  let weightSum = 0n
  for (const k of keys) {
    const w = weights.get(k) ?? 0
    if (!Number.isSafeInteger(w) || w < 0) {
      throw new RangeError(`Invalid weight for ${k}: ${w}`)
    }
    weightSum += BigInt(w)
  }
  if (weightSum === 0n) throw new RangeError('Weights must not all be zero')

  const bigTotal = BigInt(total)
  const parts = new Map<string, number>()
  const remainders: Array<{ key: string; rem: bigint }> = []
  let used = 0n
  for (const k of keys) {
    const scaled = bigTotal * BigInt(weights.get(k) ?? 0)
    const floor = scaled / weightSum
    used += floor
    parts.set(k, Number(floor))
    remainders.push({ key: k, rem: scaled % weightSum })
  }
  // keys are already sorted, and Array.sort is stable: ties keep ascending key order.
  remainders.sort((a, b) => (a.rem === b.rem ? 0 : a.rem > b.rem ? -1 : 1))
  const leftover = Number(bigTotal - used)
  for (let i = 0; i < leftover; i++) {
    const entry = remainders[i]
    if (!entry) break
    parts.set(entry.key, (parts.get(entry.key) ?? 0) + 1)
  }
  return parts
}

function compareKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Splits an expense total (integer minor units of its own currency) between members.
 *
 * - `equal`: floor division, leftover units to members in ascending id order.
 * - `shares`: proportional to `weights` (decimals up to 3 places), largest remainder.
 * - `exact`: `exact` holds each member's minor units and must sum to the total,
 *   otherwise this throws.
 */
export function splitAmount(
  totalMinor: number,
  mode: SplitMode,
  memberIds: readonly string[],
  weights?: Readonly<Record<string, number>>,
  exact?: Readonly<Record<string, number>>,
): Map<string, number> {
  if (!Number.isSafeInteger(totalMinor) || totalMinor < 0) {
    throw new RangeError(`Total must be a non-negative integer, got ${totalMinor}`)
  }
  if (memberIds.length === 0) throw new RangeError('At least one member is required')
  if (new Set(memberIds).size !== memberIds.length) {
    throw new RangeError('Duplicate member ids')
  }

  switch (mode) {
    case 'equal':
      return allocate(totalMinor, new Map(memberIds.map((id) => [id, 1])))
    case 'shares': {
      const w = new Map<string, number>()
      for (const id of memberIds) {
        const value = weights?.[id]
        if (value === undefined || !Number.isFinite(value) || value < 0) {
          throw new RangeError(`Missing or invalid weight for member ${id}`)
        }
        w.set(id, Math.round(value * 1000))
      }
      return allocate(totalMinor, w)
    }
    case 'exact': {
      const parts = new Map<string, number>()
      let sum = 0
      for (const id of memberIds) {
        const value = exact?.[id]
        if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
          throw new RangeError(`Missing or invalid exact amount for member ${id}`)
        }
        parts.set(id, value)
        sum += value
      }
      if (sum !== totalMinor) {
        throw new RangeError(`Exact amounts sum to ${sum}, expected ${totalMinor}`)
      }
      return parts
    }
  }
}

/** Rounds half to even ("banker's rounding"). Tolerates float noise around .5. */
export function roundHalfEven(x: number): number {
  const floor = Math.floor(x)
  const diff = x - floor
  if (Math.abs(diff - 0.5) < 1e-9) return floor % 2 === 0 ? floor : floor + 1
  return Math.round(x)
}

/** Converts integer minor units between currencies with banker's rounding. */
export function convertMinor(
  amountMinor: number,
  from: string,
  to: string,
  rate: number,
): number {
  if (from === to) return amountMinor
  return roundHalfEven(amountMinor * rate * 10 ** (minorUnits(to) - minorUnits(from)))
}

/**
 * Converts an expense amount to the trip default currency.
 * `fxRate` is the value of 1 unit of `currency` in the default currency.
 */
export function toDefault(
  amountMinor: number,
  currency: string,
  fxRate: number,
  defaultCurrency: string,
): number {
  return convertMinor(amountMinor, currency, defaultCurrency, fxRate)
}

/**
 * Converts a default-currency figure to the viewer's display currency.
 * Display only: the result is approximate and must never be persisted.
 */
export function toDisplay(
  amountMinorDefault: number,
  defaultCurrency: string,
  displayCurrency: string,
  rate: number,
): { minor: number; approx: true } {
  return {
    minor: convertMinor(amountMinorDefault, defaultCurrency, displayCurrency, rate),
    approx: true,
  }
}

/**
 * The expense total in the default currency as a decimal (what `amount_default`
 * stores), or null while the rate is pending. Uses banker's rounding to the
 * default currency's minor units, exactly like `toDefault`.
 *
 * Note: the SQL function computes `round(amount * fx_rate, 2)` (half away from
 * zero, always 2 decimals). It differs only for exact halves and for 0/3-decimal
 * default currencies. Balances and totals never read `amount_default`; they
 * re-derive from amount and rate with `toDefault`.
 */
export function amountDefault(
  amount: number,
  currency: string,
  fxRate: number | null,
  defaultCurrency: string,
): number | null {
  if (currency === defaultCurrency) return fromMinor(toMinor(amount, currency), currency)
  if (fxRate === null) return null
  return fromMinor(toDefault(toMinor(amount, currency), currency, fxRate, defaultCurrency), defaultCurrency)
}
