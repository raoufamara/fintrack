import { formatMoney } from '../lib/currency'
import type { FilterResult, TripCategory, TripExpenseFilter, TripMember } from '../types'
import { BottomSheet } from './BottomSheet'

interface FilterSheetProps {
  open: boolean
  onClose: () => void
  filter: TripExpenseFilter
  onChange: (next: TripExpenseFilter) => void
  onReset: () => void
  /** Result of applying `filter`; drives the CTA text. */
  result: FilterResult
  categories: readonly TripCategory[]
  members: readonly TripMember[]
  defaultCurrency: string
  /** Trip dates, used to clamp the date fields. */
  tripStart: string | null
  tripEnd: string | null
}

const chip =
  'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-bold'
const off = 'border-gray-300 bg-surface text-gray-700'

function clamp(value: string, min: string | null, max: string | null): string | null {
  if (!value) return null
  if (min && value < min) return min
  if (max && value > max) return max
  return value
}

export function FilterSheet({
  open,
  onClose,
  filter,
  onChange,
  onReset,
  result,
  categories,
  members,
  defaultCurrency,
  tripStart,
  tripEnd,
}: FilterSheetProps) {
  // Hidden categories only show when they have expenses (or are selected).
  const offered = categories.filter(
    (c) =>
      c.hidden_at === null ||
      (result.countByCategory[c.id] ?? 0) > 0 ||
      filter.categoryIds.includes(c.id),
  )
  const toggleCategory = (id: string) =>
    onChange({
      ...filter,
      categoryIds: filter.categoryIds.includes(id)
        ? filter.categoryIds.filter((x) => x !== id)
        : [...filter.categoryIds, id],
    })
  const n = result.items.length

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Filters"
      headerAction={
        <button
          type="button"
          onClick={onReset}
          className="h-9 rounded-full px-3 text-[13px] font-bold text-primary hover:bg-black/5"
        >
          Reset
        </button>
      }
    >
      <div className="flex flex-col gap-2" role="group" aria-label="Category">
        <span className="text-[13px] font-extrabold text-gray-700">Category</span>
        <div className="flex flex-wrap gap-2">
          {offered.map((c) => {
            const on = filter.categoryIds.includes(c.id)
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleCategory(c.id)}
                className={`${chip} ${on ? 'text-white' : off}`}
                style={on ? { background: `var(--color-tripcat-${c.color})`, borderColor: `var(--color-tripcat-${c.color})` } : undefined}
              >
                {c.name}
                <span className={on ? 'text-white/80' : 'text-[#8A8A8A]'}>{result.countByCategory[c.id] ?? 0}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Location facet slot (Phase 5): city chips with counts plus a dashed "No location" chip go here. */}

      <div className="flex flex-col gap-2" role="group" aria-label="Paid by">
        <span className="text-[13px] font-extrabold text-gray-700">Paid by</span>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => {
            const on = filter.payer === m.id
            return (
              <button
                key={m.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange({ ...filter, payer: on ? null : m.id })}
                className={`${chip} ${on ? 'border-text-primary bg-text-primary text-white' : off}`}
              >
                {m.display_name}
              </button>
            )
          })}
        </div>
      </div>

      <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
        <span className="text-[15px] font-bold">Only expenses I’m part of</span>
        <input
          type="checkbox"
          checked={filter.mine}
          onChange={(e) => onChange({ ...filter, mine: e.target.checked })}
          className="h-[22px] w-[22px] accent-primary"
        />
      </label>

      <div className="flex gap-2.5">
        {(['from', 'to'] as const).map((key) => (
          <label key={key} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[13px] font-extrabold text-gray-700">{key === 'from' ? 'From' : 'To'}</span>
            <input
              type="date"
              value={filter[key] ?? ''}
              min={tripStart ?? undefined}
              max={tripEnd ?? undefined}
              onChange={(e) => onChange({ ...filter, [key]: clamp(e.target.value, tripStart, tripEnd) })}
              className="h-12 w-full min-w-0 rounded-[12px] border border-gray-300 bg-surface px-3 text-[15px] font-semibold outline-none focus:border-2 focus:border-primary"
            />
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={onClose}
        className="h-14 w-full rounded-full bg-primary text-base font-bold text-white"
      >
        Show {n} {n === 1 ? 'expense' : 'expenses'} · {formatMoney(result.totalDefault, defaultCurrency)}
      </button>
    </BottomSheet>
  )
}
