// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deliverCsv } from './exportCsv'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
})

describe('deliverCsv', () => {
  it('shares the file when the browser can share files', async () => {
    const share = vi.fn(async () => undefined)
    Object.assign(navigator, { share, canShare: () => true })
    expect(await deliverCsv('trip.csv', 'a,b')).toBe('shared')
    const arg = (share.mock.calls[0] as unknown as [{ files: File[] }])[0]
    expect(arg.files[0]!.name).toBe('trip.csv')
    expect(arg.files[0]!.type).toBe('text/csv')
  })

  it('reports a cancelled share sheet without downloading', async () => {
    Object.assign(navigator, {
      share: async () => {
        throw new DOMException('cancelled', 'AbortError')
      },
      canShare: () => true,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    expect(await deliverCsv('trip.csv', 'a')).toBe('cancelled')
    expect(click).not.toHaveBeenCalled()
  })

  it('downloads through a link when sharing files is not supported', async () => {
    Object.assign(navigator, { canShare: () => false, share: vi.fn() })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    let name = ''
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      name = this.download
    })
    expect(await deliverCsv('trip.csv', 'a')).toBe('downloaded')
    expect(name).toBe('trip.csv')
  })

  it('downloads when there is no share API at all', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    expect(await deliverCsv('trip.csv', 'a')).toBe('downloaded')
  })
})
