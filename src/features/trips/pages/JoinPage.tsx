import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { MemberAvatar } from '../components/MemberAvatar'
import { Screen, Spinner, TopBar } from '../components/Screen'
import { formatRange } from '../lib/dates'
import { normalizeInviteCode } from '../lib/invite'
import type { InvitePreview } from '../services/TripsRepository'
import { useTripsStore } from '../store/TripsContext'

/** "Join with code": enter an invite code (or paste the link) and continue. */
export function JoinCodePage() {
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const code = normalizeInviteCode(text)
    if (code.length < 4) {
      setError('Enter the invite code you were sent')
      return
    }
    navigate(`/trips/join/${code}`)
  }

  return (
    <Screen>
      <TopBar title="Join a trip" onBack={() => navigate('/trips')} />
      <form onSubmit={submit} noValidate className="flex flex-col gap-4 p-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="invite-code" className="text-[13px] font-extrabold text-gray-700">Invite code</label>
          <input
            id="invite-code"
            value={text}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            placeholder="a1b2 c3d4"
            aria-invalid={!!error}
            onChange={(e) => {
              setText(e.target.value)
              setError(null)
            }}
            className="h-12 w-full rounded-[12px] border border-gray-300 bg-surface px-3.5 font-mono text-lg tracking-widest outline-none focus:border-2 focus:border-primary focus:px-[13px]"
          />
          {error && <span role="alert" className="text-xs font-bold text-error">{error}</span>}
          <span className="text-xs text-text-muted">You can also paste the whole invite link.</span>
        </div>
        <button type="submit" className="h-14 w-full rounded-full bg-primary text-base font-bold text-white">
          Continue
        </button>
      </form>
    </Screen>
  )
}

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; preview: InvitePreview }
  | { kind: 'invalid' }
  | { kind: 'error'; message: string }

const NOT_LISTED = '__new__'

