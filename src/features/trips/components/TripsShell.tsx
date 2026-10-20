import { Outlet } from 'react-router-dom'
import { Toaster } from './Toaster'

/** Layout route for everything under /trips. */
export function TripsShell() {
  return (
    <>
      <Outlet />
      <Toaster />
    </>
  )
}
