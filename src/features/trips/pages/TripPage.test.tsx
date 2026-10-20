// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { SEED_IDS } from '../services/memorySeed'
import { renderTrips } from '../testing/renderTrips'

afterEach(cleanup)

describe('TripPage', () => {
  it('shows totals, the balance tile and the expense list', async () => {
    renderTrips(`/trips/${SEED_IDS.tripId}`)
    expect(await screen.findByRole('heading', { name: 'Lisbon & Porto' })).toBeInTheDocument()
    expect(screen.getAllByText('€763.35').length).toBeGreaterThan(0)
    const tile = screen.getByRole('button', { name: /Your balance/ })
    expect(within(tile).getByText('– €6.44')).toBeInTheDocument()
    expect(within(tile).getByText(/You owe Sara/)).toBeInTheDocument()
    expect(screen.getByText('7 expenses')).toBeInTheDocument()
    expect(screen.getByText('Airbnb Alfama · 4 nights')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeInTheDocument()
  })

  it('shows an error state with retry for a missing trip', async () => {
    renderTrips('/trips/missing')
    expect(await screen.findByRole('alert')).toHaveTextContent(/does not exist/)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('lists trips with the balance line', async () => {
    renderTrips('/trips')
    expect(await screen.findByText('Lisbon & Porto')).toBeInTheDocument()
    expect(screen.getByText('You owe Sara €6.44')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New trip' })).toBeInTheDocument()
  })

  it('shows the empty state when there are no trips', async () => {
    renderTrips('/trips', { seed: [] })
    expect(await screen.findByText('No trips yet')).toBeInTheDocument()
  })
})
