import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Optional action in the header, left of the close button (e.g. Reset). */
  headerAction?: ReactNode
}

/**
 * Modal sheet: traps focus, closes on Esc and on a scrim tap, and returns
 * focus to the element that opened it.
 */
export function BottomSheet({ open, onClose, title, children, headerAction }: BottomSheetProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const focusables = () =>
      panel ? Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)) : []

    // Prefer the first field/choice over the close button.
    const items = focusables()
    ;(items.find((el) => !el.hasAttribute('data-sheet-close')) ?? items[0] ?? panel)?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const list = focusables()
      if (list.length === 0) {
        event.preventDefault()
        return
      }
      const first = list[0]
      const last = list[list.length - 1]
      const active = document.activeElement
      if (event.shiftKey && (active === first || !panel?.contains(active))) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && (active === last || !panel?.contains(active))) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      opener?.focus()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close"
        className="absolute inset-0 bg-sheet-scrim"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative mx-auto flex max-h-[92%] w-full max-w-[430px] flex-col rounded-t-[24px] bg-surface outline-none"
      >
        <div className="mx-auto mt-2.5 h-[5px] w-10 rounded-full bg-gray-200" />
        <div className="flex items-center justify-between px-5 pb-1 pt-2.5">
          <h2 id={titleId} className="text-xl font-extrabold">
            {title}
          </h2>
          <div className="flex items-center gap-1">
          {headerAction}
          <button
            type="button"
            data-sheet-close
            aria-label="Close"
            onClick={onClose}
            className="-mr-2.5 flex h-11 w-11 items-center justify-center rounded-[12px] text-text-primary hover:bg-black/5"
          >
            <X size={22} />
          </button>
          </div>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto px-5 pb-6 pt-1">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
