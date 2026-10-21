import { useDisplayCurrency } from '../hooks/useDisplayCurrency'
import { useTripWatch } from '../hooks/useTripWatch'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, PieChart, Plus, Scale, Search, Settings, SlidersHorizontal, X } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CategoryChipRow } from '../components/CategoryChipRow'
import { FilterSheet } from '../components/FilterSheet'
import { ExpenseRow } from '../components/ExpenseRow'
import { MemberAvatar } from '../components/MemberAvatar'
import { ExpenseDetailSheet } from '../components/ExpenseDetailSheet'
import { Screen, Spinner, TripLoadError } from '../components/Screen'
import { WhoAreYou } from '../components/WhoAreYou'
import { formatMoney, toMinor } from '../lib/currency'
import { formatDay, formatRange, todayISO } from '../lib/dates'
import { countActiveFilters, EMPTY_FILTER, NO_LOCATION, filterExpenses, parseFilter, serializeFilter } from '../lib/filter'
import type { TripExpense, TripExpenseFilter } from '../types'
import { useGuest, useCurrentMember, useTripKey } from '../store/GuestContext'
import { useTripsStore } from '../store/TripsContext'
import { computeBalances, suggestTransfers } from '../lib/balances'
import { sortExpenses, summarizeTrip, usedCategoriesBySpend } from '../store/selectors'

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
  const tripId = useTripKey()
  const guest = useGuest()
  const isGuest = !!guest
  const navigate = useNavigate()
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const status = useTripsStore((s) => s.tripStatus[tripId] ?? 'idle')
  const error = useTripsStore((s) => s.tripError[tripId])
  const loadTrip = useTripsStore((s) => s.loadTrip)

  const syncRates = useTripsStore((s) => s.syncRates)
  const unsynced = useTripsStore((s) => s.unsynced)
  const queued = useTripsStore((s) => s.queue.filter((q) => q.tripId === tripId).length)
  useTripWatch(tripId)
  useEffect(() => {
    // Load the trip, then refresh stale rates and convert pending expenses in the background.
    // Guests only read: no rate reconciliation, which would write.
    void loadTrip(tripId).then(() => (isGuest ? undefined : syncRates(tripId)))
  }, [loadTrip, syncRates, tripId, isGuest])

  const me = useCurrentMember(snapshot)
  const [detail, setDetail] = useState<TripExpense | null>(null)
  const summary = useMemo(
    () => (snapshot ? summarizeTrip(snapshot, me?.id) : null),
    [snapshot, me?.id],
  )

  const display = useDisplayCurrency(snapshot)
  const [params, setParams] = useSearchParams()
  const categoryIdsKey = snapshot?.categories.map((c) => c.id).join(',') ?? ''
  const memberIdsKey = snapshot?.members.map((m) => m.id).join(',') ?? ''
  // Ids that no longer exist (deleted categories) are dropped from the active filter.
  const filter = useMemo<TripExpenseFilter>(() => {
    const parsed = parseFilter(params)
    if (!snapshot) return parsed
    const catIds = new Set(categoryIdsKey.split(','))
    const memberIds = new Set(memberIdsKey.split(','))
    return {
      ...parsed,
      categoryIds: parsed.categoryIds.filter((id) => catIds.has(id)),
      payer: parsed.payer && memberIds.has(parsed.payer) ? parsed.payer : null,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, categoryIdsKey, memberIdsKey, !!snapshot])
  const filterRef = useRef(filter)
  useEffect(() => {
    filterRef.current = filter
  })
  const updateFilter = useCallback(
    (next: TripExpenseFilter, mode: 'push' | 'replace' = 'push') =>
      setParams(serializeFilter(next), { replace: mode === 'replace' }),
    [setParams],
  )

  // Search box: local text, committed to the URL after a short pause.
  const [searchText, setSearchText] = useState(filter.q)
  const committedQ = useRef(filter.q)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (filter.q !== committedQ.current) {
      committedQ.current = filter.q
      setSearchText(filter.q)
    }
  }, [filter.q])
  useEffect(() => () => clearTimeout(timer.current), [])
  const onSearch = (value: string) => {
    setSearchText(value)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      committedQ.current = value.trim()
      updateFilter({ ...filterRef.current, q: value.trim() }, 'replace')
    }, 150)
  }
  const [sheetOpen, setSheetOpen] = useState(false)

  const result = useMemo(
    () =>
      snapshot
        ? filterExpenses(snapshot.expenses, snapshot.shares, filter, {
            defaultCurrency: snapshot.trip.default_currency,
            currentMemberId: me?.id ?? null,
          })
        : null,
    [snapshot, filter, me?.id],
  )

  const guestTransfers = useMemo(() => {
    if (!guest || !me || !snapshot) return []
    const { balances } = computeBalances(snapshot.expenses, snapshot.shares, snapshot.settlements, snapshot.trip.default_currency)
    return suggestTransfers(balances, me.id).filter((t) => t.from === me.id || t.to === me.id)
  }, [guest, me, snapshot])

  if (!snapshot || !summary || !result) {
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
          <TripLoadError message={error || 'Could not load this trip.'} onRetry={() => void loadTrip(tripId)} />
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
  const activeCount = countActiveFilters(filter)
  const filterActive = filter.categoryIds.length > 0 || activeCount > 0 || filter.q !== ''
  const pills: Array<{ key: string; label: string; remove: TripExpenseFilter }> = []
  for (const p of filter.places) {
    pills.push({
      key: `place:${p}`,
      label: p === NO_LOCATION ? 'No location' : p,
      remove: { ...filter, places: filter.places.filter((x) => x !== p) },
    })
  }
  if (filter.payer) pills.push({ key: 'payer', label: `${memberName(filter.payer)} paid`, remove: { ...filter, payer: null } })
  if (filter.mine) pills.push({ key: 'mine', label: 'Only mine', remove: { ...filter, mine: false } })
  if (filter.from || filter.to) {
    pills.push({
      key: 'dates',
      label: `${filter.from ? formatDay(filter.from) : 'Start'} – ${filter.to ? formatDay(filter.to) : 'End'}`,
      remove: { ...filter, from: null, to: null },
    })
  }

  const balance = summary.myBalance
  const balanceShown = display.format(balance, { signed: true })
  const spentShown = display.format(summary.spent)
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
          {guest ? (
            <span className="h-11" />
          ) : (
            <button type="button" aria-label="Back to trips" onClick={() => navigate('/trips')} className={`${iconBtn} -ml-3`}>
              <ChevronLeft size={22} />
            </button>
          )}
          <div className="flex">
            <button type="button" aria-label="Insights" onClick={() => navigate('insights')} className={iconBtn}>
              <PieChart size={22} />
            </button>
            <button type="button" aria-label="Balances" onClick={() => navigate('balances')} className={iconBtn}>
              <Scale size={22} />
            </button>
            {!guest && (
              <button type="button" aria-label="Trip settings" onClick={() => navigate('settings')} className={`${iconBtn} -mr-3`}>
                <Settings size={22} />
              </button>
            )}
          </div>
        </div>
        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-[13px] font-semibold text-[#A9DCD7]">
              {range ? `${range} · ` : ''}
              {currency}
            </span>
            <h1 className="text-[26px] font-extrabold leading-tight tracking-tight">{trip.name}</h1>
            {trip.archived_at && (
              <span className="self-start rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-extrabold">Trip archived</span>
            )}
          </div>
          <div className="flex shrink-0">
            {members.slice(0, 5).map((m, i) => (
              <span key={m.id} className={`flex rounded-full border-2 border-primary-dark ${i ? '-ml-2' : ''}`}>
                <MemberAvatar name={m.display_name} color={m.color} size={30} />
              </span>
            ))}
          </div>
        </div>
        <div className={`grid gap-2.5 ${guest ? 'grid-cols-1' : 'grid-cols-2'}`}>
          <div className="flex flex-col gap-1 rounded-[14px] bg-white/10 p-3">
            <span className="text-xs font-semibold text-[#A9DCD7]">Group spent</span>
            <span className="text-xl font-extrabold tabular-nums">{spentShown.main}</span>
            {spentShown.sub && <span className="text-[11px] tabular-nums text-[#A9DCD7]">{spentShown.sub}</span>}
            {budget !== null ? (
              <>
                <span className="block h-1.5 overflow-hidden rounded bg-white/15">
                  <i className="block h-full bg-[#6FD0C6]" style={{ width: `${pct}%` }} />
                </span>
                <span className="text-[11px] text-[#A9DCD7]">
                  {pct}% of {money(budget)} budget
                </span>
              </>
            ) : (
              <span className="text-[11px] text-[#A9DCD7]">No budget set</span>
            )}
            {summary.pendingCount > 0 && (
              <span className="text-[11px] font-bold text-owe-light">
                {summary.pendingCount} pending
              </span>
            )}
          </div>
          {!guest && (
          <button
            type="button"
            onClick={() => navigate('balances')}
            className="flex flex-col gap-1 rounded-[14px] bg-white/10 p-3 text-left"
          >
            <span className="text-xs font-semibold text-[#A9DCD7]">Your balance</span>
            <span className="text-xl font-extrabold tabular-nums" style={{ color: balanceColor }}>
              {balanceShown.main}
            </span>
            {balanceShown.sub && <span className="text-[11px] tabular-nums text-[#A9DCD7]">{balanceShown.sub}</span>}
            <span className="text-[11px] text-[#A9DCD7]">{balanceSub} · Settle up ›</span>
          </button>
          )}
        </div>
        {guest && snapshot && (
          <WhoAreYou
            members={members}
            pickedId={me?.id ?? null}
            onPick={(id) => guest.setPick(trip.id, id)}
            transfers={guestTransfers}
            currency={currency}
          />
        )}
        {queued > 0 && (
          <p role="status" className="rounded-[10px] bg-white/10 px-3 py-2 text-xs font-bold text-owe-light">
            {queued} {queued === 1 ? 'change' : 'changes'} waiting to sync
          </p>
        )}
      </section>

      {expenses.length > 0 && (
        <div className="flex flex-col gap-2.5 border-b border-gray-100 bg-surface py-3 pl-4">
          <div className="flex items-center gap-2 pr-4">
            <label className="flex h-11 min-w-0 flex-1 items-center gap-2 rounded-[12px] bg-gray-100 px-3 text-text-muted">
              <Search size={16} aria-hidden="true" />
              <input
                type="search"
                value={searchText}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="Search expenses or places"
                aria-label="Search expenses or places"
                className="w-full min-w-0 bg-transparent text-[15px] text-text-primary outline-none"
              />
            </label>
            <button
              type="button"
              onClick={() => setSheetOpen(true)}
              aria-label={`More filters${activeCount ? `, ${activeCount} active` : ''}`}
              className="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-primary-tint text-primary"
            >
              <SlidersHorizontal size={20} />
              {activeCount > 0 && (
                <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-extrabold text-white">
                  {activeCount}
                </span>
              )}
            </button>
          </div>
          <CategoryChipRow
            categories={usedCategoriesBySpend(snapshot)}
            selectedIds={filter.categoryIds}
            onToggle={(id) =>
              updateFilter({
                ...filter,
                categoryIds: filter.categoryIds.includes(id)
                  ? filter.categoryIds.filter((x) => x !== id)
                  : [...filter.categoryIds, id],
              })
            }
            onClear={() => updateFilter({ ...filter, categoryIds: [] })}
          />
        </div>
      )}

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
            {pills.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {pills.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    aria-label={`Remove filter ${p.label}`}
                    onClick={() => updateFilter(p.remove)}
                    className="inline-flex h-8 items-center gap-1 rounded-full bg-gray-100 pl-3 pr-2 text-xs font-bold"
                  >
                    {p.label}
                    <X size={14} aria-hidden="true" />
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => updateFilter(EMPTY_FILTER)}
                  className="h-9 px-1 text-[13px] font-bold text-primary"
                >
                  Clear all
                </button>
              </div>
            )}
            {result.hiddenNoLocationCount > 0 && (
              <div className="rounded-[12px] bg-warning-light px-3 py-2.5 text-xs font-semibold text-[#6B4400]">
                {result.hiddenNoLocationCount}{' '}
                {result.hiddenNoLocationCount === 1 ? 'expense without a location is' : 'expenses without a location are'} hidden by
                the location filter.{' '}
                <button
                  type="button"
                  onClick={() => updateFilter({ ...filter, places: [...filter.places, NO_LOCATION] })}
                  className="font-extrabold underline"
                >
                  Include them
                </button>
              </div>
            )}
            <div className="flex items-baseline justify-between px-0.5 pt-1">
              <span className="text-xs font-bold text-text-muted">
                {result.items.length} {result.items.length === 1 ? 'expense' : 'expenses'}
                {filterActive ? ' · filtered' : ''}
                {result.pendingCount > 0 ? ` · ${result.pendingCount} pending` : ''}
              </span>
              <b className="text-[13px] tabular-nums">{money(result.totalDefault)}</b>
            </div>
            {filterActive && result.items.length > 0 && (
              <p className="px-0.5 text-xs text-text-muted">
                Your share of these: <b className="tabular-nums text-text-primary">{money(result.myShareDefault)}</b>
              </p>
            )}
            {result.items.length === 0 ? (
              <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
                <b className="text-base">Nothing matches these filters</b>
                <button
                  type="button"
                  onClick={() => updateFilter(EMPTY_FILTER)}
                  className="h-11 rounded-full border border-gray-300 bg-surface px-5 text-sm font-bold"
                >
                  Clear filters
                </button>
              </div>
            ) : (
              groupByDay(result.items).map(([date, list]) => (
                <section key={date} aria-label={formatDay(date, true)}>
                  <h2 className="sticky top-0 z-[1] bg-background px-0.5 pb-1 pt-2.5 text-xs font-extrabold uppercase tracking-widest text-text-muted">
                    {date === today ? `Today · ${formatDay(date, true)}` : formatDay(date, true)}
                  </h2>
                  <div className="rounded-[18px] bg-surface px-3.5 py-0.5">
                    {list.map((e) => (
                      <ExpenseRow
                        unsynced={!!unsynced[e.id]}
                        key={e.id}
                        expense={e}
                        category={categories.find((c) => c.id === e.category_id)}
                        payerName={memberName(e.paid_by)}
                        defaultCurrency={currency}
                        onOpen={(id) => (guest ? setDetail(expenses.find((x) => x.id === id) ?? null) : navigate(`expenses/${id}`))}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </>
        )}
      </div>

      <FilterSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filter={filter}
        onChange={(next) => updateFilter(next)}
        onReset={() => updateFilter({ ...EMPTY_FILTER, q: filter.q })}
        result={result}
        categories={[...categories].sort((a, b) => a.sort_order - b.sort_order)}
        expenses={expenses}
        members={members}
        defaultCurrency={currency}
        tripStart={trip.start_date}
        tripEnd={trip.end_date}
        showMine={!guest || !!me}
      />

      {!guest && (
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
        <div className="mx-auto flex max-w-[430px] justify-end px-5 pb-6">
          <button
            type="button"
            onClick={() => navigate('expenses/new')}
            className="pointer-events-auto flex h-14 items-center gap-2 rounded-full bg-primary px-5 text-[15px] font-bold text-white shadow-[0_6px_20px_rgba(11,122,119,0.4)]"
          >
            <Plus size={20} aria-hidden="true" />
            Add expense
          </button>
        </div>
      </div>
      )}
      {guest && <ExpenseDetailSheet expense={detail} snapshot={snapshot} onClose={() => setDetail(null)} />}
    </Screen>
  )
}
