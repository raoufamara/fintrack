import { useState, type FormEvent } from 'react'
import { BottomSheet } from './BottomSheet'
import { CategoryIcon } from './CategoryIcon'
import {
  CATEGORY_ICONS,
  CATEGORY_NAME_MAX,
  isDuplicateCategoryName,
  leastUsedColor,
} from '../lib/categories'
import { useTripsStore } from '../store/TripsContext'
import { CATEGORY_COLOR_KEYS } from '../lib/categories'
import type { CategoryColorKey } from '../types'

// 11 icons up front: ten from the curated list plus the generic tag.
const COLLAPSED_ICONS: readonly string[] = [...CATEGORY_ICONS.slice(0, 10), 'tag']

interface CategoryEditSheetProps {
  open: boolean
  onClose: () => void
  tripId: string
  /** Omit to create a new category. */
  categoryId?: string
  /** Called with the new category id after creating. */
  onCreated?: (categoryId: string) => void
  /** Called when the user taps Delete in edit mode. */
  onRequestDelete?: (categoryId: string) => void
}

export function CategoryEditSheet({ open, onClose, tripId, categoryId, onCreated, onRequestDelete }: CategoryEditSheetProps) {
  return (
    <BottomSheet open={open} onClose={onClose} title={categoryId ? 'Edit category' : 'New category'}>
      <EditBody tripId={tripId} categoryId={categoryId} onClose={onClose} onCreated={onCreated} onRequestDelete={onRequestDelete} />
    </BottomSheet>
  )
}

function EditBody({
  tripId,
  categoryId,
  onClose,
  onCreated,
  onRequestDelete,
}: Omit<CategoryEditSheetProps, 'open'>) {
  const snapshot = useTripsStore((s) => s.trips[tripId])
  const createCategory = useTripsStore((s) => s.createCategory)
  const updateCategory = useTripsStore((s) => s.updateCategory)
  const categories = snapshot?.categories ?? []
  const existing = categoryId ? categories.find((c) => c.id === categoryId) : undefined

  const [name, setName] = useState(existing?.name ?? '')
  const [icon, setIcon] = useState(existing?.icon ?? 'tag')
  const [color, setColor] = useState<CategoryColorKey>(existing?.color ?? leastUsedColor(categories))
  const [allIcons, setAllIcons] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const trimmed = name.trim()
  const duplicate = trimmed !== '' && isDuplicateCategoryName(trimmed, categories, categoryId)
  const error = duplicate ? `There's already a category called ${trimmed}` : serverError
  const visible = categories.filter((c) => c.hidden_at === null)
  const isLastVisible = !!existing && existing.hidden_at === null && visible.length <= 1

  const icons = allIcons
    ? CATEGORY_ICONS
    : COLLAPSED_ICONS.concat(COLLAPSED_ICONS.includes(icon) ? [] : [icon])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (trimmed === '') {
      setServerError('Give the category a name')
      return
    }
    if (duplicate || saving) return
    setSaving(true)
    if (existing) {
      const res = await updateCategory(tripId, existing.id, { name: trimmed, icon, color })
      setSaving(false)
      if (res.ok) onClose()
      else setServerError(res.error ?? 'Could not save')
    } else {
      const res = await createCategory(tripId, { name: trimmed, icon, color })
      setSaving(false)
      if (res.ok && res.id) {
        onCreated?.(res.id)
        onClose()
      } else setServerError(res.error ?? 'Could not save')
    }
  }

  const toggleHidden = async () => {
    if (!existing) return
    const res = await updateCategory(tripId, existing.id, { hidden: existing.hidden_at === null })
    if (res.ok) onClose()
    else setServerError(res.error ?? 'Could not update')
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div className="flex items-center gap-3 rounded-2xl bg-background p-3" aria-label="Preview">
        <CategoryIcon icon={icon} color={color} />
        <span
          className="inline-flex h-9 items-center rounded-full px-3.5 text-[13px] font-bold text-white"
          style={{ background: `var(--color-tripcat-${color})` }}
        >
          {trimmed || 'Category name'}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="category-name" className="text-[13px] font-extrabold text-gray-700">Name</label>
          <span className="text-xs text-text-muted">{name.length}/{CATEGORY_NAME_MAX}</span>
        </div>
        <input
          id="category-name"
          value={name}
          maxLength={CATEGORY_NAME_MAX}
          placeholder="Hammam & spa"
          aria-invalid={!!error}
          onChange={(e) => {
            setName(e.target.value)
            setServerError(null)
          }}
          className="h-12 w-full rounded-[12px] border border-gray-300 bg-surface px-3.5 text-[15px] font-semibold outline-none focus:border-2 focus:border-primary focus:px-[13px]"
        />
        {error && (
          <span role="alert" className="text-xs font-bold text-error">
            {error}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2" role="group" aria-label="Icon">
        <span className="text-[13px] font-extrabold text-gray-700">Icon</span>
        <div className="grid grid-cols-6 gap-2">
          {icons.map((name) => (
            <button
              key={name}
              type="button"
              aria-label={name.replace(/-/g, ' ')}
              aria-pressed={icon === name}
              onClick={() => setIcon(name)}
              className={`flex h-11 items-center justify-center rounded-[12px] border ${icon === name ? 'border-2 border-primary bg-primary-tint' : 'border-gray-200 bg-surface'}`}
            >
              <CategoryIcon icon={name} color={icon === name ? color : 'grey'} size={28} iconSize={18} />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setAllIcons(!allIcons)}
            aria-expanded={allIcons}
            className="flex h-11 items-center justify-center rounded-[12px] border border-dashed border-gray-300 text-xs font-bold text-text-muted"
          >
            {allIcons ? 'Less' : 'More'}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-2" role="group" aria-label="Colour">
        <span className="text-[13px] font-extrabold text-gray-700">Colour</span>
        <div className="grid grid-cols-7 gap-1.5">
          {CATEGORY_COLOR_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              aria-label={key}
              aria-pressed={color === key}
              onClick={() => setColor(key)}
              className="aspect-square min-h-11 w-full rounded-full border-2"
              style={{
                background: `var(--color-tripcat-${key})`,
                borderColor: color === key ? 'var(--color-text-primary)' : 'transparent',
                boxShadow: color === key ? 'inset 0 0 0 2px #fff' : undefined,
              }}
            />
          ))}
        </div>
      </div>

      {existing && (
        <>
          <div className="flex gap-2.5">
            <button
              type="button"
              onClick={toggleHidden}
              disabled={isLastVisible}
              className="h-12 flex-1 rounded-full border border-gray-300 bg-surface text-[15px] font-bold disabled:opacity-50"
            >
              {existing.hidden_at === null ? 'Hide' : 'Show'}
            </button>
            <button
              type="button"
              onClick={() => onRequestDelete?.(existing.id)}
              disabled={isLastVisible}
              className="h-12 flex-1 rounded-full border border-[#F3C3BF] bg-surface text-[15px] font-bold text-[#C4271D] disabled:opacity-50"
            >
              Delete
            </button>
          </div>
          {isLastVisible && (
            <p className="-mt-2 text-xs text-text-muted">
              This is your last visible category, so it can’t be hidden or deleted.
            </p>
          )}
        </>
      )}
      <button
        type="submit"
        disabled={saving}
        className="h-14 w-full rounded-full bg-primary text-base font-bold text-white disabled:bg-[#B5CFCC]"
      >
        {existing ? 'Save' : 'Add category'}
      </button>

    </form>
  )
}
