import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { CURRENCIES, getCurrency } from '../lib/currency'
import { formatDay } from '../lib/dates'
import { normalizeSearch } from '../lib/filter'
import { formatAge, formatRate, type RateStatus } from '../services/fxService'
import { useFx } from '../store/TripsContext'
import { BottomSheet } from './BottomSheet'

/** Lets the user override the cached rate of the expense being edited. */
export interface RateEditor {
  /** The expense currency the rate applies to. */
  currency: string
  /** Rate currently in effect (cached or manual), null while pending. */
  rate: number | null
  /** Rate from the cache or provider, which Reset goes back to. */
  cachedRate: number | null
  manual: boolean
  /** Called with a positive number, or null to go back to the cached rate. */
  onChange: (rate: number | null) => void
}

interface CurrencySheetProps {
  open: boolean
  onClose: () => void
  onSelect: (code: string) => void
  title?: string
  selected?: string
  /** Trip default currency: enables the "On this trip" section, the rate column and the status banner. */
  tripCurrency?: string
  /** Other currencies used on the trip, most recent first. */
  usedCurrencies?: readonly string[]
  rateEditor?: RateEditor
}

export function CurrencySheet(props: CurrencySheetProps) {
  return (
    <BottomSheet open={props.open} onClose={props.onClose} title={props.title ?? 'Choose a currency'}>
      <SheetBody {...props} />
    </BottomSheet>
  )
}

function StatusBanner({ status }: { status: RateStatus | null | undefined }) {
  if (status === undefined) return null
  if (status === null) {
    return (
      <p role="status" className="rounded-[12px] bg-warning-light px-3 py-2.5 text-xs font-semibold leading-relaxed text-[#6B4400]">
        No saved rates yet. Connect to the internet to load them. Until then, expenses in other currencies are saved as
        pending.
      </p>
    )
  }
  if (status.stale) {
    return (
      <p role="status" className="rounded-[12px] bg-warning-light px-3 py-2.5 text-xs font-semibold text-[#6B4400]">
        Rates from {formatDay(status.tableDate)} — connect to refresh
      </p>
    )
  }
  return (
    <p role="status" className="rounded-[12px] bg-success-light px-3 py-2.5 text-xs font-semibold text-[#1F7F0C]">
      Rates saved on this phone, updated {formatAge(status.ageHours)}. Works offline.
    </p>
  )
}

