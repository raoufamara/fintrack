// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../lib/dates'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'
import { createMemorySharedTripRepository } from '../services/memorySharedRepository'
import { createMemoryBackend, createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { createMemorySharedCache, withSharedCache } from '../services/sharedTripRepository'
import { RepositoryError, NetworkError } from '../services/TripsRepository'
import { makeFx } from '../testing/fxFixtures'
import { renderGuest, SHARE_TOKEN } from '../testing/renderGuest'
import { renderTrips, TEST_USER } from '../testing/renderTrips'

const GUEST = `/t/${SHARE_TOKEN}`

function backendWith(edit?: (s: ReturnType<typeof buildLisbonPortoSeed>) => void) {
  const seed = buildLisbonPortoSeed(TEST_USER, todayISO())
  edit?.(seed)
  return createMemoryBackend([seed])
}

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('public view-only trip', () => {
  it('opens without any account and shows no write controls', async () => {
    renderGuest(GUEST)
    expect(await screen.findByRole('heading', { name: 'Lisbon & Porto' })).toBeInTheDocument()
    expect(screen.getByText('View only · shared by You')).toBeInTheDocument()
    expect(screen.getByText('7 expenses')).toBeInTheDocument()
    for (const name of [/Add expense/, /Trip settings/, /Back to trips/, /Mark as paid/, /Remind/]) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    // Insights and Balances stay.
    expect(screen.getByRole('button', { name: 'Insights' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Balances' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join to add expenses' })).toBeInTheDocument()
    expect(screen.getByText('Free account. Past expenses stay linked to you.')).toBeInTheDocument()
  })

  it('shows "Who are you?" lines for the picked member and remembers the choice', async () => {
    const first = renderGuest(GUEST)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(screen.getByText('Pick your name to see your balance.')).toBeInTheDocument()
    const who = screen.getByRole('group', { name: 'Who are you?' })
    await userEvent.click(within(who).getByRole('button', { name: 'Malik' }))
    expect(await screen.findByText('Malik owes Sara €146.09')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Join as Malik to add expenses' })).toBeInTheDocument()
    expect(window.localStorage.getItem('trip-guest:trip-lisbon')).toBe(SEED_IDS.malik)

    first.unmount()
    renderGuest(GUEST)
    expect(await screen.findByText('Malik owes Sara €146.09')).toBeInTheDocument()
    expect(within(screen.getByRole('group', { name: 'Who are you?' })).getByRole('button', { name: 'Malik' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says a settled member is settled up, and ignores a stored pick that is no longer a member', async () => {
    window.localStorage.setItem('trip-guest:trip-lisbon', 'gone-member')
    const backend = backendWith((s) => {
      s.expenses = []
      s.shares = []
    })
    renderGuest(GUEST, { backend })
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(screen.getByText('Pick your name to see your balance.')).toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'Who are you?' })).getByRole('button', { name: 'Sara' }))
    expect(await screen.findByText('Sara is settled up')).toBeInTheDocument()
  })

  it('filters and searches like the member view; "mine" needs a picked name', async () => {
    // Inès is not part of the Time Out Market dinner.
    const backend = backendWith((s) => {
      s.shares = s.shares.filter((x) => !(x.expense_id === 'e2' && x.member_id === SEED_IDS.ines))
    })
    renderGuest(GUEST, { backend })
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    const chips = screen.getByRole('group', { name: 'Filter by category' })
    await userEvent.click(within(chips).getByRole('button', { name: 'Food & drinks' }))
    expect(screen.getByText('2 expenses · filtered')).toBeInTheDocument()
    await userEvent.click(within(chips).getByRole('button', { name: 'All' }))

    await userEvent.type(screen.getByLabelText('Search expenses or places'), 'pasteis')
    expect(await screen.findByText('1 expense · filtered')).toBeInTheDocument()
    await userEvent.clear(screen.getByLabelText('Search expenses or places'))
    await waitFor(() => expect(screen.getByText('7 expenses')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
    let sheet = screen.getByRole('dialog', { name: 'Filters' })
    expect(within(sheet).queryByText('Only expenses I’m part of')).toBeNull()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }))

    await userEvent.click(within(screen.getByRole('group', { name: 'Who are you?' })).getByRole('button', { name: 'Inès' }))
    await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
    sheet = screen.getByRole('dialog', { name: 'Filters' })
    await userEvent.click(within(sheet).getByLabelText('Only expenses I’m part of'))
    await userEvent.click(within(sheet).getByRole('button', { name: /^Show 6 expenses/ }))
    expect(screen.getByText('6 expenses · filtered')).toBeInTheDocument()
    expect(screen.getByText(/Your share of these/)).toBeInTheDocument()
  })

  it('opens a read-only detail sheet without edit controls or coordinates', async () => {
    const backend = backendWith((s) => {
      s.expenses[1] = { ...s.expenses[1]!, place_lat: 38.7068, place_lng: -9.1458, place_provider_id: 'N9' }
    })
    renderGuest(GUEST, { backend })
    await userEvent.click(await screen.findByRole('button', { name: /Time Out Market dinner/ }))
    const dialog = screen.getByRole('dialog', { name: 'Time Out Market dinner' })
    for (const [label, value] of [
      ['Amount', '€86.40'],
      ['Category', 'Food & drinks'],
      ['Paid by', 'You'],
      ['Split between', 'You, Sara, Malik, Inès'],
    ]) {
      expect(within(dialog).getByText(label!)).toBeInTheDocument()
      expect(within(dialog).getByText(value!)).toBeInTheDocument()
    }
    expect(within(dialog).getByText('Time Out Market, Cais do Sodré, Lisbon')).toBeInTheDocument()
    expect(dialog.textContent).not.toMatch(/38\.7|9\.14|N9/)
    // The only control is Close.
    expect(within(dialog).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Close'])
    expect(within(dialog).queryByText(/Edit|Delete/)).toBeNull()
    expect(screen.getByTestId('location')).toHaveTextContent(GUEST)
  })

  it('shows read-only balances and insights, with My share disabled until a name is picked', async () => {
    renderGuest(`${GUEST}/balances`)
    expect(await screen.findByRole('region', { name: 'Net balance' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mark as paid|Remind/ })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'How to settle up' })).getAllByRole('listitem')).toHaveLength(3)
    cleanup()

    renderGuest(`${GUEST}/insights`)
    const mine = await screen.findByRole('button', { name: 'My share' })
    expect(mine).toBeDisabled()
    cleanup()

    window.localStorage.setItem('trip-guest:trip-lisbon', SEED_IDS.you)
    renderGuest(`${GUEST}/insights`)
    const enabled = await screen.findByRole('button', { name: 'My share' })
    await waitFor(() => expect(enabled).toBeEnabled())
    await userEvent.click(enabled)
    expect(await screen.findByText('€190.84')).toBeInTheDocument()
  })

  it('links insight rows to the guest list, not the member list', async () => {
    renderGuest(`${GUEST}/insights`)
    const cats = await screen.findByRole('region', { name: 'By category' })
    await userEvent.click(within(cats).getByRole('button', { name: /Food & drinks/ }))
    expect(screen.getByTestId('location')).toHaveTextContent(GUEST)
    expect(screen.getByTestId('search')).toHaveTextContent('cat=c-food')
    expect(await screen.findByText('2 expenses · filtered')).toBeInTheDocument()
  })
})

