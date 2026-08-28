import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { walkSources } from '../lib/walk.ts'

// A package that imports a workspace package has to say so.
//
// pnpm's store makes an undeclared one work anyway: the package is on disk
// because something else in the tree asked for it, so the import resolves and
// nothing complains. It resolves until the day that other thing stops asking,
// and then a package fails to install for a reason that names neither of the
// two packages actually involved.
//
// It also matters ahead of the development supervisor. Deciding which running
// process a saved file belongs to wants a dependency closure to reason over,
// and a closure with holes in it answers wrong - so the manifests have to be
// true before anything is allowed to trust them.

const ROOT = path.resolve(import.meta.dirname, '../..')
const ROOTS = ['packages', 'apps']

interface Manifest {
  readonly name?: string
  readonly dependencies?: Record<string, string>
  readonly devDependencies?: Record<string, string>
  readonly peerDependencies?: Record<string, string>
}

const manifestPaths = (): string[] => {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      const at = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(at)
      else if (entry.name === 'package.json') found.push(at)
    }
  }
  for (const root of ROOTS) walk(path.join(ROOT, root))
  return found
}

const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest

/** the workspace package a specifier belongs to: `@qualy/ui/button` -> `@qualy/ui` */
const packageOf = (specifier: string) => specifier.split('/').slice(0, 2).join('/')

const NAMES_A_PACKAGE = /(?:from\s+'(@qualy\/[^']+)'|import\(\s*'(@qualy\/[^']+)')/g

describe('what a package says it depends on', () => {
  it('names every workspace package its own sources import', () => {
    const manifests = manifestPaths().map((file) => ({ file, manifest: read(file) }))
    const workspace = new Set(
      manifests.map(({ manifest }) => manifest.name).filter((name) => name !== undefined),
    )
    const offenders: string[] = []
    for (const { file, manifest } of manifests) {
      if (manifest.name === undefined) continue
      const declared = new Set([
        ...Object.keys(manifest.dependencies ?? {}),
        ...Object.keys(manifest.devDependencies ?? {}),
        ...Object.keys(manifest.peerDependencies ?? {}),
        manifest.name,
      ])
      const dir = path.dirname(file)
      // a nested package owns its own subtree; this one stops where that begins
      const nested = manifests
        .map((other) => path.dirname(other.file))
        .filter((other) => other !== dir && other.startsWith(`${dir}${path.sep}`))
      for (const source of walkSources(dir)) {
        if (nested.some((inner) => source.startsWith(`${inner}${path.sep}`))) continue
        for (const match of fs.readFileSync(source, 'utf8').matchAll(NAMES_A_PACKAGE)) {
          const used = packageOf(match[1] ?? match[2]!)
          if (!workspace.has(used) || declared.has(used)) continue
          offenders.push(`${path.relative(ROOT, source)} imports ${used}, undeclared`)
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([])
  })
})
