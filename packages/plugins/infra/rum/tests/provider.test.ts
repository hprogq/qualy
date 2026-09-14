import { Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Contributed, ProvideExtension } from '@qualy/plugin-kit'
import { assembledLayer, runBootHooks } from '@qualy/api-kit/assembled'
import { DeclaredRumProvider, Rum, type RumProviderDeclaration } from '../src/plugin.ts'
import { barrierLayer, registryLayer, RumProviders } from '../src/server/registry.ts'

// Who reports, and what happens when the answer is nobody - or two.
//
// One provider at most is the rule this capability adds, and it is the rule
// with teeth: every vendor sdk takes over the same globals, so two of them
// means each failure reported twice and each sdk's patch wrapping the other's.
// Deciding that by load order would be deciding it by accident, so the
// assembly refuses it by name instead.

// the provider values are typed as the descriptor union; a test narrows the
// same way the assembler does before compiling
const compileOf = (provider: unknown) => (provider as ProvideExtension).compile

const declaredOf = (contributions: readonly Contributed<RumProviderDeclaration>[]) =>
  Effect.runSync(
    DeclaredRumProvider.pipe(
      Effect.provide(
        compileOf(Rum.owner)(contributions) as Layer.Layer<DeclaredRumProvider>,
      ),
    ),
  )

const contribution = (pluginId: string, code: string): Contributed<RumProviderDeclaration> =>
  ({ pluginId, value: { code } }) as Contributed<RumProviderDeclaration>

describe('choosing a reporting provider', () => {
  it('is content with none: a deployment may report nowhere', () => {
    expect(declaredOf([])).toBeNull()
  })

  it('takes the one that was declared', () => {
    expect(declaredOf([contribution('@qualy/plugin-rum-tencent', 'tencent')])).toEqual({
      code: 'tencent',
      pluginId: '@qualy/plugin-rum-tencent',
    })
  })

  it('refuses two, and names them both', () => {
    expect(() =>
      declaredOf([
        contribution('@qualy/plugin-rum-tencent', 'tencent'),
        contribution('@qualy/plugin-rum-sentry', 'sentry'),
      ]),
    ).toThrow(/@qualy\/plugin-rum-tencent, @qualy\/plugin-rum-sentry/)
  })
})

const run = <A, E>(effect: Effect.Effect<A, E, RumProviders>) =>
  Effect.runPromiseExit(Effect.provide(effect, registryLayer))

describe('the settings a provider offers', () => {
  it('are nothing until a provider registers', async () => {
    const exit = await run(Effect.flatMap(RumProviders, (registry) => registry.selected))
    expect(Exit.isSuccess(exit) && exit.value).toBeNull()
  })

  it('are handed over verbatim: the capability does not read them', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const registry = yield* RumProviders
        yield* registry.register({ code: 'tencent', publicConfig: { id: 'abc', sampleRate: 1 } })
        return yield* registry.selected
      }),
    )
    expect(Exit.isSuccess(exit) && exit.value).toEqual({
      code: 'tencent',
      publicConfig: { id: 'abc', sampleRate: 1 },
    })
  })

  it('refuse a second registration, which the assembly should already have stopped', async () => {
    const exit = await run(
      Effect.gen(function* () {
        const registry = yield* RumProviders
        yield* registry.register({ code: 'tencent', publicConfig: {} })
        yield* registry.register({ code: 'sentry', publicConfig: {} })
      }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  })
})

const declaredLayer = (declared: { code: string; pluginId: string } | null) =>
  Layer.succeed(DeclaredRumProvider, declared)

const boot = (
  declared: { code: string; pluginId: string } | null,
  register: Effect.Effect<void, never, RumProviders>,
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      yield* register
      yield* runBootHooks
    }).pipe(
      Effect.provide(
        barrierLayer.pipe(
          Layer.provideMerge(registryLayer),
          Layer.provideMerge(declaredLayer(declared)),
          Layer.provideMerge(assembledLayer),
        ),
      ),
    ),
  )

describe('starting up', () => {
  it('is fine with a deployment that reports nowhere', async () => {
    expect(Exit.isSuccess(await boot(null, Effect.void))).toBe(true)
  })

  it('refuses to finish starting when a declared provider never registered', async () => {
    // the failure this prevents is silent: a deployment that installed
    // reporting, came up, and recorded nothing until somebody went looking
    const exit = await boot({ code: 'tencent', pluginId: '@qualy/plugin-rum-tencent' }, Effect.void)
    expect(Exit.isFailure(exit)).toBe(true)
  })

  it('starts when the declared provider registered', async () => {
    const exit = await boot(
      { code: 'tencent', pluginId: '@qualy/plugin-rum-tencent' },
      Effect.flatMap(RumProviders, (registry) =>
        registry.register({ code: 'tencent', publicConfig: { id: 'abc' } }),
      ),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })
})
