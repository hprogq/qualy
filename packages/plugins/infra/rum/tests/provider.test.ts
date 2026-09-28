import { Cause, ConfigProvider, Effect, Exit, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Contributed, ProvideExtension } from '@qualy/plugin-kit'
import { assembledLayer, runBootHooks } from '@qualy/api-kit/assembled'
import { DeclaredRumProvider, Rum, type RumProviderDeclaration } from '../src/plugin.ts'
import { barrierLayer, registryLayer, RumProviders } from '../src/server/registry.ts'
import { config, RumReporting } from '../src/server/config.ts'
import { RUM_SETTINGS_SCHEMA } from '../src/api.ts'

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
      Effect.provide(compileOf(Rum.owner)(contributions) as Layer.Layer<DeclaredRumProvider>),
    ),
  )

const contribution = (pluginId: string, code: string): Contributed<RumProviderDeclaration> => ({
  pluginId,
  value: { code },
})

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

/** the registry as a deployment that reports - or, told so, one that does not - builds it */
const registry = (on = true) =>
  registryLayer.pipe(Layer.provide(Layer.succeed(RumReporting, { on })))

const run = <A, E>(effect: Effect.Effect<A, E, RumProviders>, on = true) =>
  Effect.runPromiseExit(Effect.provide(effect, registry(on)))

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

  it('refuse a provider while reporting is off', async () => {
    const exit = await run(
      Effect.flatMap(RumProviders, (providers) =>
        providers.register({ code: 'tencent', publicConfig: { id: 'abc' } }),
      ),
      false,
    )
    expect(Exit.isFailure(exit)).toBe(true)
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
  on = true,
) =>
  Effect.runPromiseExit(
    Effect.gen(function* () {
      yield* register
      yield* runBootHooks
    }).pipe(
      Effect.provide(
        barrierLayer.pipe(
          Layer.provideMerge(registry(on)),
          Layer.provideMerge(declaredLayer(declared)),
          Layer.provideMerge(assembledLayer),
        ),
      ),
    ),
  )

describe('starting up', () => {
  it('is fine with a deployment that reports nowhere', async () => {
    expect(Exit.isSuccess(await boot(null, Effect.void, false))).toBe(true)
  })

  it('leaves a declared provider idle while reporting is off', async () => {
    const exit = await boot(
      { code: 'tencent', pluginId: '@qualy/plugin-rum-tencent' },
      Effect.void,
      false,
    )
    expect(Exit.isSuccess(exit)).toBe(true)
  })

  it('refuses reporting switched on with no provider to report through', async () => {
    const exit = await boot(null, Effect.void)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(Exit.isFailure(exit) && Cause.pretty(exit.cause)).toContain('QUALY_RUM_REPORTING=on')
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

describe('what the browser is told', () => {
  // The vendor's name is not on it. A build carries the browser half of the
  // active selection and nothing else, so the page asking already holds the
  // one provider there is; naming it here told every visitor which company
  // stores this deployment's failures, in exchange for a lookup the browser
  // does not need to do.
  const answered = (registered: { code: string; publicConfig: Record<string, unknown> } | null) =>
    Effect.runSync(
      Effect.gen(function* () {
        const providers = yield* RumProviders
        if (registered !== null) yield* providers.register(registered)
        const selected = yield* providers.selected
        return { schema: RUM_SETTINGS_SCHEMA, config: selected?.publicConfig ?? null }
      }).pipe(Effect.provide(registry(registered !== null))),
    )

  it('carries the selected provider settings and no vendor name', () => {
    const body = answered({ code: 'tencent', publicConfig: { id: 'abc', sampleRate: 1 } })
    expect(Object.keys(body).sort()).toEqual(['config', 'schema'])
    expect(body).toEqual({ schema: 2, config: { id: 'abc', sampleRate: 1 } })
    expect(JSON.stringify(body)).not.toContain('tencent')
  })

  it('says so with null rather than an empty object when nobody reports', () => {
    // told apart from "reports, with no settings", which a provider may
    // legitimately answer: one brings a vendor up and the other does not
    expect(answered(null)).toEqual({ schema: 2, config: null })
  })
})

describe('the reporting switch', () => {
  const switched = (env: Record<string, string>) =>
    Effect.runPromiseExit(
      Effect.flatMap(RumReporting, Effect.succeed).pipe(
        Effect.provide(
          config({}, { manifestDir: '/somewhere' }).pipe(
            Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
          ),
        ),
      ),
    )

  it('is off unless a deployment says on', async () => {
    const exit = await switched({})
    expect(Exit.isSuccess(exit) && exit.value.on).toBe(false)
  })

  it('is on when a deployment says so', async () => {
    const exit = await switched({ QUALY_RUM_REPORTING: 'on' })
    expect(Exit.isSuccess(exit) && exit.value.on).toBe(true)
  })

  it('refuses anything else rather than reading it as off', async () => {
    expect(Exit.isFailure(await switched({ QUALY_RUM_REPORTING: 'yes' }))).toBe(true)
  })
})
