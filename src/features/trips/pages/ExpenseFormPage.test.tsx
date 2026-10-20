// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { SEED_IDS } from '../services/memorySeed'
import { renderTrips } from '../testing/renderTrips'

afterEach(cleanup)

const NEW = `/trips/${SEED_IDS.tripId}/expenses/new`

describe('ExpenseFormPage validation', () => {
  it('requires an amount greater than 0 and a title', async () => {
    const { base } = renderTrips(NEW)
    await userEvent.click(await screen.findByRole('button', { name: 'Save expense' }))
    expect(await screen.findByText('Enter an amount greater than 0')).toBeInTheDocument()
    expect(screen.getByText('What was it? Add a title')).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(NEW)

    await userEvent.type(screen.getByLabelText('Amount'), '0')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Taxi')
    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    expect(screen.getByText('Enter an amount greater than 0')).toBeInTheDocument()
    expect(screen.queryByText('What was it? Add a title')).not.toBeInTheDocument()
    expect((await base.getTrip(SEED_IDS.tripId))?.expenses).toHaveLength(7)
  })

  it('limits the amount to the currency decimals', async () => {
    renderTrips(NEW)
    const amount = await screen.findByLabelText('Amount')
    await userEvent.type(amount, '12.3456')
    expect(amount).toHaveValue('12.34')
  })

  it('preselects the category this member used last', async () => {
    renderTrips(NEW)
    await screen.findByRole('button', { name: 'Save expense' })
    // You's most recent seeded expense is the train.
    expect(screen.getByRole('button', { name: 'Transport' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Stay' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('saves a valid expense split between two people and returns to the trip', async () => {
    const { base } = renderTrips(NEW)
    await userEvent.type(await screen.findByLabelText('Amount'), '24')
    await userEvent.type(screen.getByLabelText('What was it?'), 'Dinner')
    await userEvent.click(screen.getByRole('button', { name: 'Food & drinks' }))

    await userEvent.click(screen.getByRole('button', { name: /Split/ }))
    const sheet = screen.getByRole('dialog', { name: 'Split equally' })
    await userEvent.click(within(sheet).getByLabelText('Malik'))
    await userEvent.click(within(sheet).getByLabelText('Inès'))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }))

    await userEvent.click(screen.getByRole('button', { name: 'Save expense' }))
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(`/trips/${SEED_IDS.tripId}`))
    await waitFor(async () => expect((await base.getTrip(SEED_IDS.tripId))?.expenses).toHaveLength(8))
    expect(await screen.findByText('Dinner')).toBeInTheDocument()
  })
})

describe('split sheet', () => {
  it('always keeps at least one person selected', async () => {
    renderTrips(NEW)
    await userEvent.click(await screen.findByRole('button', { name: /Split/ }))
    const sheet = screen.getByRole('dialog', { name: 'Split equally' })
    const boxes = within(sheet).getAllByRole('checkbox')
    expect(boxes).toHaveLength(4)
    for (const box of boxes.slice(0, 3)) await userEvent.click(box)
    expect(boxes.filter((b) => (b as HTMLInputElement).checked)).toHaveLength(1)

    await userEvent.click(boxes[3]!)
    expect(boxes[3]).toBeChecked()
    expect(within(sheet).getByRole('alert')).toHaveTextContent('At least one person')
  })

  it('shows each person’s share of the amount', async () => {
    renderTrips(NEW)
    await userEvent.type(await screen.findByLabelText('Amount'), '10')
    await userEvent.click(screen.getByRole('button', { name: /Split/ }))
    const sheet = screen.getByRole('dialog', { name: 'Split equally' })
    expect(within(sheet).getAllByText('€2.50')).toHaveLength(4)
  })
})

describe('edit and delete', () => {
  it('prefills an existing expense and deletes it after confirmation', async () => {
    const { base } = renderTrips(`/trips/${SEED_IDS.tripId}/expenses/e2`)
    expect(await screen.findByLabelText('What was it?')).toHaveValue('Time Out Market dinner')
    expect(screen.getByLabelText('Amount')).toHaveValue('86.40')

    await userEvent.click(screen.getByRole('button', { name: 'Delete expense' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete this expense?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect((await base.getTrip(SEED_IDS.tripId))?.expenses).toHaveLength(7)

    await userEvent.click(screen.getByRole('button', { name: 'Delete expense' }))
    await userEvent.click(
      within(screen.getByRole('dialog', { name: 'Delete this expense?' })).getByRole('button', { name: 'Delete' }),
    )
    await waitFor(async () => expect((await base.getTrip(SEED_IDS.tripId))?.expenses).toHaveLength(6))
    expect(screen.getByTestId('location')).toHaveTextContent(`/trips/${SEED_IDS.tripId}`)
  })
})
