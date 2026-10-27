import { Config, Context, Effect, Layer, Option, Redacted, Schema } from 'effect'
import { importJWK, type JWK } from 'jose'
import type { CosDelivery, CosSettings } from './backend.ts'
import { decodePluginConfig } from '@qualy/plugin-kit/config'
import { ALGORITHM } from '../edgeone/protocol.ts'

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
//
// How readers reach the bytes is one more deployment fact: `direct` - the
// bucket's own signed urls, through the download domain when there is one -
// unless the deployment says `edgeone`. Then the file host's origin, the
// issuer its credentials name and the key they are signed with must all be
// there, or the process refuses to start: a deployment that asked for
// EdgeOne and got half of it would otherwise send readers to the bucket,
// which is exactly what choosing EdgeOne rules out. The signing key is a
// secret and lives in the environment only.

/** the store's settings, or what it is missing to be reached */
export type CosConfiguration = { readonly settings: CosSettings } | { readonly refusal: string }

export class CosStorageConfig extends Context.Service<CosStorageConfig, CosConfiguration>()(
  '@qualy/plugin-storage-cos/CosStorageConfig',
) {}

export const CosManifestConfig = Schema.Struct({
  region: Schema.optional(Schema.String),
  bucket: Schema.optional(Schema.String),
  downloadDomain: Schema.optional(Schema.String),
  delivery: Schema.optional(Schema.Literals(['direct', 'edgeone'])),
  edgeOne: Schema.optional(
    Schema.Struct({
      origin: Schema.optional(Schema.String),
      issuer: Schema.optional(Schema.String),
      thumbnails: Schema.optional(Schema.Boolean),
    }),
  ),
})
export type CosManifestConfig = typeof CosManifestConfig.Type

export const COS_CREDENTIALS_MISSING =
  'set QUALY_STORAGE_COS_SECRET_ID and QUALY_STORAGE_COS_SECRET_KEY, with its bucket and region, to reach it'

/** an https origin and nothing else: no path, query, fragment or credentials */
const bareOrigin = (name: string, value: string): string => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(
      `${name} is not a url; it should be an origin such as https://files.example.com`,
    )
  }
  if (url.protocol !== 'https:' || url.origin !== value) {
    throw new Error(
      `${name} must be a bare https origin such as https://files.example.com, not ${value}`,
    )
  }
  return value
}

/**
 * The private key EdgeOne credentials are signed with: a P-256 JWK, private
 * half included, naming the kid its public half is published under
 * (`qualy cos edge-keygen` makes one).
 */
// A key that does not import is a deployment that cannot start: the
// failures below are defects with this file's own words, never the key's.
const signingKeyOf = (value: Redacted.Redacted) =>
  Effect.promise(async () => {
    let jwk: JWK
    try {
      jwk = JSON.parse(Redacted.value(value)) as JWK
    } catch {
      throw new Error('QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY is not a JSON web key')
    }
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || typeof jwk.d !== 'string') {
      throw new Error(
        'QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY must be the private half of a P-256 key',
      )
    }
    if (typeof jwk.kid !== 'string' || jwk.kid === '') {
      throw new Error('QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY must name its key with a kid')
    }
    const key = await importJWK(jwk, ALGORITHM).catch(() => {
      throw new Error('QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY did not import as a P-256 signing key')
    })
    if (key instanceof Uint8Array) {
      throw new Error('QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY did not import as a signing key')
    }
    return { key, kid: jwk.kid }
  })

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
        const delivery = yield* deliveryOf(declared, downloadDomain)
        return CosStorageConfig.of({
          settings: {
            region: region.value,
            bucket: bucket.value,
            secretId: secretId.value,
            secretKey: secretKey.value,
            ...(downloadDomain === '' ? {} : { downloadDomain }),
            delivery,
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

/** how readers reach the bytes, refused unless it is whole */
const deliveryOf = (declared: CosManifestConfig, downloadDomain: string) =>
  Effect.gen(function* () {
    const mode = yield* Config.String('QUALY_STORAGE_COS_DELIVERY').pipe(
      Config.withDefault(declared.delivery ?? 'direct'),
    )
    if (mode === 'direct') return { kind: 'direct' } satisfies CosDelivery
    if (mode !== 'edgeone') {
      return yield* Effect.die(
        new Error(`QUALY_STORAGE_COS_DELIVERY is ${mode}; it is either direct or edgeone`),
      )
    }
    if (downloadDomain !== '') {
      return yield* Effect.die(
        new Error(
          'QUALY_STORAGE_COS_DOWNLOAD_DOMAIN names a domain for direct delivery while delivery is edgeone; unset one of them',
        ),
      )
    }
    const origin = yield* Config.option(
      stringOr('QUALY_STORAGE_COS_EDGEONE_ORIGIN', declared.edgeOne?.origin),
    )
    const issuer = yield* Config.option(
      stringOr('QUALY_STORAGE_COS_EDGEONE_ISSUER', declared.edgeOne?.issuer),
    )
    const key = yield* Config.option(Config.Redacted('QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY'))
    if (Option.isNone(origin) || Option.isNone(issuer) || Option.isNone(key)) {
      const missing = [
        ...(Option.isNone(origin) ? ['QUALY_STORAGE_COS_EDGEONE_ORIGIN'] : []),
        ...(Option.isNone(issuer) ? ['QUALY_STORAGE_COS_EDGEONE_ISSUER'] : []),
        ...(Option.isNone(key) ? ['QUALY_STORAGE_COS_EDGEONE_SIGNING_KEY'] : []),
      ]
      return yield* Effect.die(
        new Error(
          `delivery is edgeone but ${missing.join(', ')} not set; set them, or deliver directly`,
        ),
      )
    }
    // an origin that is not one is a deployment that cannot start
    const checked = yield* Effect.sync(() => ({
      origin: bareOrigin('QUALY_STORAGE_COS_EDGEONE_ORIGIN', origin.value),
      issuer: bareOrigin('QUALY_STORAGE_COS_EDGEONE_ISSUER', issuer.value),
    }))
    const signing = yield* signingKeyOf(key.value)
    // Enable only after the edge function understands the signed preset.
    const thumbnails = yield* Config.Boolean('QUALY_STORAGE_COS_EDGEONE_THUMBNAILS').pipe(
      Config.withDefault(declared.edgeOne?.thumbnails ?? false),
    )
    return { kind: 'edgeone', ...checked, signing, thumbnails } satisfies CosDelivery
  })
