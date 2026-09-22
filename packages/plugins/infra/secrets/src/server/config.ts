import { Config, Context, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { decodePluginConfig } from '@qualy/plugin-kit/config'

// The master key every secret is encrypted under, and where it comes from.
//
// It is a deployment fact and never a manifest one: it comes from
// QUALY_SECRETS_MASTER_KEY as exactly 32 bytes of base64, and anything else
// is refused rather than stretched into a key - a passphrase hashed into one
// looks configured and is as strong as the passphrase. A production process
// without one does not start. Development falls back to a key written below,
// which protects nothing and says so in the log.

export class SecretsConfig extends Context.Service<
  SecretsConfig,
  { readonly masterKey: Redacted.Redacted<Uint8Array> }
>()('@qualy/plugin-secrets/SecretsConfig') {}

export const MASTER_KEY_MALFORMED = 'QUALY_SECRETS_MASTER_KEY must be base64-encoded 32 bytes'

export const DEVELOPMENT_KEY_WARNING =
  'secrets: QUALY_SECRETS_MASTER_KEY is not set; using the development-only master key'

export const DEVELOPMENT_KEY_IN_PRODUCTION =
  'QUALY_SECRETS_MASTER_KEY is the development-only key; a production instance needs its own'

/** published with the source, so it protects nothing a development database holds */
const DEVELOPMENT_MASTER_KEY = 'tMKSs03OTU4mpuOpEpnweVddLM8NUR4OVS0r6MikvgM='

/** 32 bytes written as canonical padded base64, or undefined */
export const masterKeyFrom = (text: string): Uint8Array | undefined => {
  if (!/^[A-Za-z0-9+/]{43}=$/.test(text)) return undefined
  const bytes = Buffer.from(text, 'base64')
  return bytes.length === 32 && bytes.toString('base64') === text ? bytes : undefined
}

/** what this plugin accepts in `qualy.yml`: nothing, so a key put there is refused */
export const SecretsManifestConfig = Schema.Struct({})

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<SecretsConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    SecretsConfig,
    Effect.gen(function* () {
      yield* decodePluginConfig(SecretsManifestConfig, manifest)
      const environment = yield* Config.String('NODE_ENV').pipe(Config.withDefault('development'))
      const configured = (yield* Config.option(Config.Redacted('QUALY_SECRETS_MASTER_KEY'))).pipe(
        Option.map((value) => Redacted.value(value).trim()),
        // an empty assignment in an env file is the variable left unset
        Option.filter((value) => value !== ''),
      )
      if (Option.isNone(configured)) {
        if (environment === 'production') return yield* Effect.die(new Error(MASTER_KEY_MALFORMED))
        yield* Effect.logWarning(DEVELOPMENT_KEY_WARNING)
        return SecretsConfig.of({
          masterKey: Redacted.make(masterKeyFrom(DEVELOPMENT_MASTER_KEY)!),
        })
      }
      const masterKey = masterKeyFrom(configured.value)
      if (masterKey === undefined) return yield* Effect.die(new Error(MASTER_KEY_MALFORMED))
      if (environment === 'production' && configured.value === DEVELOPMENT_MASTER_KEY) {
        return yield* Effect.die(new Error(DEVELOPMENT_KEY_IN_PRODUCTION))
      }
      return SecretsConfig.of({ masterKey: Redacted.make(masterKey) })
    }),
  )
