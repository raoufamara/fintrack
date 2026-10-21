import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { GuestRoute } from '@/components/layout/GuestRoute'
import { Account } from '@/pages/Account'
import { Login } from '@/pages/Login'
import { Signup } from '@/pages/Signup'
import { ForgotPassword } from '@/pages/ForgotPassword'
import { SupabaseTripsProvider } from '@/features/trips/SupabaseTripsProvider'
import { PublicTripsProvider } from '@/features/trips/PublicTripsProvider'
import { tripsPublicRoutes } from '@/features/trips/publicRoutes'
import { tripsRoutes } from '@/features/trips/routes'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth routes — only accessible when NOT logged in */}
        <Route path="login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="signup" element={<GuestRoute><Signup /></GuestRoute>} />
        <Route path="forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />

        {/* Public view-only trip links: outside every auth guard, anon key only */}
        <Route element={<PublicTripsProvider />}>{tripsPublicRoutes}</Route>

        {/* Protected routes — require login */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/trips" replace />} />
          <Route path="account" element={<Account />} />
          <Route element={<SupabaseTripsProvider />}>{tripsRoutes}</Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
