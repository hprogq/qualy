import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { walkFiles } from '../lib/walk.ts'

// A package that declares `sideEffects` tells the bundler which of its
// modules may be dropped when nothing reads their exports. A module that
// exists for what importing it does - `import 'monaco-editor/features/
// register.all'` - is exactly the kind that must not be dropped, and the
// bundler only drops in production: development never tree-shakes, so the
// loss shows up nowhere but on the deployed site. It did: the formula
// package said `"sideEffects": false`, and production's formula editor came
// up without hover, context menu or syntax colours (2026-09-29).
//
// So a bare import in such a package must be accounted for in its list:
// one of the package's own files names the file imported; one of another
// package names the importing file, the only one the list can speak for.

const ROOT = path.resolve(import.meta.dirname, '../..')
const SOURCE = /\.(?:ts|tsx|js|mjs)$/
const BARE_IMPORT = /^import\s+['"]([^'"]+)['"]/gm

interface Declared {
  readonly dir: string
  readonly name: string
  readonly sideEffects: false | readonly string[]
}

const declaring = (): Declared[] =>
  walkFiles(path.join(ROOT, 'packages'), ['client-dist', 'dist'])
    .filter((file) => path.basename(file) === 'package.json')
    .map((file) => ({
      file,
      json: JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>,
    }))
    .filter(({ json }) => json.sideEffects === false || Array.isArray(json.sideEffects))
    .map(({ file, json }) => ({
      dir: path.dirname(file),
      name: String(json.name),
      sideEffects: json.sideEffects as false | string[],
    }))

const listed = (pkg: Declared, file: string) => {
  if (pkg.sideEffects === false) return false
  const relative = path.relative(pkg.dir, file).split(path.sep).join('/')
  return pkg.sideEffects.some((pattern) => path.matchesGlob(relative, pattern.replace(/^\.\//, '')))
}

describe('what a package says has side effects', () => {
  const packages = declaring()

  it('finds the packages that declare it', () => {
    expect(packages.map((pkg) => pkg.name)).toContain('@qualy/plugin-assessment-formula')
  })

  it('accounts for every import made only for what it does', () => {
    const unaccounted: string[] = []
    for (const pkg of packages) {
      const src = path.join(pkg.dir, 'src')
      if (!fs.existsSync(src)) continue
      for (const file of walkFiles(src).filter((candidate) => SOURCE.test(candidate))) {
        for (const match of fs.readFileSync(file, 'utf8').matchAll(BARE_IMPORT)) {
          const specifier = match[1]!
          const own = specifier.startsWith('.')
          const holder = own ? path.resolve(path.dirname(file), specifier) : file
          if (!listed(pkg, holder)) {
            unaccounted.push(
              `${pkg.name}: ${path.relative(ROOT, file)} imports '${specifier}' for its effect, ` +
                `but ${path.relative(pkg.dir, holder)} is not in its "sideEffects"`,
            )
          }
        }
      }
    }
    expect(unaccounted).toEqual([])
  })
})
