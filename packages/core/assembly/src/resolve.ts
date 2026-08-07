import type { AssemblyPlugin, PluginState } from '@qualy/assembly-contract'
import { isPluginDescriptor, type PluginDescriptor } from '@qualy/plugin-kit'
import { hostDirFor, manifestHash, readManifest, type AssemblyManifest } from './manifest.ts'
import { createPackageResolver, type PackageResolver, type PluginMetadata } from './metadata.ts'
import { loadProviders, type LoadedProvider } from './registry.ts'
import type { AssemblyLock } from './lock.ts'

// Resolution turns the manifest plus the previous lock into the full picture
// of an assembly: which plugins run, which ones are only kept for what they
// left behind, and what each capability makes of their declarations.
//
// It reads files and never touches an external system. Everything it produces
// is a function of the manifest, the installed packages and the previous lock,
// so running it twice on an unchanged tree changes nothing.
//
// The core decides two things and delegates everything else. It decides which
// plugins the manifest selected, and it decides whether a plugin that left the
// manifest is still accounted for, by asking every capability whether it wants
// the plugin kept. What a contribution means, and what has to happen because
// of it, belongs to the capability that owns the key.
//
// There is deliberately no runtime dependency graph. Cordis creates every
// entry concurrently and gates activation on `inject`, so the order entries
// appear in decides nothing; a graph over it would be a second, unenforced
// declaration of what `inject` already states, and package dependencies cannot
// stand in for one either, since workspace packages are allowed to depend on
// each other in a cycle and two of these already do.

export type { PluginState }

export interface ResolvedPlugin extends AssemblyPlugin {
  /** parsed contributions, keyed by capability; JSON serialisable, it goes in the lock */
  contributions: Record<string, unknown>
}

export interface ResolvedCapability {
  key: string
  /** the plugin whose package provides this capability */
  provider: string
  /** opaque to everything except the provider that produced it */
  state: unknown
}

export interface Resolution {
  manifest: AssemblyManifest
  manifestHash: string
  resolver: PackageResolver
  /** every plugin the assembly accounts for, keyed and iterated by id */
  plugins: Map<string, ResolvedPlugin>
  /**
   * What runs, by id.
   *
   * Sorted so the generated entry list has stable bytes. The order carries no
   * initialisation meaning: cordis decides that from `inject`.
   */
  runtimePlugins: string[]
  /**
   * Each active plugin's default export, imported here.
   *
   * Resolution executes plugin modules now - the repeal of an older rule,
   * decided with the descriptor model (docs/plugin-descriptor-plan.md, M3b):
   * a descriptor is a pure value and importing it opens nothing, but it IS
   * TypeScript being run, and the runtime metadata that used to live in
   * package.json - dependencies, the config channel - lives on it.
   */
  descriptors: Map<string, PluginDescriptor>
  capabilities: Map<string, ResolvedCapability>
  /** loaded providers, for the commands that do work after resolution */
  providers: Map<string, LoadedProvider>
  /** capability key to plugin id to parsed contribution */
  contributions: Map<string, Map<string, unknown>>
}

export interface ResolveOptions {
  manifestPath: string
  /** defaults to the manifest's own directory, which is where the loader anchors */
  hostDir?: string
  previousLock?: AssemblyLock
}

