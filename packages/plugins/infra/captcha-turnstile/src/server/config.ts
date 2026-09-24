import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import { decodePluginConfig } from '@qualy/plugin-kit/config'

// Which Cloudflare Turnstile widget this deployment uses.
//
// From the environment, never the manifest: a site key is one deployment's,
// and a secret key has no business in a committed file. Neither is derived
// from the deployment's master key - they are Cloudflare's credentials, and
// Cloudflare is where they are rotated. Enabling the plugin without them is a
// configuration error, not a reason to degrade: a deployment that meant to
// challenge and came up challenging nobody is the failure nobody notices.

export class TurnstileConfig extends Context.Service<
  TurnstileConfig,
  {
    /** public: the browser renders the widget with it */
    readonly siteKey: string
    /** server only: what Siteverify is asked with */
    readonly secretKey: Redacted.Redacted<string>
  }
>()('@qualy/plugin-captcha-turnstile/TurnstileConfig') {}

export const TURNSTILE_KEYS_MISSING =
  'QUALY_CAPTCHA_TURNSTILE_SITE_KEY and QUALY_CAPTCHA_TURNSTILE_SECRET_KEY must both be set while @qualy/plugin-captcha-turnstile is enabled'

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<TurnstileConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    TurnstileConfig,
    Effect.gen(function* () {
      // nothing in the manifest: an empty block, and a typo in it refused
      yield* decodePluginConfig(Schema.Struct({}), manifest)
      const siteKey = yield* Config.option(Config.String('QUALY_CAPTCHA_TURNSTILE_SITE_KEY'))
      const secretKey = yield* Config.option(Config.Redacted('QUALY_CAPTCHA_TURNSTILE_SECRET_KEY'))
      // an empty variable is an unset one: with a blank secret Siteverify
      // answers every token with a configuration error, which lets every
      // request through - "enabled" would quietly mean "off"
      const site = siteKey._tag === 'Some' ? siteKey.value.trim() : ''
      const secret = secretKey._tag === 'Some' ? Redacted.value(secretKey.value).trim() : ''
      if (site === '' || secret === '') return yield* Effect.die(new Error(TURNSTILE_KEYS_MISSING))
      return TurnstileConfig.of({ siteKey: site, secretKey: Redacted.make(secret) })
    }),
  )
