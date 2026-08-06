import { Layer } from 'effect'
import {
  Assembled,
  assembledBarrier,
  assembledLayer,
  type BootHookFailed,
} from '@qualy/api-kit/assembled'
import { makeSystemActor, type SystemActor } from './system-actor.ts'
import type { ActivePermission } from './index.ts'
import { PermissionCatalog } from './effect.ts'

// The trusted caller, available only here.
//
// A test that exercises domain logic without building an authorization graph
// passes this instead of omitting an argument, so "trusted" is something a
// call says rather than something it fails to say. Production code cannot
// import a testkit, which is what keeps this out of reach of a request.

export const systemActor: SystemActor = makeSystemActor()

/**
 * The order a production host builds, in one call for a harness: the catalog
 * below the services - a prepare-phase value, exactly as the assembler
 * compiles it - the assembled registry beside it, and the barrier after them.
 *
 * Without the barrier the permission table is never mirrored and every
 * authorization test fails loudly - which is the point: a harness cannot
 * accidentally test an order production does not run.
 */
export const booted = <ROut, E, RIn>(
  services: Layer.Layer<ROut, E, RIn>,
  options: { catalog?: readonly ActivePermission[] } = {},
): Layer.Layer<ROut, E | BootHookFailed, Exclude<RIn, Assembled | PermissionCatalog>> => {
  const supplied = services.pipe(
    Layer.provideMerge(assembledLayer),
    Layer.provide(Layer.succeed(PermissionCatalog, options.catalog ?? [])),
  )
  const barrier = assembledBarrier.pipe(Layer.provide(supplied))
  return Layer.merge(supplied, barrier) as Layer.Layer<
    ROut,
    E | BootHookFailed,
    Exclude<RIn, Assembled | PermissionCatalog>
  >
}