export async function resolveAssembly(options: ResolveOptions): Promise<Resolution> {
  const manifest = readManifest(options.manifestPath)
  const resolver = createPackageResolver(options.hostDir ?? hostDirFor(manifest))
  const previous = options.previousLock

  const states = new Map<string, PluginState>()
  const metadata = new Map<string, PluginMetadata>()
  for (const [id, entry] of manifest.plugins) {
    states.set(id, entry.enabled ? 'active' : 'disabled')
    metadata.set(id, resolver.readMetadata(id))
  }

  // Providers come from the previous lock as well as the manifest. A plugin
  // that leaves the manifest together with the capability it contributed to
  // would otherwise find nobody left to ask whether it should be kept, and the
  // answer would default to no: every table-owning plugin would leave the lock
  // at once, silently, on the one edit this whole mechanism exists to survive.
  //
  // The capability sections are read as well as the plugin table, because a
  // provider plugin that owns no contribution of its own leaves the lock on the
  // resolve after its removal, and would then be undiscoverable on the one
  // after that.
  const candidates = new Map(metadata)
  const recalled = [
    ...Object.keys(previous?.plugins ?? {}),
    ...Object.values(previous?.capabilities ?? {}).map((capability) => capability.provider),
  ]
  for (const id of recalled) {
    if (candidates.has(id) || !resolver.isInstalled(id)) continue
    candidates.set(id, resolver.readMetadata(id))
  }
  // Every candidate's descriptor, imported before anything else is decided:
  // capability providers are declared on descriptors, and the candidate set -
  // manifest plus recalled - is exactly the set whose providers may have to
  // answer for this assembly. The repeal of "resolve does not import plugin
  // code" was decided with the descriptor model (docs/plugin-descriptor-plan.md,
  // M3b): a descriptor is a pure value and importing it opens nothing, but it
  // IS TypeScript being run. After the metadata reads above, so a package
  // whose manifest is malformed is reported as that rather than as a missing
  // descriptor.
  const candidateDescriptors = new Map<string, PluginDescriptor>()
  for (const id of candidates.keys()) {
    let module: { default?: unknown }
    try {
      module = (await import(resolver.resolveModuleUrl(id))) as { default?: unknown }
    } catch (error) {
      throw new Error(`failed to load the descriptor of ${id}`, { cause: error })
    }
    if (!isPluginDescriptor(module.default)) {
      throw new Error(`${id} does not default-export a plugin descriptor`)
    }
    if (module.default.id !== id) {
      // everything downstream is keyed by the package id, while errors and
      // extension ownership speak the descriptor's; a mismatch would let the
      // two vocabularies drift apart mid-sentence
      throw new Error(`${id} default-exports a descriptor that calls itself ${module.default.id}`)
    }
    candidateDescriptors.set(id, module.default)
  }
  const providers = await loadProviders(candidateDescriptors)

  const retainedBy = new Map<string, string[]>()
  const unanswerable: string[] = []
  for (const [id, locked] of Object.entries(previous?.plugins ?? {})) {
    if (states.has(id)) continue
    const claims: string[] = []
    for (const [key, contribution] of Object.entries(locked.contributions ?? {})) {
      const loaded = providers.get(key)
      if (!loaded) {
        // not "nothing was retained": nobody is left who could say
        unanswerable.push(
          `${id} contributed to capability ${key}, which nothing in this assembly provides`,
        )
        continue
      }
      if (loaded.provider.retainsPlugin?.({ pluginId: id, previousContribution: contribution })) {
        claims.push(key)
      }
    }
    // A plugin dropped from the manifest is kept only if some capability says
    // it left something behind. Keeping one that left nothing would park a
    // dead entry in the lock with no way to remove it, since taking it out of
    // the manifest is the only removal there is.
    if (claims.length === 0) continue
    states.set(id, 'detached')
    retainedBy.set(id, claims.sort())
  }
  if (unanswerable.length > 0) {
    throw new Error(
      `this assembly cannot account for what previous ones left behind:\n  ${unanswerable.join('\n  ')}\n` +
        'Put the plugin that provides that capability back in the manifest.',
    )
  }

  // A capability that is still holding something needs the plugin that
  // provides it, so that one is held too. Without this a provider taken out of
  // the manifest leaves the lock on the next resolve, and the resolve after
  // that has nobody left to ask: the same tree would succeed once and then
  // fail, having written a lock that referred to a plugin it had dropped.
  for (const claims of [...retainedBy.values()]) {
    for (const key of claims) {
      const owner = providers.get(key)!.pluginId
      if (states.has(owner)) continue
      states.set(owner, 'detached')
      retainedBy.set(owner, [key])
    }
  }

  const uninstalled: string[] = []
  for (const id of states.keys()) {
    if (metadata.has(id)) continue
    const known = candidates.get(id)
    if (!known) {
      uninstalled.push(`${id} (kept by ${retainedBy.get(id)?.join(', ')})`)
      continue
    }
    metadata.set(id, known)
  }
  if (uninstalled.length > 0) {
    throw new Error(
      `these plugins are gone from ${manifest.source} but something they left behind is still in place, and their packages are no longer installed:\n  ${uninstalled.join('\n  ')}\n` +
        'Reinstall them to keep resolving. What they own is untouched.',
    )
  }

  const runtimePlugins = [...states]
    .filter(([, state]) => state === 'active')
    .map(([id]) => id)
    .sort()

  // Contributions are parsed by the capability that owns the key. A key nobody
  // owns is a plugin asking for something this assembly cannot do, and the
  // honest time to say so is now rather than halfway through a deployment.
  const contributions = new Map<string, Map<string, unknown>>()
  const orphaned: string[] = []
  for (const [id, entry] of metadata) {
    // A top-level qualy key that names a capability is a contribution written
    // where contributions used to live. Ignoring it would leave the plugin
    // contributing nothing, and the first sign of that is whatever the
    // capability generates once the plugin has dropped out of its set.
    for (const key of entry.otherKeys) {
      if (!providers.has(key)) continue
      orphaned.push(`${id} declares qualy.${key}, which belongs under qualy.contributions.${key}`)
    }
    if (entry.declaresProvider) {
      // nothing reads it any more, and a plugin that believes it provides a
      // capability while the assembly disagrees is not a plugin to ignore
      orphaned.push(
        `${id} declares qualy.capabilityProvider in package.json, but capabilities are declared on the plugin descriptor now (Plugin.capability)`,
      )
    }
    for (const [key, raw] of Object.entries(entry.contributions)) {
      const loaded = providers.get(key)
      if (!loaded) {
        orphaned.push(
          `${id} contributes to capability ${key}, which no plugin in this assembly provides`,
        )
        continue
      }
      if (loaded.provider.contributionFromDescriptor) {
        // one source, not a fallback chain: this capability reads descriptors
        orphaned.push(
          `${id} declares qualy.contributions.${key} in package.json, but capability ${key} reads contributions from the plugin descriptor now`,
        )
        continue
      }
      const parsed = loaded.provider.parseContribution({
        pluginId: id,
        packageRoot: entry.dir,
        raw,
      })
      const perKey = contributions.get(key) ?? new Map<string, unknown>()
      perKey.set(id, parsed)
      contributions.set(key, perKey)
    }
  }
  if (orphaned.length > 0) {
    throw new Error(`incomplete assembly:\n  ${orphaned.join('\n  ')}`)
  }

  // Every accounted plugin's descriptor, not just the running set: a disabled
  // or detached plugin's declarations still shape the assembly - that is what
  // retained means - and its package is installed by the uninstalled-check
  // above, so its descriptor is in the candidate map.
  const providerOwners = new Set([...providers.values()].map((loaded) => loaded.pluginId))
  const descriptors = new Map<string, PluginDescriptor>()
  const misconfigured: string[] = []
  const orphanedFeatures: string[] = []
  for (const id of states.keys()) {
    const descriptor = candidateDescriptors.get(id)!
    descriptors.set(id, descriptor)
    // A contribution to a capability-owned channel needs that capability's
    // provider in the assembly. The point itself says which capability owns
    // it - the plugin imported the point object from the capability's own
    // module - so the core can refuse without knowing what the channel means.
    // Runtime-only channels carry no capability and are the boot assembler's
    // completeness rule to enforce; a capability's objects outlive the
    // process, so its answer cannot wait for a boot.
    for (const feature of descriptor.features) {
      if (feature._tag !== 'Contribute' || feature.point.capability === undefined) continue
      if (!providers.has(feature.point.capability)) {
        orphanedFeatures.push(
          `${id} contributes to capability ${feature.point.capability}, which no plugin in this assembly provides`,
        )
      }
    }
    // Descriptor-sourced contributions, for the capabilities that read them.
    for (const [key, loaded] of providers) {
      if (!loaded.provider.contributionFromDescriptor) continue
      const parsed = loaded.provider.contributionFromDescriptor({
        pluginId: id,
        descriptor,
        packageRoot: resolver.resolvePackageDir(id),
      })
      if (parsed === undefined) continue
      const perKey = contributions.get(key) ?? new Map<string, unknown>()
      perKey.set(id, parsed)
      contributions.set(key, perKey)
    }
    // A config block reaches exactly two kinds of plugin: a capability
    // provider, as providerConfig during work phases; and one whose
    // descriptor carries a config channel. On any other plugin nothing reads
    // it, and the manifest hash still changes, so resolve reports success
    // and a frozen start passes: the setting looks applied and is not.
    if (
      manifest.plugins.get(id)?.config !== undefined &&
      !providerOwners.has(id) &&
      descriptor.config === undefined
    ) {
      misconfigured.push(
        `${id} is given config in ${manifest.source}, but it neither provides a capability nor takes configuration in its descriptor, so nothing would read this. Configure this plugin through the environment instead.`,
      )
    }
  }
  if (misconfigured.length > 0) {
    throw new Error(misconfigured.join('\n'))
  }
  if (orphanedFeatures.length > 0) {
    throw new Error(`incomplete assembly:\n  ${orphanedFeatures.join('\n  ')}`)
  }

  // A plugin kept because of what it contributed has to still contribute it. A
  // package that stops declaring the key that is retaining it would be
  // forgotten on the next resolve, after its objects had already dropped out of
  // the capability's set. The plugin that PROVIDES the key is kept for a
  // different reason and contributes nothing of its own.
  const abandoned: string[] = []
  for (const [id, claims] of retainedBy) {
    for (const key of claims) {
      if (providers.get(key)?.pluginId === id) continue
      if (contributions.get(key)?.has(id)) continue
      abandoned.push(
        `${id} is kept by capability ${key} but its package no longer contributes to it`,
      )
    }
  }
  if (abandoned.length > 0) {
    throw new Error(
      `${abandoned.join('\n  ')}\nRestore the declaration, or put the plugin back in the manifest and remove what it owns first.`,
    )
  }

  const plugins = new Map<string, ResolvedPlugin>()
  for (const id of [...states.keys()].sort()) {
    const own: Record<string, unknown> = {}
    for (const key of [...contributions.keys()].sort()) {
      const contribution = contributions.get(key)!
      if (contribution.has(id)) own[key] = contribution.get(id)
    }
    plugins.set(id, {
      id,
      state: states.get(id)!,
      version: metadata.get(id)!.version,
      retainedBy: retainedBy.get(id),
      contributions: own,
    })
  }

  const capabilities = new Map<string, ResolvedCapability>()
  for (const key of [...providers.keys()].sort()) {
    const loaded = providers.get(key)!
    const owner = previous?.capabilities?.[key]?.provider
    if (owner && owner !== loaded.pluginId) {
      // the lock's state was written by a different package, and only the
      // package that wrote it knows what it means
      throw new Error(
        `capability ${key} was provided by ${owner} when the lock was written and is now provided by ${loaded.pluginId}`,
      )
    }
    const state = await loaded.provider.resolve({
      manifestPath: options.manifestPath,
      plugins,
      contributions: contributions.get(key) ?? new Map(),
      descriptors,
      resolvePackageDir: resolver.resolvePackageDir,
      previousState: previous?.capabilities?.[key]?.state,
    })
    capabilities.set(key, { key, provider: loaded.pluginId, state })
  }

  return {
    manifest,
    manifestHash: manifestHash(manifest),
    resolver,
    plugins,
    runtimePlugins,
    descriptors,
    capabilities,
    providers,
    contributions,
  }
}

/** what runs */
export const activePlugins = (resolution: Resolution) =>
  resolution.runtimePlugins.map((id) => resolution.plugins.get(id)!)

/**
 * Everything the assembly still accounts for: active, disabled and detached
 * alike. Switching a plugin off or taking it out of the manifest never makes
 * what it owns disappear.
 */
export const retainedPlugins = (resolution: Resolution) => [...resolution.plugins.values()]
