export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          display_name: string
          budget_strategy: string | null
          currency: string
          onboarding_completed: boolean
          created_at: string
        }
        Insert: {
          id: string
          email: string
          display_name: string
          budget_strategy?: string | null
          currency?: string
          onboarding_completed?: boolean
          created_at?: string
        }
        Update: {
          id?: string
          email?: string
          display_name?: string
          budget_strategy?: string | null
          currency?: string
          onboarding_completed?: boolean
        }
      }
      categories: {
        Row: {
          id: string
          name: string
          icon: string
          color: string
          sort_order: number
          is_active: boolean
        }
        Insert: {
          id?: string
          name: string
          icon: string
          color: string
          sort_order?: number
          is_active?: boolean
        }
        Update: {
          name?: string
          icon?: string
          color?: string
          sort_order?: number
          is_active?: boolean
        }
      }
      budgets: {
        Row: {
          id: string
          user_id: string
          month: string
          total_amount: number
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          month: string
          total_amount: number
          created_at?: string
        }
        Update: {
          month?: string
          total_amount?: number
        }
      }
      budget_allocations: {
        Row: {
          id: string
          budget_id: string
          category_id: string
          allocated_amount: number
        }
        Insert: {
          id?: string
          budget_id: string
          category_id: string
          allocated_amount: number
        }
        Update: {
          allocated_amount?: number
        }
      }
      transactions: {
        Row: {
          id: string
          user_id: string
          category_id: string
          amount: number
          type: string
          description: string
          date: string
          is_recurring: boolean
          recurrence_rule: string | null
          parent_transaction_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          category_id: string
          amount: number
          type: string
          description: string
          date: string
          is_recurring?: boolean
          recurrence_rule?: string | null
          parent_transaction_id?: string | null
          created_at?: string
        }
        Update: {
          category_id?: string
          amount?: number
          type?: string
          description?: string
          date?: string
          is_recurring?: boolean
          recurrence_rule?: string | null
        }
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
