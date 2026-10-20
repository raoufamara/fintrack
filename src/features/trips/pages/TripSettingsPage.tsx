import { useEffect, useState } from 'react'
import { ChevronRight, Coins, Eye, Link2, Tag, UserPlus } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { CurrencySheet } from '../components/CurrencySheet'
import { ErrorState, Screen, Spinner, TopBar } from '../components/Screen'
import { formatMoney, getCurrency } from '../lib/currency'
import { formatInviteCode, inviteLink } from '../lib/invite'
import { resolveDisplayCurrency } from '../lib/display'
import { planCurrencyChange, type CurrencyChangePlan } from '../services/currencyChange'
import { shareText } from '../services/share'
import { useCurrentUserId, useFx, useHomeCurrency, useTripsStore } from '../store/TripsContext'
import { findCurrentMember } from '../store/selectors'

/** Minimal settings screen. Members and sharing arrive in later phases. */
export function TripSettingsPage() {
  const navigate = useNavigate()
  const { tripId = '' } = useParams()
  const fx = useFx()
  const userId = useCurrentUserId()
  const home = useHomeCurrency()
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const status = useTripsStore((s) => s.tripStatus[tripId] ?? 'idle')
  const error = useTripsStore((s) => s.tripError[tripId])
  const loadTrip = useTripsStore((s) => s.loadTrip)
  const setDefaultCurrency = useTripsStore((s) => s.setDefaultCurrency)
  const showToast = useTripsStore((s) => s.showToast)
  const addMember = useTripsStore((s) => s.addMember)
  const setDisplayCurrency = useTripsStore((s) => s.setDisplayCurrency)
  const setShareEnabled = useTripsStore((s) => s.setShareEnabled)
  const rotateShareToken = useTripsStore((s) => s.rotateShareToken)

  const [picking, setPicking] = useState(false)
  const [pickingDisplay, setPickingDisplay] = useState(false)
  const [personName, setPersonName] = useState('')
  const [personError, setPersonError] = useState<string | null>(null)
  const [manualLink, setManualLink] = useState<string | null>(null)
  const [manualShareLink, setManualShareLink] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
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

  const me = findCurrentMember(snapshot, userId)
  const display = resolveDisplayCurrency(me?.display_currency, home, current)
  const code = snapshot.trip.invite_code

  const copyLink = async () => {
    const link = inviteLink(window.location.origin, code)
    const outcome = await shareText(link, `Join ${snapshot.trip.name}`)
    if (outcome === 'copied') showToast('info', 'Invite link copied')
    if (outcome === 'manual') setManualLink(link)
  }

  const shareUrl = `${window.location.origin}/t/${snapshot.trip.share_token}`
  const copyShareLink = async () => {
    const outcome = await shareText(shareUrl, `${snapshot.trip.name} (view only)`)
    if (outcome === 'copied') showToast('info', 'View-only link copied')
    if (outcome === 'manual') setManualShareLink(shareUrl)
  }
  const confirmReset = async () => {
    setResetting(false)
    const res = await rotateShareToken(tripId)
    if (res.ok) showToast('info', 'Link reset. The old link no longer works.')
  }

  const submitPerson = async (event: React.FormEvent) => {
    event.preventDefault()
    const res = await addMember(tripId, personName)
    if (res.ok) {
      setPersonName('')
      setPersonError(null)
    } else setPersonError(res.error ?? 'Could not add')
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
        <div className="flex flex-col divide-y divide-gray-100 rounded-2xl bg-surface">
          <button
            type="button"
            onClick={() => setPickingDisplay(true)}
            className="flex min-h-14 w-full items-center gap-3 px-4 text-left"
          >
            <Coins size={20} aria-hidden="true" className="text-primary" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-bold">My display currency</span>
              <span className="text-xs text-text-muted">Only you see your display currency.</span>
            </span>
            <span className="text-sm font-semibold text-text-muted">{display}</span>
            <ChevronRight size={18} aria-hidden="true" className="text-text-muted" />
          </button>
        </div>

        <section aria-label="Share view-only link" className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
          <div className="flex items-center gap-3">
            <Eye size={20} aria-hidden="true" className="text-primary" />
            <span className="flex-1 text-[15px] font-bold">Share view-only link</span>
            <button
              type="button"
              role="switch"
              aria-checked={snapshot.trip.share_enabled}
              aria-label="Share view-only link"
              onClick={() => void setShareEnabled(tripId, !snapshot.trip.share_enabled)}
              className={`relative h-7 w-12 rounded-full transition-colors ${snapshot.trip.share_enabled ? 'bg-primary' : 'bg-gray-300'}`}
            >
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${snapshot.trip.share_enabled ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>
          <p className="text-xs leading-relaxed text-text-muted">
            Anyone with the view-only link sees expenses, places and balances without an account. They can’t change anything.
          </p>
          {snapshot.trip.share_enabled && (
            <div className="flex flex-col gap-2">
              <button type="button" onClick={() => void copyShareLink()} className="h-12 w-full rounded-full border border-gray-300 bg-surface text-[15px] font-bold">
                Copy view-only link
              </button>
              {manualShareLink && (
                <input
                  readOnly
                  aria-label="View-only link"
                  value={manualShareLink}
                  onFocus={(e) => e.currentTarget.select()}
                  className="h-11 w-full rounded-[12px] border border-gray-300 bg-surface px-3 text-sm"
                />
              )}
              <div className="flex gap-2">
                <button type="button" onClick={() => navigate(`/t/${snapshot.trip.share_token}`)} className="h-11 flex-1 rounded-full border border-gray-300 bg-surface text-sm font-bold">
                  Preview as a guest
                </button>
                <button type="button" onClick={() => setResetting(true)} className="h-11 flex-1 rounded-full border border-[#F3C3BF] bg-surface text-sm font-bold text-[#C4271D]">
                  Reset link
                </button>
              </div>
            </div>
          )}
        </section>

        <section aria-label="Invite people" className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
          <div className="flex items-center gap-3">
            <Link2 size={20} aria-hidden="true" className="text-primary" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-bold">Invite people</span>
              <span className="text-xs text-text-muted">They join with a free account.</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-3 rounded-[12px] bg-background px-3.5 py-3">
            <span className="text-xs font-semibold text-text-muted">Invite code</span>
            <b aria-label="Invite code" className="font-mono text-lg tracking-widest">{formatInviteCode(code)}</b>
          </div>
          <button
            type="button"
            onClick={() => void copyLink()}
            className="h-12 w-full rounded-full border border-gray-300 bg-surface text-[15px] font-bold"
          >
            Copy invite link
          </button>
          {manualLink && (
            <input
              readOnly
              aria-label="Invite link"
              value={manualLink}
              onFocus={(e) => e.currentTarget.select()}
              className="h-11 w-full rounded-[12px] border border-gray-300 bg-surface px-3 text-sm"
            />
          )}
        </section>

        <section aria-label="Add person" className="flex flex-col gap-3 rounded-2xl bg-surface p-4">
          <div className="flex items-center gap-3">
            <UserPlus size={20} aria-hidden="true" className="text-primary" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-[15px] font-bold">Add person</span>
              <span className="text-xs text-text-muted">By name. They can claim it later from the invite link.</span>
            </div>
          </div>
          <form onSubmit={submitPerson} noValidate className="flex gap-2">
            <input
              value={personName}
              maxLength={40}
              placeholder="Name"
              aria-label="Name of the person to add"
              onChange={(e) => {
                setPersonName(e.target.value)
                setPersonError(null)
              }}
              className="h-12 w-full min-w-0 rounded-[12px] border border-gray-300 bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-2 focus:border-primary focus:px-[13px]"
            />
            <button type="submit" className="h-12 shrink-0 rounded-full bg-primary px-5 text-sm font-bold text-white">
              Add
            </button>
          </form>
          {personError && (
            <p role="alert" className="-mt-1 text-xs font-bold text-error">
              {personError}
            </p>
          )}
          <ul aria-label="People" className="flex flex-wrap gap-2">
            {snapshot.members.map((m) => (
              <li key={m.id} className="rounded-full bg-background px-3 py-1.5 text-[13px] font-bold">
                {m.id === me?.id ? 'You' : m.display_name}
              </li>
            ))}
          </ul>
        </section>
        <p className="px-1 text-xs text-text-muted">More settings are coming soon.</p>
      </div>

      <CurrencySheet
        open={picking}
        onClose={() => setPicking(false)}
        onSelect={(code) => void choose(code)}
        title="Default currency"
        selected={current}
      />

      <CurrencySheet
        open={pickingDisplay}
        onClose={() => setPickingDisplay(false)}
        onSelect={(code) => me && void setDisplayCurrency(tripId, me.id, code === home ? null : code)}
        title="My display currency"
        selected={display}
      />

      <BottomSheet open={resetting} onClose={() => setResetting(false)} title="Reset the link?">
        <p className="text-sm leading-relaxed text-text-muted">
          Old links stop working. Anyone who has one will need the new link to see the trip.
        </p>
        <div className="flex gap-2.5">
          <button type="button" onClick={() => setResetting(false)} className="h-14 flex-1 rounded-full border border-gray-300 bg-surface text-base font-bold">
            Cancel
          </button>
          <button type="button" onClick={() => void confirmReset()} className="h-14 flex-1 rounded-full bg-error text-base font-bold text-white">
            Reset link
          </button>
        </div>
      </BottomSheet>

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
