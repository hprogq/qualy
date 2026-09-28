import { Config, Context, Effect, Layer, Option, Schema } from 'effect'
import type { CosSettings } from './backend.ts'
import { decodePluginConfig } from '@qualy/plugin-kit/config'

// Which bucket, and who this process is to it.
//
// Split down the middle on purpose. Region, bucket and download domain are
// deployment facts a reviewer should be able to read in the committed
// manifest; the two secrets exist only in the environment and are never
// defaulted.
//
// The secrets decide whether this store is reachable at all. Without either,
// the plugin takes part unconfigured: a deployment that writes to a disk - a
// laptop, a CI job - starts without a bucket, and only making cos the default
// is refused. With one, everything must be there, because half a
// configuration is a typo and not a choice.

/** the store's settings, or what it is missing to be reached */
export type CosConfiguration = { readonly settings: CosSettings } | { readonly refusal: string }

export class CosStorageConfig extends Context.Service<CosStorageConfig, CosConfiguration>()(
  '@qualy/plugin-storage-cos/CosStorageConfig',
) {}

export const CosManifestConfig = Schema.Struct({
  region: Schema.optional(Schema.String),
  bucket: Schema.optional(Schema.String),
  downloadDomain: Schema.optional(Schema.String),
})
export type CosManifestConfig = typeof CosManifestConfig.Type

export const COS_CREDENTIALS_MISSING =
  'set QUALY_STORAGE_COS_SECRET_ID and QUALY_STORAGE_COS_SECRET_KEY, with its bucket and region, to reach it'

/** the environment may name it; the manifest is the fallback, not the reverse */
const stringOr = (name: string, declared: string | undefined) =>
  declared === undefined
    ? Config.String(name)
    : Config.String(name).pipe(Config.withDefault(declared))

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<CosStorageConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    CosStorageConfig,
    Effect.gen(function* () {
      const declared = yield* decodePluginConfig(CosManifestConfig, manifest)
      // a blank variable is a missing one: the environment provider reads ""
      // as absent
      const secretId = yield* Config.option(Config.Redacted('QUALY_STORAGE_COS_SECRET_ID'))
      const secretKey = yield* Config.option(Config.Redacted('QUALY_STORAGE_COS_SECRET_KEY'))
      if (Option.isNone(secretId) && Option.isNone(secretKey)) {
        return CosStorageConfig.of({ refusal: COS_CREDENTIALS_MISSING })
      }
      const region = yield* Config.option(stringOr('QUALY_STORAGE_COS_REGION', declared.region))
      const bucket = yield* Config.option(stringOr('QUALY_STORAGE_COS_BUCKET', declared.bucket))
      if (
        Option.isSome(secretId) &&
        Option.isSome(secretKey) &&
        Option.isSome(bucket) &&
        Option.isSome(region)
      ) {
        const downloadDomain = yield* Config.String('QUALY_STORAGE_COS_DOWNLOAD_DOMAIN').pipe(
          Config.withDefault(declared.downloadDomain ?? ''),
        )
        return CosStorageConfig.of({
          settings: {
            region: region.value,
            bucket: bucket.value,
            secretId: secretId.value,
            secretKey: secretKey.value,
            ...(downloadDomain === '' ? {} : { downloadDomain }),
          },
        })
      }
      const missing = [
        ...(Option.isNone(secretId) ? ['QUALY_STORAGE_COS_SECRET_ID'] : []),
        ...(Option.isNone(secretKey) ? ['QUALY_STORAGE_COS_SECRET_KEY'] : []),
        ...(Option.isNone(bucket) ? ['QUALY_STORAGE_COS_BUCKET'] : []),
        ...(Option.isNone(region) ? ['QUALY_STORAGE_COS_REGION'] : []),
      ]
      return yield* Effect.die(
        new Error(
          `cos storage is only partly configured: ${missing.join(', ')} not set while the rest is; set the missing ones, or unset the cos credentials to start without the bucket`,
        ),
      )
    }),
  )
