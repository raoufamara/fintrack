import { describe, expect, it } from 'vitest'
import {
  CATEGORY_COLORS,
  CATEGORY_ICONS,
  DEFAULT_CATEGORIES,
  isDuplicateCategoryName,
  normalizeCategoryName,
} from './categories'

describe('category constants', () => {
  it('seeds the 8 default categories', () => {
    expect(DEFAULT_CATEGORIES.map((c) => c.key)).toEqual([
      'stay', 'food', 'transport', 'activity', 'groceries', 'shopping', 'fees', 'other',
    ])
    for (const c of DEFAULT_CATEGORIES) {
      expect(CATEGORY_ICONS).toContain(c.icon)
      expect(CATEGORY_COLORS[c.color]).toBeDefined()
    }
    expect(new Set(DEFAULT_CATEGORIES.map((c) => normalizeCategoryName(c.name))).size).toBe(8)
  })

  it('has the 7-colour palette and about 40 icons', () => {
    expect(Object.keys(CATEGORY_COLORS).sort()).toEqual(['blue', 'green', 'grey', 'pink', 'purple', 'rust', 'teal'])
    expect(CATEGORY_COLORS.pink).toEqual({ fg: '#C02675', bg: '#FFEFF7' })
    expect(CATEGORY_ICONS).toHaveLength(40)
    expect(new Set(CATEGORY_ICONS).size).toBe(CATEGORY_ICONS.length)
  })
})

describe('duplicate category names', () => {
  const cats = [
    { id: '1', name: 'Café' },
    { id: '2', name: 'Food & drinks' },
  ]

  it('treats Café and cafe as the same name', () => {
    expect(normalizeCategoryName('  Café ')).toBe('cafe')
    expect(isDuplicateCategoryName('cafe', cats)).toBe(true)
    expect(isDuplicateCategoryName('CAFÉ', cats)).toBe(true)
    expect(isDuplicateCategoryName(' cafe  ', cats)).toBe(true)
  })

  it('allows distinct names', () => {
    expect(isDuplicateCategoryName('Hammam & spa', cats)).toBe(false)
    expect(isDuplicateCategoryName('Cafés', cats)).toBe(false)
  })

  it('ignores the category being edited', () => {
    expect(isDuplicateCategoryName('cafe', cats, '1')).toBe(false)
    expect(isDuplicateCategoryName('food & DRINKS', cats, '1')).toBe(true)
  })
})
