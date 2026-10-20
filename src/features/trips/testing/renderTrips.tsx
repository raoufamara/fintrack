/* eslint-disable react-refresh/only-export-components -- test-only helper */
import { render } from '@testing-library/react'
import { MemoryRouter, Routes, useLocation } from 'react-router-dom'
import { todayISO } from '../lib/dates'
import { buildLisbonPortoSeed } from '../services/memorySeed'
import { createMemoryTripsRepository } from '../services/memoryTripsRepository'
import type { FxService } from '../services/fxService'
import type { TripSnapshot, TripsRepository } from '../services/TripsRepository'
import { tripsRoutes } from '../routes'
import { TripsProvider } from '../store/TripsProvider'

export const TEST_USER = 'u-you'

function LocationProbe() {
  const location = useLocation()
  return (
    <>
      <div data-testid="location">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  )
}

/** Renders the real Trips routes against a memory repository. Test-only helper. */
export function renderTrips(
  path: string,
  opts: { seed?: TripSnapshot[]; repository?: Partial<TripsRepository>; fx?: FxService } = {},
) {
  const base = createMemoryTripsRepository({
    currentUserId: TEST_USER,
    seed: opts.seed ?? [buildLisbonPortoSeed(TEST_USER, todayISO())],
  })
  const repository: TripsRepository = { ...base, ...opts.repository }
  const view = render(
    <TripsProvider repository={repository} fx={opts.fx}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>{tripsRoutes}</Routes>
        <LocationProbe />
      </MemoryRouter>
    </TripsProvider>,
  )
  return { ...view, repository, base }
}
