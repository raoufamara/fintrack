// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { todayISO } from '../lib/dates'
import { buildLisbonPortoSeed, SEED_IDS } from '../services/memorySeed'
import { createMemoryBackend, createMemoryTripsRepository } from '../services/memoryTripsRepository'
import { RepositoryError } from '../services/TripsRepository'
import { makeFx } from '../testing/fxFixtures'
import { renderTrips, TEST_USER } from '../testing/renderTrips'

const TRIP = `/trips/${SEED_IDS.tripId}`

beforeEach(() => window.localStorage.clear())
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.defineProperty(navigator, 'share', { value: undefined, configurable: true })
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
})

describe('expense row', () => {
  it('names the category for assistive tech and keeps the meta line short', async () => {
    renderTrips(TRIP)
    const row = await screen.findByRole('button', { name: /Time Out Market dinner/ })
    expect(row).toHaveAccessibleName('Time Out Market dinner, Food & drinks, You paid, Time Out Market, Lisbon, €86.40')
    // The visible meta line has no category text; the payer never truncates, only the place does.
    expect(within(row).queryByText(/Food & drinks/)).toBeNull()
    const payer = within(row).getByText('You paid')
    expect(payer.className).toContain('shrink-0')
    expect(within(row).getByText('Time Out Market, Lisbon').className).toContain('truncate')
  })
})

