import { Config, Context, Effect, Layer, Schema } from 'effect'
import { decodePluginConfig } from '@qualy/plugin-kit/config'

// What core mail is told: which backend sends, and who messages come from.
//
// Both may come from the environment as well as the manifest, because both
// legitimately differ between two deployments of one committed manifest - a
// laptop delivering to a local catcher and a school delivering through its
// relay, from its own domain. A production process without a sender address
// of its own does not start: mail from a placeholder domain is mail that is
// rejected or read as spam, found out on the day somebody needs a reset.

export class MailConfig extends Context.Service<
  MailConfig,
  {
    readonly defaultBackend: string
    /** the sender every message carries, as `Name <address>` or a bare address */
    readonly from: string
    /** how long one message may take to be accepted */
    readonly timeoutMs: number
  }
>()('@qualy/plugin-mail/MailConfig') {}

export const MailManifestConfig = Schema.Struct({
  defaultBackend: Schema.optional(Schema.String),
  from: Schema.optional(Schema.String),
})

export const MAIL_FROM_MISSING =
  'QUALY_MAIL_FROM must name the address mail is sent from, such as "Qualy <no-reply@school.edu>"'

/** where development mail says it is from, which nobody will ever reply to */
export const DEVELOPMENT_FROM = 'Qualy <no-reply@localhost>'

/** a sender address, bare or with a display name, and nothing that could break a header */
export const senderValid = (from: string) =>
  !/[\r\n]/.test(from) && /^(?:[^<>@]*<)?[^\s<>@]+@[^\s<>@]+(?:>)?$/.test(from.trim())

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<MailConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    MailConfig,
    Effect.gen(function* () {
      const declared = yield* decodePluginConfig(MailManifestConfig, manifest)
      const environment = yield* Config.String('NODE_ENV').pipe(Config.withDefault('development'))
      const defaultBackend = yield* Config.String('QUALY_MAIL_DEFAULT_BACKEND').pipe(
        Config.withDefault(declared.defaultBackend ?? 'smtp'),
      )
      const configured = yield* Config.option(Config.String('QUALY_MAIL_FROM'))
      const from =
        configured._tag === 'Some'
          ? configured.value
          : (declared.from ?? (environment === 'production' ? undefined : DEVELOPMENT_FROM))
      if (from === undefined || !senderValid(from)) {
        return yield* Effect.die(new Error(MAIL_FROM_MISSING))
      }
      return MailConfig.of({ defaultBackend, from: from.trim(), timeoutMs: 15_000 })
    }),
  )
