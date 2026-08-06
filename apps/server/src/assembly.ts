import path from 'node:path'
import { Layer } from 'effect'
import { runtimeLayers, runtimeLevels, type Resolution } from '@qualy/assembly'
import { Plugin, isPluginDescriptor, type AnyLayer, type PluginDescriptor } from '@qualy/plugin-kit'
import { assemble, type Assembled } from '@qualy/plugin-kit/assemble'

// The host's half of the descriptor model: from a verified resolution to the
// three layers the composition root serves from.
//
// This file replaced a generated module. What the generator wrote as static
// imports and a rendered composition, this does at boot: import each active
// plugin's default descriptor in dependency order, hand each configured
// plugin its own manifest block, and let the phase assembler do the rest.
// The lock is still the authority on what is loaded - the resolution comes
// from the same verification the generated module was checked against - and
// the host still names no plugin: the ids are the lock's strings.
//
// What was lost with the generator is the compile-time proof that the
// composition closes. That is the model's declared cost: each plugin's own
// layer stays fully typed where it is written, and whether the assembly
// closes is answered by the boot - which the dev loop runs constantly and CI
// runs against a real database.

export interface LoadedAssembly extends Assembled {
  /** each configured plugin's manifest block, as the service its config export builds */
  readonly configs: AnyLayer
}

interface EntryModule {
  readonly default?: unknown
  readonly config?: (block: unknown, context: { readonly manifestDir: string }) => AnyLayer
}

/**
 * Every active plugin's descriptor, imported in dependency order.
 *
 * The order comes from `runtimeLevels`, the same topology the generator
 * rendered: the assembler folds service layers in list order, and a
 * flattened level walk is a valid linearization of the dependency graph.
 */
export async function loadAssembly(
  resolution: Resolution,
  options: { readonly host?: readonly PluginDescriptor[] } = {},
): Promise<LoadedAssembly> {
  const manifestDir = path.dirname(resolution.manifest.source)
  const plan = runtimeLayers(resolution)
  const order = runtimeLevels(plan).flat()

  const descriptors: PluginDescriptor[] = []
  const configs: AnyLayer[] = []
  for (const entry of order) {
    const module = (await import(entry.specifier)) as EntryModule
    if (!isPluginDescriptor(module.default)) {
      throw new Error(`${entry.id} does not default-export a plugin descriptor`)
    }
    descriptors.push(module.default)
    if (entry.config !== undefined) {
      if (typeof module.config !== 'function') {
        throw new Error(`${entry.id} declares qualy.runtime.config but exports no config`)
      }
      configs.push(module.config(entry.config, { manifestDir }))
    }
  }

  const assembled = assemble([...descriptors, ...(options.host ?? [])])
  return {
    ...assembled,
    configs: Layer.mergeAll(Layer.empty, ...configs),
  }
}

export { Plugin }
