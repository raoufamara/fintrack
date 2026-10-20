import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { BottomSheet } from '../components/BottomSheet'
import { CategoryEditSheet } from '../components/CategoryEditSheet'
import { CategoryIcon } from '../components/CategoryIcon'
import { CurrencySheet } from '../components/CurrencySheet'
import { PayerSheet } from '../components/PayerSheet'
import { ErrorState, Screen, Spinner, TopBar } from '../components/Screen'
import { SplitSheet } from '../components/SplitSheet'
import { minorToInput, sanitizeAmountInput } from '../lib/amountInput'
import { formatMoney, minorUnits, toMinor } from '../lib/currency'
import { todayISO } from '../lib/dates'
import { validateExpenseForm } from '../lib/validation'
import { splitAmount, toDefault } from '../lib/money'
import { formatAge, formatRate, type FxRate } from '../services/fxService'
import type { TripSnapshot } from '../services/TripsRepository'
import { useCurrentUserId, useFx, useTripsStore, useTripsStoreApi } from '../store/TripsContext'
import { defaultCategoryId, findCurrentMember, lastCurrencyUsed, usedCurrencies, visibleCategories } from '../store/selectors'

export function ExpenseFormPage() {
  const { tripId = '', id } = useParams()
  const navigate = useNavigate()
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const status = useTripsStore((s) => s.tripStatus[tripId] ?? 'idle')
  const error = useTripsStore((s) => s.tripError[tripId])
  const loadTrip = useTripsStore((s) => s.loadTrip)

  useEffect(() => {
    if (!snapshot) void loadTrip(tripId)
  }, [loadTrip, tripId, snapshot])

  if (!snapshot) {
    return (
      <Screen>
        <TopBar title={id ? 'Edit expense' : 'New expense'} close onBack={() => navigate(`/trips/${tripId}`)} />
        {status === 'error' ? (
          <ErrorState message={error || 'Could not load this trip.'} onRetry={() => void loadTrip(tripId)} />
        ) : (
          <Spinner />
        )}
      </Screen>
    )
  }
  if (id && !snapshot.expenses.some((e) => e.id === id)) {
    return (
      <Screen>
        <TopBar title="Edit expense" close onBack={() => navigate(`/trips/${tripId}`)} />
        <ErrorState message="This expense no longer exists." />
      </Screen>
    )
  }
  // key: reset the form when switching between expenses.
  return <ExpenseForm key={id ?? 'new'} snapshot={snapshot} expenseId={id} />
}

