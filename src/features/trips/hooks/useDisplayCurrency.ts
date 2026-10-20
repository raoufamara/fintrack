import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatShown, resolveDisplayCurrency, type ShownAmount } from '../lib/display'
import type { TripSnapshot } from '../services/TripsRepository'
import { useCurrentUserId, useFx, useHomeCurrency } from '../store/TripsContext'

const key = (tripId: string) => `trips:show-mine:${tripId}`

function readPref(tripId: string): boolean {
  try {
    return window.localStorage.getItem(key(tripId)) === '1'
  } catch {
    return false
  }
}

function writePref(tripId: string, on: boolean): void {
  try {
    window.localStorage.setItem(key(tripId), on ? '1' : '0')
  } catch {
    // The choice just is not remembered.
  }
}

export interface DisplayCurrencyState {
  /** The member's resolved "show in" currency. */
  displayCurrency: string
  /** A cached rate exists and the currency differs from the trip's: the control may be shown. */
  available: boolean
  /** Showing amounts in the display currency right now. */
  mine: boolean
  setMine: (on: boolean) => void
  rate: number | null
  ageHours: number
  /** Formats a trip-currency amount for display. */
  format: (minor: number, options?: { signed?: boolean }) => ShownAmount
}

/**
 * Personal display currency (spec 4.12). The preference lives on the member row;
 * the on/off toggle is per device and trip. The rate is the latest cached
 * trip-currency to display-currency rate, applied to final figures only.
 */
export function useDisplayCurrency(snapshot: TripSnapshot | undefined): DisplayCurrencyState {
  const fx = useFx()
  const userId = useCurrentUserId()
  const home = useHomeCurrency()
  const tripId = snapshot?.trip.id ?? ''
  const tripCurrency = snapshot?.trip.default_currency ?? ''
  const me = snapshot?.members.find((m) => m.user_id === userId)
  const displayCurrency = resolveDisplayCurrency(me?.display_currency, home, tripCurrency)

  const [pref, setPref] = useState(() => readPref(tripId))
  const [rate, setRate] = useState<{ rate: number; ageHours: number } | null>(null)

  useEffect(() => setPref(readPref(tripId)), [tripId])
  useEffect(() => {
    if (!tripCurrency || displayCurrency === tripCurrency) {
      setRate(null)
      return
    }
    let cancelled = false
    void fx.getRate(tripCurrency, displayCurrency).then((r) => {
      if (!cancelled) setRate(r ? { rate: r.rate, ageHours: r.ageHours } : null)
    })
    return () => {
      cancelled = true
    }
  }, [fx, tripCurrency, displayCurrency])

  const available = !!tripCurrency && displayCurrency !== tripCurrency && rate !== null
  const mine = available && pref
  const setMine = useCallback(
    (on: boolean) => {
      setPref(on)
      writePref(tripId, on)
    },
    [tripId],
  )
  const shown = useMemo(
    () => (mine && rate ? { currency: displayCurrency, rate: rate.rate } : null),
    [mine, rate, displayCurrency],
  )
  const format = useCallback(
    (minor: number, options?: { signed?: boolean }) => formatShown(minor, tripCurrency, shown, options),
    [tripCurrency, shown],
  )

  return { displayCurrency, available, mine, setMine, rate: rate?.rate ?? null, ageHours: rate?.ageHours ?? 0, format }
}
