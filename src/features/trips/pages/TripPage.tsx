import { useEffect, useMemo } from 'react'
import { ChevronLeft, PieChart, Plus, Scale, Settings } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { ExpenseRow } from '../components/ExpenseRow'
import { MemberAvatar } from '../components/MemberAvatar'
import { ErrorState, Screen, Spinner } from '../components/Screen'
import { formatMoney, toMinor } from '../lib/currency'
import { formatDay, formatRange, todayISO } from '../lib/dates'
import type { TripExpense } from '../types'
import { useCurrentUserId, useTripsStore } from '../store/TripsContext'
import { findCurrentMember, sortExpenses, summarizeTrip } from '../store/selectors'

function groupByDay(expenses: readonly TripExpense[]): Array<[string, TripExpense[]]> {
  const groups = new Map<string, TripExpense[]>()
  for (const e of sortExpenses(expenses)) {
    const list = groups.get(e.date)
    if (list) list.push(e)
    else groups.set(e.date, [e])
  }
  return [...groups]
}

export function TripPage() {
  const { tripId = '' } = useParams()
  const navigate = useNavigate()
  const userId = useCurrentUserId()
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const status = useTripsStore((s) => s.tripStatus[tripId] ?? 'idle')
  const error = useTripsStore((s) => s.tripError[tripId])
  const loadTrip = useTripsStore((s) => s.loadTrip)

  useEffect(() => {
    void loadTrip(tripId)
  }, [loadTrip, tripId])

  const me = snapshot ? findCurrentMember(snapshot, userId) : undefined
  const summary = useMemo(
    () => (snapshot ? summarizeTrip(snapshot, me?.id) : null),
    [snapshot, me?.id],
  )

  if (!snapshot || !summary) {
    return (
      <Screen>
        <button
          type="button"
          aria-label="Back to trips"
          onClick={() => navigate('/trips')}
          className="m-2 flex h-11 w-11 items-center justify-center rounded-[12px] hover:bg-black/5"
        >
          <ChevronLeft size={22} />
        </button>
        {status === 'error' ? (
          <ErrorState message={error || 'Could not load this trip.'} onRetry={() => void loadTrip(tripId)} />
        ) : (
          <Spinner label="Loading trip" />
        )}
      </Screen>
    )
  }

  const { trip, members, categories, expenses } = snapshot
  const currency = trip.default_currency
  const money = (minor: number) => formatMoney(minor, currency)
  const budget = trip.budget_amount === null ? null : toMinor(trip.budget_amount, currency)
  const pct = budget && budget > 0 ? Math.min(100, Math.round((summary.spent * 100) / budget)) : 0
  const memberName = (id: string) => members.find((m) => m.id === id)?.display_name ?? '?'
  const today = todayISO()
  const range = formatRange(trip.start_date, trip.end_date)

  const balance = summary.myBalance
  const balanceText = `${balance > 0 ? '+ ' : balance < 0 ? '– ' : ''}${money(Math.abs(balance))}`
  const balanceColor = balance > 0 ? '#8BE07A' : balance < 0 ? 'var(--color-owe-light)' : '#FFFFFF'
  const t = summary.myTransfer
  const balanceSub = t
    ? t.from === me?.id
      ? `You owe ${memberName(t.to)}`
      : `${memberName(t.from)} owes you`
    : 'All settled up'

  const iconBtn = 'flex h-11 w-11 items-center justify-center rounded-[12px] text-white hover:bg-white/10'

  return (
    <Screen>
      <section className="flex flex-col gap-3.5 bg-primary-dark px-5 pb-5 pt-3 text-white">
        <div className="flex items-center justify-between">
          <button type="button" aria-label="Back to trips" onClick={() => navigate('/trips')} className={`${iconBtn} -ml-3`}>
            <ChevronLeft size={22} />
          </button>
          <div className="flex">
            <button type="button" aria-label="Insights" onClick={() => navigate('insights')} className={iconBtn}>
              <PieChart size={22} />
            </button>
            <button type="button" aria-label="Balances" onClick={() => navigate('balances')} className={iconBtn}>
              <Scale size={22} />
            </button>
            <button type="button" aria-label="Trip settings" onClick={() => navigate('settings')} className={`${iconBtn} -mr-3`}>
              <Settings size={22} />
            </button>
          </div>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] font-semibold text-[#CFC3F5]">
              {range ? `${range} · ` : ''}
              {currency}
            </span>
            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">{trip.name}</h1>
          </div>
          <div className="flex shrink-0">
            {members.slice(0, 5).map((m, i) => (
              <span key={m.id} className={`flex rounded-full border-2 border-primary-dark ${i ? '-ml-2' : ''}`}>
                <MemberAvatar name={m.display_name} color={m.color} size={30} />
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <div className="flex flex-col gap-1 rounded-[14px] bg-white/10 p-3">
            <span className="text-xs font-semibold text-[#CFC3F5]">Group spent</span>
            <span className="text-xl font-extrabold tabular-nums">{money(summary.spent)}</span>
            {budget !== null ? (
              <>
                <span className="block h-1.5 overflow-hidden rounded bg-white/15">
                  <i className="block h-full bg-[#B9A1FF]" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-[11px] text-[#CFC3F5]">
                  {pct}% of {money(budget)} budget
                </span>
              </>
            ) : (
              <span className="text-[11px] text-[#CFC3F5]">No budget set</span>
            )}
          </div>
          <button
            type="button"
            onClick={() => navigate('balances')}
            className="flex flex-col gap-1 rounded-[14px] bg-white/10 p-3 text-left"
          >
            <span className="text-xs font-semibold text-[#CFC3F5]">Your balance</span>
            <span className="text-xl font-extrabold tabular-nums" style={{ color: balanceColor }}>
              {balanceText}
            </span>
            <span className="text-[11px] text-[#CFC3F5]">{balanceSub} · Settle up ›</span>
          </button>
        </div>
      </section>

      <div className="flex flex-col gap-2 px-4 pb-32 pt-3">
        {expenses.length === 0 ? (
          <div className="flex flex-col items-center gap-2.5 px-6 py-12 text-center">
            <b className="text-base">No expenses yet</b>
            <p className="text-xs leading-relaxed text-text-muted">
              Add the first thing someone paid for. Everyone on the trip sees it.
            </p>
          </div>
        ) : (
          <>
            <div className="flex items-baseline justify-between px-0.5 pt-1">
              <span className="text-xs font-bold text-text-muted">
                {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'}
                {summary.pendingCount > 0 ? ` · +${summary.pendingCount} pending` : ''}
              </span>
              <b className="text-[13px] tabular-nums">{money(summary.spent)}</b>
            </div>
            {groupByDay(expenses).map(([date, list]) => (
              <section key={date} aria-label={formatDay(date, true)}>
                <h2 className="sticky top-0 z-[1] bg-background px-0.5 pb-1 pt-2.5 text-xs font-extrabold uppercase tracking-widest text-text-muted">
                  {date === today ? `Today · ${formatDay(date, true)}` : formatDay(date, true)}
                </h2>
                <div className="rounded-[18px] bg-surface px-3.5 py-0.5">
                  {list.map((e) => (
                    <ExpenseRow
                      key={e.id}
                      expense={e}
                      category={categories.find((c) => c.id === e.category_id)}
                      payerName={memberName(e.paid_by)}
                      defaultCurrency={currency}
                      onOpen={(id) => navigate(`expenses/${id}`)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
        <div className="mx-auto flex max-w-[430px] justify-end px-5 pb-6">
          <button
            type="button"
            onClick={() => navigate('expenses/new')}
            className="pointer-events-auto flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-bold text-white shadow-[0_6px_20px_rgba(115,64,254,0.4)]"
          >
            <Plus size={20} aria-hidden="true" />
            Add expense
          </button>
        </div>
      </div>
    </Screen>
  )
}
