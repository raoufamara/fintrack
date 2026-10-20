import { Route } from 'react-router-dom'
import { GuestRouteShell } from './components/GuestRouteShell'
import { BalancesPage } from './pages/BalancesPage'
import { InsightsPage } from './pages/InsightsPage'
import { TripPage } from './pages/TripPage'

/**
 * The public routes under /t/:shareToken. Register them OUTSIDE any auth guard,
 * inside a <GuestProvider>. They read through get_shared_trip only.
 */
export const tripsPublicRoutes = (
  <Route path="t/:shareToken" element={<GuestRouteShell />}>
    <Route index element={<TripPage />} />
    <Route path="balances" element={<BalancesPage />} />
    <Route path="insights" element={<InsightsPage />} />
  </Route>
)
