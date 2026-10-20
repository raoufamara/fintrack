import { describe, expect, it } from 'vitest'
import { safeRedirect } from './safeRedirect'

describe('safeRedirect', () => {
  it('keeps same-site paths', () => {
    expect(safeRedirect('/trips/join/abc?member=m1')).toBe('/trips/join/abc?member=m1')
  })
  it('falls back for anything else', () => {
    for (const bad of [null, undefined, '', 'https://evil.test', '//evil.test', 'javascript:alert(1)', '/\\evil', 'trips']) {
      expect(safeRedirect(bad)).toBe('/')
    }
    expect(safeRedirect('x', '/home')).toBe('/home')
  })
})
