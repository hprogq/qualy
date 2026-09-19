import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// Where a plugin's browser half really is.
//
// A descriptor names an export SUBPATH - `Browser.module('./client/boot')` -
// and the package's own exports map says which file that is. Nothing in
// either file can see the other, so a subpath that was renamed on one side
// is a boot-time failure discovered by whoever opens the page.
//
// This file used to ask a different question. `Ui.browser` named a module
// the aggregate imported for its SIDE EFFECT, so a package declaring
// `"sideEffects": false` was telling every bundler it could be dropped -
// invisible until a release build, where an upload driver disappeared and
// every upload failed with "no driver for this grant". That declaration form
// is gone: a browser half is now a value with a lifecycle, imported by name
// and therefore never dropped. The gate went on scanning for the retired
// spelling, which meant it checked nothing at all - and a gate that quietly
// checks nothing is worse than no gate. It asks what is still true instead.

const ROOT = path.resolve(import.meta.dirname, '../..')
const PLUGINS = path.join(ROOT, 'packages/plugins')

/** every plugin package directory, found rather than listed */
const packageDirs = (): string[] =>
  fs
    .readdirSync(PLUGINS, { withFileTypes: true })
    .filter((group) => group.isDirectory())
    .flatMap((group) =>
      fs
        .readdirSync(path.join(PLUGINS, group.name), { withFileTypes: true })
        .filter((one) => one.isDirectory())
        .map((one) => path.join(PLUGINS, group.name, one.name)),
    )

/**
 * The modules a descriptor asks the browser to import for their side effect,
 * as files of the package.
 *
 * A descriptor names an export SUBPATH; where that really is, the package's
 * own exports map says. Deriving it by joining `src/` was an assumption about
 * this repository's layout, and the thing that broke it - a package that
 * ships a `dist/` - is the one this rule most needs to hold for.
 */
const browserModulesOf = (dir: string): string[] => {
  const descriptor = path.join(dir, 'src/index.ts')
  if (!fs.existsSync(descriptor)) return []
  const exported = (
    JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as {
      exports?: Record<string, unknown>
    }
  ).exports
  return [...fs.readFileSync(descriptor, 'utf8').matchAll(/Browser\.module\(\s*'([^']+)'/g)].map(
    (match) => {
      const subpath = match[1]!
      const target = exported?.[subpath]
      if (typeof target !== 'string') {
        throw new Error(`${dir} declares Browser.module(${subpath}) and exports no such subpath`)
      }
      return target
    },
  )
}

describe('a plugin\'s browser half', () => {
  it('is where the package says it is', () => {
    const missing: string[] = []
    let checked = 0
    for (const dir of packageDirs()) {
      for (const module of browserModulesOf(dir)) {
        checked += 1
        if (!fs.existsSync(path.join(dir, module))) {
          missing.push(`${path.relative(ROOT, dir)} names ${module}, which is not there`)
        }
      }
    }
    expect(missing).toEqual([])
    // the gate before this one scanned for a spelling that no longer exists
    // and so checked nothing; this says out loud that it found some
    expect(checked).toBeGreaterThan(0)
  })
})
