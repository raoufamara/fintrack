export type DeliverOutcome = 'shared' | 'downloaded' | 'cancelled'

/** Excel needs the byte order mark to read accents in a UTF-8 CSV. */
const BOM = '﻿'

/**
 * Hands a CSV file to the user: the system share sheet when it can share files
 * (iPhone home-screen app), otherwise a download through a temporary link.
 */
export async function deliverCsv(fileName: string, csv: string): Promise<DeliverOutcome> {
  const blob = new Blob([BOM, csv], { type: 'text/csv;charset=utf-8' })
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && typeof navigator.share === 'function') {
      const file = new File([blob], fileName, { type: 'text/csv' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: fileName })
        return 'shared'
      }
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
    // Any other failure: fall back to a download.
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  return 'downloaded'
}
