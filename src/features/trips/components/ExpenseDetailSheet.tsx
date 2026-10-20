import { expenseTotalDefault } from '../lib/balances'
import { formatMoney, toMinor } from '../lib/currency'
import { formatDay } from '../lib/dates'
import { placeLine } from '../lib/places'
import { formatRate } from '../services/fxService'
import type { TripSnapshot } from '../services/TripsRepository'
import type { TripExpense } from '../types'
import { BottomSheet } from './BottomSheet'
import { CategoryIcon } from './CategoryIcon'

/**
 * Read-only expense detail for guests. Shows no edit controls and no
 * coordinates (guests never receive them).
 */
export function ExpenseDetailSheet({
  expense,
  snapshot,
  onClose,
}: {
  expense: TripExpense | null
  snapshot: TripSnapshot
  onClose: () => void
}) {
  const open = expense !== null
  const currency = snapshot.trip.default_currency
  const category = expense ? snapshot.categories.find((c) => c.id === expense.category_id) : undefined
  const rows: Array<[string, string]> = []
  if (expense) {
    const total = expenseTotalDefault(expense, currency)
    const members = (id: string) => snapshot.members.find((m) => m.id === id)?.display_name ?? '?'
    const splitIds = snapshot.shares.filter((s) => s.expense_id === expense.id).map((s) => s.member_id)
    rows.push(['Amount', total === null ? 'Rate pending' : formatMoney(total, currency)])
    if (expense.currency !== currency) {
      rows.push([
        'Paid in',
        `${formatMoney(toMinor(expense.amount, expense.currency), expense.currency)}${expense.fx_rate ? ` · rate ${formatRate(expense.fx_rate)}` : ''}`,
      ])
    }
    rows.push(['Category', category?.name ?? 'Unknown'])
    rows.push(['Paid by', members(expense.paid_by)])
    rows.push(['Split between', splitIds.map(members).join(', ') || '—'])
    rows.push(['Date', formatDay(expense.date, true)])
    const where = [expense.place_name, placeLine({ name: expense.place_name ?? '', area: expense.place_area, city: expense.place_city })].filter(Boolean)
    rows.push(['Place', where.length ? where.join(', ') : 'No location'])
  }
  return (
    <BottomSheet open={open} onClose={onClose} title={expense?.title ?? 'Expense'}>
      {expense && (
        <>
          <div className="flex items-center gap-3">
            <CategoryIcon icon={category?.icon ?? 'tag'} color={category?.color ?? 'grey'} />
            <span className="text-xs font-semibold text-text-muted">View only</span>
          </div>
          <dl className="rounded-2xl bg-background">
            {rows.map(([label, value]) => (
              <div key={label} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-gray-100 px-3.5 last:border-b-0">
                <dt className="text-sm font-semibold text-text-muted">{label}</dt>
                <dd className="text-right text-sm font-extrabold">{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </BottomSheet>
  )
}
