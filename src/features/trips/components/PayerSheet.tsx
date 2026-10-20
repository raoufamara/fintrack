import { Check } from 'lucide-react'
import type { TripMember } from '../types'
import { BottomSheet } from './BottomSheet'
import { MemberAvatar } from './MemberAvatar'

interface PayerSheetProps {
  open: boolean
  onClose: () => void
  members: readonly TripMember[]
  value: string
  onChange: (memberId: string) => void
}

export function PayerSheet({ open, onClose, members, value, onChange }: PayerSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title="Paid by">
      <div className="flex flex-col">
        {members.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={m.id === value}
            onClick={() => {
              onChange(m.id)
              onClose()
            }}
            className="flex min-h-14 items-center gap-3 border-b border-gray-100 text-left last:border-b-0"
          >
            <MemberAvatar name={m.display_name} color={m.color} size={36} />
            <span className="flex-1 text-[15px] font-bold">{m.display_name}</span>
            {m.id === value && <Check size={20} className="text-primary" aria-label="Selected" />}
          </button>
        ))}
      </div>
    </BottomSheet>
  )
}
