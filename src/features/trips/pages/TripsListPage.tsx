import { useEffect } from 'react'
import { Plane, Plus } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ErrorState, Spinner } from '../components/Screen'
import { CompactTripCard, FeaturedTripCard } from '../components/TripCard'
import { todayISO } from '../lib/dates'
import { useCurrentUserId, useTripsStore } from '../store/TripsContext'

export function TripsListPage() {
  const navigate = useNavigate()
  const userId = useCurrentUserId()
  const status = useTripsStore((s) => s.listStatus)
  const error = useTripsStore((s) => s.listError)
  const order = useTripsStore((s) => s.tripOrder)
  const trips = useTripsStore((s) => s.trips)
  const loadTrips = useTripsStore((s) => s.loadTrips)

  useEffect(() => {
    void loadTrips()
  }, [loadTrips])

  const today = todayISO()
  const snapshots = order.flatMap((id) => (trips[id] ? [trips[id]] : []))
  const isPast = (end: string | null) => end !== null && end < today
  const current = snapshots.filter((s) => !isPast(s.trip.end_date))
  const past = snapshots.filter((s) => isPast(s.trip.end_date))
  const open = (id: string) => navigate(`/trips/${id}`)

  return (
    <div className="mx-auto flex min-h-full w-full max-w-[430px] flex-col px-4 pb-4 pt-6">
      <div className="flex items-center justify-between pt-2">
        <h1 className="text-[28px] font-extrabold tracking-tight">Trips</h1>
        <button
          type="button"
          onClick={() => navigate('/trips/join')}
          className="h-9 rounded-full border border-gray-300 bg-surface px-3 text-[13px] font-bold text-gray-700"
        >
          Join with code
        </button>
      </div>

      {status === 'loading' && snapshots.length === 0 && <Spinner />}
      {status === 'error' && snapshots.length === 0 && (
        <ErrorState message={error ?? 'Could not load your trips.'} onRetry={() => void loadTrips()} />
      )}

      {status === 'ready' && snapshots.length === 0 && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-16 text-center">
          <span
            aria-hidden="true"
            className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-light text-primary"
          >
            <Plane size={36} />
          </span>
          <b className="text-base">No trips yet</b>
          <p className="text-sm text-text-muted">Track who paid for what and settle up at the end.</p>
        </div>
      )}

      {snapshots.length > 0 && (
        <div className="flex flex-col gap-4 pt-4">
          {current.length > 0 && (
            <>
              <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">Ongoing</h2>
              {current.map((s) => (
                <FeaturedTripCard key={s.trip.id} snapshot={s} userId={userId} onOpen={open} today={today} />
              ))}
            </>
          )}
          {past.length > 0 && (
            <>
              <h2 className="pt-1.5 text-xs font-extrabold uppercase tracking-widest text-text-muted">Past</h2>
              <div className="flex flex-col gap-2.5">
                {past.map((s) => (
                  <CompactTripCard key={s.trip.id} snapshot={s} userId={userId} onOpen={open} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="sticky bottom-24 mt-auto pt-6">
        <button
          type="button"
          onClick={() => navigate('/trips/new')}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-bold text-white shadow-lg"
        >
          <Plus size={20} aria-hidden="true" />
          New trip
        </button>
      </div>
    </div>
  )
}
