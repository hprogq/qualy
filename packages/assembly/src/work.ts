import type { CapabilityWorkContext } from '@qualy/assembly-contract'
import type { Resolution } from './resolve.ts'

// The context handed to a provider for the phases that do work rather than
// resolve: generate writes local artifacts, deploy applies them, and a
// capability's own commands do whatever only that capability can do.
//
// It is built here rather than in the CLI so every caller passes a provider
// the same thing, and so the core never has to name a capability to construct
// one.

export interface CapabilityWork {
  key: string
  pluginId: string
  run(phase: 'generate' | 'deploy', args?: readonly string[]): Promise<boolean>
  command(name: string, args: readonly string[]): Promise<boolean>
}

export function capabilityContext(
  resolution: Resolution,
  key: string,
  args: readonly string[] = [],
): CapabilityWorkContext<unknown, unknown> {
  const loaded = resolution.providers.get(key)
  if (!loaded) throw new Error(`no provider for capability ${key}`)
  return {
    manifestPath: resolution.manifest.source,
    providerConfig: resolution.manifest.plugins.get(loaded.pluginId)?.config,
    plugins: resolution.plugins,
    contributions: resolution.contributions.get(key) ?? new Map(),
    descriptors: resolution.descriptors,
    resolvePackageDir: resolution.resolver.resolvePackageDir,
    state: resolution.capabilities.get(key)?.state,
    args,
  }
}

/** every capability in this assembly, in a deterministic order */
export function capabilityWork(resolution: Resolution): CapabilityWork[] {
  return [...resolution.providers.keys()].sort().map((key) => {
    const loaded = resolution.providers.get(key)!
    return {
      key,
      pluginId: loaded.pluginId,
      async run(phase, args = []) {
        const step = loaded.provider[phase]
        if (!step) return false
        await step(capabilityContext(resolution, key, args))
        return true
      },
      async command(name, args) {
        const handler = loaded.provider.commands?.[name]
        if (!handler) return false
        await handler(capabilityContext(resolution, key, args))
        return true
      },
    }
  })
}
