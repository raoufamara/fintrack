import { createContext, useContext } from 'react'
import { useParams } from 'react-router-dom'
import type { TripSnapshot } from '../services/TripsRepository'
import { useCurrentUserId } from './TripsContext'
import { findCurrentMember } from './selectors'

export interface GuestMeta {
  /** 'idle' until the first answer. */
  status: 'idle' | 'ok' | 'dead' | 'offline'
  sharedBy: string | null
  /** The payload came from the saved copy because the network was down. */
  fromCache: boolean
}

export interface GuestContextValue {
  meta: GuestMeta
  /** The member a guest said they are ("Who are you?"). Only a viewing preference. */
  getPick: (tripId: string, memberIds: readonly string[]) => string | null
  setPick: (tripId: string, memberId: string | null) => void
}

export const GuestContext = createContext<GuestContextValue | null>(null)

/** Null in the signed-in app; set on the public view-only routes. */
export function useGuest(): GuestContextValue | null {
  return useContext(GuestContext)
}

/** Key of the trip in the store: the trip id for members, the share token for guests. */
export function useTripKey(): string {
  const params = useParams()
  return params.tripId ?? params.shareToken ?? ''
}

/** Where the main trip screen lives: /trips/:id for members, /t/:token for guests. */
export function useBasePath(): string {
  const params = useParams()
  return params.shareToken ? `/t/${params.shareToken}` : `/trips/${params.tripId ?? ''}`
}

/** The member the screen speaks for: the signed-in member, or the guest's pick. */
export function useCurrentMember(snapshot: TripSnapshot | undefined) {
  const guest = useGuest()
  const userId = useCurrentUserId()
  if (!snapshot) return undefined
  if (guest) {
    const id = guest.getPick(snapshot.trip.id, snapshot.members.map((m) => m.id))
    return snapshot.members.find((m) => m.id === id)
  }
  return findCurrentMember(snapshot, userId)
}
