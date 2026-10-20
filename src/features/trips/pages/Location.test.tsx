// @vitest-environment jsdom
import { cleanup, renderHook, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFixtureGeolocation, createFixturePlacesProvider } from '../demo/fixturePlaces'
import { useCurrentPlace } from '../hooks/useCurrentPlace'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'
import { createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { GeolocationError, type GeolocationSource } from '../services/placesService'
import { TripsProvider } from '../store/TripsProvider'
import { renderTrips, TEST_USER } from '../testing/renderTrips'
import { todayISO } from '../lib/dates'

const TRIP = `/trips/${SEED_IDS.tripId}`
const NEW = `${TRIP}/expenses/new`

function env(opts: { online?: boolean; loc?: string | null } = {}) {
  const network = { online: opts.online ?? true }
  const base = createFixtureGeolocation(opts.loc ?? 'porto')
  const getCurrentPosition = vi.fn(base.getCurrentPosition)
  const geolocation: GeolocationSource = { getCurrentPosition }
  return { network, geolocation, getCurrentPosition, places: createFixturePlacesProvider(() => network.online) }
}

beforeEach(() => window.localStorage.clear())
afterEach(cleanup)

describe('useCurrentPlace', () => {
  function wrapperFor(e: ReturnType<typeof env>) {
    const repo = createMemoryTripsRepository({ currentUserId: TEST_USER, seed: [] })
    return ({ children }: { children: ReactNode }) => (
      <TripsProvider repository={repo} places={e.places} geolocation={e.geolocation}>
        {children}
      </TripsProvider>
    )
  }

  it('never asks for the position until request() is called', async () => {
    const e = env()
    const { result } = renderHook(() => useCurrentPlace(), { wrapper: wrapperFor(e) })
    await new Promise((r) => setTimeout(r, 30))
    expect(e.getCurrentPosition).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
    expect(result.current.hasGranted).toBe(false)

    let found = null
    await act(async () => {
      found = await result.current.request()
    })
    expect(e.getCurrentPosition).toHaveBeenCalledTimes(1)
    expect(e.getCurrentPosition).toHaveBeenCalledWith({ timeoutMs: 10_000, maximumAgeMs: 300_000 })
    expect(found).toMatchObject({ name: 'Ribeira', city: 'Porto' })
    expect(result.current.status).toBe('ready')
    expect(result.current.hasGranted).toBe(true)
    expect(window.localStorage.getItem('trips:geolocation-granted')).toBe('1')
  })

  it('handles a denied permission calmly and remembers nothing', async () => {
    const e = env({ loc: 'off' })
    const { result } = renderHook(() => useCurrentPlace(), { wrapper: wrapperFor(e) })
    await act(async () => {
      expect(await result.current.request()).toBeNull()
    })
    expect(result.current.status).toBe('off')
    expect(result.current.message).toBe('Location is off. Search for a place instead.')
    expect(window.localStorage.getItem('trips:geolocation-granted')).toBeNull()
  })

  it('reports an unavailable position the same way, and a failed lookup differently', async () => {
    const e = env()
    e.getCurrentPosition.mockRejectedValueOnce(new GeolocationError('unavailable'))
    const { result } = renderHook(() => useCurrentPlace(), { wrapper: wrapperFor(e) })
    await act(async () => void (await result.current.request()))
    expect(result.current.message).toBe('Location is off. Search for a place instead.')

    e.network.online = false // reverse geocoding fails
    await act(async () => void (await result.current.request()))
    expect(result.current.status).toBe('error')
    expect(result.current.message).toMatch(/Search for a place instead/)
  })
})

describe('Location row in the expense form', () => {
  it('shows an optional, empty location and does not ask for the position on its own', async () => {
    const e = env()
    renderTrips(NEW, e)
    const field = await screen.findByRole('group', { name: 'Location' })
    expect(within(field).getByText('· optional')).toBeInTheDocument()
    expect(within(field).getByRole('button', { name: /Use current location/ })).toBeInTheDocument()
    expect(within(field).getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(e.getCurrentPosition).not.toHaveBeenCalled()
  })

  it('uses the current location, saves every place field, and offers "Use here" afterwards', async () => {
    const e = env()
    const { base } = renderTrips(NEW, e)
    await userEvent.type(await screen.findByLabelText('Amount'), '12')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Coffee')
    await userEvent.click(screen.getByRole('button', { name: /Use current location/ }))
    const field = screen.getByRole('group', { name: 'Location' })
    expect(await within(field).findByText('Ribeira')).toBeInTheDocument()
    expect(within(field).getByText('Porto')).toBeInTheDocument()

    await userEvent.click(within(field).getByRole('button', { name: 'Remove location' }))
    expect(within(field).getByRole('button', { name: 'Use here: Porto' })).toBeInTheDocument()
    await userEvent.click(within(field).getByRole('button', { name: 'Use here: Porto' }))
    await within(field).findByText('Ribeira')

    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(async () => {
      const saved = (await base.getTrip(SEED_IDS.tripId))!.expenses.find((x) => x.title === 'Coffee')
      expect(saved).toMatchObject({ place_name: 'Ribeira', place_area: 'Ribeira', place_city: 'Porto', place_country: 'PT' })
      expect(saved?.place_lat).toBeCloseTo(41.1404, 3)
      expect(saved?.place_lng).toBeCloseTo(-8.6144, 3)
    })
  })

  it('shows a calm message when location is off', async () => {
    renderTrips(NEW, env({ loc: 'off' }))
    await userEvent.click(await screen.findByRole('button', { name: /Use current location/ }))
    expect(await screen.findByText('Location is off. Search for a place instead.')).toBeInTheDocument()
  })

  it('saves without a location', async () => {
    const { base } = renderTrips(NEW, env())
    await userEvent.type(await screen.findByLabelText('Amount'), '5')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Bus')
    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(async () => {
      const saved = (await base.getTrip(SEED_IDS.tripId))!.expenses.find((x) => x.title === 'Bus')
      expect(saved).toMatchObject({ place_name: null, place_lat: null, place_lng: null, place_provider_id: null })
    })
  })

  it('searches, bolds the match, shows distance, picks, and keeps the rest of the draft', async () => {
    const e = env()
    const { base } = renderTrips(NEW, e)
    await userEvent.type(await screen.findByLabelText('Amount'), '9.5')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Breakfast')
    await userEvent.click(screen.getByRole('button', { name: /Use current location/ })) // makes results distance-aware
    await screen.findByText('Ribeira')
    await userEvent.click(screen.getByRole('button', { name: 'Remove location' }))
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(screen.getByTestId('location')).toHaveTextContent(`${TRIP}/location`)
    const input = screen.getByLabelText('Search places')
    expect(input).toHaveFocus()
    await userEvent.type(input, 'c') // below the minimum: no search yet
    await userEvent.type(input, 'afé sant')
    const results = await screen.findByRole('region', { name: 'Search results' })
    const row = await within(results).findByRole('button', { name: /Café Santiago/ })
    expect(row.querySelector('b')?.textContent).toBe('Café Sant')
    expect(within(row).getByText('R. de Passos Manuel 226')).toBeInTheDocument()
    expect(within(row).getByText('Bolhão, Porto')).toBeInTheDocument()
    expect(within(row).getByText(/^\d(\.\d)? km$|^\d+ m$/)).toBeInTheDocument()

    await userEvent.click(row)
    const field = await screen.findByRole('group', { name: 'Location' })
    expect(within(field).getByText('Café Santiago')).toBeInTheDocument()
    expect(screen.getByLabelText('What was it?')).toHaveValue('Breakfast')
    expect(screen.getByLabelText('Amount')).toHaveValue('9.5')

    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(async () => {
      const saved = (await base.getTrip(SEED_IDS.tripId))!.expenses.find((x) => x.title === 'Breakfast')
      expect(saved).toMatchObject({ place_name: 'Café Santiago', place_address: 'R. de Passos Manuel 226', place_provider_id: 'N9000', place_country: 'PT' })
      expect(saved?.place_lat).toBeCloseTo(41.1479, 4)
    })
  })

  it('offers places used on this trip (max 8), which work offline', async () => {
    const e = env({ online: false })
    renderTrips(`${TRIP}/location`, e)
    const used = await screen.findByRole('region', { name: 'Used on this trip' })
    expect(within(used).getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Livraria Lello', 'Pastéis de Belém', 'Tram 28', 'Time Out Market', 'Airbnb Alfama',
    ])
  })

  it('shows the offline message when search fails, and chips still work', async () => {
    const e = env({ online: false })
    const { base } = renderTrips(NEW, e)
    await userEvent.type(await screen.findByLabelText('Amount'), '7')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Snack')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.type(screen.getByLabelText('Search places'), 'pastéis')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Search needs a connection. Pick a place you used before, or save what you typed as text.',
    )
    await userEvent.click(within(screen.getByRole('region', { name: 'Used on this trip' })).getByRole('button', { name: 'Pastéis de Belém' }))
    expect(within(await screen.findByRole('group', { name: 'Location' })).getByText('Pastéis de Belém')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(async () => {
      const saved = (await base.getTrip(SEED_IDS.tripId))!.expenses.find((x) => x.title === 'Snack')
      expect(saved).toMatchObject({ place_name: 'Pastéis de Belém', place_city: 'Lisbon' })
    })
  })

  it('saves typed text as a free-text place in the inferred city', async () => {
    const { base } = renderTrips(NEW, env())
    await userEvent.type(await screen.findByLabelText('Amount'), '3')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Skewers')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.type(screen.getByLabelText('Search places'), 'Night market stall')
    const section = await screen.findByRole('region', { name: 'Can’t find it?' })
    // No current place yet: the city of the latest located expense (Porto) is used.
    expect(within(section).getByText('It still groups under Porto in filters.')).toBeInTheDocument()
    await userEvent.click(within(section).getByRole('button', { name: /Night market stall/ }))
    const field = await screen.findByRole('group', { name: 'Location' })
    expect(within(field).getByText('Night market stall')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(async () => {
      const saved = (await base.getTrip(SEED_IDS.tripId))!.expenses.find((x) => x.title === 'Skewers')
      expect(saved).toMatchObject({ place_name: 'Night market stall', place_city: 'Porto', place_lat: null, place_lng: null, place_provider_id: null })
    })
  })

  it('prefers the current city for free text', async () => {
    renderTrips(NEW, env({ loc: 'marrakech' }))
    await userEvent.click(await screen.findByRole('button', { name: /Use current location/ }))
    await screen.findByRole('button', { name: 'Remove location' })
    await userEvent.click(screen.getByRole('button', { name: 'Remove location' }))
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.type(screen.getByLabelText('Search places'), 'Tea stall')
    expect(await screen.findByText('It still groups under Marrakech in filters.')).toBeInTheDocument()
  })

  it('skip returns without a location, and clearing removes a picked one', async () => {
    renderTrips(NEW, env())
    await userEvent.type(await screen.findByLabelText('What was it?'), 'Lunch')
    await userEvent.click(screen.getByRole('button', { name: 'Search' }))
    await userEvent.click(screen.getByRole('button', { name: 'Skip: no location' }))
    const field = await screen.findByRole('group', { name: 'Location' })
    expect(within(field).getByRole('button', { name: 'Search' })).toBeInTheDocument()
    expect(screen.getByLabelText('What was it?')).toHaveValue('Lunch')

    await userEvent.click(within(field).getByRole('button', { name: 'Search' }))
    await userEvent.click(within(screen.getByRole('region', { name: 'Used on this trip' })).getByRole('button', { name: 'Tram 28' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Remove location' }))
    expect(within(screen.getByRole('group', { name: 'Location' })).getByRole('button', { name: 'Search' })).toBeInTheDocument()
  })

  it('prefills and keeps the place when editing an expense', async () => {
    const { base } = renderTrips(`${TRIP}/expenses/e2`, env())
    const field = await screen.findByRole('group', { name: 'Location' })
    expect(within(field).getByText('Time Out Market')).toBeInTheDocument()
    expect(within(field).getByText('Cais do Sodré, Lisbon')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(async () => {
      const saved = (await base.getTrip(SEED_IDS.tripId))!.expenses.find((x) => x.id === 'e2')
      expect(saved).toMatchObject({ place_name: 'Time Out Market', place_city: 'Lisbon' })
    })
  })
})

describe('location facet and display', () => {
  it('shows places on rows as "name, city"', async () => {
    renderTrips(TRIP, env())
    const row = await screen.findByRole('button', { name: /Time Out Market dinner/ })
    expect(within(row).getByText('Time Out Market, Lisbon')).toBeInTheDocument()
    expect(within(screen.getByRole('button', { name: /Pingo Doce/ })).queryByText(/,/)).toBeNull()
  })

  it('counts cities and No location, hides unlocated expenses with a notice, and Include them restores them', async () => {
    renderTrips(TRIP, env())
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    const loc = within(within(sheet).getByRole('group', { name: 'Location' }))
    expect(loc.getByRole('button', { name: /^Lisbon\s*4$/ })).toBeInTheDocument()
    expect(loc.getByRole('button', { name: /^Porto\s*1$/ })).toBeInTheDocument()
    expect(loc.getByRole('button', { name: /^No location\s*2$/ })).toBeInTheDocument()

    await userEvent.click(loc.getByRole('button', { name: /^Lisbon/ }))
    expect(within(sheet).getByRole('button', { name: /^Show 4 expenses/ })).toBeInTheDocument()
    // Facet counts ignore the place selection itself.
    expect(loc.getByRole('button', { name: /^Porto\s*1$/ })).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: /^Show 4 expenses/ }))

    expect(screen.getByText(/2 expenses without a location are hidden by the location filter/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter Lisbon' })).toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent('place=Lisbon')
    await userEvent.click(screen.getByRole('button', { name: 'Include them' }))
    expect(screen.getByText('6 expenses · filtered')).toBeInTheDocument()
    expect(screen.queryByText(/hidden by the location filter/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter No location' })).toBeInTheDocument()
    expect(screen.getByText('Pingo Doce')).toBeInTheDocument()
  })

  it('round-trips a city containing a comma through the URL', async () => {
    const seed = buildLisbonPortoSeed(TEST_USER, todayISO())
    seed.expenses[4] = { ...seed.expenses[4]!, place_name: 'Union Station', place_city: 'Washington, D.C.' }
    const first = renderTrips(TRIP, { seed: [seed] })
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Filters' })).getByRole('button', { name: /^Washington, D\.C\./ }))
    const search = screen.getByTestId('search').textContent ?? ''
    expect(search).toContain('place=Washington')
    expect(screen.getByText('Union Station, Washington, D.C.')).toBeInTheDocument()
    first.unmount()

    renderTrips(`${TRIP}${search}`, { seed: [seed] })
    expect(await screen.findByRole('button', { name: 'Remove filter Washington, D.C.' })).toBeInTheDocument()
    expect(screen.getByText('1 expense · filtered')).toBeInTheDocument()
  })
})
