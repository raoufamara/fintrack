import { useEffect } from 'react'
import { useTripsStore } from '../store/TripsContext'

/** Shows the store's single toast; errors stay a little longer. */
export function Toaster() {
  const toast = useTripsStore((s) => s.toast)
  const dismiss = useTripsStore((s) => s.dismissToast)

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(dismiss, toast.kind === 'error' ? 5000 : 2600)
    return () => clearTimeout(timer)
  }, [toast, dismiss])

  if (!toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-4">
      <div
        role={toast.kind === 'error' ? 'alert' : 'status'}
        className="pointer-events-auto max-w-[398px] rounded-2xl bg-primary-dark px-4 py-3 text-sm font-semibold text-white shadow-lg"
      >
        {toast.message}
      </div>
    </div>
  )
}