describe('guest display currency', () => {
  it('uses the browser locale currency and converts with cached rates', async () => {
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-CA')
    const { fx } = makeFx({ hoursAgo: 2 })
    renderGuest(`${GUEST}/balances`, { fx })
    const toggle = await screen.findByRole('group', { name: 'Currency to show' })
    await userEvent.click(within(toggle).getByRole('button', { name: 'CAD · mine' }))
    expect(within(screen.getByRole('region', { name: 'Net balance' })).getByText('≈ CA$507.10')).toBeInTheDocument()
    expect(window.localStorage.getItem('trips:guest-display-currency')).toBe('CAD')
  })

  it('shows no control when the locale has no currency, or it equals the trip currency', async () => {
    const { fx } = makeFx()
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('fr-FR') // EUR, the trip currency
    renderGuest(`${GUEST}/balances`, { fx })
    await screen.findByRole('region', { name: 'Net balance' })
    await new Promise((r) => setTimeout(r, 40))
    expect(screen.queryByRole('group', { name: 'Currency to show' })).toBeNull()
  })
})

describe('link states', () => {
  it('shows the dead-link message for unknown, disabled and reset links', async () => {
    renderGuest('/t/not-a-real-token')
    expect(await screen.findByText('This link no longer works')).toBeInTheDocument()
    expect(screen.getByText('Ask the trip owner for a new one.')).toBeInTheDocument()
    cleanup()

    const backend = backendWith()
    const owner = createMemoryTripsRepository({ currentUserId: TEST_USER, backend })
    await owner.setShareEnabled(SEED_IDS.tripId, false)
    renderGuest(GUEST, { backend })
    expect(await screen.findByText('This link no longer works')).toBeInTheDocument()
    cleanup()

    await owner.setShareEnabled(SEED_IDS.tripId, true)
    const fresh = await owner.rotateShareToken(SEED_IDS.tripId)
    renderGuest(GUEST, { backend })
    expect(await screen.findByText('This link no longer works')).toBeInTheDocument()
    cleanup()
    renderGuest(`/t/${fresh}`, { backend })
    expect(await screen.findByRole('heading', { name: 'Lisbon & Porto' })).toBeInTheDocument()
  })

  it('switches to the dead state when the owner turns sharing off while the page is open', async () => {
    const backend = backendWith()
    renderGuest(GUEST, { backend })
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    backend.db.get(SEED_IDS.tripId)!.trip.share_enabled = false
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText('This link no longer works')).toBeInTheDocument()
  })

  it('refreshes on focus so edits made by members show up', async () => {
    const backend = backendWith()
    const owner = createMemoryTripsRepository({ currentUserId: TEST_USER, backend })
    renderGuest(GUEST, { backend })
    expect(await screen.findByText('7 expenses')).toBeInTheDocument()
    await owner.deleteExpense('e5')
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(await screen.findByText('6 expenses')).toBeInTheDocument()
  })

  it('marks an archived trip with a chip', async () => {
    const backend = backendWith((s) => {
      s.trip.archived_at = '2026-10-18T10:00:00.000Z'
    })
    renderGuest(GUEST, { backend })
    expect(await screen.findByText('Trip archived')).toBeInTheDocument()
    expect(screen.getByText('7 expenses')).toBeInTheDocument()
  })

  it('shows a saved copy when offline, and an offline message when nothing is saved', async () => {
    const backend = backendWith()
    const net = { online: true }
    const cache = createMemorySharedCache()
    const shared = withSharedCache(createMemorySharedTripRepository(backend, { isOnline: () => net.online }), cache)
    const first = renderGuest(GUEST, { backend, shared })
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    first.unmount()

    net.online = false
    renderGuest(GUEST, { backend, shared })
    expect(await screen.findByRole('heading', { name: 'Lisbon & Porto' })).toBeInTheDocument()
    expect(screen.getByText('Showing saved copy. You’re offline.')).toBeInTheDocument()
    expect(screen.getByText('7 expenses')).toBeInTheDocument()
    cleanup()

    const empty = withSharedCache(createMemorySharedTripRepository(backend, { isOnline: () => false }), createMemorySharedCache())
    renderGuest(GUEST, { backend, shared: empty })
    expect(await screen.findByText('You’re offline')).toBeInTheDocument()
    expect(screen.getByText(/isn’t saved on this device yet/)).toBeInTheDocument()
  })
})

