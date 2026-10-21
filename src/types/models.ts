export interface User {
  id: string
  email: string
  display_name: string
  budget_strategy: string | null
  currency: string
  onboarding_completed: boolean
  created_at: string
}
