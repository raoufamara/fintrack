import { describe, expect, it } from 'vitest'
import { formatShown, resolveDisplayCurrency } from './display'
import { formatInviteCode, inviteLink, normalizeInviteCode, remindMessage } from './invite'

describe('invite helpers', () => {
  it('formats codes in groups of four and normalises input', () => {
    expect(formatInviteCode('a1b2c3d4')).toBe('a1b2 c3d4')
    expect(formatInviteCode('abcde')).toBe('abcd e')
    expect(normalizeInviteCode(' A1B2 c3d4 ')).toBe('a1b2c3d4')
    expect(normalizeInviteCode('https://x.app/trips/join/a1b2c3d4?x=1')).toBe('a1b2c3d4')
    expect(inviteLink('https://x.app', 'a1b2c3d4')).toBe('https://x.app/trips/join/a1b2c3d4')
  })

  it('writes the reminder', () => {
    expect(remindMessage('Malik', 'Sara', '€146.09', 'Lisbon & Porto')).toBe('Hi Malik, you owe Sara €146.09 for Lisbon & Porto.')
  })
})

describe('display helpers', () => {
  it('resolves the display currency: own choice, then home, then trip', () => {
    expect(resolveDisplayCurrency('GBP', 'CAD', 'EUR')).toBe('GBP')
    expect(resolveDisplayCurrency(null, 'CAD', 'EUR')).toBe('CAD')
    expect(resolveDisplayCurrency(null, null, 'EUR')).toBe('EUR')
  })

  it('always prefixes converted figures with ≈ and keeps the trip amount underneath', () => {
    expect(formatShown(644, 'EUR', null)).toEqual({ main: '€6.44', sub: null })
    expect(formatShown(644, 'EUR', { currency: 'CAD', rate: 1.5406 })).toEqual({ main: '≈ CA$9.92', sub: '€6.44' })
    expect(formatShown(-644, 'EUR', { currency: 'CAD', rate: 1.5406 }, { signed: true })).toEqual({ main: '– ≈ CA$9.92', sub: '€6.44' })
    expect(formatShown(-644, 'EUR', null, { signed: true }).main).toBe('– €6.44')
    expect(formatShown(0, 'EUR', null, { signed: true }).main).toBe('€0.00')
  })
})
