import { Link } from 'react-router-dom'
import { Plus, Eye, EyeOff } from 'lucide-react'
import { useState, useEffect } from 'react'
import { useAuthStore } from '@/stores/authStore'
import { TransactionList } from '@/components/transactions/TransactionList'
import { SpendingPieChart } from '@/components/dashboard/SpendingPieChart'
import { MonthlyBarChart } from '@/components/dashboard/MonthlyBarChart'
import { CURRENCY } from '@/lib/constants'
import { fetchTransactions } from '@/services/transactionService'
import { fetchBudget, type BudgetWithAllocations } from '@/services/budgetService'
import { fetchMonthlySpending } from '@/services/insightsService'

export function Dashboard() {
  const profile = useAuthStore((s) => s.profile)
  const [balanceVisible, setBalanceVisible] = useState(true)
  const [balance, setBalance] = useState(0)
  const [budget, setBudget] = useState<BudgetWithAllocations | null>(null)
  const [monthSpent, setMonthSpent] = useState(0)
  const displayName = profile?.display_name || 'User'

  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good Morning' : hour < 18 ? 'Good Afternoon' : 'Good Evening'
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  useEffect(() => {
    // Fetch balance
    fetchTransactions().then((txs) => {
      const total = txs.reduce((sum, tx) => {
        return tx.type === 'income' ? sum + tx.amount : sum - tx.amount
      }, 0)
      setBalance(total)
    })

    // Fetch current month budget
    fetchBudget(currentMonth).then(setBudget)

    // Fetch current month spending
    fetchMonthlySpending(currentMonth).then((data) => setMonthSpent(data.total))
  }, [currentMonth])

  const budgetRemaining = budget ? budget.total_amount - monthSpent : 0
  const budgetPercentage = budget ? Math.min((monthSpent / budget.total_amount) * 100, 100) : 0

  return (
    <div className="px-5 pt-12 pb-24">
      <h1 className="text-2xl font-bold text-text-primary">
        {greeting}, {displayName}
      </h1>
      <p className="text-text-secondary mt-1">Welcome to Fintrack</p>

      {/* Balance Card */}
      <div className="mt-6 bg-text-primary rounded-[var(--radius-lg)] p-5 text-white">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400 font-medium">Total balance</p>
          <button onClick={() => setBalanceVisible(!balanceVisible)} className="text-gray-400">
            {balanceVisible ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
        </div>
        <p className="text-4xl font-bold mt-1">
          {balanceVisible ? `${CURRENCY.symbol}${balance.toFixed(2)}` : '****'}
        </p>
        <p className="text-xs text-gray-400 mt-1">{CURRENCY.code}</p>
      </div>

      {/* Budget: Spending Insight Widget OR Setup Prompt */}
      {budget ? (
        <Link to="/insights" className="block mt-6 bg-surface rounded-[var(--radius-lg)] p-5">
          <div className="flex justify-between items-center">
            <h3 className="font-bold text-sm text-text-primary">Spending Insight</h3>
            <span className="text-xs text-text-secondary">This month</span>
          </div>
          <div className="mt-3 flex justify-between items-end">
            <div>
              <p className="text-2xl font-bold text-primary">
                {CURRENCY.symbol}{budgetRemaining.toFixed(2)}
              </p>
              <p className="text-xs text-text-secondary mt-0.5">left to spend</p>
            </div>
            <p className="text-sm text-text-secondary">
              {CURRENCY.symbol}{monthSpent.toFixed(2)} of {CURRENCY.symbol}{budget.total_amount.toFixed(2)} spent
            </p>
          </div>
          <div className="mt-3 h-2 bg-gray-100 rounded-[var(--radius-xs)] overflow-hidden">
            <div
              className={`h-full rounded-[var(--radius-xs)] transition-all ${budgetPercentage >= 100 ? 'bg-error' : budgetPercentage >= 80 ? 'bg-warning' : 'bg-primary'}`}
              style={{ width: `${budgetPercentage}%` }}
            />
          </div>
        </Link>
      ) : (
        <div className="mt-6 bg-primary-tint border border-dashed border-primary/30 rounded-[var(--radius-lg)] p-5">
          <h3 className="font-bold text-primary-dark">Set a financial budget</h3>
          <p className="text-sm text-text-secondary mt-1">
            Take control of your spending by setting up a budget.
          </p>
          <Link
            to={profile?.budget_strategy ? '/budget/create' : '/onboarding/strategy'}
            className="inline-block mt-3 bg-primary text-white text-sm font-semibold px-5 py-2.5 rounded-[var(--radius-xl)]"
          >
            Set up now
          </Link>
        </div>
      )}

      {/* Charts */}
      <div className="mt-6 space-y-4">
        <SpendingPieChart />
        <MonthlyBarChart />
      </div>

      {/* Recent Transactions */}
      <div className="mt-6">
        <div className="flex justify-between items-center">
          <h2 className="font-bold text-lg">Recent transactions</h2>
          <Link to="/transactions" className="text-sm text-primary font-semibold">View all</Link>
        </div>
        <TransactionList limit={5} />
      </div>

      {/* Floating Add Button */}
      <Link
        to="/transactions/add"
        className="fixed bottom-22 right-5 w-14 h-14 bg-primary text-white rounded-full flex items-center justify-center shadow-lg hover:bg-primary/90 transition-colors"
      >
        <Plus size={26} />
      </Link>
    </div>
  )
}
