import path from 'node:path'
import { Layer } from 'effect'
import { runtimeLayers, runtimeLevels, type Resolution } from '@qualy/assembly'
import { Plugin, type AnyLayer, type PluginDescriptor } from '@qualy/plugin-kit'
import { assemble, type Assembled } from '@qualy/plugin-kit/assemble'

// The host's half of the descriptor model: from a verified resolution to the
// four layers the composition root serves from.
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

/**
 * Every active plugin's descriptor, in dependency order.
 *
 * The descriptors were imported by resolution - a plugin IS its default
 * export now - so this only orders them: `runtimeLevels` is the same
 * topology the generator used to render, the assembler folds service layers
 * in list order, and a flattened level walk is a valid linearization.
 */
export function loadAssembly(
  resolution: Resolution,
  options: { readonly host?: readonly PluginDescriptor[] } = {},
): LoadedAssembly {
  const manifestDir = path.dirname(resolution.manifest.source)
  const order = runtimeLevels(runtimeLayers(resolution)).flat()

  const descriptors: PluginDescriptor[] = []
  const configs: AnyLayer[] = []
  for (const entry of order) {
    const descriptor = resolution.descriptors.get(entry.id)!
    descriptors.push(descriptor)
    if (entry.config !== undefined) {
      // presence was validated at resolve; the channel turns the block into
      // the plugin's own config service
      configs.push(descriptor.config!(entry.config, { manifestDir }))
    }
  }

  const assembled = assemble([...descriptors, ...(options.host ?? [])])
  return {
    ...assembled,
    configs: Layer.mergeAll(Layer.empty, ...configs),
  }
}

export { Plugin }
