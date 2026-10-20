// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderTrips } from '../testing/renderTrips'

afterEach(cleanup)

describe('NewTripPage', () => {
  it('shows validation errors and does not create a trip without a name', async () => {
    const createTrip = vi.fn()
    renderTrips('/trips/new', { repository: { createTrip } })
    await userEvent.click(screen.getByRole('button', { name: 'Create trip' }))
    expect(await screen.findByText('Give your trip a name')).toBeInTheDocument()
    expect(createTrip).not.toHaveBeenCalled()
    expect(screen.getByTestId('location')).toHaveTextContent('/trips/new')
  })

  it('rejects an end date before the start date and a bad budget', async () => {
    const createTrip = vi.fn()
    renderTrips('/trips/new', { repository: { createTrip } })
    await userEvent.type(screen.getByPlaceholderText('Morocco with friends'), 'Japan')
    const [start, end] = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'))
    await userEvent.type(start!, '2026-10-10')
    await userEvent.type(end!, '2026-10-03')
    await userEvent.type(screen.getByPlaceholderText('0.00'), 'lots')
    await userEvent.click(screen.getByRole('button', { name: 'Create trip' }))
    expect(await screen.findByText('The end date is before the start date')).toBeInTheDocument()
    expect(screen.getByText('Enter a valid budget, or leave it empty')).toBeInTheDocument()
    expect(createTrip).not.toHaveBeenCalled()
  })

  it('defaults to CAD and lets you search for another currency', async () => {
    renderTrips('/trips/new')
    const picker = screen.getByRole('button', { name: /Default currency: Canadian Dollar/ })
    expect(picker).toBeInTheDocument()
    await userEvent.click(picker)
    const dialog = screen.getByRole('dialog', { name: 'Choose a currency' })
    await userEvent.type(within(dialog).getByLabelText('Search currencies'), 'morocco')
    await userEvent.click(within(dialog).getByRole('button', { name: /MAD/ }))
    expect(screen.getByRole('button', { name: /Default currency: Moroccan Dirham/ })).toBeInTheDocument()
  })

  it('creates the trip with its people and opens it', async () => {
    renderTrips('/trips/new')
    await userEvent.type(screen.getByPlaceholderText('Morocco with friends'), '  Morocco  ')
    await userEvent.type(screen.getByLabelText('Add a person'), 'Sara{Enter}')
    await userEvent.type(screen.getByLabelText('Add a person'), 'Malik')
    await userEvent.click(screen.getByRole('button', { name: 'Create trip' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).not.toBe('/trips/new'))
    expect(screen.getByTestId('location').textContent).toMatch(/^\/trips\/[^/]+$/)
    expect(await screen.findByRole('heading', { name: 'Morocco' })).toBeInTheDocument()
    expect(screen.getByText('No expenses yet')).toBeInTheDocument()
  })
})
