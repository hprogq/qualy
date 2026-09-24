import { ConfigProvider, Effect, Exit, Layer, Redacted } from 'effect'
import { describe, expect, it } from 'vitest'
import { config, TurnstileConfig, TURNSTILE_KEYS_MISSING } from '../src/server/index.ts'

// A deployment that turned Turnstile on must have given it both keys. A
// blank one is a missing one: with an empty secret every token would come
// back as a configuration error, which lets every request through.

const read = (env: Record<string, string>) =>
  Effect.runPromiseExit(
    Effect.flatMap(TurnstileConfig, (settings) =>
      Effect.succeed({ siteKey: settings.siteKey, secret: Redacted.value(settings.secretKey) }),
    ).pipe(
      Effect.provide(
        config({}, { manifestDir: '/somewhere' }).pipe(
          Layer.provide(ConfigProvider.layer(ConfigProvider.fromEnv({ env }))),
        ),
      ),
    ),
  )

const refusal = (exit: Exit.Exit<unknown, unknown>) =>
  Exit.isFailure(exit) ? String(exit.cause) : 'started'

describe('the Turnstile keys', () => {
  it('are read, trimmed, from the environment', async () => {
    const exit = await read({
      QUALY_CAPTCHA_TURNSTILE_SITE_KEY: ' site ',
      QUALY_CAPTCHA_TURNSTILE_SECRET_KEY: ' secret ',
    })
    expect(Exit.isSuccess(exit) && exit.value).toEqual({ siteKey: 'site', secret: 'secret' })
  })

  it('refuse to start with either missing or blank', async () => {
    for (const env of <Record<string, string>[]>[
      {},
      { QUALY_CAPTCHA_TURNSTILE_SITE_KEY: 'site' },
      { QUALY_CAPTCHA_TURNSTILE_SITE_KEY: 'site', QUALY_CAPTCHA_TURNSTILE_SECRET_KEY: '' },
      { QUALY_CAPTCHA_TURNSTILE_SITE_KEY: 'site', QUALY_CAPTCHA_TURNSTILE_SECRET_KEY: '   ' },
      { QUALY_CAPTCHA_TURNSTILE_SITE_KEY: ' ', QUALY_CAPTCHA_TURNSTILE_SECRET_KEY: 'secret' },
    ]) {
      expect(refusal(await read(env)), JSON.stringify(env)).toContain(TURNSTILE_KEYS_MISSING)
    }
  })
})
