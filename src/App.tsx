import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { ProtectedRoute } from '@/components/layout/ProtectedRoute'
import { GuestRoute } from '@/components/layout/GuestRoute'
import { Dashboard } from '@/pages/Dashboard'
import { Insights } from '@/pages/Insights'
import { Profile } from '@/pages/Profile'
import { CreateBudget } from '@/pages/CreateBudget'
import { CategoryDetail } from '@/pages/CategoryDetail'
import { Login } from '@/pages/Login'
import { Signup } from '@/pages/Signup'
import { ForgotPassword } from '@/pages/ForgotPassword'
import { AddTransaction } from '@/pages/AddTransaction'
import { TransactionHistory } from '@/pages/TransactionHistory'
import { StrategyWizard } from '@/pages/StrategyWizard'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth routes — only accessible when NOT logged in */}
        <Route path="login" element={<GuestRoute><Login /></GuestRoute>} />
        <Route path="signup" element={<GuestRoute><Signup /></GuestRoute>} />
        <Route path="forgot-password" element={<GuestRoute><ForgotPassword /></GuestRoute>} />

        {/* Protected routes — require login */}
        <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
          <Route index element={<Dashboard />} />
          <Route path="insights" element={<Insights />} />
          <Route path="insights/:categoryId" element={<CategoryDetail />} />
          <Route path="profile" element={<Profile />} />
          <Route path="transactions" element={<TransactionHistory />} />
        </Route>
        <Route path="transactions/add" element={<ProtectedRoute><AddTransaction /></ProtectedRoute>} />
        <Route path="budget/create" element={<ProtectedRoute><CreateBudget /></ProtectedRoute>} />
        <Route path="onboarding/strategy" element={<ProtectedRoute><StrategyWizard /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
