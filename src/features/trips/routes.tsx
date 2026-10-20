import { Route } from 'react-router-dom'
import { TripsShell } from './components/TripsShell'
import { CategoriesPage } from './pages/CategoriesPage'
import { ComingSoonPage } from './pages/ComingSoonPage'
import { ExpenseFormPage } from './pages/ExpenseFormPage'
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
    <Route path="join" element={<ComingSoonPage title="Join a trip" />} />
    <Route path=":tripId" element={<TripPage />} />
    <Route path=":tripId/expenses/new" element={<ExpenseFormPage />} />
    <Route path=":tripId/expenses/:id" element={<ExpenseFormPage />} />
    <Route path=":tripId/location" element={<LocationPickerPage />} />
    <Route path=":tripId/insights" element={<ComingSoonPage title="Insights" />} />
    <Route path=":tripId/balances" element={<ComingSoonPage title="Balances" />} />
    <Route path=":tripId/settings" element={<TripSettingsPage />} />
    <Route path=":tripId/categories" element={<CategoriesPage />} />
  </Route>
)
