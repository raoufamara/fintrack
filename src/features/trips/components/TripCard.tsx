import { formatMoney, toMinor } from '../lib/currency'
import { daysBetween, formatRange, todayISO } from '../lib/dates'
import type { TripSnapshot } from '../services/TripsRepository'
import { balanceLine, findCurrentMember, isOngoing, summarizeTrip } from '../store/selectors'

interface TripCardProps {
  snapshot: TripSnapshot
  userId: string
  onOpen: (tripId: string) => void
  /** Overridable for tests. */
  today?: string
}

export function FeaturedTripCard({ snapshot, userId, onOpen, today = todayISO() }: TripCardProps) {
  const { trip } = snapshot
  const me = findCurrentMember(snapshot, userId)
  const summary = summarizeTrip(snapshot, me?.id)
  const budget = trip.budget_amount === null ? null : toMinor(trip.budget_amount, trip.default_currency)
  const pct = budget && budget > 0 ? Math.min(100, Math.round((summary.spent * 100) / budget)) : 0
  const ongoing = isOngoing(trip, today)
  const range = formatRange(trip.start_date, trip.end_date)

  return (
    <button
      type="button"
      onClick={() => onOpen(trip.id)}
      className="flex w-full flex-col gap-3.5 rounded-[20px] bg-primary-dark p-[18px] text-left text-white"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-xl font-extrabold">{trip.name}</span>
          <span className="text-[13px] font-semibold text-[#A9DCD7]">
            {range ? `${range} · ` : ''}
            {snapshot.members.length} {snapshot.members.length === 1 ? 'person' : 'people'} ·{' '}
            {trip.default_currency}
          </span>
        </span>
        {ongoing && trip.start_date && trip.end_date && (
          <span className="whitespace-nowrap rounded-[8px] bg-owe-light px-2.5 py-1.5 text-xs font-extrabold text-primary-dark">
            Day {daysBetween(trip.start_date, today) + 1} of {daysBetween(trip.start_date, trip.end_date) + 1}
          </span>
        )}
      </span>
      <span className="flex justify-between text-[13px] font-bold tabular-nums">
        <span>{formatMoney(summary.spent, trip.default_currency)} spent</span>
        {budget !== null && (
          <span className="text-[#A9DCD7]">{formatMoney(budget, trip.default_currency)} budget</span>
        )}
      </span>
      {budget !== null && (
        <span className="block h-2 overflow-hidden rounded bg-white/15">
          <i className="block h-full bg-[#6FD0C6]" style={{ width: `${pct}%` }} />
        </span>
      )}
      <span className="text-[13px] font-bold text-owe-light">{balanceLine(snapshot, userId)}</span>
    </button>
  )
}

export function CompactTripCard({ snapshot, userId, onOpen }: TripCardProps) {
  const { trip } = snapshot
  const me = findCurrentMember(snapshot, userId)
  const summary = summarizeTrip(snapshot, me?.id)
  const settled = summary.transfers.length === 0
  const range = formatRange(trip.start_date, trip.end_date)
  return (
    <button
      type="button"
      onClick={() => onOpen(trip.id)}
      className="flex w-full items-center gap-3.5 rounded-[18px] bg-surface p-4 text-left"
    >
      <span
        aria-hidden="true"
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] text-[13px] font-extrabold"
        style={{ background: 'var(--color-tripcat-teal-bg)', color: 'var(--color-tripcat-teal)' }}
      >
        {trip.default_currency}
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[15px] font-bold">{trip.name}</span>
        <span className="truncate text-xs text-text-muted">
          {range ? `${range} · ` : ''}
          {snapshot.members.length} {snapshot.members.length === 1 ? 'person' : 'people'}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <b className="text-sm tabular-nums">{formatMoney(summary.spent, trip.default_currency)}</b>
        <span className={`text-xs font-bold ${settled ? 'text-success' : 'text-owe'}`}>
          {settled ? 'Settled' : 'Open balance'}
        </span>
      </span>
    </button>
  )
}
