import { CycleError, topoSort } from './graph.ts'
import { hostDirFor, manifestHash, readManifest, type AssemblyManifest } from './manifest.ts'
import { createPackageResolver, type PackageResolver, type PluginMetadata } from './metadata.ts'
import type { AssemblyLock } from './lock.ts'

// Resolution turns the manifest plus the previous lock into the full picture
// of an assembly: which plugins run, which ones only keep their data, and in
// what order the database has to build what they own.
//
// It reads files and never touches a database. Everything it produces is a
// function of the manifest, the installed packages and the previous lock, so
// running it twice on an unchanged tree changes nothing.
//
// There is deliberately no runtime dependency graph. Cordis creates every
// entry concurrently and gates activation on `inject`, so the order entries
// appear in decides nothing; a graph over it would be a second, unenforced
// declaration of what `inject` already states, and package dependencies
// cannot stand in for one either, since workspace packages are allowed to
// depend on each other in a cycle and two of these already do.

export type PluginState = 'active' | 'disabled' | 'detached'

export interface ResolvedPlugin {
  id: string
  state: PluginState
  version: string
  /** hard requirement: a schema that references these is unusable without them */
  databaseDependsOn: string[]
  database?: { schemaEntry?: string; baselineDir?: string }
}

export interface Resolution {
  manifest: AssemblyManifest
  manifestHash: string
  resolver: PackageResolver
  /** every plugin the assembly accounts for, keyed and iterated by id */
  plugins: Map<string, ResolvedPlugin>
  /** what runs, by id, because nothing downstream gives the order meaning */
  runtimeOrder: string[]
  /** what owns database objects, dependencies first */
  databaseOrder: string[]
}

const hasDatabase = (metadata: Pick<PluginMetadata, 'database'>) =>
  Boolean(metadata.database?.schemaEntry ?? metadata.database?.baselineDir)

export interface ResolveOptions {
  manifestPath: string
  /** defaults to the manifest's own directory, which is where the loader anchors */
  hostDir?: string
  previousLock?: AssemblyLock
}

export function resolveAssembly(options: ResolveOptions): Resolution {
  const manifest = readManifest(options.manifestPath)
  const resolver = createPackageResolver(options.hostDir ?? hostDirFor(options.manifestPath))

  const states = new Map<string, PluginState>()
  for (const [id, entry] of manifest.plugins) {
    states.set(id, entry.enabled ? 'active' : 'disabled')
  }
  // A plugin dropped from the manifest keeps a place here only if it has
  // database objects to keep. Detaching one that owns nothing would park a
  // dead entry in the lock with no way to remove it, since taking it out of
  // the manifest is the only removal there is until purge exists.
  for (const [id, previous] of Object.entries(options.previousLock?.plugins ?? {})) {
    if (states.has(id) || !previous.database) continue
    states.set(id, 'detached')
  }

  const uninstalled: string[] = []
  const metadata = new Map<string, PluginMetadata>()
  for (const [id, state] of states) {
    if (state === 'detached' && !resolver.isInstalled(id)) {
      uninstalled.push(id)
      continue
    }
    metadata.set(id, resolver.readMetadata(id))
  }
  if (uninstalled.length > 0) {
    throw new Error(
      `these plugins are gone from ${manifest.source} but their database objects are still in place, and their packages are no longer installed:\n  ${uninstalled.join('\n  ')}\n` +
        'Reinstall them to keep resolving. The data they own is untouched.',
    )
  }

  const retained = new Set(states.keys())
  const missing: string[] = []
  const databaseEdges = new Map<string, string[]>()
  for (const [id, entry] of metadata) {
    const dependsOn = entry.database?.dependsOn ?? []
    for (const required of dependsOn) {
      // A schema that imports another plugin's tables is unusable without
      // them: postgres refuses the foreign key halfway through applying a
      // migration, naming a relation the reader has no reason to connect to
      // a missing plugin. Said here, the assembly is rejected before
      // anything is generated, by the name of what is missing.
      if (!retained.has(required)) {
        missing.push(`${id} needs ${required}, which this assembly does not include`)
      }
    }
    databaseEdges.set(
      id,
      dependsOn.filter((dep) => dep !== id && retained.has(dep)),
    )
  }
  if (missing.length > 0) {
    throw new Error(`incomplete assembly:\n  ${missing.join('\n  ')}`)
  }

  const databaseIds = [...metadata].filter(([, entry]) => hasDatabase(entry)).map(([id]) => id)
  let databaseOrder: string[]
  try {
    databaseOrder = topoSort(databaseIds, databaseEdges).order
  } catch (error) {
    if (!(error instanceof CycleError)) throw error
    // unlike runtime order, this one has to exist: tables are created in it
    throw new Error(`database dependency cycle: ${error.cycle.join(' -> ')}`)
  }

  const plugins = new Map<string, ResolvedPlugin>()
  for (const id of [...states.keys()].sort()) {
    const entry = metadata.get(id)!
    plugins.set(id, {
      id,
      state: states.get(id)!,
      version: entry.version,
      databaseDependsOn: databaseEdges.get(id) ?? [],
      database: hasDatabase(entry)
        ? { schemaEntry: entry.database?.schemaEntry, baselineDir: entry.database?.baselineDir }
        : undefined,
    })
  }

  return {
    manifest,
    manifestHash: manifestHash(manifest),
    resolver,
    plugins,
    runtimeOrder: [...states]
      .filter(([, state]) => state === 'active')
      .map(([id]) => id)
      .sort(),
    databaseOrder,
  }
}

/** what runs */
export const activePlugins = (resolution: Resolution) =>
  resolution.runtimeOrder.map((id) => resolution.plugins.get(id)!)

/**
 * Everything whose database objects the assembly keeps: active, disabled and
 * detached alike. Switching a plugin off or taking it out of the manifest
 * never makes its tables disappear, so schema aggregation reads this set and
 * not the runtime one.
 */
export const retainedPlugins = (resolution: Resolution) => [...resolution.plugins.values()]
