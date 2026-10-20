import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Screen, Spinner, TopBar } from '../components/Screen'
import { useTripsStore } from '../store/TripsContext'

/**
 * Where a guest lands after logging in from a view-only link. It trades the
 * share token for the invite code (request_join_from_share) and continues to the
 * normal join screen, with the member they picked preselected.
 */
export function JoinSharedPage() {
  const { shareToken = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const requestJoinFromShare = useTripsStore((s) => s.requestJoinFromShare)
  const [failure, setFailure] = useState<string | null>(null)
  const member = params.get('member')

  useEffect(() => {
    let cancelled = false
    void requestJoinFromShare(shareToken).then((res) => {
      if (cancelled) return
      if (res.ok) {
        navigate(`/trips/join/${res.code}${member ? `?member=${encodeURIComponent(member)}` : ''}`, { replace: true })
      } else {
        setFailure(res.reason === 'dead' ? 'This link no longer works. Ask the trip owner for a new one.' : res.error)
      }
    })
    return () => {
      cancelled = true
    }
  }, [shareToken, member, requestJoinFromShare, navigate])

  return (
    <Screen>
      <TopBar title="Join a trip" onBack={() => navigate('/trips')} />
      {failure ? (
        <div role="alert" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <b className="text-base">Couldn’t open the invite</b>
          <p className="text-sm text-text-muted">{failure}</p>
        </div>
      ) : (
        <Spinner label="Opening the invite" />
      )}
    </Screen>
  )
}
