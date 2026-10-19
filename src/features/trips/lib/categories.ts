import type { CategoryColorKey } from '../types'

export interface DefaultCategory {
  key: string
  name: string
  icon: string
  color: CategoryColorKey
}

/** The 8 categories every new trip is seeded with (spec section 3.1). */
export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = [
  { key: 'stay', name: 'Stay', icon: 'bed-double', color: 'blue' },
  { key: 'food', name: 'Food & drinks', icon: 'utensils', color: 'rust' },
  { key: 'transport', name: 'Transport', icon: 'train-front', color: 'teal' },
  { key: 'activity', name: 'Activities', icon: 'ticket', color: 'purple' },
  { key: 'groceries', name: 'Groceries', icon: 'shopping-basket', color: 'green' },
  { key: 'shopping', name: 'Shopping', icon: 'shopping-bag', color: 'pink' },
  { key: 'fees', name: 'Fees & tips', icon: 'circle-dollar-sign', color: 'grey' },
  { key: 'other', name: 'Other', icon: 'ellipsis', color: 'grey' },
]

export interface CategoryColor {
  /** Icons and selected chips with white text. */
  fg: string
  /** Icon tiles. */
  bg: string
}

/** Curated palette (spec section 3.2). Store the key, never the hex. */
export const CATEGORY_COLORS: Readonly<Record<CategoryColorKey, CategoryColor>> = {
  blue: { fg: '#1460D8', bg: '#E3EEFF' },
  rust: { fg: '#B8470F', bg: '#FFF1E6' },
  teal: { fg: '#0B7A82', bg: '#E2F5F6' },
  purple: { fg: '#6430E8', bg: '#F3EDFE' },
  green: { fg: '#1F7F0C', bg: '#EDF7EC' },
  pink: { fg: '#C02675', bg: '#FFEFF7' },
  grey: { fg: '#555555', bg: '#F1F1F1' },
}

export const CATEGORY_COLOR_KEYS = Object.keys(CATEGORY_COLORS) as CategoryColorKey[]

/** Curated lucide icon names (spec section 3.3). */
export const CATEGORY_ICONS: readonly string[] = [
  'bed-double', 'hotel', 'tent', 'utensils', 'coffee', 'wine', 'beer', 'pizza',
  'train-front', 'plane', 'bus', 'car', 'ship', 'bike', 'fuel', 'ticket',
  'landmark', 'camera', 'mountain', 'waves', 'music', 'shopping-bag',
  'shopping-basket', 'shirt', 'gift', 'heart-pulse', 'pill', 'sparkles',
  'scissors', 'wifi', 'smartphone', 'circle-dollar-sign', 'receipt',
  'hand-coins', 'baby', 'dog', 'briefcase', 'graduation-cap', 'ellipsis', 'tag',
]

export const CATEGORY_NAME_MAX = 24

/**
 * Canonical form used to detect duplicate names: trimmed, accents removed,
 * lower-cased. Mirrors the database index
 * lower(immutable_unaccent(btrim(name))), so "Café" and "cafe" clash.
 */
export function normalizeCategoryName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .trim()
    .toLowerCase()
}

/**
 * True when `name` clashes with another category of the same trip.
 * Pass `ignoreId` when editing so a category does not clash with itself.
 */
export function isDuplicateCategoryName(
  name: string,
  categories: ReadonlyArray<{ id: string; name: string }>,
  ignoreId?: string,
): boolean {
  const target = normalizeCategoryName(name)
  return categories.some(
    (c) => c.id !== ignoreId && normalizeCategoryName(c.name) === target,
  )
}
