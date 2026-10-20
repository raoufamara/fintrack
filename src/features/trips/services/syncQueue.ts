import { createStore, get, set, type UseStore } from 'idb-keyval'
import type { TripExpense, TripExpenseShare, TripSettlement } from '../types'
import type { CategoryPatch } from './TripsRepository'

/** A write that could not reach the server and waits for a connection (spec 7.3). */
export type QueuedOp =
  | { op: 'saveExpense'; payload: { expense: TripExpense; shares: TripExpenseShare[] } }
  | { op: 'deleteExpense'; payload: { expenseId: string } }
  | { op: 'recordSettlement'; payload: { settlement: TripSettlement } }
  | { op: 'updateCategory'; payload: { categoryId: string; patch: CategoryPatch } }
  | { op: 'deleteCategory'; payload: { categoryId: string; moveTo: string | null } }
  | { op: 'reorderCategories'; payload: { orderedIds: string[] } }

export type QueueItem = QueuedOp & {
  /** Idempotency key (the expense or settlement client_id); replays are safe. */
  clientId: string
  tripId: string
  attempts: number
  lastError: string | null
  /** Epoch ms before which the item is not retried (exponential backoff). */
  nextAttemptAt: number
  enqueuedAt: number
}

/** Persistence for the queue. Everything is written as one list. */
export interface QueueStorage {
  load(): Promise<QueueItem[]>
  save(items: QueueItem[]): Promise<void>
}

export const BACKOFF_CAP_MS = 5 * 60_000
export const RETRY_INTERVAL_MS = 30_000

/** 2s, 4s, 8s ... capped at 5 minutes. */
export function backoffMs(attempts: number): number {
  return Math.min(1000 * 2 ** Math.max(1, attempts), BACKOFF_CAP_MS)
}

export function createMemoryQueueStorage(initial: QueueItem[] = []): QueueStorage {
  let items = structuredClone(initial)
  return {
    async load() {
      return structuredClone(items)
    },
    async save(next) {
      items = structuredClone(next)
    },
  }
}

const KEY = 'trips:sync-queue'

/** IndexedDB queue. Falls back to memory for the session if IndexedDB is unavailable. */
export function createIdbQueueStorage(dbName = 'fintrack-trips-queue'): QueueStorage {
  const memory = createMemoryQueueStorage()
  let store: UseStore | null = null
  let broken = false
  const getStore = (): UseStore => (store ??= createStore(dbName, 'queue'))
  return {
    async load() {
      if (broken) return memory.load()
      try {
        return (await get<QueueItem[]>(KEY, getStore())) ?? []
      } catch {
        broken = true
        return memory.load()
      }
    },
    async save(items) {
      if (!broken) {
        try {
          await set(KEY, items, getStore())
          return
        } catch {
          broken = true
        }
      }
      await memory.save(items)
    },
  }
}

