import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { fetchMonthlySpending, type CategorySpending } from '@/services/insightsService'
import { fetchCategories } from '@/services/categoryService'
import { TransactionList } from '@/components/transactions/TransactionList'
import { CURRENCY } from '@/lib/constants'
import type { Category } from '@/types/models'

export function CategoryDetail() {
  const { categoryId } = useParams()
  const navigate = useNavigate()
  const [category, setCategory] = useState<Category | null>(null)
  const [spending, setSpending] = useState<CategorySpending | null>(null)
  const [loading, setLoading] = useState(true)

  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  useEffect(() => {
    async function load() {
      const [categories, monthData] = await Promise.all([
        fetchCategories(),
        fetchMonthlySpending(currentMonth),
      ])

      const cat = categories.find((c) => c.id === categoryId)
      setCategory(cat ?? null)

      const catSpending = monthData.byCategory.find((c) => c.category.id === categoryId)
      setSpending(catSpending ?? null)

      setLoading(false)
    }
    load()
  }, [categoryId, currentMonth])

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-text-secondary">Loading...</p>
      </div>
    )
  }

  return (
    <div className="px-5 pt-12 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate(-1)} className="p-1">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold">{category?.name ?? 'Category'}</h1>
      </div>

      {/* Spending Summary */}
      <div className="bg-surface rounded-[var(--radius-lg)] p-5">
        <p className="text-sm text-text-secondary font-medium">Spent this month</p>
        <p className="text-3xl font-bold mt-1" style={{ color: category?.color }}>
          {CURRENCY.symbol}{(spending?.total ?? 0).toFixed(2)}
        </p>

        {/* Visual bar */}
        <div className="mt-4 h-3 bg-gray-100 rounded-[var(--radius-xs)] overflow-hidden">
          <div
            className="h-full rounded-[var(--radius-xs)]"
            style={{
              width: spending && spending.total > 0 ? '100%' : '0%',
              backgroundColor: category?.color ?? '#929292',
            }}
          />
        </div>
        <p className="text-xs text-text-secondary mt-2">
          {spending?.count ?? 0} transaction{(spending?.count ?? 0) !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Transaction List */}
      <div className="mt-6">
        <h2 className="font-bold text-lg mb-3">Transactions</h2>
        <TransactionList categoryId={categoryId} />
      </div>
    </div>
  )
}
