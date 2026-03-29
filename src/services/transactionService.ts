import { supabase } from '@/lib/supabase'
import type { Transaction, TransactionType, RecurrenceRule } from '@/types/models'

export interface CreateTransactionInput {
  category_id: string
  amount: number
  type: TransactionType
  description: string
  date: string
  is_recurring: boolean
  recurrence_rule: RecurrenceRule | null
}

export async function createTransaction(input: CreateTransactionInput): Promise<Transaction> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const row = {
    user_id: user.id,
    category_id: input.category_id,
    amount: input.amount,
    type: input.type,
    description: input.description,
    date: input.date,
    is_recurring: input.is_recurring,
    recurrence_rule: input.recurrence_rule,
  }

  const { data, error } = await supabase
    .from('transactions')
    .insert(row as never)
    .select()
    .single()

  if (error) throw error
  return data as Transaction
}

export async function fetchTransactions(options?: {
  limit?: number
  offset?: number
  month?: string
  categoryId?: string
}): Promise<Transaction[]> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  let query = supabase
    .from('transactions')
    .select('*')
    .eq('user_id', user.id)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })

  if (options?.month) {
    const start = `${options.month}-01`
    const parts = options.month.split('-').map(Number)
    const yearNum = parts[0]!
    const monthNum = parts[1]!
    const nextMonth = monthNum === 12 ? `${yearNum + 1}-01` : `${yearNum}-${String(monthNum + 1).padStart(2, '0')}`
    const end = `${nextMonth}-01`
    query = query.gte('date', start).lt('date', end)
  }

  if (options?.categoryId) {
    query = query.eq('category_id', options.categoryId)
  }

  if (options?.limit) {
    query = query.limit(options.limit)
  }

  if (options?.offset) {
    query = query.range(options.offset, options.offset + (options?.limit ?? 50) - 1)
  }

  const { data, error } = await query
  if (error) throw error
  return data as Transaction[]
}

export async function deleteTransaction(id: string): Promise<void> {
  const { error } = await supabase
    .from('transactions')
    .delete()
    .eq('id', id)

  if (error) throw error
}

export async function updateTransaction(id: string, updates: Partial<CreateTransactionInput>): Promise<Transaction> {
  const { data, error } = await supabase
    .from('transactions')
    .update(updates as never)
    .eq('id', id)
    .select()
    .single()

  if (error) throw error
  return data as Transaction
}
