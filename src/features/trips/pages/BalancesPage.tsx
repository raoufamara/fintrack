import { useParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { BottomSheet } from '../components/BottomSheet'
import { MemberAvatar } from '../components/MemberAvatar'
import { ErrorState, Screen, Spinner, TopBar } from '../components/Screen'
import { ShowInControl } from '../components/ShowInControl'
import { useDisplayCurrency } from '../hooks/useDisplayCurrency'
import { useTripWatch } from '../hooks/useTripWatch'
import { computeBalances, suggestTransfers } from '../lib/balances'
import { formatMoney, toMinor } from '../lib/currency'
import { formatDay } from '../lib/dates'
import { remindMessage } from '../lib/invite'
import { transferSentence } from '../lib/transfers'
import { shareText } from '../services/share'
import { useCurrentUserId, useTripsStore } from '../store/TripsContext'
import { findCurrentMember } from '../store/selectors'
import type { Transfer } from '../types'

export function BalancesPage() {
  const { tripId = '' } = useParams()
  const userId = useCurrentUserId()
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const status = useTripsStore((s) => s.tripStatus[tripId] ?? 'idle')
  const error = useTripsStore((s) => s.tripError[tripId])
  const unsynced = useTripsStore((s) => s.unsynced)
  const loadTrip = useTripsStore((s) => s.loadTrip)
  const recordSettlement = useTripsStore((s) => s.recordSettlement)
  const showToast = useTripsStore((s) => s.showToast)
  const display = useDisplayCurrency(snapshot)
  const [paying, setPaying] = useState<Transfer | null>(null)
  const [manualText, setManualText] = useState<string | null>(null)
  useTripWatch(tripId)

  useEffect(() => {
    if (!snapshot) void loadTrip(tripId)
  }, [loadTrip, tripId, snapshot])

  const result = useMemo(
    () =>
      snapshot
        ? computeBalances(snapshot.expenses, snapshot.shares, snapshot.settlements, snapshot.trip.default_currency)
        : null,
    [snapshot],
  )

  if (!snapshot || !result) {
    return (
      <Screen>
        <TopBar title="Balances" />
        {status === 'error' ? <ErrorState message={error || 'Could not load this trip.'} onRetry={() => void loadTrip(tripId)} /> : <Spinner />}
      </Screen>
    )
  }

  const { trip, members } = snapshot
  const currency = trip.default_currency
  const me = findCurrentMember(snapshot, userId)
  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? '?'
  const who = (id: string) => (id === me?.id ? 'You' : name(id))
  const rows = members
    .map((m) => ({ member: m, balance: result.balances.get(m.id) ?? 0 }))
    .sort((a, b) => b.balance - a.balance || a.member.display_name.localeCompare(b.member.display_name))
  const transfers = suggestTransfers(result.balances, me?.id)
  const settled = transfers.length === 0
  const settlements = [...snapshot.settlements].sort((a, b) => (a.created_at < b.created_at ? 1 : -1))

  const remind = async (t: Transfer) => {
    const text = remindMessage(name(t.from), name(t.to), formatMoney(t.amount, currency), trip.name)
    const outcome = await shareText(text, `${trip.name}: payment reminder`)
    if (outcome === 'copied') showToast('info', 'Reminder copied. Paste it into a chat.')
    if (outcome === 'manual') setManualText(text)
  }

  const confirmPaid = async () => {
    const t = paying
    if (!t) return
    setPaying(null)
    await recordSettlement(trip.id, t.from, t.to, t.amount)
  }

  return (
    <Screen>
      <TopBar title="Balances" />
      <div className="flex flex-col gap-4 p-4 pb-10">
        <ShowInControl tripCurrency={currency} display={display} />

        {result.pendingIds.length > 0 && (
          <p role="status" className="rounded-[12px] bg-warning-light px-3 py-2.5 text-xs font-semibold leading-relaxed text-[#6B4400]">
            {result.pendingIds.length} {result.pendingIds.length === 1 ? 'expense is' : 'expenses are'} waiting for an
            exchange rate and {result.pendingIds.length === 1 ? 'isn’t' : 'aren’t'} counted yet.
          </p>
        )}

        <section aria-label="Net balance" className="flex flex-col gap-2">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">Net balance</h2>
          <ul className="rounded-[18px] bg-surface px-3.5">
            {rows.map(({ member, balance }) => {
              const amount = display.format(Math.abs(balance))
              return (
                <li key={member.id} className="flex items-center gap-3 border-b border-gray-100 py-3 last:border-b-0">
                  <MemberAvatar name={member.display_name} color={member.color} size={36} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[15px] font-bold">{who(member.id)}</span>
                    <span className={`text-xs font-bold ${balance > 0 ? 'text-success' : balance < 0 ? 'text-owe' : 'text-text-muted'}`}>
                      {balance > 0 ? 'gets back' : balance < 0 ? 'owes' : 'settled'}
                    </span>
                  </span>
                  {balance !== 0 && (
                    <span className="flex flex-col items-end">
                      <b className={`text-[15px] font-extrabold tabular-nums ${balance > 0 ? 'text-success' : 'text-owe'}`}>
                        {amount.main}
                      </b>
                      {amount.sub && <span className="text-xs tabular-nums text-text-muted">{amount.sub}</span>}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

        <section aria-label="How to settle up" className="flex flex-col gap-2">
          <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">How to settle up</h2>
          {settled ? (
            <p className="rounded-[18px] bg-surface p-4 text-sm font-bold">Everyone is settled up</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {transfers.map((t) => {
                const mine = t.from === me?.id || t.to === me?.id
                const amount = display.format(t.amount)
                const sentence = transferSentence(name(t.from), name(t.to), t.from === me?.id)
                return (
                  <li
                    key={`${t.from}-${t.to}`}
                    aria-label={sentence}
                    className={`flex flex-col gap-2.5 rounded-[18px] p-3.5 ${mine ? 'border-2 border-primary bg-primary-tint' : 'bg-surface'}`}
                  >
                    <div className="flex items-center gap-3">
                      <MemberAvatar name={name(t.from)} color={members.find((m) => m.id === t.from)?.color ?? '#ddd'} size={32} />
                      <span className="min-w-0 flex-1 text-[15px] font-bold">
                        {sentence}
                      </span>
                      <span className="flex flex-col items-end">
                        <b className="text-[15px] font-extrabold tabular-nums">{amount.main}</b>
                        {amount.sub && <span className="text-xs tabular-nums text-text-muted">{amount.sub}</span>}
                      </span>
                    </div>
                    {display.mine && t.from === me?.id && (
                      <p className="text-xs text-text-muted">{amount.main} on your card</p>
                    )}
                    <div className="flex gap-2">
                      {mine && (
                        <button
                          type="button"
                          onClick={() => setPaying(t)}
                          className="h-11 flex-1 rounded-full bg-primary text-sm font-bold text-white"
                        >
                          Mark as paid
                        </button>
                      )}
                      {(!mine || t.to === me?.id) && (
                        <button
                          type="button"
                          onClick={() => void remind(t)}
                          className="h-11 flex-1 rounded-full border border-gray-300 bg-surface text-sm font-bold"
                        >
                          Remind
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {settlements.length > 0 && (
          <section aria-label="Payments recorded" className="flex flex-col gap-2">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">Payments recorded</h2>
            <ul className="rounded-[18px] bg-surface px-3.5">
              {settlements.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 border-b border-gray-100 py-3 text-sm last:border-b-0">
                  <span className="min-w-0">
                    <b>{who(s.from_member)}</b> paid <b>{who(s.to_member)}</b>
                    <span className="block text-xs text-text-muted">
                      {formatDay(s.created_at.slice(0, 10))}
                      {unsynced[s.id] ? ' · not synced' : ''}
                    </span>
                  </span>
                  <b className="shrink-0 tabular-nums">{formatMoney(toMinor(s.amount, s.currency), s.currency)}</b>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="px-1 text-xs leading-relaxed text-text-muted">
          Fewest transfers to bring everyone to zero. Converted to {currency} at the rate saved on each expense.
        </p>
      </div>

      <BottomSheet open={paying !== null} onClose={() => setPaying(null)} title="Mark as paid?">
        {paying && (
          <>
            <p className="text-sm leading-relaxed text-text-muted">
              Record that {who(paying.from)} paid {who(paying.to)} {formatMoney(paying.amount, currency)}. Balances
              update for everyone on the trip.
            </p>
            <div className="flex gap-2.5">
              <button type="button" onClick={() => setPaying(null)} className="h-14 flex-1 rounded-full border border-gray-300 bg-surface text-base font-bold">
                Cancel
              </button>
              <button type="button" onClick={() => void confirmPaid()} className="h-14 flex-1 rounded-full bg-primary text-base font-bold text-white">
                Mark as paid
              </button>
            </div>
          </>
        )}
      </BottomSheet>

      <BottomSheet open={manualText !== null} onClose={() => setManualText(null)} title="Send this reminder">
        <p className="text-sm text-text-muted">Sharing isn’t available here. Select the text and copy it.</p>
        <textarea
          readOnly
          aria-label="Reminder text"
          value={manualText ?? ''}
          rows={3}
          onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-[12px] border border-gray-300 bg-surface p-3 text-[15px]"
        />
      </BottomSheet>
    </Screen>
  )
}



