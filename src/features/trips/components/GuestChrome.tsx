import { Eye } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useCurrentMember, useGuest, useTripKey } from '../store/GuestContext'
import { useTripsStore } from '../store/TripsContext'

/** Slim amber bar at the top of every guest screen. */
export function GuestBar() {
  const guest = useGuest()
  if (!guest) return null
  const { sharedBy, fromCache } = guest.meta
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-2 bg-warning-light px-4 py-2 text-xs font-bold text-[#6B4400]">
        <Eye size={14} aria-hidden="true" />
        <span className="flex-1">View only{sharedBy ? ` · shared by ${sharedBy}` : ''}</span>
      </div>
      {fromCache && (
        <p role="status" className="bg-gray-100 px-4 py-1.5 text-xs font-semibold text-text-muted">
          Showing saved copy. You’re offline.
        </p>
      )}
    </div>
  )
}

/** Sticky call to action: guests join with a free account to add expenses. */
export function GuestJoinFooter() {
  const guest = useGuest()
  const navigate = useNavigate()
  const token = useTripKey()
  const snapshot = useTripsStore((s) => s.trips[token])
  const me = useCurrentMember(snapshot)
  if (!guest) return null

  const join = () => {
    // After login the member side exchanges the token for the invite code (request_join_from_share).
    const target = `/trips/join-shared/${token}${me ? `?member=${me.id}` : ''}`
    navigate(`/login?redirect=${encodeURIComponent(target)}`)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40">
      <div className="mx-auto max-w-[430px] border-t border-gray-100 bg-surface px-4 pb-5 pt-3">
        <button type="button" onClick={join} className="h-14 w-full rounded-full bg-primary text-base font-bold text-white">
          {me ? `Join as ${me.display_name} to add expenses` : 'Join to add expenses'}
        </button>
        <p className="mt-1.5 text-center text-xs text-text-muted">Free account. Past expenses stay linked to you.</p>
      </div>
    </div>
  )
}
