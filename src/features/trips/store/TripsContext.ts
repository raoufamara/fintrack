import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { TripsState, TripsStore } from './tripStore'

export interface TripsContextValue {
  store: TripsStore
  currentUserId: string
}

export const TripsContext = createContext<TripsContextValue | null>(null)

function useTripsContext(): TripsContextValue {
  const ctx = useContext(TripsContext)
  if (!ctx) throw new Error('Trips components must be rendered inside <TripsProvider>')
  return ctx
}

export function useTripsStore<T>(selector: (state: TripsState) => T): T {
  return useStore(useTripsContext().store, selector)
}

export function useTripsStoreApi(): TripsStore {
  return useTripsContext().store
}

export function useCurrentUserId(): string {
  return useTripsContext().currentUserId
}
