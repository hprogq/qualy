import { Context, Effect, Layer } from 'effect'
import { Assembled } from '@qualy/api-kit/assembled'
import { DeclaredBackends } from '../plugin.ts'
import { BackendNotConfigured, backendFailure, type BackendUnavailable } from '../errors.ts'
import type { StorageBackend } from './backend.ts'
import { StorageConfig } from './config.ts'

// Which store answers for which attachment.
//
// Every attachment records the backend that wrote it, and this is where that
// word turns back into something that can be asked about an object. It is a
// registry rather than a single service because a deployment that moves its
// default from a disk to a bucket must still be able to open everything it
// wrote before the move: one default for writing, every installed provider
// for reading.
//
// Registration happens while the providers' own layers build - they depend on
// core storage, so this exists by then - and the barrier below turns "declared
// but never registered" into a boot failure instead of a surprise upload.
//
// A provider given no credentials registers as not configured rather than
// failing the boot: a deployment that writes to a disk has no reason to stop
// for a bucket it does not use. It must not be the default, and an attachment
// it wrote reads as that store being unavailable, never as missing.

export class StorageBackends extends Context.Service<
  StorageBackends,
  {
    /** a provider offering itself, once, during its own layer's build */
    readonly register: (backend: StorageBackend) => Effect.Effect<void>
    /**
     * A provider taking part without the credentials to reach its store,
     * saying what it is missing. Refused at once when it is the default.
     */
    readonly unconfigured: (code: string, refusal: string) => Effect.Effect<void>
    /** the store an existing attachment names */
    readonly resolve: (code: string) => Effect.Effect<StorageBackend, BackendUnavailable>
    /** where new uploads go, which is a deployment's choice, not a caller's */
    readonly forWrite: Effect.Effect<StorageBackend, BackendUnavailable>
    /** the providers that can reach their store */
    readonly installed: Effect.Effect<readonly string[]>
    /** the providers taking part without credentials */
    readonly unconfiguredCodes: Effect.Effect<readonly string[]>
  }
>()('@qualy/plugin-storage/StorageBackends') {}

export const registryLayer: Layer.Layer<StorageBackends, never, StorageConfig> = Layer.effect(
  StorageBackends,
  Effect.gen(function* () {
    const config = yield* StorageConfig
    const backends = new Map<string, StorageBackend>()
    /** what each provider without credentials said it is missing */
    const refusals = new Map<string, string>()

    const resolve = (code: string) =>
      Effect.suspend(() => {
        const backend = backends.get(code)
        if (backend !== undefined) return Effect.succeed(backend)
        const refusal = refusals.get(code)
        return Effect.fail(
          refusal === undefined
            ? // not a domain refusal: the object exists and this deployment
              // has been assembled without the plugin that can reach it
              backendFailure(
                'resolve',
                new Error(`no storage backend named "${code}" is installed`),
              )
            : new BackendNotConfigured(code, refusal),
        )
      })

    const taken = (code: string) =>
      backends.has(code) || refusals.has(code)
        ? Effect.die(new Error(`two storage backends registered as "${code}"`))
        : undefined

    return StorageBackends.of({
      register: (backend) =>
        Effect.suspend(() => {
          const twice = taken(backend.code)
          if (twice !== undefined) return twice
          backends.set(backend.code, backend)
          return Effect.logDebug(`storage backend "${backend.code}" registered`)
        }),
      unconfigured: (code, refusal) =>
        Effect.suspend(() => {
          const twice = taken(code)
          if (twice !== undefined) return twice
          // said here rather than at the barrier, in the provider's words,
          // before anything else in the boot hides it
          if (code === config.defaultBackend) {
            return Effect.die(
              new Error(`the default storage backend "${code}" is not configured: ${refusal}`),
            )
          }
          refusals.set(code, refusal)
          return Effect.logDebug(
            `storage backend "${code}" takes part without credentials; its attachments cannot be read`,
          )
        }),
      resolve,
      forWrite: resolve(config.defaultBackend),
      installed: Effect.sync(() => [...backends.keys()]),
      unconfiguredCodes: Effect.sync(() => [...refusals.keys()]),
    })
  }),
)

/**
 * Refuses to finish starting with a storage layer that cannot store anything.
 *
 * Two ways it goes wrong, and both are configuration rather than code: the
 * manifest names a default backend whose plugin is not selected, or a selected
 * provider declared a backend its layer never registered. Either way the first
 * person to hit it would otherwise be a student with a file, at the one moment
 * the answer cannot be "try again later".
 */
export const barrierLayer: Layer.Layer<
  never,
  never,
  StorageBackends | StorageConfig | DeclaredBackends | Assembled
> = Layer.effectDiscard(
  Effect.gen(function* () {
    const assembled = yield* Assembled
    const registry = yield* StorageBackends
    const declared = yield* DeclaredBackends
    const config = yield* StorageConfig
    yield* assembled.register({
      name: 'storage/backends',
      run: Effect.gen(function* () {
        const installed = yield* registry.installed
        const unconfigured = yield* registry.unconfiguredCodes
        const missing = declared
          .filter(
            (declaration) =>
              !installed.includes(declaration.code) && !unconfigured.includes(declaration.code),
          )
          .map((declaration) => `${declaration.code} (${declaration.pluginId})`)
        if (missing.length > 0) {
          return yield* Effect.die(
            new Error(`storage backends declared but never registered: ${missing.join(', ')}`),
          )
        }
        if (!installed.includes(config.defaultBackend)) {
          return yield* Effect.die(
            new Error(
              `the default storage backend "${config.defaultBackend}" is not installed; selected: ${
                installed.join(', ') || 'none'
              }`,
            ),
          )
        }
        yield* Effect.logDebug(
          `storage writing to "${config.defaultBackend}"; installed: ${installed.join(', ')}${
            unconfigured.length === 0 ? '' : `; without credentials: ${unconfigured.join(', ')}`
          }`,
        )
      }),
    })
  }),
)
