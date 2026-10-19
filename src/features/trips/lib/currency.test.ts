import { describe, expect, it } from 'vitest'
import { CURRENCIES, formatMoney, fromMinor, getCurrency, minorUnits, toMinor } from './currency'

describe('currencies.json', () => {
  it('has unique codes and well-formed entries', () => {
    expect(CURRENCIES.length).toBeGreaterThanOrEqual(150)
    expect(new Set(CURRENCIES.map((c) => c.code)).size).toBe(CURRENCIES.length)
    for (const c of CURRENCIES) {
      expect(c.code).toMatch(/^[A-Z]{3}$/)
      expect(c.name.length).toBeGreaterThan(0)
      expect(c.symbol.length).toBeGreaterThan(0)
      expect([0, 2, 3]).toContain(c.minorUnits)
      expect(c.countries.length).toBeGreaterThan(0)
    }
  })

  it('covers commonly visited countries', () => {
    const countries = new Set(CURRENCIES.flatMap((c) => c.countries))
    for (const name of ['France', 'Morocco', 'Thailand', 'Japan', 'Mexico', 'Turkey', 'Portugal', 'Vietnam', 'Argentina', 'Egypt']) {
      expect(countries.has(name)).toBe(true)
    }
    expect(getCurrency('mad')?.countries).toContain('Morocco')
  })
})

describe('minorUnits', () => {
  it('returns 0, 2 and 3 decimals as appropriate', () => {
    for (const c of ['JPY', 'KRW', 'VND', 'ISK', 'CLP']) expect(minorUnits(c)).toBe(0)
    for (const c of ['KWD', 'BHD', 'OMR', 'JOD', 'TND', 'LYD', 'IQD']) expect(minorUnits(c)).toBe(3)
    for (const c of ['EUR', 'USD', 'MAD', 'THB']) expect(minorUnits(c)).toBe(2)
  })

  it('defaults to 2 for unknown codes', () => {
    expect(minorUnits('XXX')).toBe(2)
  })
})

describe('toMinor / fromMinor', () => {
  it('parses decimals per currency precision', () => {
    expect(toMinor('12.50', 'EUR')).toBe(1250)
    expect(toMinor('12,5', 'EUR')).toBe(1250)
    expect(toMinor('1,234.56', 'EUR')).toBe(123456)
    expect(toMinor('1200', 'JPY')).toBe(1200)
    expect(toMinor('12.345', 'KWD')).toBe(12345)
    expect(toMinor(0.29, 'EUR')).toBe(29)
  })

  it('rounds extra digits half up on the decimal string', () => {
    expect(toMinor('1.005', 'EUR')).toBe(101)
    expect(toMinor('1.004', 'EUR')).toBe(100)
    expect(toMinor('99.5', 'JPY')).toBe(100)
    expect(toMinor(1.005, 'EUR')).toBe(101)
  })

  it('throws on garbage', () => {
    expect(() => toMinor('abc', 'EUR')).toThrow(RangeError)
    expect(() => toMinor('', 'EUR')).toThrow(RangeError)
    expect(() => toMinor(Number.NaN, 'EUR')).toThrow(RangeError)
  })

  it('round-trips through fromMinor', () => {
    expect(fromMinor(1250, 'EUR')).toBe(12.5)
    expect(fromMinor(12345, 'KWD')).toBe(12.345)
    expect(fromMinor(1200, 'JPY')).toBe(1200)
    expect(toMinor(fromMinor(98765, 'EUR'), 'EUR')).toBe(98765)
  })
})

describe('formatMoney', () => {
  it('uses the currency precision', () => {
    expect(formatMoney(1250, 'EUR', 'en-US')).toBe('€12.50')
    expect(formatMoney(1200, 'JPY', 'en-US')).toBe('¥1,200')
    expect(formatMoney(12345, 'KWD', 'en-US')).toContain('12.345')
  })
})
