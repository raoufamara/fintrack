import { createStore, del, get, keys, set, type UseStore } from 'idb-keyval'
import type { CachedTable, FxStorage } from './fxService'

export function createMemoryFxStorage(initial: Record<string, CachedTable> = {}): FxStorage {
  const map = new Map(Object.entries(initial))
  return {
    async get(key) {
      return map.get(key)
    },
    async set(key, value) {
      map.set(key, value)
    },
    async del(key) {
      map.delete(key)
    },
    async keys() {
      return [...map.keys()]
    },
  }
}

/**
 * IndexedDB cache via idb-keyval. Every call is guarded: if IndexedDB is
 * unavailable (private mode, blocked, old browser) the cache silently falls
 * back to memory for the rest of the session.
 */
export function createIdbFxStorage(dbName = 'fintrack-trips-fx'): FxStorage {
  const memory = createMemoryFxStorage()
  let store: UseStore | null = null
  let broken = false

  const getStore = (): UseStore => {
    store ??= createStore(dbName, 'rates')
    return store
  }

  async function run<T>(idb: () => Promise<T>, fallback: () => Promise<T>): Promise<T> {
    if (broken) return fallback()
    try {
      return await idb()
    } catch {
      broken = true
      return fallback()
    }
  }

  return {
    get: (k) => run(() => get<CachedTable>(k, getStore()), () => memory.get(k)),
    set: (k, v) => run(() => set(k, v, getStore()), () => memory.set(k, v)),
    del: (k) => run(() => del(k, getStore()), () => memory.del(k)),
    keys: () => run(async () => (await keys(getStore())).map(String), () => memory.keys()),
  }
}
