import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { assembledLayer, runBootHooks } from '@qualy/api-kit/assembled'
import { DeclaredBackends } from '../src/plugin.ts'
import { DEFAULT_LIMITS, StorageConfig } from '../src/server/config.ts'
import { barrierLayer, registryLayer, StorageBackends } from '../src/server/registry.ts'
import { memoryBackend } from '../src/testkit/index.ts'
import { registerUploadDriver, upload, loadedUploadDrivers } from '../src/client/index.ts'

// Which store answers, and what happens when the answer is nobody.
//
// This is the whole of what the provider split added, so it is the whole of
// what can newly go wrong: a deployment writing to a backend it did not
// install, a provider that declared itself and forgot to register, and two
// plugins claiming one name. Every one of them is a configuration mistake that
// would otherwise surface as a failed upload rather than a failed start.

const config = (defaultBackend: string) =>
  Layer.succeed(StorageConfig, { defaultBackend, limits: DEFAULT_LIMITS })

const run = <A, E>(effect: Effect.Effect<A, E, StorageBackends>, defaultBackend = 'memory') =>
  Effect.runPromiseExit(
    Effect.provide(effect, registryLayer.pipe(Layer.provide(config(defaultBackend)))),
  )

describe('the storage backend registry', () => {
  it('sends new uploads to the backend the deployment names', async () => {
    const backend = memoryBackend()
    const exit = await run(
      Effect.gen(function* () {
        const registry = yield* StorageBackends
        yield* registry.register(backend)
        return yield* registry.forWrite
      }),
    )
    expect(Exit.isSuccess(exit) && exit.value.code).toBe('memory')
  })

  it('sends an existing attachment to the backend that wrote it', async () => {
    const disk = memoryBackend('local')
    const cloud = memoryBackend('cos')
    const exit = await run(
      Effect.gen(function* () {
        const registry = yield* StorageBackends
        yield* registry.register(disk)
        yield* registry.register(cloud)
        // the deployment writes to the cloud now; this attachment predates that
        return yield* registry.resolve('local')
      }),
      'cos',
    )
    expect(Exit.isSuccess(exit) && exit.value.code).toBe('local')
  })

  it('refuses to guess when the named backend is not installed', async () => {
    const exit = await run(Effect.flatMap(StorageBackends, (registry) => registry.resolve('cos')))
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('refuses two plugins claiming one backend name', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const registry = yield* StorageBackends
        yield* registry.register(memoryBackend('local'))
        yield* registry.register(memoryBackend('local'))
      }),
      'local',
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

const barrier = (declared: readonly { code: string; uploadDriver: string; pluginId: string }[]) =>
  barrierLayer.pipe(
    Layer.provideMerge(registryLayer),
    Layer.provideMerge(Layer.succeed(DeclaredBackends, declared)),
    Layer.provideMerge(assembledLayer),
  )

/** builds the layer and runs what registered at the barrier, as a host does */
const boot = (
  declared: readonly { code: string; uploadDriver: string; pluginId: string }[],
  defaultBackend: string,
  register: readonly string[],
) =>
  Effect.runPromiseExit(
    Effect.scoped(
      Effect.gen(function* () {
        const registry = yield* StorageBackends
        for (const code of register) yield* registry.register(memoryBackend(code))
        yield* runBootHooks
      }).pipe(Effect.provide(barrier(declared).pipe(Layer.provide(config(defaultBackend))))),
    ),
  )

describe('what the assembly refuses to start with', () => {
  it('starts when the default backend is installed', async () => {
    const exit = await boot(
      [{ code: 'local', uploadDriver: 'local', pluginId: '@qualy/plugin-storage-local' }],
      'local',
      ['local'],
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it('refuses a default backend nobody provides', async () => {
    const exit = await boot(
      [{ code: 'local', uploadDriver: 'local', pluginId: '@qualy/plugin-storage-local' }],
      'cos',
      ['local'],
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('refuses a provider that declared a backend and never registered it', async () => {
    const exit = await boot(
      [
        { code: 'local', uploadDriver: 'local', pluginId: '@qualy/plugin-storage-local' },
        { code: 'cos', uploadDriver: 'cos', pluginId: '@qualy/plugin-storage-cos' },
      ],
      'local',
      ['local'],
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

describe('the browser side of the same question', () => {
  it('spends a grant with the driver the server named', async () => {
    const spent: string[] = []
    registerUploadDriver({
      driver: 'test-driver',
      upload: async (grant) => {
        spent.push((grant.payload as { key: string }).key)
      },
    })

    await upload(
      {
        reservationId: 'r1',
        attachmentId: 'a1',
        expiresAt: 0,
        grant: { driver: 'test-driver', payload: { key: 'attachments/t/a' } },
      },
      new Blob(['bytes']),
    )

    expect(spent).toEqual(['attachments/t/a'])
    expect(loadedUploadDrivers()).toContain('test-driver')
  })

  it('says so plainly when the bundle carries no driver for the grant', async () => {
    await expect(
      upload(
        {
          reservationId: 'r1',
          attachmentId: 'a1',
          expiresAt: 0,
          grant: { driver: 'not-bundled', payload: {} },
        },
        new Blob(['bytes']),
      ),
    ).rejects.toThrow('not-bundled')
  })
})
