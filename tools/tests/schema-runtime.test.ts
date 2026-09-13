import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { repoRoot } from '../lib/manifest.ts'

// One schema language for everything the repository authors.
//
// The api layer declares its shapes in Effect Schema; so do the contracts
// a value crosses at run time - text carried in a manifest, a release read
// off disk, a collection item a plugin contributes. A second runtime schema
// library was the tail of a migration, and it came back once by accident:
// a new contract reached for the one it remembered. So the source is read
// for it here. Only authored code counts - a third-party package may use
// whatever it likes underneath - and only the manifests of workspace
// packages, whose direct dependencies are this repository's own choices.

const FORBIDDEN = ['zod', '@standard-schema/spec'] as const
const SKIP = new Set(['node_modules', 'dist', 'client-dist', '.qualy', 'repos', 'legacy', '.git'])

const files = (dir: string, keep: (name: string) => boolean, into: string[] = []): string[] => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) files(full, keep, into)
    else if (keep(entry.name)) into.push(full)
  }
  return into
}

describe('the runtime schema language', () => {
  it('is Effect Schema in every authored module', () => {
    const offenders: string[] = []
    for (const root of ['apps', 'packages', 'tools'].map((name) => path.join(repoRoot, name))) {
      for (const file of files(root, (name) => /\.(ts|tsx|mts|mjs|js)$/.test(name))) {
        const source = fs.readFileSync(file, 'utf8')
        for (const module of FORBIDDEN) {
          if (new RegExp(`from ['"]${module.replace('/', '\\/')}(?:/[^'"]*)?['"]`).test(source)) {
            offenders.push(`${path.relative(repoRoot, file)} imports ${module}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('is not declared as a direct dependency by any workspace package', () => {
    const offenders: string[] = []
    const manifests = [
      path.join(repoRoot, 'package.json'),
      ...files(path.join(repoRoot, 'apps'), (name) => name === 'package.json'),
      ...files(path.join(repoRoot, 'packages'), (name) => name === 'package.json'),
    ]
    for (const manifest of manifests) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Record<
        string,
        Record<string, string> | undefined
      >
      for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
        for (const module of FORBIDDEN) {
          if (pkg[section]?.[module] !== undefined) {
            offenders.push(`${path.relative(repoRoot, manifest)} ${section} ${module}`)
          }
        }
      }
    }
    expect(offenders).toEqual([])
    const catalog = fs.readFileSync(path.join(repoRoot, 'pnpm-workspace.yaml'), 'utf8')
    for (const module of FORBIDDEN) expect(catalog).not.toContain(`${module}:`)
  })
})
