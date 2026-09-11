import { ConfigProvider, Layer } from 'effect'
import { Plugin, type AnyLayer } from '@qualy/plugin-kit'
import type { Assembled as AssembledLayers } from '@qualy/plugin-kit/assemble'
import { Api } from './plugin.ts'
import { assembledLayer } from './assembled.ts'
import { readinessLayer } from './readiness.ts'

// The assembly's services without the server around them.
//
// A runtime-tier CLI command needs what a request handler needs - the
// plugins' services, built over their own configuration - and none of what
// the server adds to serve them. So this composes exactly the graph the
// composition root feeds its router, and stops:
//
//   no port         - `above` is never built; routes and raw routes stay values
//   no boot hook    - the registry every plugin registers into is provided,
//                     and the barrier that runs what registered is never
//                     composed: no catalog mirrored, no sweep, no loop forked
//   no migration    - the database plugin reads its mode through `Config`,
//                     and the provider beneath this graph answers `off`
//                     whatever the environment said; the host refuses an
//                     explicit `apply` before it ever gets here
//
// The sink descriptor exists for the assembler: every api-bearing plugin
// contributes to the two points a host provides, and an assembly with a
// contribution nobody provides is refused by name.

/** the host descriptor a headless build passes: provides the api points, serves nothing */
export const headlessHost = Plugin.define('@qualy/headless', Api.provider(), Api.routesProvider)

/**
 * The runtime phase over the services over the prepared catalogs, merged:
 * a command reaches a service of any phase from the one context this builds.
 */
export const headlessGraph = (
  loaded: AssembledLayers & { readonly configs: AnyLayer },
  options: { readonly env: Readonly<Record<string, string | undefined>> },
): AnyLayer => {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.env)) {
    if (value !== undefined) env[key] = value
  }
  // pinned here as well as refused by the host: whatever runs a headless
  // graph, it does not apply a lineage
  env.QUALY_MIGRATIONS = 'off'
  return loaded.runtime.pipe(
    Layer.provideMerge(loaded.services),
    Layer.provideMerge(loaded.prepared),
    Layer.provideMerge(readinessLayer),
    Layer.provideMerge(assembledLayer),
    // merged, not only provided: a command may read a plugin's own settings
    Layer.provideMerge(loaded.configs),
    // beneath everything: every `Config` read in every plugin sees one snapshot
    Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
  ) as AnyLayer
}
