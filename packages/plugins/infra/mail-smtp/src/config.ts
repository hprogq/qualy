import { Config, Context, Effect, Layer, Redacted, Schema } from 'effect'
import { decodePluginConfig } from '@qualy/plugin-kit/config'

// Where mail is handed over, and how the connection is protected.
//
// All of it from the deployment's environment rather than the manifest: a
// relay's address, account and password differ between two deployments of
// one product, and a password has no business in a committed file. The
// protection is said in three words, because the two ports mean two
// different things: `implicit` is TLS from the first byte (465), `starttls`
// upgrades a plain connection and refuses to go on if it cannot (587), and
// `none` sends in the clear - for a mail catcher on a developer's machine,
// and in production only when somebody said so on purpose.

export type SmtpTls = 'implicit' | 'starttls' | 'none'

export class SmtpConfig extends Context.Service<
  SmtpConfig,
  {
    readonly host: string
    readonly port: number
    readonly tls: SmtpTls
    readonly auth:
      | { readonly user: string; readonly password: Redacted.Redacted<string> }
      | undefined
  }
>()('@qualy/plugin-mail-smtp/SmtpConfig') {}

export const SMTP_HOST_MISSING =
  'QUALY_MAIL_SMTP_HOST must name the relay mail is handed to in production'
export const SMTP_TLS_MALFORMED = 'QUALY_MAIL_SMTP_TLS must be implicit, starttls or none'
export const SMTP_PLAINTEXT_REFUSED =
  'QUALY_MAIL_SMTP_TLS=none sends mail and the relay password in the clear; set QUALY_MAIL_SMTP_ALLOW_PLAINTEXT=1 to mean it'
export const SMTP_AUTH_HALF =
  'QUALY_MAIL_SMTP_USER and QUALY_MAIL_SMTP_PASSWORD are given together or not at all'

const PORTS: Record<SmtpTls, number> = { implicit: 465, starttls: 587, none: 25 }

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<SmtpConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    SmtpConfig,
    Effect.gen(function* () {
      // nothing in the manifest: an empty block, and a typo in it refused
      yield* decodePluginConfig(Schema.Struct({}), manifest)
      const production =
        (yield* Config.String('NODE_ENV').pipe(Config.withDefault('development'))) === 'production'
      const host = yield* Config.option(Config.String('QUALY_MAIL_SMTP_HOST'))
      if (host._tag === 'None' && production) return yield* Effect.die(new Error(SMTP_HOST_MISSING))
      // development hands mail to the catcher the compose stack runs
      const tlsRaw = yield* Config.String('QUALY_MAIL_SMTP_TLS').pipe(
        Config.withDefault(production ? 'starttls' : 'none'),
      )
      if (tlsRaw !== 'implicit' && tlsRaw !== 'starttls' && tlsRaw !== 'none') {
        return yield* Effect.die(new Error(SMTP_TLS_MALFORMED))
      }
      const tls: SmtpTls = tlsRaw
      const plaintextAllowed =
        (yield* Config.String('QUALY_MAIL_SMTP_ALLOW_PLAINTEXT').pipe(Config.withDefault(''))) ===
        '1'
      if (production && tls === 'none' && !plaintextAllowed) {
        return yield* Effect.die(new Error(SMTP_PLAINTEXT_REFUSED))
      }
      const port = yield* Config.Number('QUALY_MAIL_SMTP_PORT').pipe(
        Config.withDefault(host._tag === 'None' ? 1025 : PORTS[tls]),
      )
      const user = yield* Config.option(Config.String('QUALY_MAIL_SMTP_USER'))
      const password = yield* Config.option(Config.Redacted('QUALY_MAIL_SMTP_PASSWORD'))
      if ((user._tag === 'Some') !== (password._tag === 'Some')) {
        return yield* Effect.die(new Error(SMTP_AUTH_HALF))
      }
      return SmtpConfig.of({
        host: host._tag === 'Some' ? host.value : '127.0.0.1',
        port,
        tls,
        auth:
          user._tag === 'Some' && password._tag === 'Some'
            ? { user: user.value, password: password.value }
            : undefined,
      })
    }),
  )
