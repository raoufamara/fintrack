/**
 * Returns `target` when it is a same-site path ("/trips/join/abc?member=1"),
 * otherwise `fallback`. Blocks "//host" and "scheme:" tricks (open redirects).
 */
export function safeRedirect(target: string | null | undefined, fallback = '/'): string {
  if (!target || !target.startsWith('/') || target.startsWith('//') || target.includes('\\')) return fallback
  return target
}
