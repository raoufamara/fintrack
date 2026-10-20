import { MapPin } from 'lucide-react'
import { expenseTotalDefault } from '../lib/balances'
import { formatMoney, toMinor } from '../lib/currency'
import { placeLabel } from '../lib/places'
import type { TripCategory, TripExpense } from '../types'
import { CategoryIcon } from './CategoryIcon'

interface ExpenseRowProps {
  expense: TripExpense
  category: TripCategory | undefined
  payerName: string
  defaultCurrency: string
  onOpen: (expenseId: string) => void
  /** Waiting in the retry queue: shows a "Not synced" tag. */
  unsynced?: boolean
}

export function ExpenseRow({ expense, category, payerName, defaultCurrency, onOpen, unsynced = false }: ExpenseRowProps) {
  const total = expenseTotalDefault(expense, defaultCurrency)
  const place = placeLabel(expense.place_name, expense.place_city)
  const original =
    expense.currency !== defaultCurrency ? formatMoney(toMinor(expense.amount, expense.currency), expense.currency) : null
  // The icon is decorative, so the category is part of the accessible name.
  const label = [
    expense.title,
    category?.name,
    `${payerName} paid`,
    place || null,
    total === null ? 'rate pending' : formatMoney(total, defaultCurrency),
    original,
    unsynced ? 'not synced' : null,
  ]
    .filter(Boolean)
    .join(', ')
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onOpen(expense.id)}
      className="flex min-h-[64px] w-full items-center gap-3 border-b border-gray-100 py-2.5 text-left last:border-b-0"
    >
      <CategoryIcon icon={category?.icon ?? 'tag'} color={category?.color ?? 'grey'} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="truncate text-[15px] font-bold">{expense.title}</span>
        <span className="flex items-center gap-1 overflow-hidden whitespace-nowrap text-xs text-text-muted">
          <span className="shrink-0">{payerName} paid</span>
          {place && (
            <>
              <span aria-hidden="true">·</span>
              <MapPin size={12} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{place}</span>
            </>
          )}
        </span>
        {unsynced && (
          <span className="self-start rounded-[6px] bg-warning-light px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-[#6B4400]">
            NOT SYNCED
          </span>
        )}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        {total === null ? (
          <span className="rounded-[6px] bg-warning-light px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-[#6B4400]">
            RATE PENDING
          </span>
        ) : (
          <b className="text-[15px] font-extrabold tabular-nums">{formatMoney(total, defaultCurrency)}</b>
        )}
        {original && <span className="text-xs tabular-nums text-text-muted">{original}</span>}
      </span>
    </button>
  )
}
