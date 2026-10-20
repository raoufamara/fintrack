import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ErrorState, Screen, Spinner, TopBar } from '../components/Screen'
import { ShowInControl } from '../components/ShowInControl'
import { useDisplayCurrency } from '../hooks/useDisplayCurrency'
import { useTripWatch } from '../hooks/useTripWatch'
import { formatMoney, toMinor } from '../lib/currency'
import { todayISO } from '../lib/dates'
import { EMPTY_FILTER, NO_LOCATION, serializeFilter } from '../lib/filter'
import { computeInsights, type InsightsMode } from '../lib/insights'
import { useCurrentUserId, useTripsStore } from '../store/TripsContext'
import { findCurrentMember } from '../store/selectors'

export function InsightsPage() {
  const { tripId = '' } = useParams()
  const navigate = useNavigate()
  const userId = useCurrentUserId()
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const status = useTripsStore((s) => s.tripStatus[tripId] ?? 'idle')
  const error = useTripsStore((s) => s.tripError[tripId])
  const loadTrip = useTripsStore((s) => s.loadTrip)
  const display = useDisplayCurrency(snapshot)
  const [mode, setMode] = useState<InsightsMode>('group')
  useTripWatch(tripId)

  useEffect(() => {
    if (!snapshot) void loadTrip(tripId)
  }, [loadTrip, tripId, snapshot])

  const me = snapshot ? findCurrentMember(snapshot, userId) : undefined
  const insights = useMemo(
    () =>
      snapshot
        ? computeInsights({
            expenses: snapshot.expenses,
            shares: snapshot.shares,
            defaultCurrency: snapshot.trip.default_currency,
            mode,
            memberId: me?.id ?? null,
            budgetMinor:
              snapshot.trip.budget_amount === null ? null : toMinor(snapshot.trip.budget_amount, snapshot.trip.default_currency),
            tripStart: snapshot.trip.start_date,
            tripEnd: snapshot.trip.end_date,
            today: todayISO(),
          })
        : null,
    [snapshot, mode, me?.id],
  )

  if (!snapshot || !insights) {
    return (
      <Screen>
        <TopBar title="Insights" />
        {status === 'error' ? <ErrorState message={error || 'Could not load this trip.'} onRetry={() => void loadTrip(tripId)} /> : <Spinner />}
      </Screen>
    )
  }

  const currency = snapshot.trip.default_currency
  const catOf = (id: string) => snapshot.categories.find((c) => c.id === id)
  const go = (filter: Partial<typeof EMPTY_FILTER>) =>
    navigate(`/trips/${tripId}?${serializeFilter({ ...EMPTY_FILTER, ...filter }).toString()}`)

  const tile = (label: string, minor: number | null) => {
    if (minor === null) return null
    const shown = display.format(minor)
    return (
      <div key={label} className="flex flex-col gap-0.5 rounded-2xl bg-surface p-3">
        <span className="text-xs font-semibold text-text-muted">{label}</span>
        <span className="text-[17px] font-extrabold tabular-nums">{shown.main}</span>
        {shown.sub && <span className="text-[11px] tabular-nums text-text-muted">{shown.sub}</span>}
      </div>
    )
  }

  const seg = (m: InsightsMode, label: string) => (
    <button
      type="button"
      aria-pressed={mode === m}
      onClick={() => setMode(m)}
      className={`h-9 flex-1 rounded-[10px] text-[13px] ${mode === m ? 'bg-surface font-extrabold shadow-sm' : 'font-bold text-gray-600'}`}
    >
      {label}
    </button>
  )

  return (
    <Screen>
      <TopBar title="Insights" />
      <div className="flex flex-col gap-4 p-4 pb-10">
        <div role="group" aria-label="Show" className="flex rounded-[13px] bg-[#EDEDF0] p-1">
          {seg('group', 'Group total')}
          {seg('mine', 'My share')}
        </div>
        <ShowInControl tripCurrency={currency} display={display} />

        <div className="grid grid-cols-3 gap-2.5">
          {tile('Spent', insights.spent)}
          {tile('Per day', insights.perDay)}
          {tile('Left', insights.left)}
        </div>
        {insights.pendingCount > 0 && (
          <p role="status" className="rounded-[12px] bg-warning-light px-3 py-2.5 text-xs font-semibold text-[#6B4400]">
            {insights.pendingCount} pending {insights.pendingCount === 1 ? 'expense is' : 'expenses are'} not included until the rate arrives.
          </p>
        )}

        {insights.spent === 0 ? (
          <p className="rounded-2xl bg-surface p-4 text-sm text-text-muted">
            {mode === 'mine' ? 'You have no share in any expense yet.' : 'No spending yet.'}
          </p>
        ) : (
          <>
            <section aria-label="By category" className="flex flex-col gap-2.5">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">By category</h2>
              <div className="flex h-3 overflow-hidden rounded-full bg-gray-200" aria-hidden="true">
                {insights.byCategory.map((r) => (
                  <i key={r.key} className="block h-full" style={{ width: `${r.pct}%`, background: `var(--color-tripcat-${catOf(r.key)?.color ?? 'grey'})` }} />
                ))}
              </div>
              <ul className="rounded-[18px] bg-surface px-3.5">
                {insights.byCategory.map((r) => {
                  const c = catOf(r.key)
                  const shown = display.format(r.amount)
                  return (
                    <li key={r.key} className="border-b border-gray-100 last:border-b-0">
                      <button type="button" onClick={() => go({ categoryIds: [r.key] })} className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
                        <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full" style={{ background: `var(--color-tripcat-${c?.color ?? 'grey'})` }} />
                        <span className="min-w-0 flex-1 truncate text-[15px] font-bold">{c?.name ?? 'Unknown'}</span>
                        <span className="text-xs tabular-nums text-text-muted">{r.pct}%</span>
                        <span className="flex w-24 flex-col items-end">
                          <b className="text-sm tabular-nums">{shown.main}</b>
                          {shown.sub && <span className="text-[11px] tabular-nums text-text-muted">{shown.sub}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section aria-label="By place" className="flex flex-col gap-2.5">
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">By place</h2>
              <ul className="rounded-[18px] bg-surface px-3.5">
                {insights.byPlace.map((r) => {
                  const none = r.key === NO_LOCATION
                  const shown = display.format(r.amount)
                  return (
                    <li key={r.key} className="border-b border-gray-100 last:border-b-0">
                      <button type="button" onClick={() => go({ places: [r.key] })} className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
                        <span className={`min-w-0 flex-1 truncate text-[15px] font-bold ${none ? 'text-text-muted' : ''}`}>
                          {none ? 'No location' : r.key}
                        </span>
                        <span className="text-xs tabular-nums text-text-muted">{r.pct}%</span>
                        <span className="flex w-24 flex-col items-end">
                          <b className="text-sm tabular-nums">{shown.main}</b>
                          {shown.sub && <span className="text-[11px] tabular-nums text-text-muted">{shown.sub}</span>}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          </>
        )}

        {insights.byCurrency.length > 0 && (
          <section aria-label="By currency" className="flex flex-col gap-2.5">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">By currency</h2>
            <ul className="rounded-[18px] bg-surface px-3.5">
              {insights.byCurrency.map((r) => (
                <li key={r.currency} className="border-b border-gray-100 py-3 text-sm last:border-b-0">
                  Paid in {r.currency}: <b className="tabular-nums">{formatMoney(r.originalMinor, r.currency)}</b>{' '}
                  <span className="text-text-muted tabular-nums">(= {formatMoney(r.defaultMinor, currency)})</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Screen>
  )
}
