/* eslint-disable react-refresh/only-export-components -- demo entry, not hot-reloaded */
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, Navigate, Outlet, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import '@/index.css'
import { createFxService } from '../services/fxService'
import { createMemoryFxStorage } from '../services/fxStorage'
import { fromMinor, toMinor } from '../lib/currency'
import { splitAmount } from '../lib/money'
import { buildLisbonPortoSeed } from '../services/memorySeed'
import { createMemoryBackend, createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { createMemorySharedTripRepository } from '../services/memorySharedRepository'
import { createMemorySharedCache, withSharedCache } from '../services/sharedTripRepository'
import { todayISO } from '../lib/dates'
import { GuestProvider } from '../store/GuestProvider'
import { tripsPublicRoutes } from '../publicRoutes'
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

// Writes fail like a dropped connection while the demo is offline, so the retry queue can be tried.
const backend = createMemoryBackend([buildLisbonPortoSeed('demo-user-you', todayISO())])
const repository = createMemoryTripsRepository({
  backend,
  currentUserId: 'demo-user-you',
  latencyMs: 120,
  isOnline: () => network.online,
})
const fx = createFxService({
  provider: createFixtureProvider(),
  storage: createMemoryFxStorage(params.get('norates') === '1' ? {} : seededCache(2)),
  isOnline: () => network.online,
})

// A slim bar above the app, so the badge never covers a control.
document.documentElement.style.setProperty('--trips-top-inset', '28px')

// The guest view reads the same backend through the shared (view-only) repository.
const shared = withSharedCache(
  createMemorySharedTripRepository(backend, { isOnline: () => network.online, latencyMs: 100 }),
  createMemorySharedCache(),
)

const places = createFixturePlacesProvider(() => network.online)
const geolocation = createFixtureGeolocation(params.get('loc'))

/** Pretends Sara added an expense on her own phone. */
function remoteAdd() {
  repository.simulateRemote('trip-lisbon', (snap) => {
    const id = `remote-${Date.now()}`
    const at = new Date().toISOString()
    const base = snap.expenses[0]
    if (!base) return
    snap.expenses.push({ ...base, id, title: 'Added from Sara’s phone', amount: 18, amount_default: 18, category_id: 'c-food', paid_by: 'm2', date: at.slice(0, 10), created_at: at, updated_at: at, client_id: null })
    for (const [member_id, minor] of splitAmount(toMinor('18', 'EUR'), 'equal', snap.members.map((m) => m.id))) {
      snap.shares.push({ expense_id: id, member_id, weight: 1, amount: fromMinor(minor, 'EUR') })
    }
  })
}

function DemoBar() {
  const [online, setOnline] = useState(network.online)
  const [linkOn, setLinkOn] = useState(true)
  const toggleLink = () => {
    const next = !linkOn
    setLinkOn(next)
    backend.db.get('trip-lisbon')!.trip.share_enabled = next
  }
  const toggle = () => {
    network.online = !network.online
    setOnline(network.online)
    if (network.online) window.dispatchEvent(new Event('online'))
  }
  return (
    <div className="fixed inset-x-0 top-0 z-[80] flex h-7 items-center justify-between bg-primary-dark px-3 text-[11px] font-bold text-white">
      <span>Trips demo · sample data</span>
      <button type="button" onClick={toggleLink} className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-extrabold">
        Link {linkOn ? 'on' : 'off'}
      </button>
      <button type="button" onClick={remoteAdd} className="rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-extrabold">
        Remote add
      </button>
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

/** Stand-in for the app's login screen: shows where it would send you back to. */
function DemoLogin() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const redirect = params.get('redirect') ?? '/trips'
  return (
    <div className="fixed inset-x-0 bottom-0 top-[var(--trips-top-inset,0px)] flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
      <b className="text-lg">Login (demo stand-in)</b>
      <p className="text-sm text-text-muted">
        After login you would go to <code data-testid="redirect">{redirect}</code>
      </p>
      <button type="button" onClick={() => navigate(redirect, { replace: true })} className="h-12 rounded-full bg-primary px-6 font-bold text-white">
        Continue as the demo user
      </button>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <HashRouter>
      <Routes>
        <Route
          element={
            <GuestProvider shared={shared} fx={fx}>
              <Outlet />
            </GuestProvider>
          }
        >
          {tripsPublicRoutes}
        </Route>
        <Route
          element={
            <TripsProvider repository={repository} fx={fx} places={places} geolocation={geolocation} homeCurrency="CAD">
              <Outlet />
            </TripsProvider>
          }
        >
          {tripsRoutes}
        </Route>
        <Route path="login" element={<DemoLogin />} />
        <Route path="*" element={<Navigate to="/trips" replace />} />
      </Routes>
      <DemoBar />
    </HashRouter>
  </StrictMode>,
)
