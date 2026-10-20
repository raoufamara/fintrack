import { describe, expect, it } from 'vitest'
import { minorToInput, sanitizeAmountInput } from './amountInput'
import { todayISO, addDays, daysBetween, formatDay, formatRange } from './dates'

describe('sanitizeAmountInput', () => {
  it('limits decimals to the currency precision', () => {
    expect(sanitizeAmountInput('12.345', 'EUR')).toBe('12.34')
    expect(sanitizeAmountInput('12.3456', 'KWD')).toBe('12.345')
    expect(sanitizeAmountInput('12.5', 'JPY')).toBe('125')
  })

  it('normalises separators and strips junk', () => {
    expect(sanitizeAmountInput('1,5', 'EUR')).toBe('1.5')
    expect(sanitizeAmountInput('€1a2.3.4', 'EUR')).toBe('12.34')
    expect(sanitizeAmountInput('', 'EUR')).toBe('')
  })
})

describe('minorToInput', () => {
  it('pads to the currency precision', () => {
    expect(minorToInput(2400, 'EUR')).toBe('24.00')
    expect(minorToInput(1200, 'JPY')).toBe('1200')
    expect(minorToInput(12345, 'KWD')).toBe('12.345')
  })
})

describe('dates', () => {
  it('formats local today', () => {
    expect(todayISO(new Date(2026, 9, 4, 23, 59))).toBe('2026-10-04')
  })
  it('does day arithmetic across months', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(daysBetween('2026-10-03', '2026-10-10')).toBe(7)
  })
  it('formats days and ranges', () => {
    expect(formatDay('2026-10-04')).toBe('Oct 4')
    expect(formatDay('2026-10-04', true)).toBe('Sun, Oct 4')
    expect(formatRange('2026-10-03', '2026-10-10')).toBe('Oct 3 – Oct 10')
    expect(formatRange(null, null)).toBe('')
  })
})
