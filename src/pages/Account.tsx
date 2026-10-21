import { LogOut } from 'lucide-react'
import { useAuthStore } from '@/stores/authStore'

export function Account() {
  const { profile, user, signOut } = useAuthStore()

  return (
    <div className="mx-auto w-full max-w-[430px] px-4 pt-8 pb-24">
      <h1 className="text-[28px] font-extrabold tracking-tight">Account</h1>

      <div className="mt-6 bg-surface rounded-[var(--radius-lg)] p-5">
        <p className="font-bold text-lg">{profile?.display_name}</p>
        <p className="text-sm text-text-muted mt-0.5">{profile?.email ?? user?.email}</p>
      </div>

      <button
        type="button"
        onClick={signOut}
        className="mt-8 w-full flex items-center justify-center gap-2 bg-surface text-error font-semibold py-3 rounded-[var(--radius-xl)] border border-gray-200"
      >
        <LogOut size={18} aria-hidden="true" />
        Sign out
      </button>
    </div>
  )
}
