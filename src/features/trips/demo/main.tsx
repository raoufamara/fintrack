import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import '@/index.css'
import { createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { TripsProvider } from '../store/TripsProvider'
import { tripsRoutes } from '../routes'

/**
 * Standalone demo: Trips running on the in-memory repository with a fake
 * signed-in user. It imports nothing from the app's Supabase client or auth,
 * which also proves the module can stand alone.
 */
const repository = createMemoryTripsRepository({ currentUserId: 'demo-user-you', latencyMs: 120 })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <TripsProvider repository={repository}>
        <Routes>
          {tripsRoutes}
          <Route path="*" element={<Navigate to="/trips" replace />} />
        </Routes>
      </TripsProvider>
    </HashRouter>
  </StrictMode>,
)
