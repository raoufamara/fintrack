import { supabase } from '@/lib/supabase'
import type { Category } from '@/types/models'

export async function fetchCategories(): Promise<Category[]> {
  const { data, error } = await supabase
    .from('categories')
    .select('*')
    .eq('is_active', true)
    .order('sort_order')

  if (error) throw error
  return data as Category[]
}
