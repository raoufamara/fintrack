import { useEffect, useState } from 'react'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowDown, ArrowUp, GripVertical, Plus } from 'lucide-react'
import { useParams } from 'react-router-dom'
import { CategoryEditSheet } from '../components/CategoryEditSheet'
import { CategoryIcon } from '../components/CategoryIcon'
import { MoveExpensesSheet } from '../components/MoveExpensesSheet'
import { ErrorState, Screen, Spinner, TopBar } from '../components/Screen'
import { useTripsStore } from '../store/TripsContext'
import { expenseCountByCategory, visibleCategories } from '../store/selectors'
import type { TripCategory } from '../types'

interface RowProps {
  category: TripCategory
  count: number
  addedBy: string | null
  isFirst: boolean
  isLast: boolean
  onOpen: () => void
  onMove: (direction: -1 | 1) => void
}

function CategoryRow({ category, count, addedBy, isFirst, isLast, onOpen, onMove }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: category.id })
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 5 : undefined }}
      className={`flex items-center gap-1 border-b border-gray-100 bg-surface py-1.5 last:border-b-0 ${isDragging ? 'shadow-lg' : ''}`}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        aria-label={`Drag to reorder ${category.name}`}
        className="flex h-11 w-9 shrink-0 touch-none items-center justify-center text-text-muted"
        {...attributes}
        {...listeners}
      >
        <GripVertical size={18} />
      </button>
      <button type="button" onClick={onOpen} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
        <CategoryIcon icon={category.icon} color={category.color} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[15px] font-bold">{category.name}</span>
            {category.key === null && (
              <span className="rounded-[6px] bg-primary-tint px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-primary">
                CUSTOM
              </span>
            )}
          </span>
          <span className="truncate text-xs text-text-muted">
            {count} {count === 1 ? 'expense' : 'expenses'}
            {category.key === null && addedBy ? ` · Added by ${addedBy}` : ''}
          </span>
        </span>
      </button>
      <button
        type="button"
        aria-label={`Move ${category.name} up`}
        disabled={isFirst}
        onClick={() => onMove(-1)}
        className="flex h-11 w-9 shrink-0 items-center justify-center rounded-[12px] text-gray-600 hover:bg-black/5 disabled:opacity-30"
      >
        <ArrowUp size={16} />
      </button>
      <button
        type="button"
        aria-label={`Move ${category.name} down`}
        disabled={isLast}
        onClick={() => onMove(1)}
        className="flex h-11 w-9 shrink-0 items-center justify-center rounded-[12px] text-gray-600 hover:bg-black/5 disabled:opacity-30"
      >
        <ArrowDown size={16} />
      </button>
    </li>
  )
}

type SheetState = { kind: 'edit'; id?: string } | { kind: 'delete'; id: string } | null

export function CategoriesPage() {
  const { tripId = '' } = useParams()
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const status = useTripsStore((s) => s.tripStatus[tripId] ?? 'idle')
  const error = useTripsStore((s) => s.tripError[tripId])
  const loadTrip = useTripsStore((s) => s.loadTrip)
  const reorderCategories = useTripsStore((s) => s.reorderCategories)
  const updateCategory = useTripsStore((s) => s.updateCategory)
  const [sheet, setSheet] = useState<SheetState>(null)

  useEffect(() => {
    if (!snapshot) void loadTrip(tripId)
  }, [loadTrip, tripId, snapshot])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (!snapshot) {
    return (
      <Screen>
        <TopBar title="Categories" />
        {status === 'error' ? <ErrorState message={error || 'Could not load this trip.'} onRetry={() => void loadTrip(tripId)} /> : <Spinner />}
      </Screen>
    )
  }

  const visible = visibleCategories(snapshot.categories)
  const hidden = snapshot.categories
    .filter((c) => c.hidden_at !== null)
    .sort((a, b) => a.sort_order - b.sort_order)
  const counts = expenseCountByCategory(snapshot.expenses)
  const memberName = (id: string | null) => snapshot.members.find((m) => m.id === id)?.display_name ?? null

  const persistOrder = (ids: string[]) =>
    void reorderCategories(tripId, [...ids, ...hidden.map((c) => c.id)])
  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= visible.length) return
    persistOrder(arrayMove(visible.map((c) => c.id), index, target))
  }
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return
    const ids = visible.map((c) => c.id)
    persistOrder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))))
  }
  const show = async (id: string) => {
    await updateCategory(tripId, id, { hidden: false })
  }
  const closeSheet = () => setSheet(null)

  return (
    <Screen>
      <TopBar title="Categories" />
      <div className="flex flex-col gap-4 p-4 pb-28">
        <p className="text-xs leading-relaxed text-text-muted">
          Everyone on the trip shares these. Drag to reorder, or use the arrows.
        </p>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={visible.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            <ul aria-label="Categories" className="rounded-[18px] bg-surface px-3 py-0.5">
              {visible.map((c, i) => (
                <CategoryRow
                  key={c.id}
                  category={c}
                  count={counts.get(c.id) ?? 0}
                  addedBy={memberName(c.created_by_member)}
                  isFirst={i === 0}
                  isLast={i === visible.length - 1}
                  onOpen={() => setSheet({ kind: 'edit', id: c.id })}
                  onMove={(d) => move(i, d)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>

        {hidden.length > 0 && (
          <section aria-label="Hidden categories" className="flex flex-col gap-2">
            <h2 className="text-xs font-extrabold uppercase tracking-widest text-text-muted">Hidden</h2>
            <ul className="rounded-[18px] bg-surface px-3 py-0.5">
              {hidden.map((c) => (
                <li key={c.id} className="flex items-center gap-3 border-b border-gray-100 py-1.5 last:border-b-0">
                  <button type="button" onClick={() => setSheet({ kind: 'edit', id: c.id })} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
                    <CategoryIcon icon={c.icon} color={c.color} />
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate text-[15px] font-bold text-text-muted">{c.name}</span>
                      <span className="text-xs text-text-muted">
                        {counts.get(c.id) ?? 0} {(counts.get(c.id) ?? 0) === 1 ? 'expense' : 'expenses'}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Show ${c.name}`}
                    onClick={() => void show(c.id)}
                    className="h-9 rounded-full border border-gray-300 px-4 text-[13px] font-bold"
                  >
                    Show
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
        <div className="pointer-events-auto mx-auto max-w-[430px] bg-gradient-to-t from-background to-transparent px-4 pb-5 pt-4">
          <button
            type="button"
            onClick={() => setSheet({ kind: 'edit' })}
            className="flex h-14 w-full items-center justify-center gap-2 rounded-full bg-primary text-base font-bold text-white"
          >
            <Plus size={20} aria-hidden="true" />
            Add category
          </button>
        </div>
      </div>

      <CategoryEditSheet
        key={sheet?.kind === 'edit' ? (sheet.id ?? 'new') : 'closed'}
        open={sheet?.kind === 'edit'}
        onClose={closeSheet}
        tripId={tripId}
        categoryId={sheet?.kind === 'edit' ? sheet.id : undefined}
        onRequestDelete={(id) => setSheet({ kind: 'delete', id })}
      />
      <MoveExpensesSheet
        open={sheet?.kind === 'delete'}
        onClose={closeSheet}
        tripId={tripId}
        categoryId={sheet?.kind === 'delete' ? sheet.id : ''}
      />
    </Screen>
  )
}
