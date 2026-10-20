import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { getCurrency } from '../lib/currency'
import { CurrencySheet } from './CurrencySheet'

interface CurrencyPickerProps {
  value: string
  onChange: (code: string) => void
  label?: string
}

/** Button that opens a searchable currency sheet (code, name or country). */
export function CurrencyPicker({ value, onChange, label = 'Default currency' }: CurrencyPickerProps) {
  const [open, setOpen] = useState(false)
  const current = getCurrency(value)
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
      <CurrencySheet open={open} onClose={() => setOpen(false)} onSelect={onChange} selected={value} />
    </>
  )
}
