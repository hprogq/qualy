import type { AssemblyCapabilityProvider } from '@qualy/assembly-contract'
import type { PackageResolver, PluginMetadata } from './metadata.ts'

// Capability providers are discovered, not configured: a plugin declares that
// it owns a capability, and the assembly loads its provider entry when that
// plugin is part of the assembly.
//
// The entry is a separate subpath export from the plugin's runtime, because
// this import happens inside a CLI with no cordis context and no intention of
// connecting to anything. A provider module that started a service or opened a
// pool at import time would make `qualy resolve` do both.

export interface LoadedProvider {
  /** the plugin that owns this capability */
  pluginId: string
  provider: AssemblyCapabilityProvider
}

export async function loadProviders(
  metadata: Iterable<PluginMetadata>,
  resolver: PackageResolver,
): Promise<Map<string, LoadedProvider>> {
  // one key, one owner: two providers would each write the same lock section
  // and neither could be said to own it. Settled from the declarations, before
  // anything is imported, so the conflict is reported as a conflict rather
  // than as whatever the first module happens to do.
  const declarations = new Map<string, PluginMetadata>()
  for (const entry of metadata) {
    if (!entry.provider) continue
    const previous = declarations.get(entry.provider.key)
    if (previous) {
      throw new Error(
        `capability ${entry.provider.key} is provided by both ${previous.id} and ${entry.id}`,
      )
    }
    declarations.set(entry.provider.key, entry)
  }

  const providers = new Map<string, LoadedProvider>()
  for (const entry of declarations.values()) {
    const declared = entry.provider!
    const specifier = `${entry.id}/${declared.entry.replace(/^\.\//, '')}`
    const module = (await import(resolver.resolveModuleUrl(specifier))) as {
      default?: AssemblyCapabilityProvider
    }
    const provider = module.default
    if (!provider || typeof provider.parseContribution !== 'function') {
      throw new Error(`${entry.id}: ${specifier} must default-export a capability provider`)
    }
    if (provider.key !== declared.key) {
      throw new Error(
        `${entry.id}: package.json declares capability ${declared.key} but ${specifier} provides ${provider.key}`,
      )
    }
    providers.set(declared.key, { pluginId: entry.id, provider })
  }
  return providers
}
