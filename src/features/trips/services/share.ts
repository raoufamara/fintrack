export type ShareOutcome = 'shared' | 'copied' | 'manual' | 'cancelled'

/**
 * Shares text with the system share sheet when available, else copies it to the
 * clipboard, else reports 'manual' so the UI can show it for selecting.
 */
export async function shareText(text: string, title?: string): Promise<ShareOutcome> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({ text, title })
      return 'shared'
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    // Any other failure: fall through to the clipboard.
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return 'copied'
    }
  } catch {
    // Clipboard blocked.
  }
  return 'manual'
}
