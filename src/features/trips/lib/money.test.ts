import { describe, expect, it } from 'vitest'
import { fromMinor, toMinor } from './currency'
import { allocate, roundHalfEven, splitAmount, toDefault, toDisplay } from './money'

const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0)

describe('splitAmount: equal', () => {
  const members = ['m3', 'm1', 'm2']

  it.each([
    ['JPY', 1000],
    ['EUR', toMinor('100.00', 'EUR')],
    ['KWD', toMinor('12.345', 'KWD')],
  ])('shares sum to the total for %s', (_code, total) => {
    const parts = splitAmount(total, 'equal', members)
    expect(sum(parts)).toBe(total)
    const values = [...parts.values()]
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1)
  })

  it('hands leftover units out in ascending member id order, regardless of input order', () => {
    const a = splitAmount(100, 'equal', ['m3', 'm1', 'm2'])
    const b = splitAmount(100, 'equal', ['m1', 'm2', 'm3'])
    expect([...a].sort()).toEqual([...b].sort())
    expect(a.get('m1')).toBe(34)
    expect(a.get('m2')).toBe(33)
    expect(a.get('m3')).toBe(33)
  })

  it('works for any member count', () => {
    for (let n = 1; n <= 9; n++) {
      const ids = Array.from({ length: n }, (_, i) => `m${i}`)
      for (const total of [1, 7, 100, 9999, 123457]) {
        expect(sum(splitAmount(total, 'equal', ids))).toBe(total)
      }
    }
  })

  it('splits zero and rejects bad input', () => {
    expect(sum(splitAmount(0, 'equal', ['a', 'b']))).toBe(0)
    expect(() => splitAmount(10, 'equal', [])).toThrow(RangeError)
    expect(() => splitAmount(10, 'equal', ['a', 'a'])).toThrow(RangeError)
    expect(() => splitAmount(-1, 'equal', ['a'])).toThrow(RangeError)
    expect(() => splitAmount(1.5, 'equal', ['a'])).toThrow(RangeError)
  })
})

describe('splitAmount: shares', () => {
  it('splits proportionally and sums to the total', () => {
    const parts = splitAmount(1000, 'shares', ['a', 'b', 'c'], { a: 2, b: 1, c: 1 })
    expect(parts.get('a')).toBe(500)
    expect(parts.get('b')).toBe(250)
    expect(parts.get('c')).toBe(250)
  })

  it('uses largest remainder with fractional weights and 3-decimal currencies', () => {
    const total = toMinor('10.000', 'KWD')
    const parts = splitAmount(total, 'shares', ['a', 'b', 'c'], { a: 1.5, b: 1, c: 1 })
    expect(sum(parts)).toBe(total)
    expect(parts.get('a')).toBeGreaterThan(parts.get('b') ?? 0)
  })

  it('gives zero-weight members nothing and requires weights', () => {
    const parts = splitAmount(101, 'shares', ['a', 'b'], { a: 1, b: 0 })
    expect(parts.get('a')).toBe(101)
    expect(parts.get('b')).toBe(0)
    expect(() => splitAmount(100, 'shares', ['a', 'b'], { a: 1 })).toThrow(RangeError)
    expect(() => splitAmount(100, 'shares', ['a', 'b'], { a: 0, b: 0 })).toThrow(RangeError)
  })
})

describe('splitAmount: exact', () => {
  it('accepts parts that sum to the total', () => {
    const parts = splitAmount(1000, 'exact', ['a', 'b'], undefined, { a: 400, b: 600 })
    expect(parts.get('a')).toBe(400)
    expect(parts.get('b')).toBe(600)
  })

  it('throws when parts do not sum to the total', () => {
    expect(() => splitAmount(1000, 'exact', ['a', 'b'], undefined, { a: 400, b: 599 })).toThrow(/sum/)
    expect(() => splitAmount(1000, 'exact', ['a', 'b'], undefined, { a: 400, b: 601 })).toThrow(/sum/)
  })

  it('throws on missing, negative or fractional parts', () => {
    expect(() => splitAmount(1000, 'exact', ['a', 'b'], undefined, { a: 1000 })).toThrow(RangeError)
    expect(() => splitAmount(1000, 'exact', ['a', 'b'], undefined, { a: 1200, b: -200 })).toThrow(RangeError)
    expect(() => splitAmount(1000, 'exact', ['a', 'b'], undefined, { a: 500.5, b: 499.5 })).toThrow(RangeError)
    expect(() => splitAmount(1000, 'exact', ['a', 'b'])).toThrow(RangeError)
  })
})

describe('allocate', () => {
  it('rejects all-zero weights', () => {
    expect(() => allocate(10, new Map([['a', 0]]))).toThrow(RangeError)
  })

  it('does not lose precision on large totals', () => {
    const total = 99_999_999_999_999
    const parts = allocate(total, new Map([['a', 1], ['b', 1], ['c', 1]]))
    expect(sum(parts)).toBe(total)
  })
})

describe('roundHalfEven / toDefault', () => {
  it('rounds halves to the even neighbour', () => {
    expect(roundHalfEven(2.5)).toBe(2)
    expect(roundHalfEven(3.5)).toBe(4)
    expect(roundHalfEven(0.5)).toBe(0)
    expect(roundHalfEven(2.4)).toBe(2)
    expect(roundHalfEven(2.6)).toBe(3)
  })

  it('applies banker\'s rounding to the default currency minor units', () => {
    // 25 cents * 0.1 = 2.5 cents -> 2 ; 35 cents * 0.1 = 3.5 cents -> 4
    expect(toDefault(25, 'USD', 0.1, 'EUR')).toBe(2)
    expect(toDefault(35, 'USD', 0.1, 'EUR')).toBe(4)
  })

  it('handles differing minor units', () => {
    // 240.00 MAD at 0.0924 EUR = 22.176 EUR -> 22.18
    expect(toDefault(24000, 'MAD', 0.0924, 'EUR')).toBe(2218)
    // 1000 JPY at 0.0061 EUR = 6.10 EUR
    expect(toDefault(1000, 'JPY', 0.0061, 'EUR')).toBe(610)
    // 10.00 EUR at 160 JPY = 1600 JPY
    expect(toDefault(1000, 'EUR', 160, 'JPY')).toBe(1600)
    // 1.000 KWD at 3.25 EUR = 3.25 EUR
    expect(toDefault(1000, 'KWD', 3.25, 'EUR')).toBe(325)
  })

  it('returns the amount unchanged for the same currency', () => {
    expect(toDefault(1234, 'EUR', 1, 'EUR')).toBe(1234)
  })
})

describe('toDisplay', () => {
  it('is flagged as approximate', () => {
    // EUR 329.17 at 1.5406 CAD = 507.1 CAD
    const out = toDisplay(32917, 'EUR', 'CAD', 1.5406)
    expect(out.approx).toBe(true)
    expect(fromMinor(out.minor, 'CAD')).toBeCloseTo(507.1, 1)
  })
})
