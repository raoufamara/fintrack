import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { fetchMonthlySpending, type MonthlySpending } from '@/services/insightsService'
import { fetchBudget, type BudgetWithAllocations } from '@/services/budgetService'
import { CURRENCY } from '@/lib/constants'

export function Insights() {
  const [month, setMonth] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })
  const [spending, setSpending] = useState<MonthlySpending | null>(null)
  const [budget, setBudget] = useState<BudgetWithAllocations | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetchMonthlySpending(month),
      fetchBudget(month),
    ]).then(([spendingData, budgetData]) => {
      setSpending(spendingData)
      setBudget(budgetData)
    }).finally(() => setLoading(false))
  }, [month])

  const navigateMonth = (direction: -1 | 1) => {
    const parts = month.split('-').map(Number)
    const d = new Date(parts[0]!, parts[1]! - 1 + direction, 1)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }

  const monthLabel = (() => {
    const parts = month.split('-').map(Number)
    const d = new Date(parts[0]!, parts[1]! - 1, 1)
    return d.toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })
  })()

  // Build allocation map: category_id -> allocated_amount
  const allocationMap = new Map<string, number>()
  if (budget) {
    for (const alloc of budget.allocations) {
      allocationMap.set(alloc.category_id, alloc.allocated_amount)
    }
  }

  return (
    <div className="px-5 pt-12 pb-24">
      <h1 className="text-2xl font-bold">Spending Insights</h1>

      {/* Month Selector */}
      <div className="flex items-center justify-between mt-6 bg-surface rounded-[var(--radius-lg)] px-4 py-3">
        <button onClick={() => navigateMonth(-1)} className="p-1 text-text-secondary">
          <ChevronLeft size={20} />
        </button>
        <span className="font-semibold text-text-primary">{monthLabel}</span>
        <button onClick={() => navigateMonth(1)} className="p-1 text-text-secondary">
          <ChevronRight size={20} />
        </button>
      </div>

      {loading ? (
        <p className="text-text-secondary text-sm mt-6">Loading...</p>
      ) : (
        <>
          {/* Budget Overview (if budget exists) */}
          {budget && spending && (
            <div className="mt-6 bg-surface rounded-[var(--radius-lg)] p-5">
              <div className="flex justify-between items-center mb-2">
                <h2 className="font-bold text-sm">Budget overview</h2>
                <Link to="/budget/create" className="text-xs text-primary font-semibold">Adjust</Link>
              </div>
              <div className="flex justify-between items-end mt-3">
                <div>
                  <p className="text-sm text-text-secondary">Budget</p>
                  <p className="font-bold text-lg">{CURRENCY.symbol}{budget.total_amount.toFixed(2)}</p>
                </div>
                <div className="text-center">
                  <p className="text-sm text-text-secondary">Spent</p>
                  <p className="font-bold text-lg text-error">{CURRENCY.symbol}{spending.total.toFixed(2)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-text-secondary">Left</p>
                  <p className={`font-bold text-lg ${budget.total_amount - spending.total < 0 ? 'text-error' : 'text-success'}`}>
                    {CURRENCY.symbol}{(budget.total_amount - spending.total).toFixed(2)}
                  </p>
                </div>
              </div>
              <div className="mt-3 h-2 bg-gray-100 rounded-[var(--radius-xs)] overflow-hidden">
                <div
                  className={`h-full rounded-[var(--radius-xs)] transition-all ${
                    spending.total >= budget.total_amount ? 'bg-error' : spending.total >= budget.total_amount * 0.8 ? 'bg-warning' : 'bg-primary'
                  }`}
                  style={{ width: `${Math.min((spending.total / budget.total_amount) * 100, 100)}%` }}
                />
              </div>
            </div>
          )}

          {/* Total Spent (if no budget) */}
          {!budget && spending && spending.total > 0 && (
            <div className="mt-6 bg-surface rounded-[var(--radius-lg)] p-5">
              <p className="text-sm text-text-secondary font-medium">Total spent</p>
              <p className="text-3xl font-bold text-text-primary mt-1">
                {CURRENCY.symbol}{spending.total.toFixed(2)}
              </p>
            </div>
          )}

          {/* Empty state */}
          {(!spending || spending.byCategory.length === 0) && (
            <div className="mt-6 text-center py-12">
              <p className="text-text-secondary">No spending this month.</p>
              <Link to="/transactions/add" className="text-primary font-semibold text-sm mt-2 inline-block">
                Add a transaction
              </Link>
            </div>
          )}

          {/* Category Breakdown */}
          {spending && spending.byCategory.length > 0 && (
            <div className="mt-6">
              <h2 className="font-bold text-lg mb-4">By category</h2>
              <div className="space-y-3">
                {spending.byCategory.map(({ category, total, count }) => {
                  const allocation = allocationMap.get(category.id)
                  const hasLimit = allocation !== undefined && allocation > 0
                  const overBudget = hasLimit && total > allocation
                  const percentage = hasLimit
                    ? Math.min((total / allocation) * 100, 100)
                    : 100

                  return (
                    <Link
                      key={category.id}
                      to={`/insights/${category.id}`}
                      className="block bg-surface rounded-[var(--radius-lg)] p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: category.color }}
                          />
                          <span className="text-sm font-semibold text-text-primary">{category.name}</span>
                        </div>
                        <span className="text-sm font-bold text-text-primary">
                          {CURRENCY.symbol}{total.toFixed(2)}
                          {hasLimit && (
                            <span className="text-text-secondary font-normal"> / {CURRENCY.symbol}{allocation.toFixed(2)}</span>
                          )}
                        </span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-[var(--radius-xs)] overflow-hidden">
                        <div
                          className={`h-full rounded-[var(--radius-xs)] transition-all ${overBudget ? 'bg-error' : ''}`}
                          style={{
                            width: `${percentage}%`,
                            backgroundColor: overBudget ? undefined : category.color,
                          }}
                        />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <p className="text-xs text-text-secondary">{count} transaction{count !== 1 ? 's' : ''}</p>
                        {overBudget && (
                          <p className="text-xs text-error font-semibold">Limit exceeded</p>
                        )}
                      </div>
                    </Link>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
