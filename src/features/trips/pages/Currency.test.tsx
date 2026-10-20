// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { SEED_IDS } from '../services/memorySeed'
import { makeFx, seedWithPendingExpense } from '../testing/fxFixtures'
import { renderTrips, TEST_USER } from '../testing/renderTrips'

afterEach(cleanup)

const TRIP = `/trips/${SEED_IDS.tripId}`
const NEW = `${TRIP}/expenses/new`

async function pickCurrency(code: string, query = code) {
  await userEvent.click(await screen.findByRole('button', { name: /Change currency/ }))
  const sheet = screen.getByRole('dialog', { name: 'Choose a currency' })
  await userEvent.type(within(sheet).getByLabelText('Search currencies'), query)
  await userEvent.click(within(within(sheet).getByRole('region', { name: 'All currencies' })).getByRole('button', { name: new RegExp(`^${code}`) }))
}

describe('currency picker', () => {
  it('finds a currency by country name', async () => {
    const { fx } = makeFx()
    renderTrips(NEW, { fx })
    await userEvent.click(await screen.findByRole('button', { name: /Change currency/ }))
    const sheet = screen.getByRole('dialog', { name: 'Choose a currency' })
    await userEvent.type(within(sheet).getByLabelText('Search currencies'), 'Morocco')
    const all = within(sheet).getByRole('region', { name: 'All currencies' })
    expect(within(all).getAllByRole('button')).toHaveLength(1)
    expect(within(all).getByRole('button', { name: /MAD/ })).toBeInTheDocument()
  })

  it('shows the rate banner, the trip currency and the currencies used on the trip', async () => {
    const { fx } = makeFx({ hoursAgo: 2 })
    renderTrips(NEW, { fx, seed: [seedWithPendingExpense(TEST_USER).seed] })
    await userEvent.click(await screen.findByRole('button', { name: /Change currency/ }))
    const sheet = screen.getByRole('dialog', { name: 'Choose a currency' })
    expect(await within(sheet).findByText('Rates saved on this phone, updated 2h ago. Works offline.')).toBeInTheDocument()
    const onTrip = within(sheet).getByRole('region', { name: 'On this trip' })
    expect(within(onTrip).getByText('Trip currency')).toBeInTheDocument()
    expect(await within(onTrip).findByText('1 THB = 0.0263 EUR')).toBeInTheDocument()
  })

  it('warns when rates are stale or missing', async () => {
    const stale = makeFx({ hoursAgo: 24 * 9 })
    renderTrips(NEW, { fx: stale.fx })
    await userEvent.click(await screen.findByRole('button', { name: /Change currency/ }))
    expect(await screen.findByText(/^Rates from .* — connect to refresh$/)).toBeInTheDocument()
    cleanup()

    const none = makeFx({ cached: false, online: false })
    renderTrips(NEW, { fx: none.fx })
    await userEvent.click(await screen.findByRole('button', { name: /Change currency/ }))
    expect(await screen.findByText(/No saved rates yet/)).toBeInTheDocument()
  })
})

describe('amount and converted line', () => {
  it('shows the converted line for a foreign currency', async () => {
    const { fx } = makeFx({ hoursAgo: 2 })
    renderTrips(NEW, { fx })
    await pickCurrency('MAD', 'Morocco')
    await userEvent.type(screen.getByLabelText('Amount'), '240')
    expect(await screen.findByText(/= €22\.18 in trip currency · rate 0\.0924 · updated 2h ago/)).toBeInTheDocument()
  })

  it('respects 0 decimals for JPY', async () => {
    const { fx } = makeFx()
    renderTrips(NEW, { fx })
    await pickCurrency('JPY', 'Japan')
    const amount = screen.getByLabelText('Amount')
    await userEvent.type(amount, '1200.55')
    expect(amount).toHaveValue('120055')
    expect(amount).toHaveAttribute('placeholder', '0')
  })

  it('lets you type your own rate, then reset to the cached one', async () => {
    const { fx } = makeFx()
    renderTrips(NEW, { fx })
    await pickCurrency('MAD', 'MAD')
    await userEvent.type(screen.getByLabelText('Amount'), '100')
    await screen.findByText(/rate 0\.0924/)

    await userEvent.click(screen.getByRole('button', { name: 'Edit rate' }))
    const sheet = screen.getByRole('dialog')
    const editor = within(sheet).getByRole('region', { name: 'Rate for this expense' })
    const input = within(editor).getByLabelText('Rate: 1 MAD in EUR')
    expect(input).toHaveValue('0.0924')
    await userEvent.clear(input)
    await userEvent.type(input, '0.1')
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText(/= €10\.00 in trip currency · rate 0\.100 · your rate/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Edit rate' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reset' }))
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByText(/rate 0\.0924 · updated 2h ago/)).toBeInTheDocument()
  })

  it('shows a pending notice offline with an empty cache and saves the expense as pending', async () => {
    const { fx } = makeFx({ cached: false, online: false })
    const { base } = renderTrips(NEW, { fx })
    await pickCurrency('THB', 'Thailand')
    await userEvent.type(screen.getByLabelText('Amount'), '1200')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Street food')
    expect(await screen.findByText(/Rate pending: converts when you’re back online/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Type a rate' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(async () => {
      const e = (await base.getTrip(SEED_IDS.tripId))!.expenses.find((x) => x.title === 'Street food')
      expect(e).toMatchObject({ currency: 'THB', amount: 1200, fx_rate: null })
    })
    expect(await screen.findByText('RATE PENDING')).toBeInTheDocument()
    expect(screen.getByText(/8 expenses · 1 pending/)).toBeInTheDocument()
  })

  it('defaults to the currency this member used last', async () => {
    const { fx } = makeFx()
    const { seed } = seedWithPendingExpense(TEST_USER)
    renderTrips(NEW, { fx, seed: [seed] })
    expect(await screen.findByRole('button', { name: /Currency: THB/ })).toBeInTheDocument()
  })
})

