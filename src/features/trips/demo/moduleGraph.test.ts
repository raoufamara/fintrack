import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = resolve(__dirname, '../../..')
const FORBIDDEN = [/^@\/lib\/supabase$/, /^@\/stores\//, /^@\/services\//, /^@\/pages\//, /^@\/types\//, /^@\/lib\/constants$/]

function resolveModule(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? resolve(SRC, spec.slice(2)) : resolve(dirname(from), spec)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(candidate) && /\.(tsx?|css)$/.test(candidate)) return candidate
  }
  return null
}

/** Collects every module reachable from `entry` through static imports. */
function walk(entry: string, forbiddenPatterns: RegExp[] = FORBIDDEN): { files: Set<string>; bare: Set<string>; forbidden: string[] } {
  const files = new Set<string>()
  const bare = new Set<string>()
  const forbidden: string[] = []
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.pop()!
    if (files.has(file) || file.endsWith('.css')) continue
    files.add(file)
    const source = readFileSync(file, 'utf8')
    for (const m of source.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^'"]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
      const spec = (m[1] ?? m[2])!
      if (forbiddenPatterns.some((re) => re.test(spec))) forbidden.push(`${file} -> ${spec}`)
      if (spec.startsWith('.') || spec.startsWith('@/')) {
        const next = resolveModule(file, spec)
        if (next) queue.push(next)
      } else bare.add(spec)
    }
  }
  return { files, bare, forbidden }
}

describe('trips demo module graph', () => {
  const graph = walk(resolve(__dirname, 'main.tsx'))

  it('reaches the Trips routes', () => {
    expect([...graph.files].some((f) => f.endsWith('routes.tsx'))).toBe(true)
    expect(graph.files.size).toBeGreaterThan(20)
  })

  it('never imports the app Supabase client, auth store or budget code', () => {
    expect(graph.forbidden).toEqual([])
    expect([...graph.files].some((f) => f.endsWith('lib/supabase.ts'))).toBe(false)
    expect([...graph.files].some((f) => f.includes('SupabaseTripsProvider'))).toBe(false)
  })

  it('does not pull in the Supabase package at runtime', () => {
    expect([...graph.bare].filter((b) => b.startsWith('@supabase'))).toEqual([])
  })
})

describe('public view-only entry', () => {
  const routes = walk(resolve(__dirname, '../publicRoutes.tsx'))
  const provider = walk(resolve(__dirname, '../PublicTripsProvider.tsx'), [
    /^@\/stores\//, /^@\/services\//, /^@\/pages\//, /^@\/types\//, /^@\/lib\/constants$/, /^@\/components\//,
  ])

  it('the public routes reach the guest screens but no auth, Supabase or budget code', () => {
    expect([...routes.files].some((f) => f.endsWith('GuestRouteShell.tsx'))).toBe(true)
    expect(routes.forbidden).toEqual([])
    expect([...routes.files].some((f) => /SupabaseTripsProvider|PublicTripsProvider|authStore/.test(f))).toBe(false)
    expect([...routes.bare].filter((b) => b.startsWith('@supabase'))).toEqual([])
  })

  it('the provider that wires them uses the Supabase client but never the auth store', () => {
    expect(provider.forbidden).toEqual([])
    expect([...provider.files].some((f) => /authStore|SupabaseTripsProvider/.test(f))).toBe(false)
  })
})
