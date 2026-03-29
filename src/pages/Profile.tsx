import { Link } from 'react-router-dom'
import { LogOut, ChevronRight } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'
import { BUDGET_STRATEGIES } from '@/lib/constants'

export function Profile() {
  const { profile, signOut } = useAuthStore()

  const currentStrategy = BUDGET_STRATEGIES.find((s) => s.id === profile?.budget_strategy)

  return (
    <div className="px-5 pt-12 pb-24">
      <h1 className="text-2xl font-bold">Profile</h1>

      {/* User info */}
      <div className="mt-6 bg-surface rounded-[var(--radius-lg)] p-5">
        <p className="font-bold text-lg">{profile?.display_name}</p>
        <p className="text-sm text-text-secondary mt-0.5">{profile?.email}</p>
      </div>

      {/* Settings */}
      <div className="mt-6">
        <h2 className="font-bold text-sm text-text-secondary mb-3">Settings</h2>

        <Link
          to="/onboarding/strategy"
          className="flex items-center justify-between bg-surface rounded-[var(--radius-md)] p-4 mb-2"
        >
          <div>
            <p className="text-sm font-semibold text-text-primary">Budget strategy</p>
            <p className="text-xs text-text-secondary mt-0.5">
              {currentStrategy ? currentStrategy.name : 'Not set'}
            </p>
          </div>
          <ChevronRight size={18} className="text-text-secondary" />
        </Link>
      </div>

      {/* Sign out */}
      <button
        onClick={signOut}
        className="mt-8 w-full flex items-center justify-center gap-2 bg-surface text-error font-semibold py-3 rounded-[var(--radius-xl)] border border-gray-200"
      >
        <LogOut size={18} />
        Sign out
      </button>
    </div>
  )
}
