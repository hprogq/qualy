import { inspect } from 'node:util'
import { Effect, Exit, Layer } from 'effect'
import { databaseFor } from '@qualy/plugin-database/testkit'
import type { Orm } from '@qualy/plugin-database/server'
import { entities } from '../../src/db/entities.ts'
import { DEFAULT_LIMITS, StorageConfig, type StorageLimits } from '../../src/server/config.ts'
import { registryLayer, StorageBackends } from '../../src/server/registry.ts'
import { serviceLayer, Storage } from '../../src/server/service.ts'
import { cleanupLayer, StorageCleanup } from '../../src/server/cleanup.ts'
import { backendLayer, memoryBackend, type MemoryBackend } from '../../src/testkit/index.ts'

// The plugin as the host builds it, minus the parts a test cannot have: no
// assembly barrier, and a backend that keeps objects in a map.
//
// The memory backend is the point. These suites are about what the service
// does - what it charges, what it refuses, what it writes down - and a real
// disk would only add ways for them to fail that have nothing to do with that.

export const stack = (url: string, backend: MemoryBackend, limits: Partial<StorageLimits> = {}) => {
  const config = Layer.succeed(StorageConfig, {
    defaultBackend: backend.code,
    limits: { ...DEFAULT_LIMITS, ...limits },
  })
  const registered = backendLayer(backend).pipe(
    Layer.provideMerge(registryLayer),
    Layer.provideMerge(config),
  )
  return Layer.mergeAll(serviceLayer, cleanupLayer).pipe(
    Layer.provideMerge(registered),
    Layer.provideMerge(databaseFor(url, { entities: [...entities] })),
  )
}

export const run = <A, E>(
  url: string,
  backend: MemoryBackend,
  effect: Effect.Effect<A, E, Storage | StorageCleanup | StorageBackends | Orm>,
  limits: Partial<StorageLimits> = {},
) => Effect.runPromiseExit(Effect.provide(effect, stack(url, backend, limits)))

export const ok = <A, E>(exit: Exit.Exit<A, E>): A => {
  if (Exit.isSuccess(exit)) return exit.value
  throw new Error(`expected success, got ${inspect(exit.cause, { depth: 10 })}`)
}

const reasonsOf = (exit: Exit.Exit<unknown, unknown>): readonly { error?: unknown }[] =>
  Exit.isFailure(exit)
    ? ((exit.cause as { reasons?: readonly { error?: unknown }[] }).reasons ?? [])
    : []

export const tagOf = (exit: Exit.Exit<unknown, unknown>): string | undefined =>
  reasonsOf(exit)
    .map((entry) => (entry.error as { _tag?: string } | undefined)?._tag)
    .find((tag) => tag !== undefined)

export const reasonIn = (exit: Exit.Exit<unknown, unknown>): string | undefined =>
  reasonsOf(exit)
    .map((entry) => (entry.error as { reason?: string } | undefined)?.reason)
    .find((reason) => reason !== undefined)

export { memoryBackend }
