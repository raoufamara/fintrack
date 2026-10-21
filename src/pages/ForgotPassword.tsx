import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '@/stores/authStore'

export function ForgotPassword() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const resetPassword = useAuthStore((s) => s.resetPassword)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await resetPassword(email)
    setLoading(false)

    if (error) {
      setError(error)
    } else {
      setSent(true)
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <img src="/fintrack.svg" alt="" className="mx-auto mb-4 h-16 w-16" />
        <h1 className="text-3xl font-bold text-center text-primary-dark">Fintrack</h1>
        <p className="text-text-secondary text-center mt-2">Reset your password</p>

        {sent ? (
          <div className="mt-8 text-center">
            <div className="bg-success-light text-success text-sm px-4 py-3 rounded-[var(--radius-sm)]">
              Check your email for a password reset link.
            </div>
            <Link to="/login" className="inline-block mt-6 text-primary font-semibold text-sm">
              Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-8 space-y-4">
            {error && (
              <div className="bg-error-light text-error text-sm px-4 py-3 rounded-[var(--radius-sm)]">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-text-primary mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-[var(--radius-md)] border border-gray-200 bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="you@example.com"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-white font-semibold py-3 rounded-[var(--radius-xl)] hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              {loading ? 'Sending...' : 'Send reset link'}
            </button>

            <p className="text-center text-sm text-text-secondary">
              <Link to="/login" className="text-primary font-semibold">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
