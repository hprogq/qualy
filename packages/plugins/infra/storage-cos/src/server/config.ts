import { Config, Context, Effect, Layer, Schema } from 'effect'
import type { CosSettings } from './backend.ts'

// Which bucket, and who this process is to it.
//
// Split down the middle on purpose. Region, bucket and download domain are
// deployment facts a reviewer should be able to read in the committed
// manifest; the two secrets exist only in the environment and are never
// defaulted, so a deployment that forgets them fails at startup rather than at
// the first upload.

export class CosStorageConfig extends Context.Service<CosStorageConfig, CosSettings>()(
  '@qualy/plugin-storage-cos/CosStorageConfig',
) {}

export const CosManifestConfig = Schema.Struct({
  region: Schema.optional(Schema.String),
  bucket: Schema.optional(Schema.String),
  downloadDomain: Schema.optional(Schema.String),
})
export type CosManifestConfig = typeof CosManifestConfig.Type

/** the environment may name it; the manifest is the fallback, not the reverse */
const stringOr = (name: string, declared: string | undefined) =>
  declared === undefined
    ? Config.string(name)
    : Config.string(name).pipe(Config.withDefault(declared))

export const config = (
  manifest: unknown,
  _context: { readonly manifestDir: string },
): Layer.Layer<CosStorageConfig, Schema.SchemaError | Config.ConfigError> =>
  Layer.effect(
    CosStorageConfig,
    Effect.gen(function* () {
      const declared = yield* Schema.decodeUnknownEffect(CosManifestConfig)(manifest, {
        onExcessProperty: 'error',
      })
      const region = yield* stringOr('QUALY_STORAGE_COS_REGION', declared.region)
      const bucket = yield* stringOr('QUALY_STORAGE_COS_BUCKET', declared.bucket)
      const secretId = yield* Config.redacted('QUALY_STORAGE_COS_SECRET_ID')
      const secretKey = yield* Config.redacted('QUALY_STORAGE_COS_SECRET_KEY')
      const downloadDomain = yield* Config.string('QUALY_STORAGE_COS_DOWNLOAD_DOMAIN').pipe(
        Config.withDefault(declared.downloadDomain ?? ''),
      )
      return CosStorageConfig.of({
        region,
        bucket,
        secretId,
        secretKey,
        ...(downloadDomain === '' ? {} : { downloadDomain }),
      })
    }),
  )
