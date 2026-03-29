import { ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { TransactionList } from '@/components/transactions/TransactionList'

export function TransactionHistory() {
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-background">
      <div className="bg-surface px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-1">
          <ArrowLeft size={22} />
        </button>
        <h1 className="text-lg font-bold">All Transactions</h1>
      </div>

      <div className="px-5 pt-4">
        <TransactionList limit={50} />
      </div>
    </div>
  )
}
