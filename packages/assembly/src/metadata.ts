import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
// Plugin metadata is read the way the loader will resolve it: from the host
// that owns the manifest. Resolving from the repository root instead would
// find packages the host never declared, and pnpm's isolation means those are
// exactly the ones that fail at runtime.
//
// One `qualy` field is read here and nothing else: `contributions`, a map
// from capability key to a declaration only that capability's provider
// understands - for the capabilities that still read package.json rather
// than the descriptor. Every other `qualy` field is metadata one plugin reads
// from another at runtime, which is none of the assembly's business; the
// names are kept so resolution can notice a contribution written outside
// `contributions`, and `capabilityProvider` is remembered only so resolution
// can refuse it - the declaration lives on the descriptor now.

export interface PluginMetadata {
  id: string
  version: string
  /** absolute, real path to the package root */
  dir: string
  /** capability key to raw declaration, uninterpreted */
  contributions: Record<string, unknown>
  /** whether package.json still carries the provider declaration this replaced */
  declaresProvider: boolean
  /** every other qualy.* key, so a misplaced contribution can be spotted later */
  otherKeys: string[]
  exports: Record<string, unknown>
}

export interface PackageResolver {
  hostDir: string
  resolvePackageDir(id: string): string
  resolveModuleUrl(specifier: string): string
  readMetadata(id: string): PluginMetadata
  isInstalled(id: string): boolean
}

interface RawManifest {
  version?: string
  exports?: Record<string, unknown>
  qualy?: {
    contributions?: Record<string, unknown>
    capabilityProvider?: unknown
  }
}

/** the `qualy` fields this layer reads; anything else is plugin-to-plugin metadata */
const ASSEMBLY_KEYS = new Set(['contributions', 'capabilityProvider'])

export function createPackageResolver(hostDir: string): PackageResolver {
  const host = path.resolve(hostDir)
  const hostRequire = createRequire(path.join(host, 'package.json'))
  const cache = new Map<string, PluginMetadata>()

  const resolvePackageDir = (id: string): string => {
    // Resolved through its manifest, not through a main entry. A plugin is a
    // package the assembly reads declarations from; whether it also has
    // something to import at the root is its own business, and several have
    // nothing to run at all. Requiring a "." export made "contributes a
    // schema and no code" unexpressible.
    let entryPath: string
    try {
      entryPath = hostRequire.resolve(`${id}/package.json`)
    } catch {
      throw new Error(
        `${id} cannot be resolved from ${host}: add it to that package's dependencies, and make sure its exports map declares "./package.json"`,
      )
    }
    let dir = path.dirname(entryPath)
    while (!fs.existsSync(path.join(dir, 'package.json'))) {
      const parent = path.dirname(dir)
      if (parent === dir) throw new Error(`cannot locate package.json for ${id}`)
      dir = parent
    }
    return fs.realpathSync(dir)
  }

  const readMetadata = (id: string): PluginMetadata => {
    const cached = cache.get(id)
    if (cached) return cached
    const dir = resolvePackageDir(id)
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as RawManifest
    const contributions = raw.qualy?.contributions ?? {}
    if (typeof contributions !== 'object' || Array.isArray(contributions)) {
      throw new Error(
        `${id}: qualy.contributions must be a mapping of capability key to declaration`,
      )
    }
    const metadata: PluginMetadata = {
      id,
      version: raw.version ?? '0.0.0',
      dir,
      contributions,
      declaresProvider: raw.qualy?.capabilityProvider !== undefined,
      otherKeys: Object.keys((raw.qualy ?? {}) as Record<string, unknown>).filter(
        (key) => !ASSEMBLY_KEYS.has(key),
      ),
      exports: raw.exports ?? {},
    }
    cache.set(id, metadata)
    return metadata
  }

  return {
    hostDir: host,
    resolvePackageDir,
    resolveModuleUrl: (specifier) => pathToFileURL(hostRequire.resolve(specifier)).href,
    readMetadata,
    // Asked the same way the package is located, for the same reason: a
    // plugin that exports no "." is still installed, and answering no here
    // told people to reinstall a package that was sitting right there.
    isInstalled: (id) => {
      try {
        resolvePackageDir(id)
        return true
      } catch {
        return false
      }
    },
  }
}
