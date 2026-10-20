import { useState } from 'react'
import { formatMoney } from '../lib/currency'
import { splitAmount } from '../lib/money'
import type { TripMember } from '../types'
import { BottomSheet } from './BottomSheet'
import { MemberAvatar } from './MemberAvatar'

interface SplitSheetProps {
  open: boolean
  onClose: () => void
  members: readonly TripMember[]
  selected: readonly string[]
  onChange: (memberIds: string[]) => void
  /** Amount being split, minor units; 0 hides the per-person preview. */
  totalMinor: number
  currency: string
}

/** Choose who shares an expense equally. At least one member always stays selected. */
export function SplitSheet({
  open,
  onClose,
  members,
  selected,
  onChange,
  totalMinor,
  currency,
}: SplitSheetProps) {
  const [notice, setNotice] = useState<string | null>(null)
  const parts = totalMinor > 0 && selected.length > 0 ? splitAmount(totalMinor, 'equal', selected) : null

  const toggle = (id: string) => {
    if (selected.includes(id)) {
      if (selected.length === 1) {
        setNotice('At least one person has to share this expense.')
        return
      }
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange(members.map((m) => m.id).filter((m) => m === id || selected.includes(m)))
    }
    setNotice(null)
  }

  const handleClose = () => {
    setNotice(null)
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={handleClose} title="Split equally">
      <p className="text-xs leading-relaxed text-text-muted">
        Choose who shares this expense. Exact amounts and shares come in a later version.
      </p>
      <div className="flex flex-col">
        {members.map((m) => {
          const on = selected.includes(m.id)
          return (
            <label
              key={m.id}
              htmlFor={`split-${m.id}`}
              className="flex min-h-14 cursor-pointer items-center gap-3 border-b border-gray-100 last:border-b-0"
            >
              <MemberAvatar name={m.display_name} color={m.color} size={36} />
              <span className="flex-1 text-[15px] font-bold">{m.display_name}</span>
              <span className="text-xs tabular-nums text-text-muted">
                {on && parts ? formatMoney(parts.get(m.id) ?? 0, currency) : ''}
              </span>
              <input
                id={`split-${m.id}`}
                aria-label={m.display_name}
                type="checkbox"
                checked={on}
                onChange={() => toggle(m.id)}
                className="h-[22px] w-[22px] accent-primary"
              />
            </label>
          )
        })}
      </div>
      {notice && (
        <p role="alert" className="text-xs font-bold text-error">
          {notice}
        </p>
      )}
      <button
        type="button"
        onClick={handleClose}
        className="h-14 w-full rounded-full bg-primary text-base font-bold text-white"
      >
        Done
      </button>
    </BottomSheet>
  )
}
