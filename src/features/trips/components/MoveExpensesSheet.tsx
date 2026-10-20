import { useState } from 'react'
import { BottomSheet } from './BottomSheet'
import { CategoryIcon } from './CategoryIcon'
import { useTripsStore } from '../store/TripsContext'
import { expenseCountByCategory, visibleCategories } from '../store/selectors'

interface MoveExpensesSheetProps {
  open: boolean
  onClose: () => void
  tripId: string
  categoryId: string
  onDeleted?: () => void
}

export function MoveExpensesSheet({ open, onClose, tripId, categoryId, onDeleted }: MoveExpensesSheetProps) {
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const category = snapshot?.categories.find((c) => c.id === categoryId)
  return (
    <BottomSheet open={open} onClose={onClose} title={category ? `Delete ${category.name}?` : 'Delete category'}>
      {open && snapshot && category && (
        <Body tripId={tripId} categoryId={categoryId} onClose={onClose} onDeleted={onDeleted} />
      )}
    </BottomSheet>
  )
}

function Body({ tripId, categoryId, onClose, onDeleted }: Omit<MoveExpensesSheetProps, 'open'>) {
  const snapshot = useTripsStore((s) => s.trips[tripId])!
  const deleteCategory = useTripsStore((s) => s.deleteCategory)
  const count = expenseCountByCategory(snapshot.expenses).get(categoryId) ?? 0
  const targets = snapshot.categories
    .filter((c) => c.id !== categoryId)
    .sort((a, b) => a.sort_order - b.sort_order)
  const visible = visibleCategories(targets)
  const [moveTo, setMoveTo] = useState<string | null>(
    (visible.find((c) => c.key === 'other') ?? visible[0] ?? targets[0])?.id ?? null,
  )
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    const res = await deleteCategory(tripId, categoryId, count > 0 ? moveTo : null)
    if (res.ok) {
      onClose()
      onDeleted?.()
    } else setError(res.error ?? 'Could not delete')
  }

  return (
    <>
      {count === 0 ? (
        <p className="text-sm leading-relaxed text-text-muted">This category has no expenses. It will be removed for everyone on the trip.</p>
      ) : (
        <>
          <p className="text-sm font-bold">
            Move its {count} {count === 1 ? 'expense' : 'expenses'} to…
          </p>
          <div role="radiogroup" aria-label="Move expenses to" className="flex max-h-[40vh] flex-col overflow-y-auto">
            {visible.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={moveTo === c.id}
                onClick={() => setMoveTo(c.id)}
                className="flex min-h-[52px] items-center gap-3 border-b border-gray-100 text-left last:border-b-0"
              >
                <CategoryIcon icon={c.icon} color={c.color} size={36} iconSize={18} />
                <span className="flex-1 text-[15px] font-bold">{c.name}</span>
                <span
                  aria-hidden="true"
                  className={`h-5 w-5 rounded-full border-2 ${moveTo === c.id ? 'border-primary bg-primary shadow-[inset_0_0_0_3px_#fff]' : 'border-gray-300'}`}
                />
              </button>
            ))}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs font-bold text-error">
          {error}
        </p>
      )}
      <div className="flex gap-2.5">
        <button type="button" onClick={onClose} className="h-14 flex-1 rounded-full border border-gray-300 bg-surface text-base font-bold">
          Cancel
        </button>
        <button type="button" onClick={confirm} className="h-14 flex-1 rounded-full bg-error text-base font-bold text-white">
          {count === 0 ? 'Delete' : 'Move & delete'}
        </button>
      </div>
    </>
  )
}
