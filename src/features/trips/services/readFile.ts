export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

/** Reads a chosen file as text: UTF-8, or Windows-1252 when the bytes are not valid UTF-8. */
export function readFileText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'))
    reader.onload = () => {
      const bytes = new Uint8Array(reader.result as ArrayBuffer)
      try {
        resolve(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
      } catch {
        resolve(new TextDecoder('windows-1252').decode(bytes))
      }
    }
    reader.readAsArrayBuffer(file)
  })
}
