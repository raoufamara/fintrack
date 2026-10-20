// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it } from 'vitest'
import { SEED_IDS } from '../services/memorySeed'
import { renderTrips } from '../testing/renderTrips'

afterEach(cleanup)

const TRIP = `/trips/${SEED_IDS.tripId}`
const CATS = `${TRIP}/categories`
const openRow = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name.replace(/[&]/g, '\\$&')}\\s*(CUSTOM)?\\d+ expense`) })
const rowNames = () =>
  within(screen.getByRole('list', { name: 'Categories' }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('span.truncate')?.textContent)

describe('categories page', () => {
  it('lists visible categories with counts and reaches the page from trip settings', async () => {
    renderTrips(`${TRIP}/settings`)
    await userEvent.click(await screen.findByRole('button', { name: /Categories/ }))
    expect(await screen.findByRole('list', { name: 'Categories' })).toBeInTheDocument()
    expect(rowNames()).toEqual(['Stay', 'Food & drinks', 'Transport', 'Activities', 'Groceries', 'Shopping', 'Fees & tips', 'Other'])
    expect(screen.getAllByText('2 expenses', { selector: 'span' })).toHaveLength(2) // food and transport
  })

  it('reorders with the Move up / Move down buttons and persists', async () => {
    const { base } = renderTrips(CATS)
    await screen.findByRole('list', { name: 'Categories' })
    expect(screen.getByRole('button', { name: 'Move Stay up' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'Move Transport up' }))
    expect(rowNames().slice(0, 3)).toEqual(['Stay', 'Transport', 'Food & drinks'])
    await userEvent.click(screen.getByRole('button', { name: 'Move Stay down' }))
    expect(rowNames().slice(0, 3)).toEqual(['Transport', 'Stay', 'Food & drinks'])

    await waitFor(async () => {
      const cats = (await base.getTrip(SEED_IDS.tripId))!.categories.sort((a, b) => a.sort_order - b.sort_order)
      expect(cats.slice(0, 3).map((c) => c.id)).toEqual(['c-transport', 'c-stay', 'c-food'])
    })
  })

  it('shows an inline duplicate error for Café vs cafe', async () => {
    renderTrips(CATS)
    await userEvent.click(await screen.findByRole('button', { name: 'Add category' }))
    await userEvent.type(screen.getByLabelText('Name'), 'Café')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(rowNames()).toContain('Café'))

    await userEvent.click(screen.getByRole('button', { name: 'Add category' }))
    await userEvent.type(screen.getByLabelText('Name'), 'cafe')
    expect(await screen.findByRole('alert')).toHaveTextContent("There's already a category called cafe")
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Add category' }))
    expect(rowNames().filter((n) => n?.toLowerCase().startsWith('caf'))).toHaveLength(1)
  })

  it('offers the full icon list behind More, and labelled colour swatches', async () => {
    renderTrips(CATS)
    await userEvent.click(await screen.findByRole('button', { name: 'Add category' }))
    const dialog = screen.getByRole('dialog', { name: 'New category' })
    const icons = within(within(dialog).getByRole('group', { name: 'Icon' }))
    expect(icons.getAllByRole('button')).toHaveLength(12) // 11 + More
    await userEvent.click(icons.getByRole('button', { name: 'More' }))
    expect(icons.getAllByRole('button')).toHaveLength(41) // 40 + Less
    const colours = within(within(dialog).getByRole('group', { name: 'Colour' })).getAllByRole('button')
    expect(colours.map((b) => b.getAttribute('aria-label'))).toEqual(['blue', 'rust', 'teal', 'purple', 'green', 'pink', 'grey'])
    // Default colour: the least used on the trip (every colour is used; blue wins the tie).
    expect(colours[0]).toHaveAttribute('aria-pressed', 'true')
  })

  it('deletes with move-to: default Other, then Move & delete', async () => {
    const { base } = renderTrips(CATS)
    await userEvent.click(await waitFor(() => openRow('Activities')))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Edit category' })).getByRole('button', { name: 'Delete' }))

    const sheet = await screen.findByRole('dialog', { name: 'Delete Activities?' })
    expect(within(sheet).getByText('Move its 1 expense to…')).toBeInTheDocument()
    expect(within(sheet).getByRole('radio', { name: 'Other' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Move & delete' }))

    await waitFor(() => expect(rowNames()).not.toContain('Activities'))
    const snap = await base.getTrip(SEED_IDS.tripId)
    expect(snap?.categories.some((c) => c.id === 'c-activity')).toBe(false)
    expect(snap?.expenses.find((e) => e.id === 'e7')?.category_id).toBe('c-other')
  })

  it('asks for plain confirmation when the category has no expenses', async () => {
    renderTrips(CATS)
    await userEvent.click(await waitFor(() => openRow('Fees & tips')))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Edit category' })).getByRole('button', { name: 'Delete' }))
    const sheet = await screen.findByRole('dialog', { name: 'Delete Fees & tips?' })
    expect(within(sheet).queryByRole('radiogroup')).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(rowNames()).not.toContain('Fees & tips'))
  })

  it('hides a category and shows it again from the Hidden section', async () => {
    renderTrips(CATS)
    await userEvent.click(await waitFor(() => openRow('Shopping')))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Edit category' })).getByRole('button', { name: 'Hide' }))
    await waitFor(() => expect(rowNames()).not.toContain('Shopping'))
    const hidden = screen.getByRole('region', { name: 'Hidden categories' })
    await userEvent.click(within(hidden).getByRole('button', { name: 'Show Shopping' }))
    await waitFor(() => expect(rowNames()).toContain('Shopping'))
  })

  it('explains why the last visible category cannot be hidden or deleted', async () => {
    const { base } = renderTrips(CATS)
    const snap = await base.getTrip(SEED_IDS.tripId)
    for (const c of snap!.categories.filter((c) => c.id !== 'c-other')) await base.updateCategory(c.id, { hidden: true })
    // reload the page state
    cleanup()
    renderTrips(CATS, { repository: base })
    await userEvent.click(await waitFor(() => openRow('Other')))
    const dialog = screen.getByRole('dialog', { name: 'Edit category' })
    expect(within(dialog).getByRole('button', { name: 'Hide' })).toBeDisabled()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeDisabled()
    expect(within(dialog).getByText(/last visible category/)).toBeInTheDocument()
  })
})

describe('new category from the expense form', () => {
  it('creates it with the New tile and selects it', async () => {
    renderTrips(`${TRIP}/expenses/new`)
    await userEvent.click(await screen.findByRole('button', { name: 'New' }))
    const dialog = screen.getByRole('dialog', { name: 'New category' })
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Hammam & spa')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add category' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const tile = screen.getByRole('button', { name: 'Hammam & spa' })
    expect(tile).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Transport' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('has an Edit link to the category manager', async () => {
    renderTrips(`${TRIP}/expenses/new`)
    await userEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    expect(await screen.findByRole('list', { name: 'Categories' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent(CATS)
  })

  it('keeps a hidden category selectable while it is selected', async () => {
    const { base } = renderTrips(`${TRIP}/expenses/e7`)
    await screen.findByLabelText('What was it?')
    await base.updateCategory('c-activity', { hidden: true })
    expect(screen.getByRole('button', { name: 'Activities' })).toHaveAttribute('aria-pressed', 'true')
  })
})
