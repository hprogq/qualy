import { readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkFiles } from '../lib/walk.ts'

// The semantic token sheet must be complete in both schemes. The real
// incident this guards: a token pair got its .dark override written while
// the :root base value was forgotten, var() resolved to nothing, and every
// surface painted with it silently went transparent. No CSS parser here -
// the sheet is a flat pair of blocks and two regexes read it exactly.
//
// The cases below that read the whole browser tree were added after the same
// failure happened again, in the direction this file could not see. Retiring
// the utility framework deleted the block that declared its aliases, and three
// readers of them survived: every toast in the product lost its surface (an
// unresolvable var() makes the whole declaration invalid, so sonner's own
// white default won the element and then computed to nothing), and the paper's
// allocation bar painted four transparent segments. The cases here only ever
// looked at `--q-*` names, and only in two files, so none of it was visible.
//
// The rule is now the general one: a custom property this repository READS
// must be one this repository, or the widget library at runtime, WRITES.

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

// ---------------------------------------------------------------------------
// every custom property the browser code reads, against what writes them

const browserRoots = [
  'packages/web/ui/src',
  'packages/web/runtime/src',
  'packages/web/i18n/src',
  'apps/web/src',
  ...['assessment', 'base', 'demo', 'infra'].flatMap((group) => `packages/plugins/${group}`),
]

const browserSources = browserRoots
  .flatMap((dir) => walkFiles(join(root, dir)))
  // a plugin's browser half only; its server sources never reach a stylesheet
  .filter((file) => !file.includes(`${sep}plugins${sep}`) || file.includes(`${sep}client${sep}`))
  .filter((file) => /\.(ts|tsx|css)$/.test(file))
  .map((file) => ({ path: relative(root, file), text: readFileSync(file, 'utf8') }))

/**
 * Prose removed before anything is read out of a file.
 *
 * Comments in this repository quote the code they are about, so a case that
 * scanned them would report a sentence describing a bug as the bug. Only whole
 * comment lines are dropped - a line whose first non-space is `//` or `*`, and
 * anything between a block comment's delimiters - which leaves code untouched
 * even when it contains a `//` of its own.
 */
const withoutProse = (text: string): string =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart()
      return !trimmed.startsWith('//') && !trimmed.startsWith('*')
    })
    .join('\n')

/**
 * Properties a component sets on itself, and the sheets' own declarations.
 *
 * Matched in both spellings, because a stylesheet writes `--x: value` and a
 * component writes `'--x': value` into a style object; a rule that only knew
 * one of them would call the other dangling.
 */
const written = new Set<string>()
for (const { text } of [...browserSources, { path: '', text: sheet }]) {
  for (const hit of text.matchAll(/['"]?(--[a-zA-Z0-9-]+)['"]?\s*:/g)) written.add(hit[1]!)
}

/**
 * Read at runtime from the widget library, which sets them inline per element
 * rather than declaring them in its stylesheet - so neither this repository
 * nor any file on disk writes them, and only naming them says so.
 */
const setByTheWidget = new Map([
  ['--button-bg', 'Mantine Button, per variant; the disabled shim points hover back at it'],
  ['--ai-bg', 'Mantine ActionIcon, the same shim'],
])

describe('what the browser reads', () => {
  it('found the sources to check', () => {
    expect(browserSources.length).toBeGreaterThan(100)
  })

  it('reads no custom property that nothing writes', () => {
    const dangling: string[] = []
    for (const { path, text: raw } of browserSources) {
      const text = withoutProse(raw)
      // a reference that carries a fallback has already said what happens
      // when the property is absent, which makes its absence a decision
      for (const hit of text.matchAll(/var\(\s*(--[a-zA-Z0-9-]*)\s*([,)])/g)) {
        const name = hit[1]!
        if (hit[2] === ',') continue
        if (name.startsWith('--mantine-')) continue
        if (setByTheWidget.has(name)) continue
        if (written.has(name)) continue
        dangling.push(`${name} read in ${path}`)
      }
    }
    expect(dangling, 'var() references nothing declares or sets').toEqual([])
  })
})
