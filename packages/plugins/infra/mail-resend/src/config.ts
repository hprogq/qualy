import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import { decodePluginConfig } from '@qualy/plugin-kit/config'
import type { BackendSettings } from '@qualy/plugin-mail/server'

// Which Resend account mail goes out through.
//
// From the environment only: an api key is one deployment's, and has no
// business in a committed file. Sending through Resend without one is a
// configuration error rather than a reason to degrade - a blank variable is
// a missing one, and a backend that could not authenticate would fail every
// message it was handed, found out the day somebody needs a reset. Whether
// a missing key stops the product depends on whether Resend is the backend
// the deployment sends through (offerBackend), so it is recorded here.

export interface ResendSettings {
  readonly apiKey: Redacted.Redacted<string>
}

export class ResendConfig extends Context.Service<ResendConfig, BackendSettings<ResendSettings>>()(
  '@qualy/plugin-mail-resend/ResendConfig',
) {}

export const RESEND_API_KEY_MISSING =
  'QUALY_MAIL_RESEND_API_KEY must be set while mail is sent through resend'

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
      if (apiKey === '') return ResendConfig.of({ refusal: RESEND_API_KEY_MISSING })
      return ResendConfig.of({ settings: { apiKey: Redacted.make(apiKey) } })
    }),
  )
