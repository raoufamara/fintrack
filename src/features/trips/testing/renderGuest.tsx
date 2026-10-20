/* eslint-disable react-refresh/only-export-components -- test-only helper */
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, useLocation } from 'react-router-dom'
import { todayISO } from '../lib/dates'
import { tripsPublicRoutes } from '../publicRoutes'
import type { FxService } from '../services/fxService'
import { buildLisbonPortoSeed } from '../services/memorySeed'
import { createMemorySharedTripRepository } from '../services/memorySharedRepository'
import { createMemoryBackend, type MemoryBackend } from '../services/memoryTripsRepository'
import type { SharedTripRepository } from '../services/sharedTripRepository'
import { GuestProvider } from '../store/GuestProvider'
import { TEST_USER } from './renderTrips'

function Probe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  )
}

export const SHARE_TOKEN = 'demo-share-token'

/** Renders the public view-only routes with NO TripsProvider of the signed-in app and no auth. Test-only. */
export function renderGuest(
  path: string,
  opts: { backend?: MemoryBackend; shared?: SharedTripRepository; fx?: FxService } = {},
) {
  const backend = opts.backend ?? createMemoryBackend([buildLisbonPortoSeed(TEST_USER, todayISO())])
  const shared = opts.shared ?? createMemorySharedTripRepository(backend)
  const view = render(
    <GuestProvider shared={shared} fx={opts.fx}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{tripsPublicRoutes}</Routes>
        <Probe />
      </MemoryRouter>
    </GuestProvider>,
  )
  return { ...view, backend, shared }
}