describe('joining from the link', () => {
  it('sends a guest to login with a redirect back, carrying the picked member', async () => {
    renderGuest(GUEST)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await userEvent.click(screen.getByRole('button', { name: 'Join to add expenses' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/login')
    const redirect = new URLSearchParams(screen.getByTestId('search').textContent ?? '').get('redirect')
    expect(redirect).toBe(`/trips/join-shared/${SHARE_TOKEN}`)
  })

  it('includes the picked member in the redirect', async () => {
    renderGuest(GUEST)
    await userEvent.click(await screen.findByRole('button', { name: 'Malik' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Join as Malik to add expenses' }))
    const redirect = new URLSearchParams(screen.getByTestId('search').textContent ?? '').get('redirect')
    expect(redirect).toBe(`/trips/join-shared/${SHARE_TOKEN}?member=${SEED_IDS.malik}`)
  })

  it('after login, trades the token for the invite code and preselects the member', async () => {
    const backend = backendWith()
    const guestAfterLogin = createMemoryTripsRepository({ currentUserId: 'u-guest', backend, displayName: 'Alex' })
    const requestJoinFromShare = vi.fn(guestAfterLogin.requestJoinFromShare)
    renderTrips(`/trips/join-shared/${SHARE_TOKEN}?member=${SEED_IDS.malik}`, { repo: guestAfterLogin, repository: { requestJoinFromShare } })
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/trips/join/lisb0a1'))
    expect(requestJoinFromShare).toHaveBeenCalledWith(SHARE_TOKEN)
    expect(screen.getByTestId('search')).toHaveTextContent(`member=${SEED_IDS.malik}`)
    expect(await screen.findByRole('radio', { name: 'Malik' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('button', { name: 'Join trip' }))
    await waitFor(() => expect(backend.db.get(SEED_IDS.tripId)!.members.find((m) => m.id === SEED_IDS.malik)?.user_id).toBe('u-guest'))
  })

  it('tells a logged-in guest when the link is dead', async () => {
    const backend = backendWith()
    const guestAfterLogin = createMemoryTripsRepository({ currentUserId: 'u-guest', backend })
    renderTrips('/trips/join-shared/old-token', { repo: guestAfterLogin })
    expect(await screen.findByRole('alert')).toHaveTextContent('This link no longer works. Ask the trip owner for a new one.')
  })
})

describe('share settings (member side)', () => {
  const SETTINGS = `/trips/${SEED_IDS.tripId}/settings`
  const toggle = () => screen.getByRole('switch', { name: 'Share view-only link' })

  it('is on by default, explains what guests can see, and copies the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderTrips(SETTINGS)
    await screen.findByRole('switch', { name: 'Share view-only link' })
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByText(/Anyone with the view-only link sees expenses, places and balances without an account. They can’t change anything./)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Copy view-only link' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/t/${SHARE_TOKEN}`)
    expect(await screen.findByText('View-only link copied')).toBeInTheDocument()
  })

  it('turns the link off and on, and hides the link actions while off', async () => {
    const { base } = renderTrips(SETTINGS)
    await screen.findByRole('switch', { name: 'Share view-only link' })
    await userEvent.click(toggle())
    expect(toggle()).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('button', { name: 'Copy view-only link' })).toBeNull()
    await waitFor(async () => expect((await base.getTrip(SEED_IDS.tripId))?.trip.share_enabled).toBe(false))
    await userEvent.click(toggle())
    expect(screen.getByRole('button', { name: 'Copy view-only link' })).toBeInTheDocument()
  })

  it('rolls the toggle back with a clear message when offline', async () => {
    renderTrips(SETTINGS, { repository: { setShareEnabled: () => Promise.reject(new NetworkError()) } })
    await screen.findByRole('switch', { name: 'Share view-only link' })
    await userEvent.click(toggle())
    expect(await screen.findByText(/Changing the link needs a connection/)).toBeInTheDocument()
    expect(toggle()).toHaveAttribute('aria-checked', 'true')
  })

  it('previews as a guest', async () => {
    renderTrips(SETTINGS)
    await userEvent.click(await screen.findByRole('button', { name: 'Preview as a guest' }))
    expect(screen.getByTestId('location')).toHaveTextContent(`/t/${SHARE_TOKEN}`)
  })

  it('resets the link after a confirmation, and the old link stops working', async () => {
    const { base } = renderTrips(SETTINGS)
    await userEvent.click(await screen.findByRole('button', { name: 'Reset link' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset the link?' })
    expect(within(dialog).getByText(/Old links stop working/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect((await base.getTrip(SEED_IDS.tripId))?.trip.share_token).toBe(SHARE_TOKEN)

    await userEvent.click(screen.getByRole('button', { name: 'Reset link' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Reset the link?' })).getByRole('button', { name: 'Reset link' }))
    expect(await screen.findByText('Link reset. The old link no longer works.')).toBeInTheDocument()
    const token = (await base.getTrip(SEED_IDS.tripId))!.trip.share_token
    expect(token).not.toBe(SHARE_TOKEN)
  })

  it('keeps the old token and says so when the reset fails', async () => {
    const { base } = renderTrips(SETTINGS, {
      repository: { rotateShareToken: () => Promise.reject(new RepositoryError('Not a member of this trip', '42501')) },
    })
    await userEvent.click(await screen.findByRole('button', { name: 'Reset link' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Reset the link?' })).getByRole('button', { name: 'Reset link' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't reset the link/)
    expect((await base.getTrip(SEED_IDS.tripId))?.trip.share_token).toBe(SHARE_TOKEN)
  })
})
