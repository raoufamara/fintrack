import { MapPin, Navigation, Search, X } from 'lucide-react'
import { useCurrentPlace } from '../hooks/useCurrentPlace'
import { placeLine, type PlaceResult } from '../lib/places'

interface LocationFieldProps {
  place: PlaceResult | null
  onChange: (place: PlaceResult | null) => void
  /** Opens the full-screen place picker. */
  onSearch: () => void
}

/** Optional place of an expense: empty (use here / search) or filled (chip with a clear button). */
export function LocationField({ place, onChange, onSearch }: LocationFieldProps) {
  const here = useCurrentPlace()
  const known = here.place

  const locateHere = async () => {
    const found = await here.request()
    if (found) onChange(found)
  }

  return (
    <div className="flex flex-col gap-2" role="group" aria-label="Location">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[13px] font-extrabold text-gray-700">Location</span>
        <span className="text-xs text-text-muted">· optional</span>
      </div>

      {place ? (
        <div className="flex items-center gap-2.5 rounded-[12px] border border-gray-300 bg-surface py-2 pl-3 pr-1.5">
          <MapPin size={16} aria-hidden="true" className="shrink-0 text-primary" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-bold">{place.name}</span>
            <span className="truncate text-xs text-text-muted">{placeLine(place) || 'Free-text place'}</span>
          </span>
          <button
            type="button"
            aria-label="Remove location"
            onClick={() => onChange(null)}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] hover:bg-black/5"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void locateHere()}
            disabled={here.status === 'locating'}
            className="flex h-12 min-w-0 flex-1 items-center gap-2 overflow-hidden whitespace-nowrap rounded-[12px] border border-dashed border-[#6FD0C6] bg-primary-tint px-3 text-[13px] font-bold text-primary"
          >
            <Navigation size={16} aria-hidden="true" className="shrink-0" />
            <span className="truncate">
              {here.status === 'locating'
                ? 'Finding you…'
                : known
                  ? `Use here: ${placeLine(known) || known.name}`
                  : 'Use current location'}
            </span>
          </button>
          <button
            type="button"
            onClick={onSearch}
            className="flex h-12 shrink-0 items-center gap-1.5 rounded-[12px] border border-gray-300 bg-surface px-4 text-sm font-bold"
          >
            <Search size={16} aria-hidden="true" />
            Search
          </button>
        </div>
      )}
      {!place && here.message && (
        <p role="status" className="text-xs text-text-muted">
          {here.message}
        </p>
      )}
    </div>
  )
}
