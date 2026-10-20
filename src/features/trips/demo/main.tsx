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
import { createFixturePlacesProvider, createFixtureGeolocation } from './fixturePlaces'
import { createFixtureProvider, seededCache } from './fixtureRates'

/**
 * Standalone demo: Trips running on the in-memory repository with a fake
 * signed-in user and sample exchange rates. It imports nothing from the app's
 * Supabase client or auth, which also proves the module can stand alone.
 *
 * Flags (query string, before the #): ?offline=1 starts offline,
 * ?norates=1 starts with an empty rate cache, ?loc=porto|marrakech|off picks the
 * simulated device position (off = permission denied). Offline makes place search fail. Both together make foreign
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

// A slim bar above the app, so the badge never covers a control.
document.documentElement.style.setProperty('--trips-top-inset', '28px')

const places = createFixturePlacesProvider(() => network.online)
const geolocation = createFixtureGeolocation(params.get('loc'))

function DemoBar() {
  const [online, setOnline] = useState(network.online)
  const toggle = () => {
    network.online = !network.online
    setOnline(network.online)
    if (network.online) window.dispatchEvent(new Event('online'))
  }
  return (
    <div className="fixed inset-x-0 top-0 z-[80] flex h-7 items-center justify-between bg-primary-dark px-3 text-[11px] font-bold text-white">
      <span>Trips demo · sample data</span>
      <button
        type="button"
        onClick={toggle}
        aria-label={online ? 'Demo network: online. Tap to go offline' : 'Demo network: offline. Tap to go online'}
        className={`rounded-full px-2.5 py-0.5 text-[10px] font-extrabold ${online ? 'bg-success text-white' : 'bg-owe-light text-primary-dark'}`}
      >
        {online ? 'ONLINE' : 'OFFLINE'}
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <TripsProvider repository={repository} fx={fx} places={places} geolocation={geolocation}>
        <Routes>
          {tripsRoutes}
          <Route path="*" element={<Navigate to="/trips" replace />} />
        </Routes>
      </TripsProvider>
      <DemoBar />
    </HashRouter>
  </StrictMode>,
)
