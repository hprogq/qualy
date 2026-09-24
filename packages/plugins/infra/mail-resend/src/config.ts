import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import { decodePluginConfig } from '@qualy/plugin-kit/config'

// Which Resend account mail goes out through.
//
// From the environment only: an api key is one deployment's, and has no
// business in a committed file. Enabling the plugin without one is a
// configuration error rather than a reason to degrade - a blank variable is
// a missing one, and a backend that could not authenticate would fail every
// message it was handed, found out the day somebody needs a reset.

export class ResendConfig extends Context.Service<
  ResendConfig,
  { readonly apiKey: Redacted.Redacted<string> }
>()('@qualy/plugin-mail-resend/ResendConfig') {}

export const RESEND_API_KEY_MISSING =
  'QUALY_MAIL_RESEND_API_KEY must be set while @qualy/plugin-mail-resend is enabled'

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<ResendConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    ResendConfig,
    Effect.gen(function* () {
      // nothing in the manifest: an empty block, and a typo in it refused
      yield* decodePluginConfig(Schema.Struct({}), manifest)
      const key = yield* Config.option(Config.Redacted('QUALY_MAIL_RESEND_API_KEY'))
      const apiKey = key._tag === 'Some' ? Redacted.value(key.value).trim() : ''
      if (apiKey === '') return yield* Effect.die(new Error(RESEND_API_KEY_MISSING))
      return ResendConfig.of({ apiKey: Redacted.make(apiKey) })
    }),
  )
