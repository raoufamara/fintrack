export type BudgetStrategy = 'envelope' | '50_30_20' | 'zero_based' | 'tracking_only'

export type TransactionType = 'income' | 'expense'

export type RecurrenceRule = 'daily' | 'weekly' | 'biweekly' | 'monthly'

export interface User {
  id: string
  email: string
  display_name: string
  budget_strategy: BudgetStrategy | null
  currency: string
  onboarding_completed: boolean
  created_at: string
}

export interface Category {
  id: string
  name: string
  icon: string
  color: string
  sort_order: number
  is_active: boolean
}

export interface Budget {
  id: string
  user_id: string
  month: string
  total_amount: number
  created_at: string
}

export interface BudgetAllocation {
  id: string
  budget_id: string
  category_id: string
  allocated_amount: number
}

export interface Transaction {
  id: string
  user_id: string
  category_id: string
  amount: number
  type: TransactionType
  description: string
  date: string
  is_recurring: boolean
  recurrence_rule: RecurrenceRule | null
  parent_transaction_id: string | null
  created_at: string
}
