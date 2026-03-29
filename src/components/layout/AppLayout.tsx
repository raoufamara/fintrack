import { Outlet, NavLink } from 'react-router-dom'
import { Home, PieChart, User } from 'lucide-react'

const tabs = [
  { to: '/', icon: Home, label: 'Home' },
  { to: '/insights', icon: PieChart, label: 'Insights' },
  { to: '/profile', icon: User, label: 'Profile' },
] as const

export function AppLayout() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <main className="flex-1 pb-20">
        <Outlet />
      </main>
      <nav className="fixed bottom-0 left-0 right-0 bg-surface border-t border-gray-100 px-6 py-2 flex justify-around items-center">
        {tabs.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 py-2 px-4 rounded-[var(--radius-md)] transition-colors ${
                isActive
                  ? 'text-primary'
                  : 'text-text-secondary hover:text-text-primary'
              }`
            }
          >
            <Icon size={22} />
            <span className="text-xs font-semibold">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
