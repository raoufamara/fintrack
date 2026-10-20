import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, X } from 'lucide-react'

/** Full-screen page that covers the app's tab bar. Content is capped at phone width. */
export function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-background">
      <div className="relative mx-auto flex min-h-full w-full max-w-[430px] flex-col bg-background">
        {children}
      </div>
    </div>
  )
}

export function TopBar({
  title,
  close = false,
  right,
  onBack,
}: {
  title: string
  close?: boolean
  right?: ReactNode
  onBack?: () => void
}) {
  const navigate = useNavigate()
  return (
    <header className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-surface px-3 py-2">
      <button
        type="button"
        aria-label={close ? 'Close' : 'Back'}
        onClick={onBack ?? (() => navigate(-1))}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] hover:bg-black/5"
      >
        {close ? <X size={22} /> : <ChevronLeft size={22} />}
      </button>
      <h1 className="min-w-0 flex-1 truncate text-lg font-extrabold">{title}</h1>
      {right}
    </header>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" aria-label={label} className="flex justify-center py-16">
      <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-primary border-t-transparent" />
    </div>
  )
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <b className="text-base">Something went wrong</b>
      <p className="text-sm text-text-muted">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="h-11 rounded-full border border-gray-300 bg-surface px-5 text-sm font-bold"
        >
          Try again
        </button>
      )}
    </div>
  )
}
