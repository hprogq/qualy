import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { REPOS, VENDORED, catalogVersion, readVendorLock } from '../vendor-sync.ts'

// The vendored sources exist so that anything reasoning about Effect reads the
// code that actually runs. That only holds while they are the same version as
// the one installed, so the alignment is a gate rather than a habit: a version
// bump that forgets `pnpm vendor:sync` leaves the tree describing an API that
// is no longer there, which is worse than having no vendored source at all.

const walk = (dir: string, depth = 0): string[] =>
  depth > 4 || !fs.existsSync(dir)
    ? []
    : fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          return entry.name === 'node_modules' || entry.name === 'repos'
            ? []
            : walk(full, depth + 1)
        }
        return /\.tsx?$/.test(entry.name) ? [full] : []
      })

describe('vendored upstream sources', () => {
  const lock = readVendorLock()

  it.each(VENDORED.map((source) => source.name))('%s is present', (name) => {
    expect(fs.existsSync(path.join(REPOS, name)), `${REPOS}/${name} is missing`).toBe(true)
  })

  it('records the version each tree was taken from', () => {
    for (const source of VENDORED) {
      const recorded = lock.sources[source.packageName]
      expect(recorded, `${source.packageName} is not in the vendor lock`).toBeDefined()
      expect(recorded!.commit).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('is the same version this workspace installs', () => {
    // the whole point: reading an older API than the one that runs is how a
    // migration ships code against a signature that no longer exists
    for (const source of VENDORED) {
      expect(lock.sources[source.packageName]!.packageVersion).toBe(
        catalogVersion(source.packageName),
      )
    }
  })

  it('keeps every effect package on one version', () => {
    // the ecosystem peers on an exact beta, so a partial bump resolves to two
    // copies of the runtime rather than to an error
    const workspace = fs.readFileSync('pnpm-workspace.yaml', 'utf8')
    const versions = [...workspace.matchAll(/^\s*'?(@effect\/[\w-]+|effect)'?:\s*(\S+)\s*$/gm)].map(
      (match) => [match[1]!, match[2]!.replace(/^['"]|['"]$/g, '')] as const,
    )
    expect(versions.length).toBeGreaterThan(1)
    expect(new Set(versions.map(([, version]) => version)).size).toBe(1)
  })

  it('is never imported by this repository', () => {
    // it is documentation that happens to compile, not a dependency
    const offenders = [...walk('packages'), ...walk('apps'), ...walk('scripts')].flatMap((file) =>
      fs
        .readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          /from ['"][^'"]*repos\//.test(line) ? [`${file}:${index + 1}`] : [],
        ),
    )
    expect(offenders).toEqual([])
  })

  it('is kept out of every toolchain that would walk it', () => {
    const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8')) as { exclude?: string[] }
    expect(tsconfig.exclude).toContain('repos')
    expect(fs.readFileSync('vitest.config.ts', 'utf8')).toContain("'repos/**'")
    expect(fs.readFileSync('.prettierignore', 'utf8')).toContain('repos/')
    expect(fs.readFileSync('pnpm-workspace.yaml', 'utf8')).not.toContain('repos/')
    // and it must stay in version control, or vendoring it proved nothing
    expect(fs.readFileSync('.gitignore', 'utf8')).not.toMatch(/^repos\/?$/m)
  })
})
