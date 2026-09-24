import { Effect, Layer } from 'effect'
import { Plugin } from '@qualy/plugin-kit'
import { Mail } from '@qualy/plugin-mail/plugin'
import { MailBackends } from '@qualy/plugin-mail/server'
import { smtpBackend } from './backend.ts'
import { config, SmtpConfig } from './config.ts'

// Delivering mail through an SMTP relay: declared to the assembly as the
// backend named "smtp", registered when this layer builds, and its
// connections closed when the process shuts down. Nothing is sent at boot:
// a relay that is down at start is found out by the first message, which
// says so, rather than keeping the whole product from starting.

const registration: Layer.Layer<never, never, MailBackends | SmtpConfig> = Layer.effectDiscard(
  Effect.gen(function* () {
    const settings = yield* SmtpConfig
    const registry = yield* MailBackends
    const smtp = yield* Effect.acquireRelease(
      Effect.sync(() => smtpBackend(settings)),
      (made) => Effect.sync(() => made.close()),
    )
    yield* registry.register(smtp.backend)
    yield* Effect.logDebug(`mail handed to ${settings.host}:${settings.port} (${settings.tls})`)
  }),
)

const plugin = Plugin.define(
  '@qualy/plugin-mail-smtp',
  { dependsOn: ['@qualy/plugin-mail'], config },
  Mail.backend({ code: 'smtp' }),
  Plugin.layer(registration),
)

export default plugin
