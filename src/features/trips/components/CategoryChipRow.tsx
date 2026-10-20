import type { TripCategory } from '../types'

interface CategoryChipRowProps {
  /** Categories to offer, already ordered (used on this trip, by spend). */
  categories: readonly TripCategory[]
  selectedIds: readonly string[]
  onToggle: (categoryId: string) => void
  onClear: () => void
}

/** "All" plus one multi-select chip per category used on the trip. */
export function CategoryChipRow({ categories, selectedIds, onToggle, onClear }: CategoryChipRowProps) {
  const chip =
    'inline-flex h-9 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-bold'
  const allOn = selectedIds.length === 0
  return (
    <div
      role="group"
      aria-label="Filter by category"
      className="flex gap-2 overflow-x-auto pb-1 pr-4 [scrollbar-width:none]"
    >
      <button
        type="button"
        aria-pressed={allOn}
        onClick={onClear}
        className={`${chip} ${allOn ? 'border-primary bg-primary text-white' : 'border-gray-300 bg-surface text-gray-700'}`}
      >
        All
      </button>
      {categories.map((c) => {
        const on = selectedIds.includes(c.id)
        return (
          <button
            key={c.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(c.id)}
            className={`${chip} ${on ? 'text-white' : 'border-gray-300 bg-surface text-gray-700'}`}
            style={on ? { background: `var(--color-tripcat-${c.color})`, borderColor: `var(--color-tripcat-${c.color})` } : undefined}
          >
            {c.name}
          </button>
        )
      })}
    </div>
  )
}
