import type { Category } from '@/types/models'

export const PRESET_CATEGORIES: Omit<Category, 'id'>[] = [
  { name: 'Housing / Rent', icon: 'house', color: '#7340FE', sort_order: 1, is_active: true },
  { name: 'Groceries', icon: 'shopping-cart', color: '#249A0E', sort_order: 2, is_active: true },
  { name: 'Transportation', icon: 'car', color: '#1570FF', sort_order: 3, is_active: true },
  { name: 'Dining Out', icon: 'utensils', color: '#EF9700', sort_order: 4, is_active: true },
  { name: 'Entertainment', icon: 'gamepad-2', color: '#FD6FB8', sort_order: 5, is_active: true },
  { name: 'Health / Medical', icon: 'heart-pulse', color: '#FE3428', sort_order: 6, is_active: true },
  { name: 'Fitness', icon: 'dumbbell', color: '#2CAEB7', sort_order: 7, is_active: true },
  { name: 'Shopping', icon: 'shopping-bag', color: '#9E6FF7', sort_order: 8, is_active: true },
  { name: 'Education', icon: 'graduation-cap', color: '#1570FF', sort_order: 9, is_active: true },
  { name: 'Utilities & Bills', icon: 'zap', color: '#EF9700', sort_order: 10, is_active: true },
  { name: 'Subscriptions', icon: 'repeat', color: '#2CAEB7', sort_order: 11, is_active: true },
  { name: 'Charity / Donations', icon: 'hand-heart', color: '#FD6FB8', sort_order: 12, is_active: true },
  { name: 'Self Care', icon: 'sparkles', color: '#9E6FF7', sort_order: 13, is_active: true },
  { name: 'Personal', icon: 'user', color: '#1570FF', sort_order: 14, is_active: true },
  { name: 'General / Other', icon: 'wallet', color: '#929292', sort_order: 15, is_active: true },
]

export const BUDGET_STRATEGIES = [
  {
    id: 'envelope' as const,
    name: 'Envelope / Category-based',
    description: 'Allocate a fixed amount to each spending category. When the envelope is empty, you stop spending in that category.',
    bestFor: 'People who want strict control over each area of spending.',
  },
  {
    id: '50_30_20' as const,
    name: '50/30/20 Rule',
    description: '50% of income goes to needs, 30% to wants, and 20% to savings. Simple and flexible.',
    bestFor: 'Beginners who want a simple starting point.',
  },
  {
    id: 'zero_based' as const,
    name: 'Zero-based Budget',
    description: 'Every dollar of income is assigned a job — spending, saving, or investing — until you reach $0 unallocated.',
    bestFor: 'People who want to maximize every dollar.',
  },
  {
    id: 'tracking_only' as const,
    name: 'Tracking Only',
    description: 'No budget limits. Just log transactions and see where your money goes. Great for getting started.',
    bestFor: 'People who want visibility before committing to a plan.',
  },
] as const

export const CURRENCY = {
  code: 'CAD',
  symbol: '$',
  locale: 'en-CA',
} as const
