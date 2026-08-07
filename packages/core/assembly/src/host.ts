import fs from 'node:fs'
import { createPackageResolver, type PackageResolver } from './metadata.ts'
import { hostDirFor, lockPathFor, readManifest } from './manifest.ts'
import { readLock } from './lock.ts'
import { resolveAssembly, type Resolution } from './resolve.ts'

// Host-anchored resolution, for every tool that works ON an assembly: the
// CLI, the browser build, the quality gates and the fixtures. Plugin ids
// resolve from the workspace the manifest names - resolving from anywhere
// else finds packages the host never declared, which pnpm's isolation then
// fails to load. The manifest path is always the caller's: this module has
// no idea where a repository keeps its qualy.yml, and pretending otherwise
// is how a build run from another directory reads the wrong assembly.

const resolvers = new Map<string, PackageResolver>()

export function hostResolver(manifestPath: string): PackageResolver {
  const host = hostDirFor(readManifest(manifestPath))
  const cached = resolvers.get(host)
  if (cached) return cached
  const resolver = createPackageResolver(host)
  resolvers.set(host, resolver)
  return resolver
}

export const resolvePluginModuleUrl = (specifier: string, manifestPath: string): string =>
  hostResolver(manifestPath).resolveModuleUrl(specifier)

export const resolvePackageDir = (id: string, manifestPath: string): string =>
  hostResolver(manifestPath).resolvePackageDir(id)

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
