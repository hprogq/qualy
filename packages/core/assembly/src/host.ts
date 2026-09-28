import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createPackageResolver, type PackageResolver } from './metadata.ts'
import { lockPathFor, productRootFor } from './manifest.ts'
import { readLock } from './lock.ts'
import { resolveAssembly, type Resolution } from './resolve.ts'

// Product-anchored resolution, for every tool that works ON an assembly: the
// CLI, the browser build, the quality gates and the fixtures. Plugin ids
// resolve from the package the manifest sits in - resolving from anywhere
// else finds packages the product never declared, which pnpm's isolation then
// fails to load. The manifest path is always the caller's: this module has
// no idea where a repository keeps its qualy.yml, and pretending otherwise
// is how a build run from another directory reads the wrong assembly.

const resolvers = new Map<string, PackageResolver>()

export function hostResolver(manifestPath: string): PackageResolver {
  const root = productRootFor(manifestPath)
  const cached = resolvers.get(root)
  if (cached) return cached
  const resolver = createPackageResolver(root)
  resolvers.set(root, resolver)
  return resolver
}

export const resolvePluginModuleUrl = (specifier: string, manifestPath: string): string =>
  hostResolver(manifestPath).resolveModuleUrl(specifier)

export const resolvePackageDir = (id: string, manifestPath: string): string =>
  hostResolver(manifestPath).resolvePackageDir(id)

/**
 * Where a plugin's own export subpath really is: `./client/ReviewPage` of
 * `@acme/probe` -> the file its package says stands behind that name.
 *
 * Through the package's exports map, which is the one place a package
 * already declares this - so a workspace plugin can answer with a `.tsx`
 * under `src/` and a published one with a `.js` under `dist/`, and nothing
 * asking has to know which.
 */
export const resolvePluginExport = (id: string, subpath: string, manifestPath: string): string => {
  const specifier = subpath === '.' ? id : `${id}${subpath.replace(/^\./, '')}`
  try {
    return fileURLToPath(hostResolver(manifestPath).resolveModuleUrl(specifier))
  } catch (error) {
    throw new Error(
      `${id} does not export ${subpath}; a plugin's modules are named by its own export subpaths, so add it to that package's "exports"`,
      { cause: error },
    )
  }
}

// resolution walks every plugin package and imports every capability
// provider, and callers ask once per entry; keyed by content rather than by
// path so that rewriting a manifest in place still resolves again
const cache = new Map<string, Promise<Resolution>>()

export function currentResolution(manifestPath: string): Promise<Resolution> {
  // computed before any await, so two concurrent callers agree on the key
  const key = `${manifestPath} ${fs.readFileSync(manifestPath, 'utf8')}`
  const cached = cache.get(key)
  if (cached) return cached
  const pending = resolveAssembly({
    manifestPath,
    previousLock: readLock(lockPathFor(manifestPath)),
    // a failure must not be memoised: the next caller retries rather than
    // inheriting a rejection whose stack points at whoever asked first
  }).catch((error: unknown) => {
    cache.delete(key)
    throw error
  })
  cache.set(key, pending)
  return pending
}

export interface Entry {
  name: string
  config?: unknown
  disabled?: boolean
}

/**
 * What the manifest selected, sorted by plugin id.
 *
 * `all` keeps the entries that are switched off. Detached plugins are never
 * here: they are not part of the selection any more, only of what some
 * capability still accounts for.
 */
export async function readEntries(options: {
  manifestPath: string
  all?: boolean
}): Promise<Entry[]> {
  const resolution = await currentResolution(options.manifestPath)
  return [...resolution.plugins.values()]
    .filter((plugin) => plugin.state === 'active' || (options.all && plugin.state === 'disabled'))
    .map((plugin) => ({
      name: plugin.id,
      config: resolution.manifest.plugins.get(plugin.id)?.config,
      disabled: plugin.state === 'disabled' || undefined,
    }))
}

/** the variable a host reads how long a stopping process waits before forcing its exit from */
export const SHUTDOWN_TIMEOUT_VARIABLE = 'QUALY_SHUTDOWN_TIMEOUT'

/**
 * How long, in milliseconds, a stopping server or CLI command waits for its
 * finalizers before it forces the exit; 0 never forces it. Whole seconds in
 * the environment, 30 when unset. Anything else is refused rather than read
 * as something: `Number('30s')` is NaN, and a NaN deadline never fires, so a
 * typo used to switch the forced exit off without a word.
 */
export const shutdownTimeoutMs = (env: Readonly<Record<string, string | undefined>>): number => {
  const raw = env[SHUTDOWN_TIMEOUT_VARIABLE]
  if (raw === undefined || raw === '') return 30_000
  if (!/^\d{1,5}$/.test(raw)) {
    throw new Error(
      `${SHUTDOWN_TIMEOUT_VARIABLE} must be a whole number of seconds (0 never forces the exit), not ${JSON.stringify(raw)}`,
    )
  }
  return Number(raw) * 1000
}
