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

  // Whether the tree is on disk is `pnpm vendor:check`, not this suite.
  //
  // The trees are no longer in version control: vendor-lock.json pins an exact
  // commit, which is what makes them reproducible, and committing 103MB of
  // upstream source bought only offline reads. So a plain `pnpm test` must
  // pass on a fresh clone that has never run vendor:sync, and everything here
  // reads the lock and this repository rather than the trees.
  const present = VENDORED.filter((source) => fs.existsSync(path.join(REPOS, source.name)))

  it.runIf(present.length > 0)('is the version the lock names, where it is checked out', () => {
    for (const source of present) {
      const manifest = path.join(REPOS, source.name, source.versionFile)
      const { version } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string }
      expect(version, `${REPOS}/${source.name} is stale; run \`pnpm vendor:sync\``).toBe(
        lock.sources[source.packageName]!.packageVersion,
      )
    }
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

  it('keeps every effect RUNTIME package on one version', () => {
    // The runtime ecosystem peers on an exact beta, so a partial bump resolves
    // to two copies of the runtime rather than to an error. Tooling is not
    // part of that lockstep: the language service has its own version line and
    // peers on nothing, so holding it to the runtime's version would only
    // block upgrading either one.
    const TOOLING = new Set(['@effect/language-service'])
    const workspace = fs.readFileSync('pnpm-workspace.yaml', 'utf8')
    const versions = [...workspace.matchAll(/^\s*'?(@effect\/[\w-]+|effect)'?:\s*(\S+)\s*$/gm)]
      .map((match) => [match[1]!, match[2]!.replace(/^['"]|['"]$/g, '')] as const)
      .filter(([name]) => !TOOLING.has(name))
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
    // and out of version control, except the lock that makes it reproducible
    const ignored = fs.readFileSync('.gitignore', 'utf8')
    expect(ignored).toMatch(/^repos\/\*$/m)
    expect(ignored).toMatch(/^!repos\/vendor-lock\.json$/m)
  })
})
