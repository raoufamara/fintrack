import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronDown, Calendar } from 'lucide-react'
import { createTransaction } from '@/services/transactionService'
import { fetchCategories } from '@/services/categoryService'
import { CURRENCY } from '@/lib/constants'
import type { Category, TransactionType, RecurrenceRule } from '@/types/models'

export function AddTransaction() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Form state
  const [amount, setAmount] = useState('')
  const [type, setType] = useState<TransactionType>('expense')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]!)
  const [isRecurring, setIsRecurring] = useState(false)
  const [recurrenceRule, setRecurrenceRule] = useState<RecurrenceRule>('monthly')
  const [showCategoryPicker, setShowCategoryPicker] = useState(false)

  useEffect(() => {
    fetchCategories().then(setCategories)
  }, [])

  const selectedCategory = categories.find((c) => c.id === categoryId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!amount || !categoryId) return

    setLoading(true)
    setError(null)

    try {
      await createTransaction({
        amount: parseFloat(amount),
        type,
        category_id: categoryId,
        description,
        date,
        is_recurring: isRecurring,
        recurrence_rule: isRecurring ? recurrenceRule : null,
      })
      navigate(-1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="bg-surface px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold">Add Transaction</h1>
      </div>

      <form onSubmit={handleSubmit} className="px-5 pt-6 space-y-5">
        {error && (
          <div className="bg-error-light text-error text-sm px-4 py-3 rounded-[var(--radius-sm)]">
            {error}
          </div>
        )}

        {/* Type Toggle */}
        <div className="flex bg-gray-100 rounded-[var(--radius-md)] p-1">
          <button
            type="button"
            onClick={() => setType('expense')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-[var(--radius-sm)] transition-colors ${
              type === 'expense'
                ? 'bg-error text-white'
                : 'text-text-secondary'
            }`}
          >
            Expense
          </button>
          <button
            type="button"
            onClick={() => setType('income')}
            className={`flex-1 py-2.5 text-sm font-semibold rounded-[var(--radius-sm)] transition-colors ${
              type === 'income'
                ? 'bg-success text-white'
                : 'text-text-secondary'
            }`}
          >
            Income
          </button>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1.5">Amount ({CURRENCY.symbol})</label>
          <input
            type="number"
            step="0.01"
            min="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            required
            className="w-full px-4 py-3 rounded-[var(--radius-md)] border border-gray-200 bg-surface text-text-primary text-2xl font-bold placeholder:text-text-tertiary placeholder:text-base placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            placeholder="0.00"
          />
        </div>

        {/* Category Picker */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1.5">Category</label>
          <button
            type="button"
            onClick={() => setShowCategoryPicker(!showCategoryPicker)}
            className="w-full px-4 py-3 rounded-[var(--radius-md)] border border-gray-200 bg-surface text-left flex items-center justify-between"
          >
            {selectedCategory ? (
              <span className="flex items-center gap-2">
                <span
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: selectedCategory.color }}
                />
                <span className="text-text-primary">{selectedCategory.name}</span>
              </span>
            ) : (
              <span className="text-text-tertiary">Select a category</span>
            )}
            <ChevronDown size={18} className="text-text-secondary" />
          </button>

          {showCategoryPicker && (
            <div className="mt-2 bg-surface border border-gray-200 rounded-[var(--radius-md)] shadow-lg max-h-60 overflow-y-auto">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCategoryId(cat.id)
                    setShowCategoryPicker(false)
                  }}
                  className={`w-full px-4 py-3 text-left flex items-center gap-3 hover:bg-gray-50 ${
                    categoryId === cat.id ? 'bg-primary-tint' : ''
                  }`}
                >
                  <span
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-sm">{cat.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1.5">Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full px-4 py-3 rounded-[var(--radius-md)] border border-gray-200 bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            placeholder="e.g. Grocery store, Netflix, etc."
          />
        </div>

        {/* Date */}
        <div>
          <label className="block text-sm font-semibold text-text-primary mb-1.5">Date</label>
          <div className="relative">
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-4 py-3 rounded-[var(--radius-md)] border border-gray-200 bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            />
            <Calendar size={18} className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary pointer-events-none" />
          </div>
        </div>

        {/* Recurring Toggle */}
        <div className="flex items-center justify-between py-2">
          <div>
            <p className="text-sm font-semibold text-text-primary">Recurring transaction</p>
            <p className="text-xs text-text-secondary mt-0.5">Automatically repeat this transaction</p>
          </div>
          <button
            type="button"
            onClick={() => setIsRecurring(!isRecurring)}
            className={`w-11 h-6 rounded-full transition-colors flex items-center ${
              isRecurring ? 'bg-primary justify-end' : 'bg-gray-300 justify-start'
            }`}
          >
            <span className="w-5 h-5 bg-white rounded-full shadow mx-0.5" />
          </button>
        </div>

        {/* Recurrence Rule */}
        {isRecurring && (
          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1.5">Repeat</label>
            <select
              value={recurrenceRule}
              onChange={(e) => setRecurrenceRule(e.target.value as RecurrenceRule)}
              className="w-full px-4 py-3 rounded-[var(--radius-md)] border border-gray-200 bg-surface text-text-primary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
            >
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every 2 weeks</option>
              <option value="monthly">Monthly</option>
            </select>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !amount || !categoryId}
          className="w-full bg-primary text-white font-semibold py-3.5 rounded-[var(--radius-xl)] hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {loading ? 'Saving...' : 'Save transaction'}
        </button>
      </form>
    </div>
  )
}