/** Invite screen: shows the trip and who is still unclaimed, then joins as the chosen person. */
export function JoinPage() {
  const { code = '' } = useParams()
  const [params] = useSearchParams()
  const preselect = params.get('member')
  const navigate = useNavigate()
  const previewInvite = useTripsStore((s) => s.previewInvite)
  const joinTrip = useTripsStore((s) => s.joinTrip)
  const loadTrips = useTripsStore((s) => s.loadTrips)
  const trips = useTripsStore((s) => s.trips)
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' })
  const [choice, setChoice] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadTrips()
      const res = await previewInvite(code)
      if (cancelled) return
      if (res.ok) {
        setPhase({ kind: 'ready', preview: res.preview })
        // Someone who picked their name on the view-only link arrives with it already chosen.
        setChoice((current) => current ?? (res.preview.unclaimed.some((m) => m.id === preselect) ? preselect : null))
      }
      else setPhase(res.reason === 'invalid' ? { kind: 'invalid' } : { kind: 'error', message: res.error })
    })()
    return () => {
      cancelled = true
    }
  }, [code, previewInvite, loadTrips, reload, preselect])

  const join = async () => {
    if (phase.kind !== 'ready' || choice === null || busy) return
    setBusy(true)
    setMessage(null)
    const res = await joinTrip(code, phase.preview.tripId, choice === NOT_LISTED ? null : choice)
    setBusy(false)
    if (res.ok) {
      navigate(`/trips/${phase.preview.tripId}`, { replace: true })
    } else if (res.reason === 'claimed') {
      setMessage('Someone just claimed that name. Pick another one.')
      setChoice(null)
      setReload((n) => n + 1)
    } else if (res.reason === 'invalid') {
      setPhase({ kind: 'invalid' })
    } else {
      setMessage(res.error)
    }
  }

  const alreadyIn = phase.kind === 'ready' && !!trips[phase.preview.tripId]

  return (
    <Screen>
      <TopBar title="Join a trip" onBack={() => navigate('/trips')} />
      {phase.kind === 'loading' && <Spinner />}
      {phase.kind === 'invalid' && (
        <div role="alert" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <b className="text-base">This invite doesn’t work</b>
          <p className="text-sm text-text-muted">Check the code, or ask for a new link.</p>
          <button type="button" onClick={() => navigate('/trips/join')} className="h-11 rounded-full border border-gray-300 bg-surface px-5 text-sm font-bold">
            Enter another code
          </button>
        </div>
      )}
      {phase.kind === 'error' && (
        <div role="alert" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <b className="text-base">Couldn’t open the invite</b>
          <p className="text-sm text-text-muted">{phase.message}</p>
          <button type="button" onClick={() => setReload((n) => n + 1)} className="h-11 rounded-full border border-gray-300 bg-surface px-5 text-sm font-bold">
            Try again
          </button>
        </div>
      )}
      {phase.kind === 'ready' && (
        <div className="flex flex-col gap-5 p-4 pb-10">
          <div className="rounded-[20px] bg-primary-dark p-[18px] text-white">
            <div className="text-xl font-extrabold">{phase.preview.name}</div>
            <div className="text-[13px] font-semibold text-[#CFC3F5]">
              {formatRange(phase.preview.startDate, phase.preview.endDate)}
              {formatRange(phase.preview.startDate, phase.preview.endDate) ? ' · ' : ''}
              {phase.preview.defaultCurrency}
            </div>
          </div>

          {alreadyIn ? (
            <div className="flex flex-col gap-3">
              <p role="status" className="rounded-[12px] bg-success-light px-3 py-2.5 text-sm font-bold text-success">
                You’re already on this trip.
              </p>
              <button type="button" onClick={() => navigate(`/trips/${phase.preview.tripId}`, { replace: true })} className="h-14 w-full rounded-full bg-primary text-base font-bold text-white">
                Open trip
              </button>
            </div>
          ) : (
            <>
              <section aria-label="Which one are you?" className="flex flex-col gap-2">
                <h2 className="text-[15px] font-extrabold">Which one are you?</h2>
                <div role="radiogroup" aria-label="Which one are you?" className="rounded-[18px] bg-surface px-3.5">
                  {phase.preview.unclaimed.map((m, i) => (
                    <button
                      key={m.id}
                      type="button"
                      role="radio"
                      aria-checked={choice === m.id}
                      onClick={() => setChoice(m.id)}
                      className="flex min-h-14 w-full items-center gap-3 border-b border-gray-100 text-left"
                    >
                      <MemberAvatar name={m.displayName} color={['#FD6FB8', '#93D4D9', '#FDAC62', '#D0E2FF'][i % 4] ?? '#ddd'} size={36} />
                      <span className="flex-1 text-[15px] font-bold">{m.displayName}</span>
                      <span aria-hidden="true" className={`h-5 w-5 rounded-full border-2 ${choice === m.id ? 'border-primary bg-primary shadow-[inset_0_0_0_3px_#fff]' : 'border-gray-300'}`} />
                    </button>
                  ))}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={choice === NOT_LISTED}
                    onClick={() => setChoice(NOT_LISTED)}
                    className="flex min-h-14 w-full items-center gap-3 text-left"
                  >
                    <span className="flex-1 text-[15px] font-bold">I’m not listed</span>
                    <span aria-hidden="true" className={`h-5 w-5 rounded-full border-2 ${choice === NOT_LISTED ? 'border-primary bg-primary shadow-[inset_0_0_0_3px_#fff]' : 'border-gray-300'}`} />
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-text-muted">Picking your name keeps the expenses already added for you.</p>
              </section>
              {message && <p role="alert" className="text-sm font-bold text-error">{message}</p>}
              <button
                type="button"
                disabled={choice === null || busy}
                onClick={() => void join()}
                className="h-14 w-full rounded-full bg-primary text-base font-bold text-white disabled:bg-[#C9C2DA]"
              >
                Join trip
              </button>
            </>
          )}
        </div>
      )}
    </Screen>
  )
}
