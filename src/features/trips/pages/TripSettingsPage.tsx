import { ChevronRight, Tag } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { Screen, TopBar } from '../components/Screen'

/** Minimal settings screen. Members, currency and sharing arrive in later phases. */
export function TripSettingsPage() {
  const navigate = useNavigate()
  const { tripId = '' } = useParams()
  return (
    <Screen>
      <TopBar title="Trip settings" />
      <div className="flex flex-col gap-4 p-4">
        <div className="rounded-2xl bg-surface">
          <button
            type="button"
            onClick={() => navigate(`/trips/${tripId}/categories`)}
            className="flex min-h-14 w-full items-center gap-3 px-4 text-left"
          >
            <Tag size={20} aria-hidden="true" className="text-primary" />
            <span className="flex-1 text-[15px] font-bold">Categories</span>
            <ChevronRight size={18} aria-hidden="true" className="text-text-muted" />
          </button>
        </div>
        <p className="px-1 text-xs text-text-muted">More settings are coming soon.</p>
      </div>
    </Screen>
  )
}
