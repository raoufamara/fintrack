import { describe, expect, it } from 'vitest'
import { validateExpenseForm, validateNewTrip } from './validation'

describe('validateExpenseForm', () => {
  const ok = { amount: '24.00', title: 'Dinner', date: '2026-10-20', categoryId: 'c1', currency: 'EUR' }

  it('accepts a complete form and returns minor units', () => {
    const r = validateExpenseForm(ok)
    expect(r.errors).toEqual({})
    expect(r.amountMinor).toBe(2400)
  })

  it('requires an amount greater than 0', () => {
    for (const amount of ['', '0', '0.00', 'abc', '-5']) {
      expect(validateExpenseForm({ ...ok, amount }).errors.amount).toBeDefined()
    }
  })

  it('respects the currency precision', () => {
    expect(validateExpenseForm({ ...ok, amount: '1200', currency: 'JPY' }).amountMinor).toBe(1200)
    expect(validateExpenseForm({ ...ok, amount: '1.234', currency: 'KWD' }).amountMinor).toBe(1234)
  })

  it('requires a title, a date and a category', () => {
    const r = validateExpenseForm({ ...ok, title: '   ', date: '', categoryId: undefined })
    expect(Object.keys(r.errors).sort()).toEqual(['category', 'date', 'title'])
  })
})

describe('validateNewTrip', () => {
  const ok = { name: 'Morocco', start: '', end: '', budget: '', currency: 'CAD' }

  it('requires a name', () => {
    expect(validateNewTrip({ ...ok, name: '  ' }).errors.name).toBeDefined()
    expect(validateNewTrip({ ...ok, name: 'x'.repeat(81) }).errors.name).toBeDefined()
    expect(validateNewTrip(ok).errors).toEqual({})
  })

  it('rejects an end date before the start date', () => {
    expect(validateNewTrip({ ...ok, start: '2026-10-10', end: '2026-10-03' }).errors.dates).toBeDefined()
    expect(validateNewTrip({ ...ok, start: '2026-10-03', end: '2026-10-03' }).errors.dates).toBeUndefined()
  })

  it('parses an optional budget', () => {
    expect(validateNewTrip({ ...ok, budget: '1,200.50' }).budgetAmount).toBe(1200.5)
    expect(validateNewTrip({ ...ok, budget: '' }).budgetAmount).toBeNull()
    expect(validateNewTrip({ ...ok, budget: 'lots' }).errors.budget).toBeDefined()
    expect(validateNewTrip({ ...ok, budget: '-5' }).errors.budget).toBeDefined()
  })
})
