import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Plugin metadata is read the way the loader will resolve it: from the host
// that owns the manifest. Resolving from the repository root instead would
// find packages the host never declared, and pnpm's isolation means those are
// exactly the ones that fail at runtime.

export interface PluginDatabaseMetadata {
  schemaEntry?: string
  baselineDir?: string
  dependsOn: string[]
}

export interface PluginMetadata {
  id: string
  version: string
  /** absolute, real path to the package root */
  dir: string
  database?: PluginDatabaseMetadata
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
    database?: { schemaEntry?: string; baselineDir?: string; dependsOn?: string[] }
  }
}

export function createPackageResolver(hostDir: string): PackageResolver {
  const host = path.resolve(hostDir)
  const hostRequire = createRequire(path.join(host, 'package.json'))
  const cache = new Map<string, PluginMetadata>()

  const resolvePackageDir = (id: string): string => {
    let entryPath: string
    try {
      entryPath = hostRequire.resolve(id)
    } catch {
      throw new Error(
        `${id} cannot be resolved from ${host}: add it to that package's dependencies, or check that its exports map declares a "." entry`,
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
    const database = raw.qualy?.database
    const metadata: PluginMetadata = {
      id,
      version: raw.version ?? '0.0.0',
      dir,
      exports: raw.exports ?? {},
      database: database
        ? {
            schemaEntry: database.schemaEntry,
            baselineDir: database.baselineDir,
            dependsOn: [...(database.dependsOn ?? [])].sort(),
          }
        : undefined,
    }
    cache.set(id, metadata)
    return metadata
  }

  return {
    hostDir: host,
    resolvePackageDir,
    resolveModuleUrl: (specifier) => pathToFileURL(hostRequire.resolve(specifier)).href,
    readMetadata,
    isInstalled: (id) => {
      try {
        hostRequire.resolve(id)
        return true
      } catch {
        return false
      }
    },
  }
}
