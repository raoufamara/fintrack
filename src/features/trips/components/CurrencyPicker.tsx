import { useMemo, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { CURRENCIES, getCurrency } from '../lib/currency'
import { normalizeSearch } from '../lib/filter'
import { BottomSheet } from './BottomSheet'

interface CurrencyPickerProps {
  value: string
  onChange: (code: string) => void
  label?: string
}

/** Searchable currency select: matches ISO code, name or country ("dirham", "Morocco"). */
export function CurrencyPicker({ value, onChange, label = 'Default currency' }: CurrencyPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const current = getCurrency(value)

  const results = useMemo(() => {
    const q = normalizeSearch(query)
    if (!q) return CURRENCIES
    return CURRENCIES.filter((c) =>
      normalizeSearch([c.code, c.name, ...c.countries].join(' ')).includes(q),
    )
  }, [query])

  const close = () => {
    setOpen(false)
    setQuery('')
  }

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={`${label}: ${current?.name ?? value}`}
        onClick={() => setOpen(true)}
        className="flex h-12 w-full items-center justify-between rounded-[12px] border border-gray-300 bg-surface px-3.5 text-[15px] font-semibold"
      >
        <span>
          {value} <span className="font-medium text-text-muted">· {current?.name ?? 'Unknown'}</span>
        </span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <BottomSheet open={open} onClose={close} title="Choose a currency">
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
        <ul className="-mx-1 flex max-h-[50vh] flex-col overflow-y-auto">
          {results.map((c) => (
            <li key={c.code}>
              <button
                type="button"
                aria-pressed={c.code === value}
                onClick={() => {
                  onChange(c.code)
                  close()
                }}
                className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[8px] px-2 text-left hover:bg-black/5"
              >
                <span className="min-w-0 truncate text-sm font-semibold">
                  <b className={c.code === value ? 'text-primary' : ''}>{c.code}</b> · {c.name}
                </span>
                <span className="shrink-0 text-xs text-text-muted">{c.symbol}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && (
            <li className="py-6 text-center text-sm text-text-muted">No currency matches “{query}”</li>
          )}
        </ul>
      </BottomSheet>
    </>
  )
}
