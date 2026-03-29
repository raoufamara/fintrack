import { useEffect, useState } from 'react'
import { fetchTransactions } from '@/services/transactionService'
import { fetchCategories } from '@/services/categoryService'
import { CURRENCY } from '@/lib/constants'
import type { Transaction, Category } from '@/types/models'

interface TransactionListProps {
  limit?: number
  month?: string
  categoryId?: string
  refreshKey?: number
}

export function TransactionList({ limit, month, categoryId, refreshKey }: TransactionListProps) {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [categories, setCategories] = useState<Map<string, Category>>(new Map())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchCategories().then((cats) => {
      const map = new Map<string, Category>()
      cats.forEach((c) => map.set(c.id, c))
      setCategories(map)
    })
  }, [])

  useEffect(() => {
    setLoading(true)
    fetchTransactions({ limit, month, categoryId })
      .then(setTransactions)
      .finally(() => setLoading(false))
  }, [limit, month, categoryId, refreshKey])

  if (loading) {
    return <p className="text-text-secondary text-sm py-4">Loading...</p>
  }

  if (transactions.length === 0) {
    return <p className="text-text-secondary text-sm py-4">No transactions yet.</p>
  }

  return (
    <div className="space-y-1">
      {transactions.map((tx) => {
        const category = categories.get(tx.category_id)
        const isExpense = tx.type === 'expense'

        return (
          <div
            key={tx.id}
            className="flex items-center gap-3 py-3 px-1"
          >
            {/* Category icon dot */}
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: category ? `${category.color}20` : '#F3EDFE' }}
            >
              <span
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: category?.color ?? '#929292' }}
              />
            </div>

            {/* Description & category */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-text-primary truncate">
                {tx.description || category?.name || 'Transaction'}
              </p>
              <p className="text-xs text-text-secondary mt-0.5">
                {category?.name} · {new Date(tx.date + 'T00:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })}
              </p>
            </div>

            {/* Amount */}
            <p className={`text-sm font-bold ${isExpense ? 'text-error' : 'text-success'}`}>
              {isExpense ? '-' : '+'}{CURRENCY.symbol}{tx.amount.toFixed(2)}
            </p>
          </div>
        )
      })}
    </div>
  )
}
