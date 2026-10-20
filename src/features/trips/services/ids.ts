/** RFC 4122 v4 id. Uses crypto.randomUUID when available. */
export function newId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  const hex = (n: number) => Math.floor(Math.random() * n).toString(16)
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) =>
    ch === 'x' ? hex(16) : ((Math.random() * 4) | 8).toString(16),
  )
}