function ExpenseForm({ snapshot, expenseId }: { snapshot: TripSnapshot; expenseId: string | undefined }) {
  const navigate = useNavigate()
  const userId = useCurrentUserId()
  const saveExpense = useTripsStore((s) => s.saveExpense)
  const deleteExpense = useTripsStore((s) => s.deleteExpense)

  const { trip, members } = snapshot
  const defaultCurrency = trip.default_currency
  const me = findCurrentMember(snapshot, userId)
  const existing = expenseId ? snapshot.expenses.find((e) => e.id === expenseId) : undefined
  const existingShares = useMemo(
    () => (existing ? snapshot.shares.filter((s) => s.expense_id === existing.id) : []),
    [existing, snapshot.shares],
  )
  const isCustomSplit = !!existing && existing.split_mode !== 'equal'
  const fx = useFx()
  const storeApi = useTripsStoreApi()
  const draftKey = `${trip.id}:${expenseId ?? 'new'}`
  // A draft is stashed when the user leaves for Categories and comes back.
  const [draft] = useState(() => storeApi.getState().drafts[draftKey])
  useEffect(() => {
    storeApi.getState().clearDraft(draftKey)
  }, [storeApi, draftKey])

  const [currency, setCurrency] = useState(
    draft?.currency ?? existing?.currency ?? lastCurrencyUsed(snapshot, me?.id),
  )
  const [amount, setAmount] = useState(
    draft?.amount ?? (existing ? minorToInput(toMinor(existing.amount, existing.currency), existing.currency) : ''),
  )
  const [title, setTitle] = useState(draft?.title ?? existing?.title ?? '')
  const [categoryId, setCategoryId] = useState<string | undefined>(
    draft ? draft.categoryId : (existing?.category_id ?? defaultCategoryId(snapshot, me?.id)),
  )
  const [paidBy, setPaidBy] = useState(draft?.paidBy ?? existing?.paid_by ?? me?.id ?? members[0]?.id ?? '')
  const [splitIds, setSplitIds] = useState<string[]>(
    draft?.splitIds ?? (existing ? existingShares.map((s) => s.member_id) : members.map((m) => m.id)),
  )
  const [date, setDate] = useState(draft?.date ?? existing?.date ?? todayISO())
  const [manualRate, setManualRate] = useState<string | null>(
    draft ? draft.manualRate : existing?.fx_source === 'manual' && existing.fx_rate !== null ? String(existing.fx_rate) : null,
  )
  const [submitted, setSubmitted] = useState(false)
  const [sheet, setSheet] = useState<'payer' | 'split' | 'delete' | 'category' | 'currency' | null>(null)

  // Rate lookup for foreign currencies. An unchanged stored rate is kept as is.
  const storedRateApplies =
    !!existing && existing.fx_rate !== null && existing.currency === currency && existing.date === date
  const [lookup, setLookup] = useState<{ key: string; rate: FxRate | null } | null>(null)
  const lookupKey = `${currency}|${date}`
  useEffect(() => {
    if (currency === defaultCurrency || storedRateApplies) return
    let cancelled = false
    void fx.getRate(currency, defaultCurrency, date).then((rate) => {
      if (!cancelled) setLookup({ key: lookupKey, rate })
    })
    return () => {
      cancelled = true
    }
  }, [fx, currency, defaultCurrency, date, lookupKey, storedRateApplies])

  const manualValue = manualRate !== null && Number(manualRate) > 0 ? Number(manualRate) : null
  const cached: FxRate | null =
    currency === defaultCurrency
      ? { rate: 1, source: 'same', ageHours: 0, tableDate: null }
      : storedRateApplies && existing && existing.fx_source !== 'manual'
        ? { rate: existing.fx_rate!, source: existing.fx_source === 'api' ? 'api' : 'cache', ageHours: 0, tableDate: existing.fx_date }
        : lookup?.key === lookupKey
          ? lookup.rate
          : null
  const rateLoading = currency !== defaultCurrency && !storedRateApplies && lookup?.key !== lookupKey
  const effective: { rate: number; source: 'same' | 'cache' | 'api' | 'manual'; ageHours: number; tableDate: string | null } | null =
    currency === defaultCurrency
      ? { rate: 1, source: 'same', ageHours: 0, tableDate: null }
      : manualValue !== null
        ? { rate: manualValue, source: 'manual', ageHours: 0, tableDate: null }
        : cached

  const { errors, amountMinor } = validateExpenseForm({ amount, title, date, categoryId, currency })
  const show = submitted ? errors : {}
  const convertedMinor = effective && amountMinor > 0 ? toDefault(amountMinor, currency, effective.rate, defaultCurrency) : 0

  const changeCurrency = (code: string) => {
    if (code === currency) return
    setCurrency(code)
    setManualRate(null)
    setAmount((a) => sanitizeAmountInput(a, code))
  }

  const categories = useMemo(() => {
    const visible = visibleCategories(snapshot.categories)
    // A selected category stays in the grid even if it was hidden meanwhile.
    const current = snapshot.categories.find((c) => c.id === categoryId)
    return current && !visible.some((c) => c.id === current.id) ? [...visible, current] : visible
  }, [snapshot.categories, categoryId])

  const payer = members.find((m) => m.id === paidBy)
  const splitLabel = isCustomSplit
    ? `Custom · ${splitIds.length} ${splitIds.length === 1 ? 'person' : 'people'}`
    : splitIds.length === members.length
      ? 'Equally · everyone'
      : `Equally · ${members.filter((m) => splitIds.includes(m.id)).map((m) => m.display_name).join(', ')}`

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (Object.keys(errors).length > 0 || !categoryId || splitIds.length === 0) return

    // Custom splits made elsewhere keep their proportions when the amount changes.
    const shares = isCustomSplit
      ? splitAmount(
          amountMinor,
          'shares',
          existingShares.map((s) => s.member_id),
          Object.fromEntries(existingShares.map((s) => [s.member_id, toMinor(s.amount, existing?.currency ?? currency)])),
        )
      : splitAmount(amountMinor, 'equal', splitIds)

    // Optimistic: the store applies the change at once, so we can leave right away.
    void saveExpense({
      tripId: trip.id,
      id: existing?.id,
      categoryId,
      title,
      amountMinor,
      paidBy,
      date,
      note: existing?.note ?? null,
      splitMode: existing?.split_mode ?? 'equal',
      shares,
      currency,
      fxRate: effective?.rate ?? null,
      fxSource: effective && effective.source !== 'same' ? effective.source : null,
      fxDate: effective?.tableDate ?? null,
    })
    navigate(`/trips/${trip.id}`, { replace: true })
  }

  const confirmDelete = () => {
    if (!existing) return
    void deleteExpense(trip.id, existing.id)
    setSheet(null)
    navigate(`/trips/${trip.id}`, { replace: true })
  }

  const rowClass =
    'flex min-h-[52px] w-full items-center justify-between gap-3 px-3.5 text-sm font-semibold text-text-muted'

  return (
    <Screen>
      <TopBar
        title={existing ? 'Edit expense' : 'New expense'}
        close
        onBack={() => navigate(`/trips/${trip.id}`)}
        right={
          existing && (
            <button
              type="button"
              aria-label="Delete expense"
              onClick={() => setSheet('delete')}
              className="flex h-11 w-11 items-center justify-center rounded-[12px] text-error hover:bg-black/5"
            >
              <Trash2 size={20} />
            </button>
          )
        }
      />
      <form onSubmit={submit} noValidate className="flex flex-1 flex-col">
        <div className="flex flex-col items-center gap-1.5 border-b border-gray-100 bg-surface px-5 pb-4 pt-2">
          <div className="flex items-baseline justify-center gap-2">
            <button
              type="button"
              aria-label={`Currency: ${currency}. Change currency`}
              onClick={() => setSheet('currency')}
              className="flex h-9 items-center gap-1 rounded-[10px] border border-gray-300 px-2.5 text-sm font-extrabold text-gray-700"
            >
              {currency}
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            <input
              inputMode="decimal"
              aria-label="Amount"
              aria-invalid={!!show.amount}
              placeholder={minorUnits(currency) === 0 ? '0' : '0.00'}
              value={amount}
              onChange={(e) => setAmount(sanitizeAmountInput(e.target.value, currency))}
              className="w-[7ch] bg-transparent text-[44px] font-extrabold tracking-tight outline-none"
            />
          </div>
          {currency !== defaultCurrency && (
            <div className="flex flex-col items-center gap-1 text-center text-xs text-text-muted" aria-live="polite">
              {rateLoading ? (
                <span>Looking up the rate…</span>
              ) : effective ? (
                <span className="tabular-nums">
                  {amountMinor > 0 ? `= ${formatMoney(convertedMinor, defaultCurrency)} in trip currency · ` : ''}
                  rate {formatRate(effective.rate)} ·{' '}
                  {effective.source === 'manual' ? 'your rate' : `updated ${formatAge(effective.ageHours)}`}
                  <button type="button" onClick={() => setSheet('currency')} className="ml-2 font-bold text-primary">
                    Edit rate
                  </button>
                </span>
              ) : (
                <span className="rounded-[8px] bg-warning-light px-2.5 py-1.5 font-semibold text-[#6B4400]">
                  Rate pending: converts when you’re back online.{' '}
                  <button type="button" onClick={() => setSheet('currency')} className="font-extrabold underline">
                    Type a rate
                  </button>
                </span>
              )}
            </div>
          )}
          {show.amount && (
            <span role="alert" className="text-xs font-bold text-error">
              {show.amount}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-4 p-4 pb-28">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="expense-title" className="text-[13px] font-extrabold text-gray-700">
              What was it?
            </label>
            <input
              id="expense-title"
              value={title}
              maxLength={120}
              placeholder="Dinner, taxi, museum…"
              aria-invalid={!!show.title}
              onChange={(e) => setTitle(e.target.value)}
              className="h-12 w-full rounded-[12px] border border-gray-300 bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-2 focus:border-primary focus:px-[13px]"
            />
            {show.title && (
              <span role="alert" className="text-xs font-bold text-error">
                {show.title}
              </span>
            )}
          </div>

          <div className="flex flex-col gap-1.5" role="group" aria-label="Category">
            <div className="flex items-center justify-between">
              <span className="text-[13px] font-extrabold text-gray-700">Category</span>
              <button
                type="button"
                onClick={() => {
                  storeApi.getState().saveDraft(draftKey, {
                    amount,
                    title,
                    categoryId,
                    paidBy,
                    splitIds,
                    date,
                    currency,
                    manualRate,
                  })
                  navigate(`/trips/${trip.id}/categories`)
                }}
                className="h-9 px-1 text-[13px] font-bold text-primary"
              >
                Edit
              </button>
            </div>
            <div className="grid grid-cols-4 gap-2">
              {categories.map((c) => {
                const on = c.id === categoryId
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCategoryId(c.id)}
                    className="flex h-16 flex-col items-center justify-center gap-1 rounded-[14px] border bg-surface px-1 text-[11px] font-bold"
                    style={
                      on
                        ? {
                            border: `2px solid var(--color-tripcat-${c.color})`,
                            background: `var(--color-tripcat-${c.color}-bg)`,
                            color: `var(--color-tripcat-${c.color})`,
                          }
                        : { borderColor: '#E5E5E5' }
                    }
                  >
                    <CategoryIcon icon={c.icon} color={c.color} size={26} iconSize={18} />
                    <span className="max-w-full truncate">{c.name}</span>
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setSheet('category')}
                className="flex h-16 flex-col items-center justify-center gap-1 rounded-[14px] border border-dashed border-[#B9A1FF] bg-primary-tint px-1 text-[11px] font-bold text-primary"
              >
                <Plus size={20} aria-hidden="true" />
                <span>New</span>
              </button>
            </div>
            {show.category && (
              <span role="alert" className="text-xs font-bold text-error">
                {show.category}
              </span>
            )}
          </div>

          <div className="flex flex-col divide-y divide-gray-100 rounded-2xl bg-surface">
            <button type="button" className={rowClass} onClick={() => setSheet('payer')}>
              <span>Paid by</span>
              <b className="flex items-center gap-1 text-text-primary">
                {payer?.display_name ?? '—'} <ChevronRight size={16} aria-hidden="true" />
              </b>
            </button>
            <button type="button" className={rowClass} onClick={() => setSheet('split')} disabled={isCustomSplit}>
              <span>Split</span>
              <b className="flex items-center gap-1 text-right text-text-primary">
                {splitLabel} {!isCustomSplit && <ChevronRight size={16} aria-hidden="true" />}
              </b>
            </button>
            <label className={rowClass}>
              <span>Date</span>
              <input
                type="date"
                aria-label="Date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="bg-transparent text-right font-extrabold text-text-primary outline-none"
              />
            </label>
          </div>
          {show.date && (
            <span role="alert" className="-mt-2 text-xs font-bold text-error">
              {show.date}
            </span>
          )}
        </div>

        <div className="sticky bottom-0 mt-auto border-t border-gray-100 bg-background px-4 pb-5 pt-3">
          <button type="submit" className="h-14 w-full rounded-full bg-primary text-base font-bold text-white">
            Save expense
          </button>
        </div>
      </form>

      <CategoryEditSheet
        open={sheet === 'category'}
        onClose={() => setSheet(null)}
        tripId={trip.id}
        onCreated={setCategoryId}
      />
      <CurrencySheet
        open={sheet === 'currency'}
        onClose={() => setSheet(null)}
        onSelect={changeCurrency}
        selected={currency}
        tripCurrency={defaultCurrency}
        usedCurrencies={usedCurrencies(snapshot)}
        rateEditor={
          currency === defaultCurrency
            ? undefined
            : {
                currency,
                rate: effective?.rate ?? null,
                cachedRate: cached?.rate ?? null,
                manual: manualValue !== null,
                onChange: (r) => setManualRate(r === null ? null : String(r)),
              }
        }
      />
      <PayerSheet
        open={sheet === 'payer'}
        onClose={() => setSheet(null)}
        members={members}
        value={paidBy}
        onChange={setPaidBy}
      />
      <SplitSheet
        open={sheet === 'split'}
        onClose={() => setSheet(null)}
        members={members}
        selected={splitIds}
        onChange={setSplitIds}
        totalMinor={amountMinor}
        currency={currency}
      />
      <BottomSheet open={sheet === 'delete'} onClose={() => setSheet(null)} title="Delete this expense?">
        <p className="text-sm leading-relaxed text-text-muted">
          It disappears for everyone on the trip, and balances update.
        </p>
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => setSheet(null)}
            className="h-14 flex-1 rounded-full border border-gray-300 bg-surface text-base font-bold"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmDelete}
            className="h-14 flex-1 rounded-full bg-error text-base font-bold text-white"
          >
            Delete
          </button>
        </div>
      </BottomSheet>
    </Screen>
  )
}
