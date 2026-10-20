import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, FileUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { CurrencyPicker } from '../components/CurrencyPicker'
import { Screen, TopBar } from '../components/Screen'
import { formatMoney } from '../lib/currency'
import { EXPECTED_FORMAT, parseSplitwiseCsv, type SplitwiseFile } from '../lib/splitwiseCsv'
import {
  buildImportPayload,
  mapSplitwise,
  neededRates,
  PAYMENT_RATE_ERROR,
  rateKey,
  verifyAgainstTotals,
  type ImportPlan,
  type RateLookup,
  type VerificationResult,
} from '../lib/splitwiseImport'
import { MAX_IMPORT_FILE_BYTES, readFileText } from '../services/readFile'
import { useFx, useTripsStore } from '../store/TripsContext'

interface Loaded {
  plan: ImportPlan
  file: SplitwiseFile
  verification: VerificationResult
}

interface Done {
  tripId: string
  expenses: number
  payments: number
  warnings: string[]
  verification: VerificationResult
}

const inputClass =
  'h-12 w-full min-w-0 rounded-[12px] border border-gray-300 bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-2 focus:border-primary focus:px-[13px]'

function useOnline(isOnline: () => boolean): boolean {
  const [online, setOnline] = useState(isOnline())
  useEffect(() => {
    const update = () => setOnline(isOnline())
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [isOnline])
  return online
}

/** Import a Splitwise CSV as a new trip: pick the file, check the preview, import. */
export function ImportPage() {
  const navigate = useNavigate()
  const fx = useFx()
  const importTrip = useTripsStore((s) => s.importTrip)
  const online = useOnline(useCallback(() => fx.isOnline(), [fx]))

  const [pickError, setPickError] = useState<{ message: string; expected: string } | null>(null)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [fileName, setFileName] = useState('')
  const [reading, setReading] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('EUR')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [me, setMe] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File) => {
    setPickError(null)
    setReading(true)
    try {
      if (file.size > MAX_IMPORT_FILE_BYTES) {
        setPickError({ message: 'This file is too large to be a Splitwise export (over 5 MB).', expected: EXPECTED_FORMAT })
        return
      }
      const parsed = parseSplitwiseCsv(await readFileText(file))
      if (!parsed.ok) {
        setPickError({ message: parsed.message, expected: parsed.expected })
        return
      }
      const plan = mapSplitwise(parsed.file, { fileName: file.name })
      setLoaded({ plan, file: parsed.file, verification: verifyAgainstTotals(plan, parsed.file.totals) })
      setFileName(file.name)
      setName(plan.tripName)
      setCurrency(plan.defaultCurrency)
      setStart(plan.startDate ?? '')
      setEnd(plan.endDate ?? '')
      setMe(null)
      setImportError(null)
    } catch {
      setPickError({ message: "That file couldn't be read.", expected: EXPECTED_FORMAT })
    } finally {
      setReading(false)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files[0]
    if (file) void handleFile(file)
  }

  const runImport = async () => {
    if (!loaded || me === null || importing) return
    const { plan } = loaded
    if (!fx.isOnline()) {
      setImportError("You're offline. Connect to the internet to import a trip.")
      return
    }
    setImporting(true)
    setImportError(null)
    try {
      const rates = new Map<string, RateLookup | null>()
      for (const need of neededRates(plan, currency)) {
        const found = await fx.getRate(need.currency, currency, need.date)
        rates.set(
          rateKey(need.currency, need.date),
          found ? { rate: found.rate, source: found.source, tableDate: found.tableDate } : null,
        )
      }
      const built = buildImportPayload(plan, {
        meKey: me,
        tripName: name,
        defaultCurrency: currency,
        startDate: start || null,
        endDate: end || null,
        rates,
      })
      if (!built.ok) {
        setImportError(built.error)
        return
      }
      const result = await importTrip(built.payload)
      if (!result.ok) {
        setImportError(result.offline ? "You're offline. Connect to the internet to import a trip." : result.error)
        return
      }
      setDone({
        tripId: result.id,
        expenses: built.payload.expenses.length,
        payments: built.payload.settlements.length,
        warnings: built.warnings,
        verification: loaded.verification,
      })
    } finally {
      setImporting(false)
    }
  }

  // ------------------------------------------------------------ importing
  if (importing) {
    return (
      <Screen>
        <TopBar title="Importing" close onBack={() => undefined} />
        <div role="status" aria-label="Importing your trip" className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
          <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-primary border-t-transparent" />
          <b className="text-base">Importing your trip…</b>
          <p className="text-sm text-text-muted">This takes a few seconds.</p>
        </div>
      </Screen>
    )
  }

  // --------------------------------------------------------------- done
  if (done) {
    const v = done.verification
    return (
      <Screen>
        <TopBar title="Trip imported" close onBack={() => navigate('/trips')} />
        <div className="flex flex-1 flex-col gap-4 p-4">
          <div className="flex flex-col items-center gap-2 py-6 text-center">
            <CheckCircle2 size={48} aria-hidden="true" className="text-success" />
            <h2 className="text-xl font-extrabold">
              Imported {done.expenses} {done.expenses === 1 ? 'expense' : 'expenses'} and {done.payments}{' '}
              {done.payments === 1 ? 'payment' : 'payments'}
            </h2>
          </div>
          {!v.checked ? (
            <p role="status" className="rounded-[12px] bg-background px-3.5 py-3 text-sm text-text-muted">
              The file has no “Total balance” row, so the balances weren’t compared with Splitwise.
            </p>
          ) : v.matches ? (
            <p role="status" className="flex items-center gap-2 rounded-[12px] bg-success-light px-3.5 py-3 text-sm font-bold text-[#1F7F0C]">
              <CheckCircle2 size={18} aria-hidden="true" />
              Balances match Splitwise
            </p>
          ) : (
            <div role="status" className="flex flex-col gap-2 rounded-[12px] bg-warning-light px-3.5 py-3 text-[#6B4400]">
              <b className="flex items-center gap-2 text-sm">
                <AlertTriangle size={18} aria-hidden="true" />
                Some balances differ
              </b>
              <ul className="flex flex-col gap-1 text-sm">
                {v.diffs.map((d) => (
                  <li key={`${d.member}-${d.currency}`}>
                    {d.member} ({d.currency}): Splitwise {formatMoney(d.splitwise, d.currency)}, here {formatMoney(d.ours, d.currency)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {done.warnings.map((w) => (
            <p key={w} className="rounded-[12px] bg-warning-light px-3.5 py-3 text-sm font-semibold text-[#6B4400]">
              {w}
            </p>
          ))}
          <div className="sticky bottom-0 mt-auto bg-background pb-5 pt-3">
            <button
              type="button"
              onClick={() => navigate(`/trips/${done.tripId}`, { replace: true })}
              className="h-14 w-full rounded-full bg-primary text-base font-bold text-white"
            >
              Open trip
            </button>
          </div>
        </div>
      </Screen>
    )
  }

  // ------------------------------------------------------------- preview
  if (loaded) {
    const { plan } = loaded
    const warningCount = plan.warnings.length + plan.rowErrors.length
    const blocked = plan.errors.length > 0
    const canImport = !blocked && me !== null && online && name.trim() !== ''
    return (
      <Screen>
        <TopBar title="Review import" onBack={() => setLoaded(null)} />
        <div className="flex flex-col gap-5 p-4">
          <p className="truncate text-xs text-text-muted">{fileName}</p>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-name" className="text-[13px] font-extrabold text-gray-700">Trip name</label>
            <input id="import-name" className={inputClass} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-extrabold text-gray-700">Default currency</span>
            <CurrencyPicker value={currency} onChange={setCurrency} />
          </div>

          <div className="flex gap-2.5">
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[13px] font-extrabold text-gray-700">Starts</span>
              <input className={inputClass} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="text-[13px] font-extrabold text-gray-700">Ends</span>
              <input className={inputClass} type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>

          <p data-testid="import-counts" className="rounded-[12px] bg-surface px-4 py-3 text-[15px] font-bold">
            {`${plan.expenses.length} ${plan.expenses.length === 1 ? 'expense' : 'expenses'} · ${plan.settlements.length} ${
              plan.settlements.length === 1 ? 'payment' : 'payments'
            } · ${plan.skipped} skipped`}
          </p>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-[13px] font-extrabold text-gray-700">Which one is you?</legend>
            {plan.members.map((m) => (
              <label key={m.key} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-[12px] border border-gray-300 bg-surface px-3.5 has-[:checked]:border-2 has-[:checked]:border-primary">
                <input type="radio" name="me" value={m.key} checked={me === m.key} onChange={() => setMe(m.key)} className="h-5 w-5 accent-[#7340FE]" />
                <span className="text-[15px] font-semibold">{m.name}</span>
              </label>
            ))}
            <span className="text-xs leading-relaxed text-text-muted">
              Everyone else is added by name. They can claim their name later from the invite link.
            </span>
          </fieldset>

          {plan.categorySummary.length > 0 && (
            <section aria-label="Categories" className="flex flex-col gap-2">
              <h2 className="text-[13px] font-extrabold text-gray-700">Categories</h2>
              <ul className="flex flex-col divide-y divide-gray-100 rounded-2xl bg-surface">
                {plan.categorySummary.map((c) => (
                  <li key={`${c.source}-${c.key}`} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span>
                      {c.source} → {c.label}
                    </span>
                    <span className="font-bold text-text-muted">· {c.count}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {plan.errors.map((e) => (
            <p key={e} role="alert" className="rounded-[12px] bg-error-light px-3.5 py-3 text-sm font-bold text-error">
              {e}
            </p>
          ))}

          {warningCount > 0 && (
            <details className="rounded-2xl bg-warning-light px-4 py-3 text-[#6B4400]">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-extrabold">
                {warningCount} {warningCount === 1 ? 'warning' : 'warnings'}
                <ChevronDown size={18} aria-hidden="true" />
              </summary>
              <ul className="mt-2 flex flex-col gap-1.5 text-[13px] leading-relaxed">
                {plan.rowErrors.map((w) => (
                  <li key={w} className="font-bold text-error">{w}</li>
                ))}
                {plan.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </details>
          )}

          {importError && (
            <p role="alert" className="rounded-[12px] bg-error-light px-3.5 py-3 text-sm font-bold text-error">
              {importError === PAYMENT_RATE_ERROR ? `${importError}.` : importError}
            </p>
          )}
          {!online && (
            <p role="status" className="rounded-[12px] bg-warning-light px-3.5 py-3 text-sm font-semibold text-[#6B4400]">
              You’re offline. Importing needs an internet connection.
            </p>
          )}
        </div>
        <div className="sticky bottom-0 mt-auto border-t border-gray-100 bg-background px-4 pb-5 pt-3">
          {me === null && !blocked && <p className="pb-2 text-center text-xs text-text-muted">Choose who you are to import.</p>}
          <button
            type="button"
            disabled={!canImport}
            onClick={() => void runImport()}
            className="h-14 w-full rounded-full bg-primary text-base font-bold text-white disabled:bg-[#C9C2DA]"
          >
            Import trip
          </button>
        </div>
      </Screen>
    )
  }

  // ---------------------------------------------------------------- pick
  return (
    <Screen>
      <TopBar title="Import from Splitwise" close onBack={() => navigate('/trips')} />
      <div className="flex flex-col gap-4 p-4">
        <p className="text-sm leading-relaxed text-text-muted">
          In Splitwise, open the group → ⚙ Settings → Export as spreadsheet. Then choose the file here.
        </p>
        <div
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={`flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-10 text-center ${
            dragging ? 'border-primary bg-primary-light' : 'border-gray-300 bg-surface'
          }`}
        >
          <FileUp size={32} aria-hidden="true" className="text-primary" />
          <p className="text-sm text-text-muted">Drop the CSV file here, or</p>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={reading}
            className="h-12 rounded-full bg-primary px-6 text-[15px] font-bold text-white disabled:bg-[#C9C2DA]"
          >
            {reading ? 'Reading…' : 'Choose file'}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            aria-label="Splitwise CSV file"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
              e.target.value = ''
            }}
          />
        </div>
        {pickError && (
          <div role="alert" className="flex flex-col gap-1.5 rounded-[12px] bg-error-light px-3.5 py-3 text-sm">
            <b className="text-error">{pickError.message}</b>
            <span className="text-text-muted">{pickError.expected}</span>
          </div>
        )}
      </div>
    </Screen>
  )
}
