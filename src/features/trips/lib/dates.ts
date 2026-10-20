/** Date helpers on plain YYYY-MM-DD strings (no time zones involved). */

const pad = (n: number) => String(n).padStart(2, '0')

/** Today in the device's local calendar, as YYYY-MM-DD. */
export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number)
  return [y ?? 1970, m ?? 1, d ?? 1]
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = parts(iso)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = parts(from)
  const [ty, tm, td] = parts(to)
  return Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86_400_000)
}

/** "Sat, Oct 4" (with weekday) or "Oct 4". */
export function formatDay(iso: string, withWeekday = false, locale = 'en'): string {
  const [y, m, d] = parts(iso)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(locale, {
    weekday: withWeekday ? 'short' : undefined,
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** "Oct 3 – Oct 10", "Oct 3" or "" depending on which dates are set. */
export function formatRange(start: string | null, end: string | null): string {
  if (start && end) return `${formatDay(start)} – ${formatDay(end)}`
  if (start) return formatDay(start)
  return ''
}
