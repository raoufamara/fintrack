import { describe, expect, it } from 'vitest'
import { transferSentence } from './transfers'

describe('transferSentence', () => {
  it('agrees the verb with the subject', () => {
    expect(transferSentence('Alex', 'Sara', true)).toBe('You pay Sara')
    expect(transferSentence('Inès', 'Sara', false)).toBe('Inès pays Sara')
  })
})
