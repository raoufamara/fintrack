import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Check } from 'lucide-react'
import { fetchCategories } from '@/services/categoryService'
import { createBudget } from '@/services/budgetService'
import { CURRENCY } from '@/lib/constants'
import type { Category } from '@/types/models'

const PRESET_AMOUNTS = [1000, 2000, 3000, 5000]

type Step = 'amount' | 'allocate' | 'success'

export function CreateBudget() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('amount')
  const [categories, setCategories] = useState<Category[]>([])
  const [totalAmount, setTotalAmount] = useState('')
  const [allocations, setAllocations] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  useEffect(() => {
    fetchCategories().then(setCategories)
  }, [])

  const total = parseFloat(totalAmount) || 0
  const allocated = Array.from(allocations.values()).reduce((sum, v) => sum + v, 0)
  const remaining = total - allocated

  const updateAllocation = (catId: string, value: string) => {
    const num = parseFloat(value) || 0
    const next = new Map(allocations)
    if (num > 0) {
      next.set(catId, num)
    } else {
      next.delete(catId)
    }
    setAllocations(next)
  }

  const handleSubmit = async () => {
    if (remaining < 0) {
      setError('Allocations exceed total budget')
      return
    }

    setLoading(true)
    setError(null)

    try {
      await createBudget({
        month: currentMonth,
        total_amount: total,
        allocations: Array.from(allocations.entries()).map(([category_id, allocated_amount]) => ({
          category_id,
          allocated_amount,
        })),
      })
      setStep('success')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  // Step 1: Set total amount
  if (step === 'amount') {
    return (
      <div className="min-h-screen bg-background">
        <div className="bg-surface px-5 pt-12 pb-4 flex items-center gap-3">
          <button onClick={() => navigate(-1)} className="p-1">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-lg font-bold">Create Budget</h1>
        </div>

        <div className="px-5 pt-8">
          <p className="text-text-secondary text-sm">Set your monthly budget for</p>
          <p className="font-bold text-lg mt-1">
            {new Date(parseInt(currentMonth.split('-')[0]!), parseInt(currentMonth.split('-')[1]!) - 1).toLocaleDateString('en-CA', { month: 'long', year: 'numeric' })}
          </p>

          {/* Amount display */}
          <div className="mt-8 text-center">
            <p className="text-5xl font-bold text-text-primary">
              {CURRENCY.symbol}{totalAmount || '0'}
            </p>
          </div>

          {/* Preset amounts */}
          <div className="flex gap-2 justify-center mt-6">
            {PRESET_AMOUNTS.map((amt) => (
              <button
                key={amt}
                type="button"
                onClick={() => setTotalAmount(String(amt))}
                className={`px-4 py-2 rounded-[var(--radius-sm)] text-sm font-semibold border transition-colors ${
                  totalAmount === String(amt)
                    ? 'border-primary bg-primary-tint text-primary'
                    : 'border-gray-200 text-text-secondary'
                }`}
              >
                {CURRENCY.symbol}{amt.toLocaleString()}
              </button>
            ))}
          </div>

          {/* Custom input */}
          <div className="mt-6">
            <label className="block text-sm font-semibold text-text-primary mb-1.5">Or enter custom amount</label>
            <input
              type="number"
              step="0.01"
              min="1"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              className="w-full px-4 py-3 rounded-[var(--radius-md)] border border-gray-200 bg-surface text-text-primary text-lg font-bold placeholder:text-text-tertiary placeholder:font-normal focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="0.00"
            />
          </div>

          <button
            onClick={() => total > 0 && setStep('allocate')}
            disabled={total <= 0}
            className="w-full mt-8 bg-primary text-white font-semibold py-3.5 rounded-[var(--radius-xl)] hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Next — Allocate to categories
          </button>
        </div>
      </div>
    )
  }

  // Step 2: Allocate to categories
  if (step === 'allocate') {
    return (
      <div className="min-h-screen bg-background">
        <div className="bg-surface px-5 pt-12 pb-4 flex items-center gap-3">
          <button onClick={() => setStep('amount')} className="p-1">
            <ArrowLeft size={22} />
          </button>
          <h1 className="text-lg font-bold">Allocate Budget</h1>
        </div>

        <div className="px-5 pt-6">
          {error && (
            <div className="bg-error-light text-error text-sm px-4 py-3 rounded-[var(--radius-sm)] mb-4">
              {error}
            </div>
          )}

          {/* Summary bar */}
          <div className="bg-surface rounded-[var(--radius-lg)] p-4 flex justify-between items-center">
            <div>
              <p className="text-xs text-text-secondary">Total budget</p>
              <p className="font-bold text-lg">{CURRENCY.symbol}{total.toFixed(2)}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-text-secondary">Left to allocate</p>
              <p className={`font-bold text-lg ${remaining < 0 ? 'text-error' : remaining === 0 ? 'text-success' : 'text-text-primary'}`}>
                {CURRENCY.symbol}{remaining.toFixed(2)}
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="mt-3 h-2 bg-gray-100 rounded-[var(--radius-xs)] overflow-hidden">
            <div
              className={`h-full rounded-[var(--radius-xs)] transition-all ${remaining < 0 ? 'bg-error' : 'bg-primary'}`}
              style={{ width: `${Math.min((allocated / total) * 100, 100)}%` }}
            />
          </div>

          {/* Category list */}
          <div className="mt-6 space-y-3">
            {categories.map((cat) => (
              <div key={cat.id} className="bg-surface rounded-[var(--radius-md)] p-4">
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: cat.color }}
                  />
                  <span className="text-sm font-semibold">{cat.name}</span>
                </div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={allocations.get(cat.id) || ''}
                  onChange={(e) => updateAllocation(cat.id, e.target.value)}
                  className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-gray-200 bg-background text-sm text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                  placeholder={`${CURRENCY.symbol}0.00`}
                />
              </div>
            ))}
          </div>

          <button
            onClick={handleSubmit}
            disabled={loading || total <= 0 || remaining < 0}
            className="w-full mt-6 mb-8 bg-primary text-white font-semibold py-3.5 rounded-[var(--radius-xl)] hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Creating...' : 'Get Started'}
          </button>
        </div>
      </div>
    )
  }

  // Step 3: Success
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
      <div className="w-16 h-16 bg-success/10 rounded-full flex items-center justify-center mb-6">
        <Check size={32} className="text-success" />
      </div>
      <h1 className="text-2xl font-bold text-center">Your budget has been set up!</h1>
      <p className="text-text-secondary text-center mt-2">
        You can always adjust your budget from the insights page.
      </p>

      {/* Summary */}
      <div className="w-full mt-8 bg-surface rounded-[var(--radius-lg)] p-5">
        <div className="flex justify-between items-center mb-4">
          <span className="text-sm text-text-secondary">Total budgeted</span>
          <span className="font-bold">{CURRENCY.symbol}{total.toFixed(2)}</span>
        </div>
        {Array.from(allocations.entries()).map(([catId, amount]) => {
          const cat = categories.find((c) => c.id === catId)
          if (!cat || amount <= 0) return null
          return (
            <div key={catId} className="flex justify-between items-center py-2">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: cat.color }} />
                <span className="text-sm text-text-primary">{cat.name}</span>
              </div>
              <span className="text-sm font-semibold">{CURRENCY.symbol}{amount.toFixed(2)}</span>
            </div>
          )
        })}
      </div>

      <button
        onClick={() => navigate('/')}
        className="w-full mt-8 bg-primary text-white font-semibold py-3.5 rounded-[var(--radius-xl)] hover:bg-primary/90 transition-colors"
      >
        View my dashboard
      </button>
    </div>
  )
}
