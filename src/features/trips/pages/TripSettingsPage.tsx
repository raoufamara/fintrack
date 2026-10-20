import { useEffect, useState } from 'react'
import { ChevronRight, Coins, Tag } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { CurrencySheet } from '../components/CurrencySheet'
import { ErrorState, Screen, Spinner, TopBar } from '../components/Screen'
import { formatMoney, getCurrency } from '../lib/currency'
import { planCurrencyChange, type CurrencyChangePlan } from '../services/currencyChange'
import { useFx, useTripsStore } from '../store/TripsContext'

/** Minimal settings screen. Members and sharing arrive in later phases. */
export function TripSettingsPage() {
  const navigate = useNavigate()
  const { tripId = '' } = useParams()
  const fx = useFx()
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const status = useTripsStore((s) => s.tripStatus[tripId] ?? 'idle')
  const error = useTripsStore((s) => s.tripError[tripId])
  const loadTrip = useTripsStore((s) => s.loadTrip)
  const setDefaultCurrency = useTripsStore((s) => s.setDefaultCurrency)
  const showToast = useTripsStore((s) => s.showToast)

  const [picking, setPicking] = useState(false)
  const [change, setChange] = useState<{ currency: string; plan: CurrencyChangePlan | null } | null>(null)
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  useEffect(() => {
    if (!snapshot) void loadTrip(tripId)
  }, [loadTrip, tripId, snapshot])

  if (!snapshot) {
    return (
      <Screen>
        <TopBar title="Trip settings" />
        {status === 'error' ? <ErrorState message={error || 'Could not load this trip.'} onRetry={() => void loadTrip(tripId)} /> : <Spinner />}
      </Screen>
    )
  }

  const current = snapshot.trip.default_currency

  const choose = async (code: string) => {
    if (code === current) return
    setFailure(null)
    setChange({ currency: code, plan: null })
    setChange({ currency: code, plan: await planCurrencyChange(snapshot, code, fx) })
  }

  const confirm = async () => {
    if (!change?.plan || change.plan.missing.length > 0 || saving) return
    setSaving(true)
    const res = await setDefaultCurrency(tripId, change.currency, change.plan.rates)
    setSaving(false)
    if (res.ok) {
      showToast('info', `Default currency is now ${change.currency}`)
      setChange(null)
    } else setFailure(res.error ?? 'Could not change the currency')
  }

  const plan = change?.plan ?? null
  return (
    <Screen>
      <TopBar title="Trip settings" />
      <div className="flex flex-col gap-4 p-4">
        <div className="flex flex-col divide-y divide-gray-100 rounded-2xl bg-surface">
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex min-h-14 w-full items-center gap-3 px-4 text-left"
          >
            <Coins size={20} aria-hidden="true" className="text-primary" />
            <span className="flex-1 text-[15px] font-bold">Default currency</span>
            <span className="text-sm font-semibold text-text-muted">{current}</span>
            <ChevronRight size={18} aria-hidden="true" className="text-text-muted" />
          </button>
          <button
            type="button"
            onClick={() => navigate(`/trips/${tripId}/categories`)}
            className="flex min-h-14 w-full items-center gap-3 px-4 text-left"
          >
            <Tag size={20} aria-hidden="true" className="text-primary" />
            <span className="flex-1 text-[15px] font-bold">Categories</span>
            <ChevronRight size={18} aria-hidden="true" className="text-text-muted" />
          </button>
        </div>
        <p className="px-1 text-xs text-text-muted">More settings are coming soon.</p>
      </div>

      <CurrencySheet
        open={picking}
        onClose={() => setPicking(false)}
        onSelect={(code) => void choose(code)}
        title="Default currency"
        selected={current}
      />

      <BottomSheet
        open={change !== null}
        onClose={() => setChange(null)}
        title={`Change to ${change?.currency ?? ''}?`}
      >
        {!plan ? (
          <p role="status" className="text-sm text-text-muted">Looking up rates…</p>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-text-muted">
              Totals and balances will be shown in {change?.currency} ({getCurrency(change?.currency ?? '')?.name}).
              Every expense is re-converted at the rate for its date.
            </p>
            {plan.missing.length === 0 && (
              <div className="rounded-2xl bg-background p-4">
                <div className="text-xs font-semibold text-text-muted">New group total</div>
                <div className="text-2xl font-extrabold tabular-nums">
                  {formatMoney(plan.newTotal, change?.currency ?? current)}
                </div>
                {plan.stillPending > 0 && (
                  <div className="mt-1 text-xs text-text-muted">
                    {plan.stillPending} pending {plan.stillPending === 1 ? 'expense stays' : 'expenses stay'} pending.
                  </div>
                )}
              </div>
            )}
            {plan.missing.length > 0 && (
              <p role="alert" className="rounded-[12px] bg-warning-light px-3 py-2.5 text-sm font-semibold text-[#6B4400]">
                Rates for {plan.missing.join(', ')} aren’t available right now. Connect to the internet and try again.
              </p>
            )}
            {failure && (
              <p role="alert" className="text-xs font-bold text-error">
                {failure}
              </p>
            )}
            <div className="flex gap-2.5">
              <button
                type="button"
                onClick={() => setChange(null)}
                className="h-14 flex-1 rounded-full border border-gray-300 bg-surface text-base font-bold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirm}
                disabled={plan.missing.length > 0 || saving}
                className="h-14 flex-1 rounded-full bg-primary text-base font-bold text-white disabled:bg-[#C9C2DA]"
              >
                Change currency
              </button>
            </div>
          </>
        )}
      </BottomSheet>
    </Screen>
  )
}
