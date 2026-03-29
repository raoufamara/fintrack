import { supabase } from '@/lib/supabase'
import type { Budget, BudgetAllocation } from '@/types/models'

export interface BudgetWithAllocations extends Budget {
  allocations: (BudgetAllocation & { category_name?: string; category_color?: string })[]
}

export interface CreateBudgetInput {
  month: string
  total_amount: number
  allocations: { category_id: string; allocated_amount: number }[]
}

export async function createBudget(input: CreateBudgetInput): Promise<Budget> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  // Create budget
  const { data: budget, error: budgetError } = await supabase
    .from('budgets')
    .insert({
      user_id: user.id,
      month: `${input.month}-01`,
      total_amount: input.total_amount,
    } as never)
    .select()
    .single()

  if (budgetError) throw budgetError

  // Create allocations
  const allocations = input.allocations
    .filter((a) => a.allocated_amount > 0)
    .map((a) => ({
      budget_id: (budget as Budget).id,
      category_id: a.category_id,
      allocated_amount: a.allocated_amount,
    }))

  if (allocations.length > 0) {
    const { error: allocError } = await supabase
      .from('budget_allocations')
      .insert(allocations as never[])

    if (allocError) throw allocError
  }

  return budget as Budget
}

export async function fetchBudget(month: string): Promise<BudgetWithAllocations | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: budget, error: budgetError } = await supabase
    .from('budgets')
    .select('*')
    .eq('user_id', user.id)
    .eq('month', `${month}-01`)
    .maybeSingle()

  if (budgetError) throw budgetError
  if (!budget) return null

  const { data: allocations, error: allocError } = await supabase
    .from('budget_allocations')
    .select('*')
    .eq('budget_id', (budget as Budget).id)

  if (allocError) throw allocError

  // Enrich with category info
  const { data: categories } = await supabase
    .from('categories')
    .select('id, name, color')
    .eq('is_active', true)

  const catMap = new Map((categories ?? []).map((c: { id: string; name: string; color: string }) => [c.id, c]))

  const enrichedAllocations = (allocations as BudgetAllocation[]).map((a) => {
    const cat = catMap.get(a.category_id)
    return {
      ...a,
      category_name: cat?.name,
      category_color: cat?.color,
    }
  })

  return { ...(budget as Budget), allocations: enrichedAllocations }
}

export async function updateAllocation(
  allocationId: string,
  amount: number
): Promise<void> {
  const { error } = await supabase
    .from('budget_allocations')
    .update({ allocated_amount: amount } as never)
    .eq('id', allocationId)

  if (error) throw error
}

export async function updateBudgetTotal(
  budgetId: string,
  totalAmount: number
): Promise<void> {
  const { error } = await supabase
    .from('budgets')
    .update({ total_amount: totalAmount } as never)
    .eq('id', budgetId)

  if (error) throw error
}
