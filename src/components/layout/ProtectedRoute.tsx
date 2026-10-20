import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, loading } = useAuthStore()
  const location = useLocation()

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-3 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!session) {
    // Remember where they were going (e.g. an invite link) so login can send them back.
    const back = location.pathname + location.search
    return <Navigate to={back === '/' ? '/login' : `/login?redirect=${encodeURIComponent(back)}`} replace />
  }

  return <>{children}</>
}
