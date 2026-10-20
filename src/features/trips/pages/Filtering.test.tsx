// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { SEED_IDS } from '../services/memorySeed'
import { renderTrips } from '../testing/renderTrips'

afterEach(cleanup)

const TRIP = `/trips/${SEED_IDS.tripId}`
const chips = () => screen.getByRole('group', { name: 'Filter by category' })

describe('category chips', () => {
  it('lists All plus used categories by spend, and filters the list and total', async () => {
    renderTrips(TRIP)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    const names = within(chips()).getAllByRole('button').map((b) => b.textContent)
    expect(names).toEqual(['All', 'Stay', 'Transport', 'Food & drinks', 'Activities', 'Groceries'])
    expect(within(chips()).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(within(chips()).getByRole('button', { name: 'Food & drinks' }))
    await userEvent.click(within(chips()).getByRole('button', { name: 'Activities' }))

    expect(within(chips()).getByRole('button', { name: 'Food & drinks' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('3 expenses · filtered')).toBeInTheDocument()
    expect(screen.getByText('€140.60')).toBeInTheDocument()
    expect(screen.getByText(/Your share of these/)).toBeInTheDocument()
    expect(screen.queryByText('Airbnb Alfama · 4 nights')).not.toBeInTheDocument()
    expect(screen.getByTestId('search').textContent).toMatch(/cat=c-food%2Cc-activity|cat=c-food,c-activity/)

    await userEvent.click(within(chips()).getByRole('button', { name: 'All' }))
    expect(screen.getByText('7 expenses')).toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent('')
  })

  it('restores the filter from the URL', async () => {
    renderTrips(`${TRIP}?cat=c-food,c-activity&payer=${SEED_IDS.you}`)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(within(chips()).getByRole('button', { name: 'Food & drinks' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(chips()).getByRole('button', { name: 'Activities' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 expense · filtered')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove filter You paid' })).toBeInTheDocument()
    expect(screen.getAllByText('€86.40').length).toBeGreaterThan(0)
  })

  it('ignores category ids that no longer exist', async () => {
    renderTrips(`${TRIP}?cat=deleted-id`)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    expect(screen.getByText('7 expenses')).toBeInTheDocument()
    expect(within(chips()).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('search', () => {
  it('matches accent-insensitively after a short pause and keeps focus', async () => {
    renderTrips(TRIP)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    const box = screen.getByLabelText('Search expenses or places')
    await userEvent.click(box)
    await userEvent.type(box, 'pasteis')
    expect(box).toHaveFocus()
    await waitFor(() => expect(screen.getByText('1 expense · filtered')).toBeInTheDocument())
    expect(box).toHaveFocus()
    expect(screen.getByText('Pastéis de Belém')).toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent('q=pasteis')
  })

  it('shows the empty result with Clear filters', async () => {
    renderTrips(TRIP)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await userEvent.type(screen.getByLabelText('Search expenses or places'), 'zzzz')
    expect(await screen.findByText('Nothing matches these filters')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }))
    expect(await screen.findByText('7 expenses')).toBeInTheDocument()
  })
})

describe('filter sheet', () => {
  it('shows facet counts and a live CTA, and applies Paid by', async () => {
    renderTrips(TRIP)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })

    const cat = (name: RegExp) => within(within(sheet).getByRole('group', { name: 'Category' })).getByRole('button', { name })
    expect(cat(/^Food & drinks\s*2$/)).toBeInTheDocument()
    expect(cat(/^Activities\s*1$/)).toBeInTheDocument()
    expect(cat(/^Fees & tips\s*0$/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Show 7 expenses · €763.35' })).toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'You' }))
    // Counts follow the other filters: You paid one food and one transport expense.
    expect(cat(/^Food & drinks\s*1$/)).toBeInTheDocument()
    expect(cat(/^Activities\s*0$/)).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: 'Show 2 expenses · €184.40' })).toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Reset' }))
    expect(within(sheet).getByRole('button', { name: 'Show 7 expenses · €763.35' })).toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'You' }))
    await userEvent.click(within(sheet).getByRole('button', { name: /^Show 2 expenses/ }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    // Pill and badge appear; removing the pill clears the filter.
    expect(screen.getByRole('button', { name: 'More filters, 1 active' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter You paid' }))
    expect(screen.getByText('7 expenses')).toBeInTheDocument()
  })

  it('clamps dates to the trip dates', async () => {
    renderTrips(TRIP)
    await screen.findByRole('heading', { name: 'Lisbon & Porto' })
    await userEvent.click(screen.getByRole('button', { name: /More filters/ }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    const from = within(sheet).getByLabelText('From') as HTMLInputElement
    expect(from.min).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(from.max).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(from.min < from.max).toBe(true)
  })
})
