import type { GuestMeta } from '../store/GuestContext'
import type { SharedTripRepository } from './sharedTripRepository'
import { NetworkError, RepositoryError, type TripsRepository } from './TripsRepository'

const READ_ONLY = 'This link is view-only.'

/**
 * Adapts the read-only shared repository to the repository interface the store
 * and screens use, so the same components render a guest view. The "trip id"
 * passed to `getTrip` is the share token. Every write is refused.
 */
export function createGuestTripsRepository(
  shared: SharedTripRepository,
  onMeta: (meta: GuestMeta) => void,
): TripsRepository {
  const refuse = <T,>(): Promise<T> => Promise.reject(new RepositoryError(READ_ONLY, '42501'))
  return {
    currentUserId: 'guest',
    async listTrips() {
      return []
    },
    async getTrip(token) {
      try {
        const result = await shared.getSharedTrip(token)
        if (result.status === 'dead') {
          onMeta({ status: 'dead', sharedBy: null, fromCache: false })
          return null
        }
        onMeta({ status: 'ok', sharedBy: result.view.sharedBy, fromCache: result.fromCache })
        return result.view.snapshot
      } catch (err) {
        if (err instanceof NetworkError) onMeta({ status: 'offline', sharedBy: null, fromCache: false })
        throw err
      }
    },
    subscribe: () => () => undefined,
    createTrip: refuse,
    saveExpense: refuse,
    deleteExpense: refuse,
    setDefaultCurrency: refuse,
    recordSettlement: refuse,
    addMember: refuse,
    previewInvite: refuse,
    joinTrip: refuse,
    updateMyDisplayCurrency: refuse,
    setShareEnabled: refuse,
    rotateShareToken: refuse,
    requestJoinFromShare: refuse,
    createCategory: refuse,
    updateCategory: refuse,
    deleteCategory: refuse,
    reorderCategories: refuse,
  }
}
