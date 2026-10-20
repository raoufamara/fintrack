// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { BottomSheet } from './BottomSheet'

afterEach(cleanup)

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open sheet</button>
      <button>Outside</button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Pick one">
        <input aria-label="First" />
        <button>Last</button>
      </BottomSheet>
    </div>
  )
}

describe('BottomSheet', () => {
  it('moves focus in, traps Tab, closes on Esc and returns focus to the opener', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open sheet' })
    await userEvent.click(opener)

    const dialog = screen.getByRole('dialog', { name: 'Pick one' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(screen.getByLabelText('First')).toHaveFocus()

    // Tab cycles inside: First -> Last -> Close -> First
    await userEvent.tab()
    expect(screen.getByRole('button', { name: 'Last' })).toHaveFocus()
    await userEvent.tab()
    expect(dialog.contains(document.activeElement)).toBe(true)
    await userEvent.tab()
    expect(screen.getByLabelText('First')).toHaveFocus()
    await userEvent.tab({ shift: true })
    expect(dialog.contains(document.activeElement)).toBe(true)

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })

  it('closes when the scrim is tapped and restores focus', async () => {
    render(<Harness />)
    const opener = screen.getByRole('button', { name: 'Open sheet' })
    await userEvent.click(opener)
    // The scrim is the first "Close" button (the second one is in the header).
    await userEvent.click(screen.getAllByRole('button', { name: 'Close', hidden: true })[0]!)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(opener).toHaveFocus()
  })
})
