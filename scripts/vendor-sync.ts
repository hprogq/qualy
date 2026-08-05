import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Upstream source, vendored at exactly the version this repository installs.
//
// It is here so that anything reasoning about Effect or Drizzle reads the code
// that actually runs rather than remembering an older API. Effect v4 is in
// beta and the modules this project depends on live under `unstable/`, where
// a minor release is allowed to change them, so "the docs said" is not a
// source. `repos/` is the source.
//
// A shallow clone at the tag rather than a git subtree: the only supported
// upgrade is "pick a version, move every pinned package to it, replace the
// vendored tree, commit that on its own", and re-cloning expresses exactly
// that. A subtree would additionally carry the upstream history into this
// repository, which nothing here has a use for.

export interface VendoredSource {
  /** directory under repos/ */
  name: string
  repository: string
  /** the npm package whose installed version this must match */
  packageName: string
  /** how that package's version becomes an upstream tag */
  tagFor(version: string): string
  /**
   * The manifest inside the tree that says which version it is.
   *
   * The clone's `.git` is stripped, so a checked-out tree carries no commit to
   * compare against. This is what `pnpm vendor:check` reads instead to tell a
   * stale tree from the one the lock names.
   */
  versionFile: string
  /**
   * Paths in this upstream that describe a version other than the pinned one.
   *
   * The tree exists so that reasoning about a library reads what actually
   * runs. A directory of documentation snapshots for five superseded majors is
   * the opposite of that, and every search through the tree would surface it
   * beside the real answer.
   */
  supersededPaths?: readonly string[]
}

export const VENDORED: readonly VendoredSource[] = [
  {
    name: 'effect',
    repository: 'https://github.com/Effect-TS/effect.git',
    packageName: 'effect',
    tagFor: (version) => `effect@${version}`,
    versionFile: 'packages/effect/package.json',
  },
  {
    name: 'drizzle-orm',
    repository: 'https://github.com/drizzle-team/drizzle-orm.git',
    packageName: 'drizzle-orm',
    tagFor: (version) => `v${version}`,
    versionFile: 'drizzle-orm/package.json',
  },
  // Vendored ahead of any dependency on it: the orm decision spike has to read
  // what v7 actually does with entity metadata, the Kysely bridge and the
  // migrator, and reasoning from release notes is how a spike concludes that a
  // product supports something it supports differently. `docs/` in this tree is
  // the documentation site's source.
  {
    name: 'mikro-orm',
    repository: 'https://github.com/mikro-orm/mikro-orm.git',
    packageName: '@mikro-orm/core',
    tagFor: (version) => `v${version}`,
    versionFile: 'packages/core/package.json',
    // 176MB of docusaurus snapshots for v2 through v6. The version this tree
    // is pinned to documents itself in docs/docs, which stays.
    supersededPaths: ['docs/versioned_docs', 'docs/versioned_sidebars'],
  },
]

export const REPOS = 'repos'
export const VENDOR_LOCK = path.join(REPOS, 'vendor-lock.json')

export interface VendorLock {
  /** package name to the version and upstream commit the tree was taken from */
  sources: Record<string, { packageVersion: string; tag: string; commit: string }>
}

export const readVendorLock = (): VendorLock =>
  fs.existsSync(VENDOR_LOCK)
    ? (JSON.parse(fs.readFileSync(VENDOR_LOCK, 'utf8')) as VendorLock)
    : { sources: {} }

/** the version the workspace catalog pins, which is what the tree has to match */
export function catalogVersion(packageName: string): string {
  const workspace = fs.readFileSync('pnpm-workspace.yaml', 'utf8')
  const pattern = new RegExp(`^\\s*'?${packageName}'?:\\s*(\\S+)\\s*$`, 'm')
  const found = pattern.exec(workspace)?.[1]
  if (!found) throw new Error(`${packageName} is not pinned in the pnpm-workspace catalog`)
  return found.replace(/^['"]|['"]$/g, '')
}

const git = (args: readonly string[], cwd?: string) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()

/**
 * Directories that would address an agent rather than inform it.
 *
 * A vendored tree is upstream source to read. Its own agent configuration is
 * instructions written for a different repository by people who never saw
 * this one, and a coding agent working here would pick them up as if they
 * were this project's rules. Vendoring drizzle-orm brought exactly that:
 * a skill announcing itself the moment the tree landed.
 */
export const NOT_VENDORED = [
  '.claude',
  '.cursor',
  '.agents',
  'AGENTS.md',
  '.github/copilot-instructions.md',
]

function vendor(source: VendoredSource, version: string): string {
  const tag = source.tagFor(version)
  const target = path.join(REPOS, source.name)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `qualy-vendor-${source.name}-`))
  try {
    console.log(`vendor: cloning ${source.name} at ${tag}`)
    git(['clone', '--depth', '1', '--branch', tag, source.repository, temp])
    const commit = git(['rev-parse', 'HEAD'], temp)
    fs.rmSync(path.join(temp, '.git'), { recursive: true, force: true })
    for (const unwanted of [...NOT_VENDORED, ...(source.supersededPaths ?? [])]) {
      fs.rmSync(path.join(temp, unwanted), { recursive: true, force: true })
    }
    fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(temp, target, { recursive: true })
    console.log(`vendor: ${target} at ${commit}`)
    return commit
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

if (import.meta.filename === process.argv[1]) {
  const only = process.argv[2]
  const lock = readVendorLock()
  for (const source of VENDORED) {
    if (only && only !== source.name) continue
    const packageVersion = catalogVersion(source.packageName)
    lock.sources[source.packageName] = {
      packageVersion,
      tag: source.tagFor(packageVersion),
      commit: vendor(source, packageVersion),
    }
  }
  lock.sources = Object.fromEntries(
    Object.entries(lock.sources).sort(([a], [b]) => a.localeCompare(b)),
  )
  fs.writeFileSync(VENDOR_LOCK, `${JSON.stringify(lock, null, 2)}\n`)
  console.log(`vendor: ${VENDOR_LOCK} written`)
}
