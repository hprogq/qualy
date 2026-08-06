import { Effect, Layer } from 'effect'
import {
  Assembled,
  assembledBarrier,
  assembledLayer,
  type BootHookFailed,
} from '@qualy/api-kit/assembled'
import { makeSystemActor, type SystemActor } from './system-actor.ts'
import type { ActivePermission } from './index.ts'
import { Permissions } from './effect.ts'

// The trusted caller, available only here.
//
// A test that exercises domain logic without building an authorization graph
// passes this instead of omitting an argument, so "trusted" is something a
// call says rather than something it fails to say. Production code cannot
// import a testkit, which is what keeps this out of reach of a request.

export const systemActor: SystemActor = makeSystemActor()

/**
 * A test's permission catalog, declared the way plugins declare theirs.
 *
 * Row by row rather than in one call, because a fixture catalog mixes owners:
 * the tests state which plugin a code belongs to, and the registry stamps the
 * owner it is given.
 */
export const declareCatalog = (
  catalog: readonly ActivePermission[],
): Layer.Layer<never, never, Permissions> =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const registry = yield* Permissions
      for (const permission of catalog) {
        const { plugin, ...definition } = permission
        yield* registry.declare(plugin, [definition])
      }
    }),
  )

/**
 * The order a production host builds, in one call for a harness: the
 * assembled registry below the services, the barrier after them, and a
 * fixture catalog declared in between when the test brings one.
 *
 * Without the barrier the permission table is never mirrored and every
 * authorization test fails loudly - which is the point: a harness cannot
 * accidentally test an order production does not run.
 */
export const booted = <ROut, E, RIn>(
  services: Layer.Layer<ROut, E, RIn>,
  options: { catalog?: readonly ActivePermission[] } = {},
): Layer.Layer<ROut, E | BootHookFailed, Exclude<RIn, Assembled>> => {
  const supplied = services.pipe(Layer.provideMerge(assembledLayer))
  // the declarations and the barrier both reach into the same built stack;
  // layers are memoized, so this is one build observed three ways
  const declared = options.catalog ? declareCatalog(options.catalog) : Layer.empty
  const barrier = assembledBarrier.pipe(Layer.provide(declared), Layer.provide(supplied))
  return Layer.merge(supplied, barrier) as Layer.Layer<
    ROut,
    E | BootHookFailed,
    Exclude<RIn, Assembled>
  >
}
