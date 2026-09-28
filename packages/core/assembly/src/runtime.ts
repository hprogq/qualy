import path from 'node:path'
import { Cause, Context, Effect, Exit, Layer } from 'effect'
import type { AnyLayer, PluginDescriptor } from '@qualy/plugin-kit'
import { assemble, type Assembled } from '@qualy/plugin-kit/assemble'
import { runtimeLayers, runtimeLevels } from './runtime-plan.ts'
import type { Resolution } from './resolve.ts'

// From a verified resolution to the layers a host builds from.
//
// Two hosts share this: the server, which serves the four layers over a port,
// and the CLI's runtime tier, which builds three of them for one command and
// closes the scope. Neither names a plugin - the ids are the lock's strings -
// and neither knows what the other does around the layers, which is why the
// composition itself stops here.
//
// This file replaced a generated module. What the generator wrote as static
// imports and a rendered composition, this does at load: order each active
// plugin's default descriptor by dependency, hand each configured plugin its
// own manifest block, and let the phase assembler do the rest. What was lost
// with the generator is the compile-time proof that the composition closes.
// That is the model's declared cost: each plugin's own layer stays fully
// typed where it is written, and whether the assembly closes is answered by
// the build - which the dev loop runs constantly and CI runs against a real
// database.

export interface LoadedAssembly extends Assembled {
  /** each configured plugin's manifest block, as the service its config export builds */
  readonly configs: AnyLayer
}

/**
 * Every plugin whose configuration was refused, each in its own words.
 *
 * A deployment missing three settings used to learn of them one start at a
 * time: the configuration layers were built together and the first refusal
 * ended the build. Now all of them are built, and the start fails once,
 * naming every plugin that refused and why.
 */
export class ConfigurationRefused extends Error {
  readonly _tag = 'ConfigurationRefused'
  readonly refusals: readonly { readonly plugin: string; readonly reason: string }[]
  constructor(refusals: readonly { readonly plugin: string; readonly reason: string }[]) {
    super(
      `the configuration of ${String(refusals.length)} plugin(s) was refused:\n${refusals
        .map((refusal) => `  ${refusal.plugin}: ${refusal.reason}`)
        .join('\n')}`,
    )
    this.name = 'ConfigurationRefused'
    this.refusals = refusals
  }
}

/** a refusal's own words on one line: a config error says which variable */
const reasonOf = (cause: Cause.Cause<unknown>) => {
  const error = Cause.squash(cause)
  return (error instanceof Error ? error.message : String(error)).replace(/\s*\n\s*/g, ' ')
}

/** builds every plugin's configuration, and refuses once with all that failed */
const configurationOf = (
  configs: readonly { readonly plugin: string; readonly layer: AnyLayer }[],
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      const built = yield* Effect.forEach(
        configs,
        ({ plugin, layer }) =>
          Effect.map(Effect.exit(Layer.build(layer)), (exit) => ({ plugin, exit })),
        { concurrency: 'unbounded' },
      )
      const refusals = built.flatMap(({ plugin, exit }) =>
        Exit.isFailure(exit) ? [{ plugin, reason: reasonOf(exit.cause) }] : [],
      )
      if (refusals.length > 0) return yield* Effect.fail(new ConfigurationRefused(refusals))
      return Context.mergeAll(
        ...built.flatMap(({ exit }) => (Exit.isSuccess(exit) ? [exit.value] : [])),
      )
    }),
  ) as AnyLayer

/**
 * Every active plugin's descriptor, in dependency order.
 *
 * The descriptors were imported by resolution - a plugin IS its default
 * export now - so this only orders them: `runtimeLevels` is the same
 * topology the generator used to render, the assembler folds service layers
 * in list order, and a flattened level walk is a valid linearization. The
 * host appends its own descriptors - the ones providing what every
 * api-bearing plugin contributes to - so that the assembler finds a
 * provider for every point, whether or not the host ever builds it.
 */
export function loadAssembly(
  resolution: Resolution,
  options: { readonly host?: readonly PluginDescriptor[] } = {},
): LoadedAssembly {
  const manifestDir = path.dirname(resolution.manifest.source)
  const order = runtimeLevels(runtimeLayers(resolution)).flat()

  const descriptors: PluginDescriptor[] = []
  const configs: { plugin: string; layer: AnyLayer }[] = []
  for (const entry of order) {
    const descriptor = resolution.descriptors.get(entry.id)!
    descriptors.push(descriptor)
    if (entry.config !== undefined) {
      // presence was validated at resolve; the channel turns the block into
      // the plugin's own config service
      configs.push({ plugin: entry.id, layer: descriptor.config!(entry.config, { manifestDir }) })
    }
  }

  const assembled = assemble([...descriptors, ...(options.host ?? [])])
  return {
    ...assembled,
    configs: configurationOf(configs),
  }
}
