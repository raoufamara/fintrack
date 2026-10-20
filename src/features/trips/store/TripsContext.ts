import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { FxService } from '../services/fxService'
import type { GeolocationSource, PlacesProvider } from '../services/placesService'
import type { TripsState, TripsStore } from './tripStore'

export interface TripsContextValue {
  store: TripsStore
  currentUserId: string
  fx: FxService
  places: PlacesProvider
  geolocation: GeolocationSource
  /** The user's home currency (users.currency); the default "show in" currency. */
  homeCurrency: string | null
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

export function useFx(): FxService {
  return useTripsContext().fx
}

export function usePlaces(): PlacesProvider {
  return useTripsContext().places
}

export function useGeolocation(): GeolocationSource {
  return useTripsContext().geolocation
}

export function useHomeCurrency(): string | null {
  return useTripsContext().homeCurrency
}
