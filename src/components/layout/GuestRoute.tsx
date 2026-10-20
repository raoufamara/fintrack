import { Navigate, useSearchParams } from 'react-router-dom'
import { safeRedirect } from '@/lib/safeRedirect'
import { useAuthStore } from '@/stores/authStore'

export function GuestRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuthStore()
  const [searchParams] = useSearchParams()

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (session) {
    return <Navigate to={safeRedirect(searchParams.get('redirect'))} replace />
  }

  return <>{children}</>
}
