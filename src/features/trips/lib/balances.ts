import type {
  TripExpense,
  TripExpenseShare,
  TripSettlement,
  Transfer,
} from '../types'
import { toMinor } from './currency'
import { allocate, toDefault } from './money'

export interface BalanceResult {
  /** Member id to minor units of the default currency. Positive = gets back. */
  balances: Map<string, number>
  /** Expenses skipped because their rate is still pending. */
  pendingIds: string[]
}

/**
 * Total of an expense in the default currency (minor units), converted once.
 * Returns null while the rate is pending.
 */
export function expenseTotalDefault(
  expense: Pick<TripExpense, 'amount' | 'currency' | 'fx_rate'>,
  defaultCurrency: string,
): number | null {
  const originalMinor = toMinor(expense.amount, expense.currency)
  if (expense.currency === defaultCurrency) return originalMinor
  if (expense.fx_rate === null) return null
  return toDefault(originalMinor, expense.currency, expense.fx_rate, defaultCurrency)
}

/**
 * Each member's share of an expense in the default currency: the converted
 * total re-split in proportion to the original shares, so the parts always sum
 * exactly to the converted total. Null while pending or when there are no shares.
 */
export function expenseSharesDefault(
  expense: Pick<TripExpense, 'amount' | 'currency' | 'fx_rate'>,
  shares: readonly Pick<TripExpenseShare, 'member_id' | 'amount'>[],
  defaultCurrency: string,
): Map<string, number> | null {
  const total = expenseTotalDefault(expense, defaultCurrency)
  if (total === null || shares.length === 0) return null
  const weights = new Map<string, number>()
  let sum = 0
  for (const s of shares) {
    const w = toMinor(s.amount, expense.currency)
    weights.set(s.member_id, w)
    sum += w
  }
  // Degenerate data (all shares zero): fall back to an equal split.
  if (sum === 0) for (const id of weights.keys()) weights.set(id, 1)
  return allocate(total, weights)
}

export function groupSharesByExpense(
  shares: readonly TripExpenseShare[],
): Map<string, TripExpenseShare[]> {
  const byExpense = new Map<string, TripExpenseShare[]>()
  for (const s of shares) {
    const list = byExpense.get(s.expense_id)
    if (list) list.push(s)
    else byExpense.set(s.expense_id, [s])
  }
  return byExpense
}

function add(map: Map<string, number>, key: string, delta: number): void {
  map.set(key, (map.get(key) ?? 0) + delta)
}

/**
 * Net balance per member in the default currency (spec section 6).
 * Pending expenses are skipped and reported. Expenses without shares are
 * ignored, which keeps the balances summing to exactly 0.
 */
export function computeBalances(
  expenses: readonly TripExpense[],
  shares: readonly TripExpenseShare[],
  settlements: readonly TripSettlement[],
  defaultCurrency: string,
): BalanceResult {
  const balances = new Map<string, number>()
  const pendingIds: string[] = []
  const sharesByExpense = groupSharesByExpense(shares)

  for (const expense of expenses) {
    const total = expenseTotalDefault(expense, defaultCurrency)
    if (total === null) {
      pendingIds.push(expense.id)
      continue
    }
    const split = expenseSharesDefault(
      expense,
      sharesByExpense.get(expense.id) ?? [],
      defaultCurrency,
    )
    if (!split) continue
    add(balances, expense.paid_by, total)
    for (const [memberId, part] of split) add(balances, memberId, -part)
  }

  for (const s of settlements) {
    const minor = toMinor(s.amount, s.currency)
    const inDefault =
      s.currency === defaultCurrency
        ? minor
        : toDefault(minor, s.currency, s.fx_rate, defaultCurrency)
    add(balances, s.from_member, inDefault)
    add(balances, s.to_member, -inDefault)
  }

  return { balances, pendingIds }
}

/**
 * Fewest-ish transfers that bring everyone to 0: repeatedly match the largest
 * debtor with the largest creditor. Transfers involving `currentMemberId` are
 * listed first.
 */
export function suggestTransfers(
  balances: ReadonlyMap<string, number>,
  currentMemberId?: string | null,
): Transfer[] {
  const debtors: Array<{ id: string; amount: number }> = []
  const creditors: Array<{ id: string; amount: number }> = []
  for (const [id, balance] of balances) {
    if (balance < 0) debtors.push({ id, amount: -balance })
    else if (balance > 0) creditors.push({ id, amount: balance })
  }
  const byAmountThenId = (a: { id: string; amount: number }, b: { id: string; amount: number }) =>
    b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

  const transfers: Transfer[] = []
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(byAmountThenId)
    creditors.sort(byAmountThenId)
    const debtor = debtors[0]
    const creditor = creditors[0]
    if (!debtor || !creditor) break
    const amount = Math.min(debtor.amount, creditor.amount)
    transfers.push({ from: debtor.id, to: creditor.id, amount })
    debtor.amount -= amount
    creditor.amount -= amount
    if (debtor.amount === 0) debtors.shift()
    if (creditor.amount === 0) creditors.shift()
  }

  if (currentMemberId) {
    const involves = (t: Transfer) => t.from === currentMemberId || t.to === currentMemberId
    return [...transfers.filter(involves), ...transfers.filter((t) => !involves(t))]
  }
  return transfers
}
