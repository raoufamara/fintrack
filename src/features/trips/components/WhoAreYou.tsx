import type { Transfer, TripMember } from '../types'
import { formatMoney } from '../lib/currency'

interface WhoAreYouProps {
  members: readonly TripMember[]
  pickedId: string | null
  onPick: (memberId: string | null) => void
  /** The picked member's transfers, in the trip currency. */
  transfers: readonly Transfer[]
  currency: string
}

/** Guest "Who are you?" chips, with the picked member's settle-up lines. Only a viewing preference. */
export function WhoAreYou({ members, pickedId, onPick, transfers, currency }: WhoAreYouProps) {
  const name = (id: string) => members.find((m) => m.id === id)?.display_name ?? '?'
  const picked = members.find((m) => m.id === pickedId)
  return (
    <div className="flex flex-col gap-2.5 rounded-[14px] bg-white/10 p-3">
      <div className="text-[13px] font-bold">Who are you?</div>
      <div role="group" aria-label="Who are you?" className="flex flex-wrap gap-2">
        {members.map((m) => {
          const on = m.id === pickedId
          return (
            <button
              key={m.id}
              type="button"
              aria-pressed={on}
              onClick={() => onPick(on ? null : m.id)}
              className={`h-9 rounded-full border px-3.5 text-[13px] font-bold ${on ? 'border-white bg-white text-primary-dark' : 'border-white/35 bg-transparent text-white'}`}
            >
              {m.display_name}
            </button>
          )
        })}
      </div>
      <div className="flex flex-col gap-1.5 border-t border-white/15 pt-2.5" aria-live="polite">
        {!picked ? (
          <span className="text-[13px] text-[#A9DCD7]">Pick your name to see your balance.</span>
        ) : transfers.length === 0 ? (
          <span className="text-[13px] text-[#A9DCD7]">{picked.display_name} is settled up</span>
        ) : (
          transfers.map((t) => (
            <div key={`${t.from}-${t.to}`} className="flex items-center justify-between gap-2">
              <span className="text-[13px] text-[#A9DCD7]">
                {name(t.from)} owes {name(t.to)} {formatMoney(t.amount, currency)}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
