import type { AssemblyCapabilityProvider } from '@qualy/assembly-contract'
import type { PluginDescriptor } from '@qualy/plugin-kit'

// Capability providers are discovered, not configured: a plugin's descriptor
// declares that it owns a capability, and the assembly imports its provider
// when that plugin is part of the assembly.
//
// The provider arrives as a lazy import on the feature, separate from the
// plugin's runtime, because this load happens inside a CLI with no server
// context and no intention of connecting to anything - and never happens at
// boot, so a server does not pay for a migrator it will not run. A provider
// module that started a service or opened a pool at import time would make
// `qualy resolve` do both.

export interface LoadedProvider {
  /** the plugin that owns this capability */
  pluginId: string
  provider: AssemblyCapabilityProvider
}

export async function loadProviders(
  descriptors: ReadonlyMap<string, PluginDescriptor>,
): Promise<Map<string, LoadedProvider>> {
  // one key, one owner: two providers would each write the same lock section
  // and neither could be said to own it. Settled from the declarations, before
  // anything is imported, so the conflict is reported as a conflict rather
  // than as whatever the first module happens to do.
  const declarations = new Map<string, { pluginId: string; load: () => Promise<unknown> }>()
  for (const [id, descriptor] of descriptors) {
    for (const feature of descriptor.features) {
      if (feature._tag !== 'Capability') continue
      const previous = declarations.get(feature.key)
      if (previous) {
        throw new Error(
          `capability ${feature.key} is provided by both ${previous.pluginId} and ${id}`,
        )
      }
      declarations.set(feature.key, { pluginId: id, load: feature.load })
    }
  }

  const providers = new Map<string, LoadedProvider>()
  for (const [key, declared] of declarations) {
    const module = (await declared.load()) as { default?: AssemblyCapabilityProvider } | undefined
    const provider = module?.default
    if (!provider || typeof provider.parseContribution !== 'function') {
      throw new Error(
        `${declared.pluginId}: the module behind Plugin.capability('${key}', ...) must default-export a capability provider`,
      )
    }
    if (provider.key !== key) {
      throw new Error(
        `${declared.pluginId}: the descriptor declares capability ${key} but its provider module provides ${provider.key}`,
      )
    }
    providers.set(key, { pluginId: declared.pluginId, provider })
  }
  return providers
}
