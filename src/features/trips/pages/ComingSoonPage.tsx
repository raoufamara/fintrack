import { Screen, TopBar } from '../components/Screen'

export function ComingSoonPage({ title }: { title: string }) {
  return (
    <Screen>
      <TopBar title={title} />
      <div className="flex flex-col items-center gap-2 px-6 py-24 text-center">
        <b className="text-base">Coming soon</b>
        <p className="text-sm text-text-muted">This part of Trips isn’t built yet.</p>
      </div>
    </Screen>
  )
}
