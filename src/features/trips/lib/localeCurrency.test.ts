import { describe, expect, it } from 'vitest'
import { currencyForLocale } from './localeCurrency'

describe('currencyForLocale', () => {
  it.each([
    ['en-CA', 'CAD'],
    ['en-US', 'USD'],
    ['en-GB', 'GBP'],
    ['fr-FR', 'EUR'],
    ['de-CH', 'CHF'],
    ['ja-JP', 'JPY'],
    ['pt-BR', 'BRL'],
  ])('%s gives %s', (locale, code) => {
    expect(currencyForLocale(locale)).toBe(code)
  })

  it('gives null when it cannot tell', () => {
    expect(currencyForLocale(undefined)).toBeNull()
    expect(currencyForLocale('')).toBeNull()
    expect(currencyForLocale('not a locale')).toBeNull()
  })
})

