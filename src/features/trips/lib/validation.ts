import { fromMinor, toMinor } from './currency'

export const DEFAULT_TRIP_CURRENCY = 'CAD'
export const MAX_MEMBERS = 49 // the creator makes 50

export interface NewTripErrors {
  name?: string
  dates?: string
  budget?: string
}

/** Pure validation, shared by the page and its tests. */
export function validateNewTrip(v: {
  name: string
  start: string
  end: string
  budget: string
  currency: string
}): { errors: NewTripErrors; budgetAmount: number | null } {
  const errors: NewTripErrors = {}
  const name = v.name.trim()
  if (name.length < 1) errors.name = 'Give your trip a name'
  else if (name.length > 80) errors.name = 'Use 80 characters or fewer'
  if (v.start && v.end && v.end < v.start) errors.dates = 'The end date is before the start date'

  let budgetAmount: number | null = null
  if (v.budget.trim() !== '') {
    try {
      const minor = toMinor(v.budget, v.currency)
      if (minor < 0) throw new RangeError('negative')
      budgetAmount = fromMinor(minor, v.currency)
    } catch {
      errors.budget = 'Enter a valid budget, or leave it empty'
    }
  }
  return { errors, budgetAmount }
}

export interface ExpenseFormErrors {
  amount?: string
  title?: string
  date?: string
  category?: string
}

/** Pure validation, shared by the page and its tests. Returns minor units when valid. */
export function validateExpenseForm(v: {
  amount: string
  title: string
  date: string
  categoryId: string | undefined
  currency: string
}): { errors: ExpenseFormErrors; amountMinor: number } {
  const errors: ExpenseFormErrors = {}
  let amountMinor = 0
  try {
    amountMinor = v.amount.trim() === '' ? 0 : toMinor(v.amount, v.currency)
  } catch {
    amountMinor = 0
  }
  if (amountMinor <= 0) errors.amount = 'Enter an amount greater than 0'
  if (v.title.trim() === '') errors.title = 'What was it? Add a title'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) errors.date = 'Pick a date'
  if (!v.categoryId) errors.category = 'Pick a category'
  return { errors, amountMinor }
}

