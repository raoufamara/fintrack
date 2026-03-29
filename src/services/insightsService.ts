import { supabase } from '@/lib/supabase'
import type { Transaction, Category } from '@/types/models'

export interface CategorySpending {
  category: Category
  total: number
  count: number
}

export interface MonthlySpending {
  month: string
  total: number
  byCategory: CategorySpending[]
}

export async function fetchMonthlySpending(month: string): Promise<MonthlySpending> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Fetch transactions for the month
  const parts = month.split('-').map(Number)
  const yearNum = parts[0]!
  const monthNum = parts[1]!
  const start = `${month}-01`
  const nextMonth = monthNum === 12 ? `${yearNum + 1}-01` : `${yearNum}-${String(monthNum + 1).padStart(2, '0')}`
  const end = `${nextMonth}-01`

  const { data: transactions, error: txError } = await supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .eq('type', 'expense')
    .gte('date', start)
    .lt('date', end)

  if (txError) throw txError

  // Fetch categories
  const { data: categories, error: catError } = await supabase
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')

  if (catError) throw catError

  // Aggregate by category
  const catMap = new Map<string, { category: Category; total: number; count: number }>()

  for (const cat of (categories as Category[])) {
    catMap.set(cat.id, { category: cat, total: 0, count: 0 })
  }

  let total = 0
  for (const tx of (transactions as Transaction[])) {
    total += tx.amount
    const entry = catMap.get(tx.category_id)
    if (entry) {
      entry.total += tx.amount
      entry.count += 1
    }
  }

  const byCategory = Array.from(catMap.values())
    .filter((e) => e.count > 0)
    .sort((a, b) => b.total - a.total)

  return { month, total, byCategory }
}

export interface MonthTotal {
  month: string
  label: string
  total: number
}

export async function fetchSpendingByMonth(months: number = 6): Promise<MonthTotal[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const now = new Date()
  const results: MonthTotal[] = []

  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const monthStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const start = `${monthStr}-01`
    const nextD = new Date(d.getFullYear(), d.getMonth() + 1, 1)
    const end = `${nextD.getFullYear()}-${String(nextD.getMonth() + 1).padStart(2, '0')}-01`

    const { data, error } = await supabase
      .from('transactions')
      .select('amount')
      .eq('user_id', user.id)
      .eq('type', 'expense')
      .gte('date', start)
      .lt('date', end)

    if (error) throw error

    const total = (data as { amount: number }[]).reduce((sum, tx) => sum + tx.amount, 0)
    const label = d.toLocaleDateString('en-CA', { month: 'short' })
    results.push({ month: monthStr, label, total })
  }

  return results
}
