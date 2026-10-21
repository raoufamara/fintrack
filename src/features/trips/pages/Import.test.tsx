// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import realCsv from '../lib/__fixtures__/splitwise-real-export.csv?raw'
import sampleCsv from '../lib/__fixtures__/splitwise-sample.csv?raw'
import { SEED_IDS } from '../services/memorySeed'
import { makeFx } from '../testing/fxFixtures'
import { renderTrips } from '../testing/renderTrips'

const deliverCsv = vi.hoisted(() => vi.fn(async () => 'downloaded' as const))
vi.mock('../services/exportCsv', () => ({ deliverCsv }))

afterEach(() => {
  cleanup()
  deliverCsv.mockClear()
})

const csvFile = (text: string, name = 'lisbon-trip_2026-10-10_export.csv') => new File([text], name, { type: 'text/csv' })

async function pick(text: string, name?: string) {
  await userEvent.upload(await screen.findByLabelText('Splitwise CSV file'), csvFile(text, name))
}

describe('import screen', () => {
  it('explains where to find the export and only accepts CSV', async () => {
    renderTrips('/trips/import', { seed: [], fx: makeFx().fx })
    expect(screen.getByText(/open the group → ⚙ Settings → Export as spreadsheet/)).toBeInTheDocument()
    expect(screen.getByLabelText('Splitwise CSV file')).toHaveAttribute('accept', '.csv,text/csv')
  })

  it('imports the sample: preview, who-are-you is required, then success with matching balances', async () => {
    const { repository } = renderTrips('/trips/import', { seed: [], fx: makeFx().fx })
    await pick(sampleCsv)

    expect(await screen.findByLabelText('Trip name')).toHaveValue('Lisbon Trip')
    expect(screen.getByTestId('import-counts')).toHaveTextContent('6 expenses · 1 payment · 0 skipped')
    expect(screen.getByRole('button', { name: /Default currency: Euro/ })).toBeInTheDocument()
    expect(screen.getByText('Hotel → Stay')).toBeInTheDocument()
    expect(screen.getByText('Dining out → Food & drinks')).toBeInTheDocument()

    const importButton = screen.getByRole('button', { name: 'Import trip' })
    expect(importButton).toBeDisabled()
    const group = screen.getByRole('group', { name: 'Which one is you?' })
    expect(within(group).getAllByRole('radio').map((r) => (r.parentElement as HTMLElement).textContent)).toEqual(['Sara Lopez', 'Malik B', 'Inès', 'Raouf'])
    await userEvent.click(within(group).getByRole('radio', { name: 'Raouf' }))
    expect(importButton).toBeEnabled()

    await userEvent.click(importButton)
    expect(await screen.findByText('Imported 6 expenses and 1 payment')).toBeInTheDocument()
    expect(screen.getByText('Balances match Splitwise')).toBeInTheDocument()

    // The creator's member keeps the Splitwise name and is linked to the user.
    const [snap] = await repository.listTrips()
    expect(snap!.trip.name).toBe('Lisbon Trip')
    expect(snap!.members.find((m) => m.user_id === repository.currentUserId)!.display_name).toBe('Raouf')
    expect(snap!.members.filter((m) => m.user_id === null).map((m) => m.display_name)).toEqual(['Sara Lopez', 'Malik B', 'Inès'])

    await userEvent.click(screen.getByRole('button', { name: 'Open trip' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(`/trips/${snap!.trip.id}`))
    expect(await screen.findByRole('heading', { name: 'Lisbon Trip' })).toBeInTheDocument()
  })

  it('shows the differences when balances do not match', async () => {
    renderTrips('/trips/import', { seed: [], fx: makeFx().fx })
    await pick(sampleCsv.replace('249.16,-118.84', '249.16,-117.84'))
    await userEvent.click(await screen.findByRole('radio', { name: 'Raouf' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import trip' }))
    expect(await screen.findByText('Some balances differ')).toBeInTheDocument()
    expect(screen.getByText(/Malik B \(EUR\): Splitwise -€117\.84, here -€118\.84/)).toBeInTheDocument()
  })

  it('imports the real export: 53 expenses, 4 payments, balances match', async () => {
    renderTrips('/trips/import', { seed: [], fx: makeFx().fx })
    await pick(realCsv, 'Splitwise_expenses_Oct_20.csv')
    expect(await screen.findByLabelText('Trip name')).toHaveValue('Trip · Feb – Mar 2024')
    expect(screen.getByTestId('import-counts')).toHaveTextContent('53 expenses · 4 payments · 0 skipped')
    expect(screen.getByRole('button', { name: /Default currency: Canadian Dollar/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Sam' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import trip' }))
    expect(await screen.findByText('Imported 53 expenses and 4 payments')).toBeInTheDocument()
    expect(screen.getByText('Balances match Splitwise')).toBeInTheDocument()
  })

  it('lists warnings in a collapsible and the trip name stays editable', async () => {
    renderTrips('/trips/import', { seed: [], fx: makeFx().fx })
    await pick('Date,Description,Category,Cost,Currency,Ann,Bob\n2026-10-03,Free,Food,0.00,EUR,0,0\n2026-10-03,Lunch,Food,10.00,EUR,5.00,-5.00\n')
    expect(await screen.findByText('1 warning')).toBeInTheDocument()
    expect(screen.getByTestId('import-counts')).toHaveTextContent('1 expense · 0 payments · 1 skipped')
    const name = screen.getByLabelText('Trip name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Weekend')
    expect(name).toHaveValue('Weekend')
  })

  it('shows a friendly message and what was expected for a file that is not a Splitwise export', async () => {
    renderTrips('/trips/import', { seed: [], fx: makeFx().fx })
    await pick('name,age\nann,3\n', 'people.csv')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/doesn't look like a Splitwise export/)
    expect(alert).toHaveTextContent(/Date, Description, Category, Cost and Currency/)
    expect(screen.queryByLabelText('Trip name')).not.toBeInTheDocument()
  })

  it('blocks the import when there is nothing in the file to import', async () => {
    renderTrips('/trips/import', { seed: [], fx: makeFx().fx })
    await pick('Date,Description,Category,Cost,Currency,Ann,Bob\n')
    expect(await screen.findByText(/nothing to import/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: 'Ann' }))
    expect(screen.getByRole('button', { name: 'Import trip' })).toBeDisabled()
  })

  it('is disabled while offline, with a message', async () => {
    renderTrips('/trips/import', { seed: [], fx: makeFx({ online: false }).fx })
    await pick(sampleCsv)
    await userEvent.click(await screen.findByRole('radio', { name: 'Raouf' }))
    expect(screen.getByRole('button', { name: 'Import trip' })).toBeDisabled()
    expect(screen.getByText(/You’re offline. Importing needs an internet connection/)).toBeInTheDocument()
  })

  it('blocks payments in another currency when no rate can be found', async () => {
    const csv = 'Date,Description,Category,Cost,Currency,Ann,Bob\n2026-10-03,Lunch,Dining out,10.00,EUR,5.00,-5.00\n2026-10-04,Lunch 2,Dining out,12.00,EUR,6.00,-6.00\n2026-10-05,Bob paid Ann,Payment,5000,XXX,-5000,5000\n'
    renderTrips('/trips/import', { seed: [], fx: makeFx({ cached: false, online: true }).fx })
    await pick(csv)
    await userEvent.click(await screen.findByRole('radio', { name: 'Ann' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import trip' }))
    expect(await screen.findByText('Connect to the internet to import payments in other currencies.')).toBeInTheDocument()
  })

  it('fetches the rates of several days at once, one table per day', async () => {
    const eur = Array.from({ length: 9 }, (_, i) => `2026-10-0${i + 1},Dinner ${i + 1},Dining out,10.00,EUR,5.00,-5.00`)
    const usd = Array.from({ length: 8 }, (_, i) => `2026-10-0${i + 1},Taxi ${i + 1},Taxi,8.00,USD,4.00,-4.00`)
    const csv = ['Date,Description,Category,Cost,Currency,Ann,Bob', ...eur, ...usd, ''].join('\n')
    const { fx } = makeFx()
    let inFlight = 0
    let maxInFlight = 0
    const calls: string[] = []
    const slowFx = {
      ...fx,
      getRate: async (from: string, _to: string, date?: string) => {
        calls.push(`${from}:${date}`)
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 20))
        inFlight -= 1
        return { rate: 0.9, source: 'api' as const, ageHours: 0, tableDate: date ?? null }
      },
    }
    renderTrips('/trips/import', { seed: [], fx: slowFx })
    await pick(csv)
    await userEvent.click(await screen.findByRole('radio', { name: 'Ann' }))
    await userEvent.click(screen.getByRole('button', { name: 'Import trip' }))
    expect(await screen.findByText('Imported 17 expenses and 0 payments')).toBeInTheDocument()
    expect(calls).toHaveLength(8)
    expect(maxInFlight).toBeGreaterThan(1)
  })

  it('imports expenses as pending when exchange rates do not arrive in time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    try {
      const csv = 'Date,Description,Category,Cost,Currency,Ann,Bob\n2026-10-03,Lunch,Dining out,10.00,EUR,5.00,-5.00\n2026-10-04,Lunch 2,Dining out,12.00,EUR,6.00,-6.00\n2026-10-05,Taxi,Taxi,8.00,USD,4.00,-4.00\n'
      const { fx } = makeFx()
      const stuckFx = { ...fx, getRate: () => new Promise<null>(() => undefined) }
      renderTrips('/trips/import', { seed: [], fx: stuckFx })
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
      await user.upload(await screen.findByLabelText('Splitwise CSV file'), csvFile(csv))
      await user.click(await screen.findByRole('radio', { name: 'Ann' }))
      await user.click(screen.getByRole('button', { name: 'Import trip' }))
      expect(await screen.findByText('Getting exchange rates: 0 of 1 day')).toBeInTheDocument()
      await vi.advanceTimersByTimeAsync(15_000)
      expect(await screen.findByText('Imported 3 expenses and 0 payments')).toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the Splitwise import button on the list and in the empty state', async () => {
    renderTrips('/trips', { seed: [], fx: makeFx().fx })
    expect(await screen.findByText('No trips yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Coming from Splitwise/ })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Import from Splitwise' }))
    expect(screen.getByTestId('location')).toHaveTextContent('/trips/import')
  })
})

describe('export from settings', () => {
  it('hands the Splitwise-layout CSV to the delivery', async () => {
    renderTrips(`/trips/${SEED_IDS.tripId}/settings`, { fx: makeFx().fx })
    await userEvent.click(await screen.findByRole('button', { name: /Export CSV/ }))
    await waitFor(() => expect(deliverCsv).toHaveBeenCalledTimes(1))
    const [fileName, csv] = deliverCsv.mock.calls[0] as unknown as [string, string]
    expect(fileName).toMatch(/^lisbon-porto-fintrack-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.split('\r\n')[0]).toBe('Date,Description,Category,Cost,Currency,You,Sara,Malik,Inès')
    expect(csv).toContain('Total balance')
    expect(await screen.findByText(`Saved ${fileName}`)).toBeInTheDocument()
  })
})