describe('balances', () => {
  it('lists members by balance with gets back / owes, and the settle-up transfers (mine first)', async () => {
    renderTrips(`${TRIP}/balances`)
    const net = await screen.findByRole('region', { name: 'Net balance' })
    const names = within(net).getAllByRole('listitem').map((li) => li.querySelector('span.truncate')?.textContent)
    expect(names).toEqual(['Sara', 'You', 'Malik', 'Inès'])
    expect(within(net).getByText('gets back')).toBeInTheDocument()
    expect(within(net).getAllByText('owes')).toHaveLength(3)
    expect(within(net).getByText('€329.16')).toBeInTheDocument()

    const settle = screen.getByRole('region', { name: 'How to settle up' })
    const cards = within(settle).getAllByRole('listitem')
    expect(cards.map((c) => c.getAttribute('aria-label'))).toEqual(['You pays Sara', 'Inès pays Sara', 'Malik pays Sara'])
    expect(within(cards[0]!).getByText('€6.44')).toBeInTheDocument()
    expect(within(cards[0]!).getByRole('button', { name: 'Mark as paid' })).toBeInTheDocument()
    expect(within(cards[2]!).getByText('€146.09')).toBeInTheDocument()
    expect(within(cards[2]!).getByRole('button', { name: 'Remind' })).toBeInTheDocument()
    expect(within(cards[2]!).queryByRole('button', { name: 'Mark as paid' })).toBeNull()
    expect(screen.getByText(/Fewest transfers to bring everyone to zero. Converted to EUR at the rate saved on each expense./)).toBeInTheDocument()
  })

  it('marks my transfer as paid after a confirmation, and the transfer disappears', async () => {
    const { base } = renderTrips(`${TRIP}/balances`)
    const settle = await screen.findByRole('region', { name: 'How to settle up' })
    await userEvent.click(within(within(settle).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Mark as paid' }))
    const dialog = screen.getByRole('dialog', { name: 'Mark as paid?' })
    expect(within(dialog).getByText(/Record that You paid Sara €6.44/)).toBeInTheDocument()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as paid' }))

    const recorded = await screen.findByRole('region', { name: 'Payments recorded' })
    expect(within(recorded).getByText('€6.44')).toBeInTheDocument()
    expect(within(screen.getByRole('region', { name: 'How to settle up' })).getAllByRole('listitem').map((c) => c.getAttribute('aria-label'))).toEqual(['Inès pays Sara', 'Malik pays Sara'])
    expect(within(screen.getByRole('region', { name: 'Net balance' })).getAllByText('settled')).toHaveLength(1)
    await waitFor(async () => expect((await base.getTrip(SEED_IDS.tripId))?.settlements).toHaveLength(1))
  })

  it('rolls the payment back and says so when the server refuses it', async () => {
    renderTrips(`${TRIP}/balances`, {
      repository: { recordSettlement: () => Promise.reject(new RepositoryError('Both members must belong to this trip', '22023')) },
    })
    const settle = await screen.findByRole('region', { name: 'How to settle up' })
    await userEvent.click(within(within(settle).getAllByRole('listitem')[0]!).getByRole('button', { name: 'Mark as paid' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark as paid' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/Couldn't record the payment/)
    expect(screen.queryByRole('region', { name: 'Payments recorded' })).toBeNull()
    expect(within(screen.getByRole('region', { name: 'How to settle up' })).getAllByRole('listitem')).toHaveLength(3)
  })

  it('says everyone is settled when all balances are zero', async () => {
    const seed = buildLisbonPortoSeed(TEST_USER, todayISO())
    seed.expenses = []
    seed.shares = []
    renderTrips(`${TRIP}/balances`, { seed: [seed] })
    expect(await screen.findByText('Everyone is settled up')).toBeInTheDocument()
    expect(screen.getAllByText('settled')).toHaveLength(4)
  })

  it('warns about pending expenses', async () => {
    const seed = buildLisbonPortoSeed(TEST_USER, todayISO())
    seed.expenses[0] = { ...seed.expenses[0]!, currency: 'THB', fx_rate: null, fx_source: null, amount_default: null }
    renderTrips(`${TRIP}/balances`, { seed: [seed] })
    expect(await screen.findByText(/1 expense is waiting for an exchange rate and isn’t counted yet/)).toBeInTheDocument()
  })

  it('reminds with the share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'share', { value: share, configurable: true })
    renderTrips(`${TRIP}/balances`)
    const card = within(await screen.findByRole('region', { name: 'How to settle up' })).getAllByRole('listitem')[2]!
    await userEvent.click(within(card).getByRole('button', { name: 'Remind' }))
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hi Malik, you owe Sara €146.09 for Lisbon & Porto.' }))
  })

  it('falls back to the clipboard with a toast, then to selectable text', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderTrips(`${TRIP}/balances`)
    const cardOf = async () => within(await screen.findByRole('region', { name: 'How to settle up' })).getAllByRole('listitem')[2]!
    await userEvent.click(within(await cardOf()).getByRole('button', { name: 'Remind' }))
    expect(writeText).toHaveBeenCalledWith('Hi Malik, you owe Sara €146.09 for Lisbon & Porto.')
    expect(await screen.findByText('Reminder copied. Paste it into a chat.')).toBeInTheDocument()
    cleanup()

    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    renderTrips(`${TRIP}/balances`)
    await userEvent.click(within(await cardOf()).getByRole('button', { name: 'Remind' }))
    expect(await screen.findByLabelText('Reminder text')).toHaveValue('Hi Malik, you owe Sara €146.09 for Lisbon & Porto.')
  })
})

describe('display currency', () => {
  const group = () => screen.queryByRole('group', { name: 'Currency to show' })

  it('is hidden when the display currency equals the trip currency', async () => {
    const { fx } = makeFx()
    renderTrips(`${TRIP}/balances`, { fx, homeCurrency: 'EUR' })
    await screen.findByRole('region', { name: 'Net balance' })
    await new Promise((r) => setTimeout(r, 50))
    expect(group()).toBeNull()
  })

  it('is hidden when no rate is available', async () => {
    const { fx } = makeFx({ cached: false, online: false })
    renderTrips(`${TRIP}/balances`, { fx, homeCurrency: 'CAD' })
    await screen.findByRole('region', { name: 'Net balance' })
    await new Promise((r) => setTimeout(r, 50))
    expect(group()).toBeNull()
  })

  it('shows ≈ figures with the trip amount underneath, the rate note, and remembers the choice per trip', async () => {
    const { fx } = makeFx({ hoursAgo: 2 })
    const first = renderTrips(`${TRIP}/balances`, { fx, homeCurrency: 'CAD' })
    const toggle = await screen.findByRole('group', { name: 'Currency to show' })
    expect(within(toggle).getByRole('button', { name: 'EUR · trip' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(toggle).getByRole('button', { name: 'CAD · mine' }))

    const net = screen.getByRole('region', { name: 'Net balance' })
    expect(within(net).getByText('≈ CA$9.92')).toBeInTheDocument() // You owe €6.44
    expect(within(net).getByText('€6.44')).toBeInTheDocument()
    expect(screen.getByText('Approximate, at 1 EUR = 1.5406 CAD (updated 2h ago). Balances and payments stay in EUR.')).toBeInTheDocument()
    const myCard = within(screen.getByRole('region', { name: 'How to settle up' })).getAllByRole('listitem')[0]!
    expect(within(myCard).getByText('≈ CA$9.92 on your card')).toBeInTheDocument()
    expect(window.localStorage.getItem(`trips:show-mine:${SEED_IDS.tripId}`)).toBe('1')
    first.unmount()

    renderTrips(`${TRIP}/balances`, { fx, homeCurrency: 'CAD' })
    expect(await screen.findByRole('button', { name: 'CAD · mine' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('applies to the trip header tiles but not to expense rows', async () => {
    window.localStorage.setItem(`trips:show-mine:${SEED_IDS.tripId}`, '1')
    const { fx } = makeFx()
    renderTrips(TRIP, { fx, homeCurrency: 'CAD' })
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(await screen.findByText(/^≈ CA\$1,17[56]\.\d\d$/)).toBeInTheDocument()
    const tile = screen.getByRole('button', { name: /Your balance/ })
    expect(within(tile).getByText('– ≈ CA$9.92')).toBeInTheDocument()
    const row = screen.getByRole('button', { name: /Time Out Market dinner/ })
    expect(within(row).getByText('€86.40')).toBeInTheDocument()
    expect(within(row).queryByText(/≈/)).toBeNull()
  })

  it('saves my own display currency on my member row, from settings', async () => {
    const { fx } = makeFx()
    const { base } = renderTrips(`${TRIP}/settings`, { fx, homeCurrency: 'CAD' })
    expect(await screen.findByText('Only you see your display currency.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /My display currency/ }))
    const sheet = screen.getByRole('dialog', { name: 'My display currency' })
    await userEvent.type(within(sheet).getByLabelText('Search currencies'), 'GBP')
    await userEvent.click(within(sheet).getByRole('button', { name: /^GBP/ }))
    await waitFor(async () => {
      const me = (await base.getTrip(SEED_IDS.tripId))!.members.find((m) => m.user_id === TEST_USER)
      expect(me?.display_currency).toBe('GBP')
    })
    expect(screen.getByText('GBP')).toBeInTheDocument()
  })
})

describe('insights screen', () => {
  it('shows group totals, switches to my share, and the budget tile only for the group', async () => {
    renderTrips(`${TRIP}/insights`)
    expect(await screen.findByText('€763.35')).toBeInTheDocument()
    expect(screen.getByText('Spent')).toBeInTheDocument()
    expect(screen.getByText('Per day')).toBeInTheDocument()
    expect(screen.getByText('€436.65')).toBeInTheDocument() // left of €1,200
    await userEvent.click(screen.getByRole('button', { name: 'My share' }))
    expect(await screen.findByText('€190.84')).toBeInTheDocument()
    expect(screen.queryByText('Left')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Group total' }))
    expect(await screen.findByText('Left')).toBeInTheDocument()
  })

  it('lists categories and places, with No location last, and the currency card', async () => {
    const seed = buildLisbonPortoSeed(TEST_USER, todayISO())
    seed.expenses.push({ ...seed.expenses[0]!, id: 'mad', title: 'Souk', currency: 'MAD', amount: 1840, fx_rate: 0.0924, fx_source: 'cache', amount_default: 170, place_city: 'Marrakech', place_name: 'Souk' })
    for (const m of seed.members) seed.shares.push({ expense_id: 'mad', member_id: m.id, weight: 1, amount: 460 })
    renderTrips(`${TRIP}/insights`, { seed: [seed] })
    const cats = await screen.findByRole('region', { name: 'By category' })
    expect(within(cats).getAllByRole('button')[0]).toHaveTextContent('Stay')
    const places = screen.getByRole('region', { name: 'By place' })
    const placeNames = within(places).getAllByRole('button').map((b) => b.querySelector('span')?.textContent)
    expect(placeNames[placeNames.length - 1]).toBe('No location')
    expect(placeNames).toContain('Marrakech')
    const card = screen.getByRole('region', { name: 'By currency' })
    expect(card).toHaveTextContent(/Paid in MAD: MAD 1,840\.00 \(= €170\.02\)/)
  })

  it('opens the trip list filtered when a category or place row is tapped', async () => {
    renderTrips(`${TRIP}/insights`)
    const cats = await screen.findByRole('region', { name: 'By category' })
    await userEvent.click(within(cats).getByRole('button', { name: /Food & drinks/ }))
    expect(screen.getByTestId('location')).toHaveTextContent(TRIP)
    expect(screen.getByTestId('search')).toHaveTextContent('cat=c-food')
    expect(await screen.findByText('2 expenses · filtered')).toBeInTheDocument()
  })

  it('opens a place filter from a place row', async () => {
    renderTrips(`${TRIP}/insights`)
    const places = await screen.findByRole('region', { name: 'By place' })
    await userEvent.click(within(places).getByRole('button', { name: /Lisbon/ }))
    expect(screen.getByTestId('search')).toHaveTextContent('place=Lisbon')
    expect(await screen.findByText(/4 expenses · filtered/)).toBeInTheDocument()
  })
})

describe('invite and join', () => {
  function world() {
    const backend = createMemoryBackend([buildLisbonPortoSeed(TEST_USER, todayISO())])
    const owner = createMemoryTripsRepository({ currentUserId: TEST_USER, backend })
    const guest = createMemoryTripsRepository({ currentUserId: 'u-guest', backend, displayName: 'Alex' })
    return { backend, owner, guest }
  }

  it('shows the invite code in groups of four and copies the link', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderTrips(`${TRIP}/settings`)
    expect(await screen.findByLabelText('Invite code')).toHaveTextContent('lisb 0a1')
    await userEvent.click(screen.getByRole('button', { name: 'Copy invite link' }))
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/trips/join/lisb0a1`)
    expect(await screen.findByText('Invite link copied')).toBeInTheDocument()
  })

  it('adds a name-only person from settings', async () => {
    const { base } = renderTrips(`${TRIP}/settings`)
    await userEvent.type(await screen.findByLabelText('Name of the person to add'), 'Alex')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(async () => {
      const m = (await base.getTrip(SEED_IDS.tripId))!.members.find((x) => x.display_name === 'Alex')
      expect(m?.user_id).toBeNull()
    })
    expect(within(screen.getByRole('list', { name: 'People' })).getByText('Alex')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Name of the person to add'), 'alex')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('alex is already on this trip')).toBeInTheDocument()
  })

  it('opens the invite from a typed code', async () => {
    renderTrips('/trips/join', { repo: world().guest })
    await userEvent.type(await screen.findByLabelText('Invite code'), 'LISB 0A1')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText('Which one are you?', { selector: 'h2' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/trips/join/lisb0a1')
  })

  it('previews the trip with its unclaimed members and lets a guest claim one', async () => {
    const { guest, backend } = world()
    renderTrips('/trips/join/lisb0a1', { repo: guest })
    expect(await screen.findByText('Lisbon & Porto')).toBeInTheDocument()
    const choices = within(screen.getByRole('radiogroup', { name: 'Which one are you?' }))
    for (const name of ['Sara', 'Malik', 'Inès', 'I’m not listed']) expect(choices.getByRole('radio', { name })).toBeInTheDocument()
    expect(choices.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('button', { name: 'Join trip' })).toBeDisabled()
    await userEvent.click(choices.getByRole('radio', { name: 'Malik' }))
    await userEvent.click(screen.getByRole('button', { name: 'Join trip' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(TRIP))
    expect(backend.db.get(SEED_IDS.tripId)!.members.find((m) => m.id === SEED_IDS.malik)?.user_id).toBe('u-guest')
    expect(await screen.findByRole('heading', { name: 'Lisbon & Porto' })).toBeInTheDocument()
  })

  it('creates a new member for "I’m not listed"', async () => {
    const { guest, backend } = world()
    renderTrips('/trips/join/lisb0a1', { repo: guest })
    await userEvent.click(await screen.findByRole('radio', { name: 'I’m not listed' }))
    await userEvent.click(screen.getByRole('button', { name: 'Join trip' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(TRIP))
    const members = backend.db.get(SEED_IDS.tripId)!.members
    expect(members).toHaveLength(5)
    expect(members.find((m) => m.user_id === 'u-guest')?.display_name).toBe('Alex')
  })

  it('handles an invalid code', async () => {
    renderTrips('/trips/join/nope1234', { repo: world().guest })
    expect(await screen.findByRole('alert')).toHaveTextContent('This invite doesn’t work')
  })

  it('handles a name that was claimed while the guest was choosing', async () => {
    const { guest, backend } = world()
    renderTrips('/trips/join/lisb0a1', { repo: guest })
    await userEvent.click(await screen.findByRole('radio', { name: 'Malik' }))
    backend.db.get(SEED_IDS.tripId)!.members.find((m) => m.id === SEED_IDS.malik)!.user_id = 'u-someone-else'
    await userEvent.click(screen.getByRole('button', { name: 'Join trip' }))
    expect(await screen.findByText('Someone just claimed that name. Pick another one.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('radio', { name: 'Malik' })).toBeNull())
    expect(screen.getByTestId('location')).toHaveTextContent('/trips/join/lisb0a1')
  })

  it('recognises someone who is already on the trip', async () => {
    renderTrips('/trips/join/lisb0a1', { repo: world().owner })
    expect(await screen.findByText('You’re already on this trip.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open trip' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(TRIP))
  })

  it('opens the code entry from the trips list', async () => {
    renderTrips('/trips')
    await userEvent.click(await screen.findByRole('button', { name: 'Join with code' }))
    expect(await screen.findByLabelText('Invite code')).toBeInTheDocument()
  })
})

describe('live updates and the retry indicator', () => {
  it('shows an expense another device added', async () => {
    const backend = createMemoryBackend([buildLisbonPortoSeed(TEST_USER, todayISO())])
    const repo = createMemoryTripsRepository({ currentUserId: TEST_USER, backend })
    renderTrips(TRIP, { repo })
    await screen.findByText('Time Out Market dinner')
    expect(screen.getByText('7 expenses')).toBeInTheDocument()
    act(() => {
      repo.simulateRemote(SEED_IDS.tripId, (snap) => {
        const base = snap.expenses[0]!
        snap.expenses.push({ ...base, id: 'remote-1', title: 'Added on another phone', created_at: new Date().toISOString(), date: todayISO() })
        snap.shares.push(...snap.members.map((m) => ({ expense_id: 'remote-1', member_id: m.id, weight: 1, amount: base.amount / 4 })))
      })
    })
    expect(await screen.findByText('Added on another phone')).toBeInTheDocument()
    expect(screen.getByText('8 expenses')).toBeInTheDocument()
  })

  it('shows Not synced and a waiting indicator offline, then syncs when the device is back online', async () => {
    const net = { online: false }
    const backend = createMemoryBackend([buildLisbonPortoSeed(TEST_USER, todayISO())])
    const repo = createMemoryTripsRepository({ currentUserId: TEST_USER, backend, isOnline: () => net.online })
    renderTrips(`${TRIP}/expenses/new`, { repo })
    await userEvent.type(await screen.findByLabelText('Amount'), '15')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Offline snack')
    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))

    const row = await screen.findByRole('button', { name: /Offline snack/ })
    expect(row).toHaveAccessibleName(expect.stringContaining('not synced'))
    expect(within(row).getByText('NOT SYNCED')).toBeInTheDocument()
    expect(screen.getByText('1 change waiting to sync')).toBeInTheDocument()
    expect(backend.db.get(SEED_IDS.tripId)!.expenses.some((e) => e.title === 'Offline snack')).toBe(false)

    net.online = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    await waitFor(() => expect(screen.queryByText('NOT SYNCED')).toBeNull())
    expect(screen.queryByText(/waiting to sync/)).toBeNull()
    expect(backend.db.get(SEED_IDS.tripId)!.expenses.some((e) => e.title === 'Offline snack')).toBe(true)
  })
})