function SheetBody({ onClose, onSelect, selected, tripCurrency, usedCurrencies = [], rateEditor }: CurrencySheetProps) {
  const fx = useFx()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<RateStatus | null | undefined>(undefined)
  const [rates, setRates] = useState<Record<string, number | null>>({})

  const onTrip = useMemo(
    () => (tripCurrency ? [tripCurrency, ...usedCurrencies.filter((c) => c !== tripCurrency)] : []),
    [tripCurrency, usedCurrencies],
  )

  useEffect(() => {
    if (!tripCurrency) return
    let cancelled = false
    void (async () => {
      const st = await fx.rateStatus(tripCurrency)
      const next: Record<string, number | null> = {}
      for (const c of onTrip) if (c !== tripCurrency) next[c] = (await fx.getRate(c, tripCurrency))?.rate ?? null
      if (!cancelled) {
        setStatus(st)
        setRates(next)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fx, tripCurrency, onTrip])

  const results = useMemo(() => {
    const q = normalizeSearch(query)
    if (!q) return CURRENCIES
    return CURRENCIES.filter((c) => normalizeSearch([c.code, c.name, ...c.countries].join(' ')).includes(q))
  }, [query])

  const pick = (code: string) => {
    onSelect(code)
    onClose()
  }

  const row = (code: string, extra?: string, rateText?: string) => {
    const info = getCurrency(code)
    return (
      <button
        type="button"
        aria-pressed={code === selected}
        onClick={() => pick(code)}
        className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[8px] px-2 text-left hover:bg-black/5"
      >
        <span className="min-w-0 truncate text-sm font-semibold">
          <b className={code === selected ? 'text-primary' : ''}>{code}</b> · {info?.name ?? code}
          {extra && <span className="ml-1.5 rounded-[6px] bg-primary-tint px-1.5 py-0.5 text-[10px] font-extrabold text-primary">{extra}</span>}
        </span>
        <span className="shrink-0 text-xs tabular-nums text-text-muted">{rateText ?? info?.symbol}</span>
      </button>
    )
  }

  return (
    <>
      {tripCurrency && <StatusBanner status={status} />}
      {rateEditor && rateEditor.currency !== tripCurrency && tripCurrency && (
        <RateEditorSection editor={rateEditor} tripCurrency={tripCurrency} />
      )}

      <label className="flex h-11 items-center gap-2 rounded-[12px] bg-gray-100 px-3 text-text-muted">
        <Search size={16} aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Code, name or country"
          aria-label="Search currencies"
          className="w-full min-w-0 bg-transparent text-[15px] text-text-primary outline-none"
        />
      </label>

      {tripCurrency && !query && (
        <section aria-label="On this trip" className="flex flex-col gap-1">
          <h3 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">On this trip</h3>
          <ul>
            {onTrip.map((code) => (
              <li key={code}>
                {row(
                  code,
                  code === tripCurrency ? 'Trip currency' : undefined,
                  code === tripCurrency
                    ? undefined
                    : rates[code] != null
                      ? `1 ${code} = ${formatRate(rates[code]!)} ${tripCurrency}`
                      : 'no rate',
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="All currencies" className="flex flex-col gap-1">
        {tripCurrency && !query && (
          <h3 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">All currencies</h3>
        )}
        <ul className="-mx-1 flex max-h-[40vh] flex-col overflow-y-auto">
          {results.map((c) => (
            <li key={c.code}>{row(c.code)}</li>
          ))}
          {results.length === 0 && (
            <li className="py-6 text-center text-sm text-text-muted">No currency matches “{query}”</li>
          )}
        </ul>
      </section>
    </>
  )
}

function RateEditorSection({ editor, tripCurrency }: { editor: RateEditor; tripCurrency: string }) {
  const [text, setText] = useState(editor.rate === null ? '' : formatRate(editor.rate))

  const commit = (value: string) => {
    setText(value)
    const n = Number(value.replace(',', '.'))
    if (value.trim() !== '' && Number.isFinite(n) && n > 0) editor.onChange(n)
  }

  return (
    <section aria-label="Rate for this expense" className="flex flex-col gap-2 rounded-[12px] border border-gray-200 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-extrabold text-gray-700">Rate for this expense</h3>
        {editor.manual && (
          <button
            type="button"
            onClick={() => {
              editor.onChange(null)
              setText(editor.cachedRate === null ? '' : formatRate(editor.cachedRate))
            }}
            className="h-8 px-2 text-[13px] font-bold text-primary"
          >
            Reset
          </button>
        )}
      </div>
      <label className="flex items-center gap-2 text-sm font-semibold">
        <span className="shrink-0">1 {editor.currency} =</span>
        <input
          inputMode="decimal"
          aria-label={`Rate: 1 ${editor.currency} in ${tripCurrency}`}
          value={text}
          placeholder="0.0000"
          onChange={(e) => commit(e.target.value)}
          className="h-10 w-full min-w-0 rounded-[10px] border border-gray-300 bg-surface px-3 text-[15px] tabular-nums outline-none focus:border-2 focus:border-primary focus:px-[11px]"
        />
        <span className="shrink-0">{tripCurrency}</span>
      </label>
      <p className="text-xs leading-relaxed text-text-muted">
        The rate is locked on the expense so balances never shift later. {editor.manual ? 'This is your own rate.' : 'Type your own to match a card statement or an exchange booth.'}
      </p>
    </section>
  )
}
