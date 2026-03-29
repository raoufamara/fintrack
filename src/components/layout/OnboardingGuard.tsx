import { Navigate } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

export function OnboardingGuard({ children }: { children: React.ReactNode }) {
  const profile = useAuthStore((s) => s.profile)

  // Still loading profile — show nothing while we wait
  if (!profile) return null

  // If onboarding not completed, redirect to wizard
  if (!profile.onboarding_completed) {
    return <Navigate to="/onboarding/strategy" replace />
  }

  return <>{children}</>
}
