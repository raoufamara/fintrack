import { useEffect, useState } from 'react'
import { MapPin, Navigation } from 'lucide-react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ErrorState, Screen, Spinner, TopBar } from '../components/Screen'
import { useCurrentPlace } from '../hooks/useCurrentPlace'
import { usePlaceSearch, MIN_QUERY } from '../hooks/usePlaceSearch'
import {
  formatDistance,
  freeTextPlace,
  highlightParts,
  inferCity,
  placeLine,
  usedPlaces,
  type PlaceResult,
} from '../lib/places'
import { useTripsStore, useTripsStoreApi } from '../store/TripsContext'

export const OFFLINE_SEARCH_MESSAGE =
  'Search needs a connection. Pick a place you used before, or save what you typed as text.'

function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, i) =>
        part.bold ? (
          <b key={i} className="font-extrabold">
            {part.text}
          </b>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

/**
 * Full-screen place picker. It writes the choice into the expense draft (key in
 * the route state) and goes back, so the form comes back exactly as it was left.
 */
export function LocationPickerPage() {
  const { tripId = '' } = useParams()
  const navigate = useNavigate()
  const routeState = useLocation().state as { draftKey?: string } | null
  const storeApi = useTripsStoreApi()
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const status = useTripsStore((s) => s.tripStatus[tripId] ?? 'idle')
  const error = useTripsStore((s) => s.tripError[tripId])
  const loadTrip = useTripsStore((s) => s.loadTrip)
  const here = useCurrentPlace()
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!snapshot) void loadTrip(tripId)
  }, [loadTrip, tripId, snapshot])

  const near = here.place && here.place.lat !== null && here.place.lng !== null ? { lat: here.place.lat, lng: here.place.lng } : null
  const search = usePlaceSearch(query, near)

  if (!snapshot) {
    return (
      <Screen>
        <TopBar title="Location" close />
        {status === 'error' ? <ErrorState message={error || 'Could not load this trip.'} onRetry={() => void loadTrip(tripId)} /> : <Spinner />}
      </Screen>
    )
  }

  const choose = (place: PlaceResult | null) => {
    const key = routeState?.draftKey
    const draft = key ? storeApi.getState().drafts[key] : undefined
    if (key && draft) {
      // Distance is only for display; it is never stored.
      const stored = place ? { ...place, distanceKm: undefined } : null
      storeApi.getState().saveDraft(key, { ...draft, place: stored })
    }
    navigate(-1)
  }

  const locateHere = async () => {
    const found = await here.request()
    if (found) choose(found)
  }

  const trimmed = query.trim()
  const used = usedPlaces(snapshot.expenses)
  const city = inferCity(here.place?.city ?? null, snapshot.expenses)

  return (
    <Screen>
      <TopBar title="Location" close />
      <div className="flex flex-1 flex-col gap-4 p-4 pb-28">
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search for a place"
          aria-label="Search places"
          className="h-12 w-full rounded-[12px] border border-gray-300 bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-2 focus:border-primary focus:px-[13px]"
        />

        <button
          type="button"
          onClick={() => void locateHere()}
          disabled={here.status === 'locating'}
          className="flex min-h-14 w-full items-center gap-3 rounded-2xl bg-surface px-3.5 text-left"
        >
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] bg-primary-tint text-primary">
            <Navigation size={18} aria-hidden="true" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-bold">Current location</span>
            <span className="truncate text-xs text-text-muted">
              {here.status === 'locating' ? 'Finding you…' : here.place ? (placeLine(here.place) || here.place.name) : 'Uses your device location once'}
            </span>
          </span>
        </button>
        {here.message && (
          <p role="status" className="-mt-2 text-xs text-text-muted">
            {here.message}
          </p>
        )}

        {trimmed.length >= MIN_QUERY && (
          <section aria-label="Search results" className="flex flex-col">
            {search.status === 'loading' && <p role="status" className="py-3 text-sm text-text-muted">Searching…</p>}
            {search.status === 'error' && (
              <p role="alert" className="rounded-[12px] bg-warning-light px-3 py-2.5 text-sm font-semibold text-[#6B4400]">
                {OFFLINE_SEARCH_MESSAGE}
              </p>
            )}
            {search.status === 'ready' && search.results.length === 0 && (
              <p className="py-3 text-sm text-text-muted">No places found for “{trimmed}”.</p>
            )}
            {search.status === 'ready' && (
              <ul className="rounded-2xl bg-surface px-3">
                {search.results.map((p, i) => (
                  <li key={p.providerId ?? `${p.name}-${i}`} className="border-b border-gray-100 last:border-b-0">
                    <button type="button" onClick={() => choose(p)} className="flex min-h-14 w-full items-center gap-3 py-2 text-left">
                      <MapPin size={16} aria-hidden="true" className="shrink-0 text-text-muted" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate text-[15px]"><Highlight text={p.name} query={trimmed} /></span>
                        {p.address && <span className="truncate text-xs text-text-muted">{p.address}</span>}
                        <span className="truncate text-xs text-text-muted">{placeLine(p)}</span>
                      </span>
                      {p.distanceKm != null && (
                        <span className="shrink-0 text-xs tabular-nums text-text-muted">{formatDistance(p.distanceKm)}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {used.length > 0 && (
          <section aria-label="Used on this trip" className="flex flex-col gap-2">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">Used on this trip</h2>
            <div className="flex flex-wrap gap-2">
              {used.map((p) => (
                <button
                  key={p.providerId ?? `${p.name}|${p.city}`}
                  type="button"
                  onClick={() => choose(p)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-full border border-gray-300 bg-surface px-3.5 text-[13px] font-bold"
                >
                  <MapPin size={14} aria-hidden="true" />
                  {p.name}
                </button>
              ))}
            </div>
          </section>
        )}

        {trimmed.length >= 1 && (
          <section aria-label="Can’t find it?" className="flex flex-col gap-2">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">Can’t find it?</h2>
            <button
              type="button"
              onClick={() => choose(freeTextPlace(trimmed, city))}
              className="flex min-h-14 w-full flex-col items-start justify-center rounded-2xl border border-dashed border-gray-300 px-3.5 text-left"
            >
              <span className="text-[15px] font-bold">Save “{trimmed}” as text</span>
              <span className="text-xs text-text-muted">
                {city ? `It still groups under ${city} in filters.` : 'It won’t group under a city in filters.'}
              </span>
            </button>
          </section>
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40">
        <div className="mx-auto max-w-[430px] border-t border-gray-100 bg-background px-4 pb-5 pt-3">
          <button
            type="button"
            onClick={() => choose(null)}
            className="h-14 w-full rounded-full border border-gray-300 bg-surface text-base font-bold"
          >
            Skip: no location
          </button>
        </div>
      </div>
    </Screen>
  )
}
