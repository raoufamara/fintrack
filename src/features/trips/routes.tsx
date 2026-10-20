import { Route } from 'react-router-dom'
import { TripsShell } from './components/TripsShell'
import { CategoriesPage } from './pages/CategoriesPage'
import { ExpenseFormPage } from './pages/ExpenseFormPage'
import { BalancesPage } from './pages/BalancesPage'
import { InsightsPage } from './pages/InsightsPage'
import { ImportPage } from './pages/ImportPage'
import { JoinCodePage, JoinPage } from './pages/JoinPage'
import { JoinSharedPage } from './pages/JoinSharedPage'
import { LocationPickerPage } from './pages/LocationPickerPage'
import { NewTripPage } from './pages/NewTripPage'
import { TripPage } from './pages/TripPage'
import { TripSettingsPage } from './pages/TripSettingsPage'
import { TripsListPage } from './pages/TripsListPage'

/**
 * All Trips routes under /trips. Mount inside a router with a <TripsProvider>
 * above it (the main app and the standalone demo each provide their own).
 */
export const tripsRoutes = (
  <Route path="trips" element={<TripsShell />}>
    <Route index element={<TripsListPage />} />
    <Route path="new" element={<NewTripPage />} />
    <Route path="import" element={<ImportPage />} />
    <Route path="join" element={<JoinCodePage />} />
    <Route path="join/:code" element={<JoinPage />} />
    <Route path="join-shared/:shareToken" element={<JoinSharedPage />} />
    <Route path=":tripId" element={<TripPage />} />
    <Route path=":tripId/expenses/new" element={<ExpenseFormPage />} />
    <Route path=":tripId/expenses/:id" element={<ExpenseFormPage />} />
    <Route path=":tripId/location" element={<LocationPickerPage />} />
    <Route path=":tripId/insights" element={<InsightsPage />} />
    <Route path=":tripId/balances" element={<BalancesPage />} />
    <Route path=":tripId/settings" element={<TripSettingsPage />} />
    <Route path=":tripId/categories" element={<CategoriesPage />} />
  </Route>
)
