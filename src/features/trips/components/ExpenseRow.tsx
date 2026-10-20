import { expenseTotalDefault } from '../lib/balances'
import { formatMoney, toMinor } from '../lib/currency'
import type { TripCategory, TripExpense } from '../types'
import { CategoryIcon } from './CategoryIcon'

interface ExpenseRowProps {
  expense: TripExpense
  category: TripCategory | undefined
  payerName: string
  defaultCurrency: string
  onOpen: (expenseId: string) => void
}

export function ExpenseRow({ expense, category, payerName, defaultCurrency, onOpen }: ExpenseRowProps) {
  const total = expenseTotalDefault(expense, defaultCurrency)
  const place = expense.place_name ?? expense.place_city
  return (
    <button
      type="button"
      onClick={() => onOpen(expense.id)}
      className="flex min-h-[64px] w-full items-center gap-3 border-b border-gray-100 py-2.5 text-left last:border-b-0"
    >
      <CategoryIcon icon={category?.icon ?? 'tag'} color={category?.color ?? 'grey'} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[15px] font-bold">{expense.title}</span>
        <span className="truncate text-xs text-text-muted">
          {category ? `${category.name} · ` : ''}
          {payerName} paid{place ? ` · ${place}` : ''}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {total === null ? (
          <span className="rounded-[6px] bg-warning-light px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-[#6B4400]">
            RATE PENDING
          </span>
        ) : (
          <b className="text-[15px] font-extrabold tabular-nums">{formatMoney(total, defaultCurrency)}</b>
        )}
        {expense.currency !== defaultCurrency && (
          <span className="text-xs tabular-nums text-text-muted">
            {formatMoney(toMinor(expense.amount, expense.currency), expense.currency)}
          </span>
        )}
      </span>
    </button>
  )
}
