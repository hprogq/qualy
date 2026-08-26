import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The semantic token sheet must be complete in both schemes. The real
// incident this guards: a token pair got its .dark override written while
// the :root base value was forgotten, var() resolved to nothing, and every
// surface painted with it silently went transparent. No CSS parser here -
// the sheet is a flat pair of blocks and two regexes read it exactly.

const root = join(import.meta.dirname, '..', '..')
const sheet = readFileSync(join(root, 'packages/web/ui/src/styles/tokens.css'), 'utf8')
const stylexFace = readFileSync(join(root, 'packages/web/ui/src/theme/tokens.stylex.ts'), 'utf8')

/** the custom properties DECLARED inside one top-level block */
const declaredIn = (selector: string): Set<string> => {
  const at = sheet.indexOf(`${selector} {`)
  expect(at, `tokens.css has a ${selector} block`).toBeGreaterThanOrEqual(0)
  const body = sheet.slice(at, sheet.indexOf('}', sheet.indexOf('{', at)))
  return new Set([...body.matchAll(/(--q-[a-z0-9-]+)\s*:/g)].map((hit) => hit[1]!))
}

const light = declaredIn(':root')
const dark = declaredIn('.dark')

describe('semantic token completeness', () => {
  it('every dark override has a light base value', () => {
    const orphans = [...dark].filter((name) => !light.has(name))
    expect(orphans, 'tokens defined only under .dark resolve to nothing in light').toEqual([])
  })

  it('the core scheme-paired tokens all have a light base', () => {
    const required = [
      '--q-background',
      '--q-foreground',
      '--q-surface',
      '--q-surface-muted',
      '--q-surface-elevated',
      '--q-border',
      '--q-input',
      '--q-focus-ring',
      '--q-primary',
      '--q-primary-foreground',
      '--q-danger',
      '--q-warning',
      '--q-warning-foreground',
      '--q-success',
      '--q-success-foreground',
      '--q-muted-foreground',
      '--q-selected-border',
      '--q-selected-surface',
    ]
    const missing = required.filter((name) => !light.has(name))
    expect(missing).toEqual([])
  })

  it('every token the StyleX face points at is declared', () => {
    // the incident's exact shape: tokens.stylex.ts already carried
    // var(--q-warning) while tokens.css had no such declaration
    const pointed = [...stylexFace.matchAll(/var\((--q-[a-z0-9-]+)\)/g)].map((hit) => hit[1]!)
    expect(pointed.length).toBeGreaterThan(0)
    const dangling = pointed.filter((name) => !light.has(name))
    expect(dangling, 'tokens.stylex.ts references without a :root declaration').toEqual([])
  })

  it('cross-references inside the sheet resolve', () => {
    const referenced = [...sheet.matchAll(/var\((--q-[a-z0-9-]+)\)/g)].map((hit) => hit[1]!)
    const dangling = referenced.filter((name) => !light.has(name))
    expect(dangling).toEqual([])
  })
})
