import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import type { CapabilityProviderDeclaration } from '@qualy/assembly-contract'

// Plugin metadata is read the way the loader will resolve it: from the host
// that owns the manifest. Resolving from the repository root instead would
// find packages the host never declared, and pnpm's isolation means those are
// exactly the ones that fail at runtime.
//
// Two `qualy` fields are read here and nothing else. `contributions` is a map
// from capability key to a declaration only that capability's provider
// understands, and `capabilityProvider` is how a plugin says it owns one.
// Every other `qualy` field is metadata one plugin reads from another at
// runtime, which is none of the assembly's business; the names are kept so
// resolution can notice a contribution written outside `contributions`, which
// it can only judge once it knows which capabilities exist.

export interface PluginMetadata {
  id: string
  version: string
  /** absolute, real path to the package root */
  dir: string
  /** capability key to raw declaration, uninterpreted */
  contributions: Record<string, unknown>
  provider?: CapabilityProviderDeclaration
  /** the subpath export whose `layer` this plugin contributes to the runtime */
  runtime?: { entry: string }
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
    capabilityProvider?: CapabilityProviderDeclaration
    runtime?: { entry?: string }
  }
}

/** the `qualy` fields this layer reads; anything else is plugin-to-plugin metadata */
const ASSEMBLY_KEYS = new Set(['contributions', 'capabilityProvider', 'runtime'])

const readProvider = (id: string, raw: RawManifest): CapabilityProviderDeclaration | undefined => {
  const declared = raw.qualy?.capabilityProvider
  if (!declared) return undefined
  const { key, entry } = declared
  if (!key || typeof key !== 'string') {
    throw new Error(`${id}: qualy.capabilityProvider.key must be a non-empty string`)
  }
  if (!entry || typeof entry !== 'string') {
    throw new Error(`${id}: qualy.capabilityProvider.entry must name a subpath export`)
  }
  return { key, entry }
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
      provider: readProvider(id, raw),
      runtime: raw.qualy?.runtime?.entry ? { entry: raw.qualy.runtime.entry } : undefined,
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