describe('rows and reconciliation on the trip screen', () => {
  it('shows the original amount under the converted one', async () => {
    const { fx } = makeFx()
    renderTrips(NEW, { fx })
    await pickCurrency('MAD', 'MAD')
    await userEvent.type(screen.getByLabelText('Amount'), '240')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Tagine lunch')
    await userEvent.click(await screen.findByText(/rate 0\.0924/).then(() => screen.getByRole('button', { name: 'Save expense' })))
    const row = await screen.findByRole('button', { name: /Tagine lunch/ })
    expect(within(row).getByText('€22.18')).toBeInTheDocument()
    expect(within(row).getByText('MAD 240.00')).toBeInTheDocument()
  })

  it('converts pending expenses when the device comes back online and says so', async () => {
    const { fx, network } = makeFx({ online: false, cached: false })
    const { seed } = seedWithPendingExpense(TEST_USER)
    renderTrips(TRIP, { fx, seed: [seed] })
    expect(await screen.findByText('RATE PENDING')).toBeInTheDocument()
    expect(screen.getByText(/8 expenses · 1 pending/)).toBeInTheDocument()

    network.online = true
    act(() => {
      window.dispatchEvent(new Event('online'))
    })
    expect(await screen.findByText('1 pending expense converted')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('RATE PENDING')).not.toBeInTheDocument())
    expect(screen.getByText('€31.58')).toBeInTheDocument()
    expect(screen.queryByText(/pending$/)).not.toBeInTheDocument()
  })
})

describe('default currency setting', () => {
  it('confirms with the new total, then re-converts', async () => {
    const { fx } = makeFx()
    renderTrips(`${TRIP}/settings`, { fx })
    await userEvent.click(await screen.findByRole('button', { name: /Default currency/ }))
    const sheet = screen.getByRole('dialog', { name: 'Default currency' })
    await userEvent.type(within(sheet).getByLabelText('Search currencies'), 'CAD')
    await userEvent.click(within(sheet).getByRole('button', { name: /^CAD/ }))

    const confirm = await screen.findByRole('dialog', { name: 'Change to CAD?' })
    expect(await within(confirm).findByText(/Every expense is re-converted at the rate for its date/)).toBeInTheDocument()
    expect(within(confirm).getByText('New group total')).toBeInTheDocument()
    expect(within(confirm).getByText(/^CA\$1,17[56]\.\d\d$/)).toBeInTheDocument() // 763.35 * 1.5406, rounded per expense
    await userEvent.click(within(confirm).getByRole('button', { name: 'Change currency' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await screen.findByText('Default currency is now CAD')).toBeInTheDocument()
    expect(screen.getByText('CAD')).toBeInTheDocument()
  })

  it('blocks the change when rates are not available offline', async () => {
    const { fx } = makeFx({ cached: false, online: false })
    renderTrips(`${TRIP}/settings`, { fx })
    await userEvent.click(await screen.findByRole('button', { name: /Default currency/ }))
    const sheet = screen.getByRole('dialog', { name: 'Default currency' })
    await userEvent.type(within(sheet).getByLabelText('Search currencies'), 'CAD')
    await userEvent.click(within(sheet).getByRole('button', { name: /^CAD/ }))
    const confirm = await screen.findByRole('dialog', { name: 'Change to CAD?' })
    expect(await within(confirm).findByRole('alert')).toHaveTextContent(/Rates for EUR aren’t available/)
    expect(within(confirm).getByRole('button', { name: 'Change currency' })).toBeDisabled()
  })
})

describe('expense draft', () => {
  it('survives a visit to Categories', async () => {
    const { fx } = makeFx()
    renderTrips(NEW, { fx })
    await userEvent.type(await screen.findByLabelText('Amount'), '12.5')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Museum')
    await userEvent.click(screen.getByRole('button', { name: 'Activities' }))
    await userEvent.click(screen.getByRole('button', { name: /Paid by/ }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Paid by' })).getByRole('button', { name: 'Sara' }))
    await userEvent.click(screen.getByRole('button', { name: /Split/ }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Split equally' })).getByLabelText('Malik'))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Split equally' })).getByRole('button', { name: 'Done' }))
    await userEvent.clear(screen.getByLabelText('Date'))
    await userEvent.type(screen.getByLabelText('Date'), '2026-10-02')

    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('list', { name: 'Categories' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByLabelText('What was it?')).toHaveValue('Museum')
    expect(screen.getByLabelText('Amount')).toHaveValue('12.5')
    expect(screen.getByRole('button', { name: 'Activities' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: /Paid by/ })).toHaveTextContent('Sara')
    expect(screen.getByRole('button', { name: /Split/ })).toHaveTextContent('Equally · You, Sara, Inès')
    expect(screen.getByLabelText('Date')).toHaveValue('2026-10-02')
  })
})
