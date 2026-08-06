import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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

export interface VendorSourceLock {
  packageVersion: string
  tag: string
  commit: string
  /**
   * A hash of the stripped tree's contents.
   *
   * The commit alone does not say what is on disk: a tag can be moved, and a
   * local edit to a tree that is no longer in version control leaves no trace
   * at all. Comparing versions cannot see either, since both keep the same
   * package.json. This is what makes "restores a byte-identical tree" a claim
   * something checks rather than one the process merely intends.
   */
  contentSha256: string
}

export interface VendorLock {
  /** package name to the version, commit and content the tree was taken from */
  sources: Record<string, VendorSourceLock>
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

/**
 * A hash of what a vendored tree contains, and nothing else.
 *
 * Paths and bytes only: mtimes and permissions differ between a clone and a
 * copy of the same commit, and hashing them would report drift on every
 * restore. Paths are sorted and separators normalised so the digest is the
 * same on every platform.
 */
export function treeContentHash(root: string): string {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.isFile()) files.push(full)
    }
  }
  walk(root)
  const digest = createHash('sha256')
  for (const file of files.sort()) {
    digest.update(path.relative(root, file).split(path.sep).join('/'))
    digest.update('\0')
    digest.update(createHash('sha256').update(fs.readFileSync(file)).digest())
  }
  return digest.digest('hex')
}

const strip = (tree: string, source: VendoredSource) => {
  fs.rmSync(path.join(tree, '.git'), { recursive: true, force: true })
  for (const unwanted of [...NOT_VENDORED, ...(source.supersededPaths ?? [])]) {
    fs.rmSync(path.join(tree, unwanted), { recursive: true, force: true })
  }
}

/**
 * Put a tree on disk at a named commit, and say what landed.
 *
 * `update` clones the tag and reports whatever commit it points at; `restore`
 * fetches the commit the lock names, so a moved tag cannot change what is
 * checked out. Both strip the same paths, because the hash is taken after.
 */
function vendor(
  source: VendoredSource,
  ref: { tag: string } | { commit: string },
): { commit: string; contentSha256: string } {
  const target = path.join(REPOS, source.name)
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `qualy-vendor-${source.name}-`))
  try {
    if ('tag' in ref) {
      console.log(`vendor: cloning ${source.name} at ${ref.tag}`)
      git(['clone', '--depth', '1', '--branch', ref.tag, source.repository, temp])
    } else {
      console.log(`vendor: restoring ${source.name} at ${ref.commit}`)
      git(['init', '--quiet', temp])
      git(['remote', 'add', 'origin', source.repository], temp)
      git(['fetch', '--depth', '1', '--quiet', 'origin', ref.commit], temp)
      git(['checkout', '--quiet', 'FETCH_HEAD'], temp)
    }
    const commit = git(['rev-parse', 'HEAD'], temp)
    strip(temp, source)
    fs.rmSync(target, { recursive: true, force: true })
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.cpSync(temp, target, { recursive: true })
    const contentSha256 = treeContentHash(target)
    console.log(`vendor: ${target} at ${commit}`)
    return { commit, contentSha256 }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

/** what is wrong with the tree on disk, as `vendor:check` reports it */
export function checkVendored(source: VendoredSource, locked: VendorSourceLock): string[] {
  const target = path.join(REPOS, source.name)
  if (!fs.existsSync(target)) return [`${target} is missing; run \`pnpm vendor:restore\``]
  const problems: string[] = []
  const manifest = path.join(target, source.versionFile)
  if (!fs.existsSync(manifest)) {
    problems.push(`${manifest} is missing, so the tree cannot say which version it is`)
  } else {
    const { version } = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { version: string }
    if (version !== locked.packageVersion) {
      problems.push(`${target} is version ${version}, the lock names ${locked.packageVersion}`)
    }
  }
  for (const unwanted of [...NOT_VENDORED, ...(source.supersededPaths ?? [])]) {
    if (fs.existsSync(path.join(target, unwanted))) {
      problems.push(`${target}/${unwanted} should have been stripped`)
    }
  }
  const actual = treeContentHash(target)
  if (actual !== locked.contentSha256) {
    problems.push(
      `${target} does not match the content the lock names; it has been edited, or restored from a different commit`,
    )
  }
  return problems
}

if (import.meta.filename === process.argv[1]) {
  const [command, only] = process.argv.slice(2)
  const lock = readVendorLock()
  const selected = VENDORED.filter((source) => !only || only === source.name)

  if (command === 'check') {
    const problems = selected.flatMap((source) => {
      const locked = lock.sources[source.packageName]
      return locked
        ? checkVendored(source, locked)
        : [`${source.packageName} is not in ${VENDOR_LOCK}`]
    })
    if (problems.length > 0) {
      console.error(`vendor: ${problems.join('\n        ')}`)
      process.exit(1)
    }
    console.log(`vendor: ${selected.length} tree(s) match ${VENDOR_LOCK}`)
  } else if (command === 'restore') {
    // The lock decides, not the tag: a tag can be moved, and restoring through
    // one would quietly hand back a different tree than the one recorded.
    for (const source of selected) {
      const locked = lock.sources[source.packageName]
      if (!locked) throw new Error(`${source.packageName} is not in ${VENDOR_LOCK}`)
      const { contentSha256 } = vendor(source, { commit: locked.commit })
      if (contentSha256 !== locked.contentSha256) {
        throw new Error(
          `${source.name} restored from ${locked.commit} but its contents do not match the lock; the stripping rules have changed`,
        )
      }
    }
    console.log(`vendor: ${selected.length} tree(s) restored from ${VENDOR_LOCK}`)
  } else {
    // update: the catalog decides the version, and whatever the tag points at
    // now becomes the new record
    for (const source of selected) {
      const packageVersion = catalogVersion(source.packageName)
      const tag = source.tagFor(packageVersion)
      const { commit, contentSha256 } = vendor(source, { tag })
      lock.sources[source.packageName] = { packageVersion, tag, commit, contentSha256 }
    }
    lock.sources = Object.fromEntries(
      Object.entries(lock.sources).sort(([a], [b]) => a.localeCompare(b)),
    )
    fs.writeFileSync(VENDOR_LOCK, `${JSON.stringify(lock, null, 2)}\n`)
    console.log(`vendor: ${VENDOR_LOCK} written`)
  }
}
