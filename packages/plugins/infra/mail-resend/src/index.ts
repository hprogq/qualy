import { Effect, Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Mail } from '@qualy/plugin-mail/plugin'
import { MailBackends, offerBackend } from '@qualy/plugin-mail/server'
import { resendBackend } from './backend.ts'
import { config, ResendConfig } from './config.ts'

// Delivering mail through Resend's api: declared to the assembly as the
// backend named "resend", registered when this layer builds. Beside the smtp
// backend rather than in place of it - which one sends is the mail
// capability's default backend, chosen per deployment. Nothing is sent at
// boot: a key that does not work is found out by the first message, loudly.

const registration: Layer.Layer<never, never, MailBackends | ResendConfig> = Layer.effectDiscard(
  Effect.gen(function* () {
    yield* offerBackend('resend', yield* ResendConfig, (settings) =>
      Effect.as(Effect.logDebug('mail handed to resend'), resendBackend(settings)),
    )
  }),
)

const plugin = Plugin.define(
  '@qualy/plugin-mail-resend',
  { dependsOn: ['@qualy/plugin-mail'], config },
  Mail.backend({ code: 'resend' }),
  Plugin.layer(registration),
)

export default plugin
