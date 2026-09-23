import { Effect, Exit, Layer, Logger } from 'effect'
import { describe, expect, it } from 'vitest'
import type { Contributed, ProvideExtension } from '@qualy/plugin-kit'
import { assembledLayer, runBootHooks } from '@qualy/api-kit/assembled'
import {
  Captcha,
  DeclaredCaptchaProvider,
  type CaptchaProviderDeclaration,
} from '../src/plugin.ts'
import { barrierLayer, CaptchaProviders, registryLayer } from '../src/server/registry.ts'
import type { CaptchaProvider } from '../src/server/provider.ts'

// Who issues challenges, and what happens when the answer is nobody - or two.
//
// None is a deployment that still starts, and says at start that its
// challenged requests will go through. Two is refused by name while the
// assembly is described. One that was declared and never registered is a
// deployment that believes it is protected and is not, so it does not start.

const compileOf = (provider: unknown) => (provider as ProvideExtension).compile

const declaredOf = (contributions: readonly Contributed<CaptchaProviderDeclaration>[]) =>
  Effect.runSync(
    DeclaredCaptchaProvider.pipe(
      Effect.provide(
        compileOf(Captcha.owner)(contributions) as Layer.Layer<DeclaredCaptchaProvider>,
      ),
    ),
  )

const contribution = (pluginId: string, code: string): Contributed<CaptchaProviderDeclaration> =>
  ({ pluginId, value: { code } }) as Contributed<CaptchaProviderDeclaration>

const provider = (code: string): CaptchaProvider => ({
  code,
  issue: () => Effect.succeed({}),
  verify: () => Effect.succeed('rejected'),
})

describe('choosing a challenge provider', () => {
  it('is content with none', () => {
    expect(declaredOf([])).toBeNull()
  })

  it('takes the one that was declared', () => {
    expect(declaredOf([contribution('@qualy/plugin-captcha-altcha', 'altcha')])).toEqual({
      code: 'altcha',
      pluginId: '@qualy/plugin-captcha-altcha',
    })
  })

  it('refuses two, and names them both', () => {
    expect(() =>
      declaredOf([
        contribution('@qualy/plugin-captcha-altcha', 'altcha'),
        contribution('@qualy/plugin-captcha-turnstile', 'turnstile'),
      ]),
    ).toThrow(/@qualy\/plugin-captcha-altcha, @qualy\/plugin-captcha-turnstile/)
  })

  it('refuses a code that is not one', () => {
    expect(() => Captcha.provider({ code: 'Turnstile ' })).toThrow(/not a captcha provider code/)
    expect(() => Captcha.provider({ code: '../foo' })).toThrow(/not a captcha provider code/)
  })
})

describe('the provider registry', () => {
  it('holds the one that registered, and refuses a second', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const registry = yield* CaptchaProviders
        const before = yield* registry.selected
        yield* registry.register(provider('altcha'))
        const after = yield* registry.selected
        yield* registry.register(provider('turnstile'))
        return { before, after: after?.code }
      }).pipe(Effect.provide(registryLayer)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(Exit.isFailure(exit) ? exit.cause : '')).toMatch(/already come from "altcha"/)
  })
})

/** runs the boot barrier under a declaration, with or without a registration, collecting warnings */
const boot = async (
  declared: (CaptchaProviderDeclaration & { pluginId: string }) | null,
  registered: CaptchaProvider | null,
) => {
  const warnings: string[] = []
  const capture = Logger.layer([
    Logger.make((options) => {
      if (options.logLevel === 'Warn') warnings.push(String(options.message))
    }),
  ])
  const registration = Layer.effectDiscard(
    Effect.flatMap(CaptchaProviders, (registry) =>
      registered === null ? Effect.void : registry.register(registered),
    ),
  )
  const exit = await Effect.runPromiseExit(
    runBootHooks.pipe(
      Effect.provide(
        Layer.mergeAll(
          barrierLayer.pipe(
            Layer.provideMerge(registration),
            Layer.provideMerge(registryLayer),
            Layer.provideMerge(Layer.succeed(DeclaredCaptchaProvider, declared)),
            Layer.provideMerge(assembledLayer),
          ),
          capture,
        ),
      ),
    ),
  )
  return { exit, warnings }
}

describe('the boot barrier', () => {
  it('lets a deployment without a provider start, and says so once', async () => {
    const { exit, warnings } = await boot(null, null)
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(warnings).toEqual([
      expect.stringContaining('no provider selected; challenged requests will bypass CAPTCHA'),
    ])
  })

  it('starts quietly with the provider it declared', async () => {
    const { exit, warnings } = await boot(
      { code: 'altcha', pluginId: '@qualy/plugin-captcha-altcha' },
      provider('altcha'),
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(warnings).toEqual([])
  })

  it('refuses to start with a provider declared and never registered', async () => {
    const { exit } = await boot({ code: 'altcha', pluginId: '@qualy/plugin-captcha-altcha' }, null)
    expect(Exit.isFailure(exit)).toBe(true)
    expect(String(Exit.isFailure(exit) ? exit.cause : '')).toMatch(
      /@qualy\/plugin-captcha-altcha declares the captcha provider "altcha" but never registered it/,
    )
  })
})
