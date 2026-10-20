/* eslint-disable react-refresh/only-export-components -- demo entry, not hot-reloaded */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import '@/index.css'
import { createFxService } from '../services/fxService'
import { createMemoryFxStorage } from '../services/fxStorage'
import { createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { TripsProvider } from '../store/TripsProvider'
import { tripsRoutes } from '../routes'
import { createFixtureProvider, seededCache } from './fixtureRates'

/**
 * Standalone demo: Trips running on the in-memory repository with a fake
 * signed-in user and sample exchange rates. It imports nothing from the app's
 * Supabase client or auth, which also proves the module can stand alone.
 *
 * Flags (query string, before the #): ?offline=1 starts offline,
 * ?norates=1 starts with an empty rate cache. Both together make foreign
 * currency expenses pending until you go online with the toggle.
 */
const params = new URLSearchParams(window.location.search)
const network = { online: params.get('offline') !== '1' }

const repository = createMemoryTripsRepository({ currentUserId: 'demo-user-you', latencyMs: 120 })
const fx = createFxService({
  provider: createFixtureProvider(),
  storage: createMemoryFxStorage(params.get('norates') === '1' ? {} : seededCache(2)),
  isOnline: () => network.online,
})

function DemoPanel() {
  const [online, setOnline] = useState(network.online)
  const toggle = () => {
    network.online = !network.online
    setOnline(network.online)
    if (network.online) window.dispatchEvent(new Event('online'))
  }
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={online ? 'Demo network: online. Tap to go offline' : 'Demo network: offline. Tap to go online'}
      className={`fixed right-2 top-1 z-[80] rounded-full px-2.5 py-1 text-[10px] font-extrabold ${online ? 'bg-success text-white' : 'bg-owe-light text-primary-dark'}`}
    >
      DEMO · {online ? 'ONLINE' : 'OFFLINE'}
    </button>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <TripsProvider repository={repository} fx={fx}>
        <Routes>
          {tripsRoutes}
          <Route path="*" element={<Navigate to="/trips" replace />} />
        </Routes>
      </TripsProvider>
      <DemoPanel />
    </HashRouter>
  </StrictMode>,
)
