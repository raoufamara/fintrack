import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { safeRedirect } from '@/lib/safeRedirect'
import { useAuthStore } from '@/stores/authStore'

export function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const signIn = useAuthStore((s) => s.signIn)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const redirect = safeRedirect(searchParams.get('redirect'))
  const withRedirect = (path: string) => (redirect === '/' ? path : `${path}?redirect=${encodeURIComponent(redirect)}`)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    const { error } = await signIn(email, password)
    setLoading(false)

    if (error) {
      setError(error)
    } else {
      navigate(redirect, { replace: true })
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-5">
      <div className="w-full max-w-sm">
        <img src="/fintrack.svg" alt="" className="mx-auto mb-4 h-16 w-16" />
        <h1 className="text-3xl font-bold text-center text-primary-dark">Fintrack</h1>
        <p className="text-text-secondary text-center mt-2">Welcome back</p>

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

          <div>
            <label className="block text-sm font-semibold text-text-primary mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              className="w-full px-4 py-3 rounded-[var(--radius-md)] border border-gray-200 bg-surface text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="Your password"
            />
          </div>

          <div className="text-right">
            <Link to="/forgot-password" className="text-sm text-primary font-semibold">
              Forgot password?
            </Link>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white font-semibold py-3 rounded-[var(--radius-xl)] hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-sm text-text-secondary mt-6">
          Don't have an account?{' '}
          <Link to={withRedirect('/signup')} className="text-primary font-semibold">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  )
}
