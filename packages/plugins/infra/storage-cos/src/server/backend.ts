import { Effect, Redacted } from 'effect'
import COS from 'cos-nodejs-sdk-v5'
import { backendFailure, type BackendUnavailable } from '@qualy/plugin-storage/errors'
import type {
  BlobStat,
  RevisionEntry,
  RevisionStore,
  StorageBackend,
} from '@qualy/plugin-storage/backend'
import type { CosUploadPayload } from '../payload.ts'
import { credentialForObject } from './sts.ts'

// Tencent cloud object storage, as three calls and a signature.
//
// The bytes never pass through this process: a browser writes them straight to
// the bucket with a credential minted here, and everything this file does
// afterwards is ask the bucket what actually arrived. That is the whole reason
// `stat` is trusted and the uploader is not.
//
// A bucket is in one of two modes, read once when the deployment starts
// (bucketModeOf). One that has never kept versions refuses a second write to a
// key: the upload credential demands `x-cos-forbid-overwrite`. One that keeps
// versions ignores that header - a second write with a credential that has not
// expired yet becomes the newest version - so there `stat` reports the version
// it looked at, the attachment keeps it, and every read names it. Deleting,
// there, means removing every version and marker under the key, or the bytes
// are only hidden. A bucket whose versioning was switched on and then
// suspended does neither, and is refused.

export interface CosSettings {
  readonly region: string
  readonly bucket: string
  readonly secretId: Redacted.Redacted
  readonly secretKey: Redacted.Redacted
  /** a download domain, when the deployment has one */
  readonly downloadDomain?: string | undefined
}

/** how long a signed read url is good for; long enough to start a download */
const DOWNLOAD_TTL_SECONDS = 60

/** whether the bucket keeps a version of every write */
export type CosBucketMode = 'single' | 'versioned'

/**
 * The version an object had before its bucket kept versions is called "null";
 * to core storage that is no revision at all, and an attachment that completed
 * then reads back without naming one.
 */
const revisionOf = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined
  const text = String(value)
  return text === '' || text === 'null' ? undefined : text
}

/** a page position in a version listing, which needs both a key and a version */
const cursorOf = (key: string, version: string | undefined) => JSON.stringify([key, version ?? ''])
const positionOf = (cursor: string | undefined) => {
  if (cursor === undefined) return {}
  const [key, version] = JSON.parse(cursor) as [string, string]
  return { KeyMarker: key, VersionIdMarker: version }
}

/**
 * What the bucket says about its versioning: never switched on, on, or
 * switched on once and suspended since.
 */
export const bucketModeOf = (settings: CosSettings) =>
  Effect.tryPromise({
    try: async (): Promise<CosBucketMode | 'suspended'> => {
      const cos = new COS({
        SecretId: Redacted.value(settings.secretId),
        SecretKey: Redacted.value(settings.secretKey),
      })
      const answer = await cos.getBucketVersioning({
        Bucket: settings.bucket,
        Region: settings.region,
      })
      const status = answer.VersioningConfiguration?.Status
      if (status === 'Enabled') return 'versioned'
      if (status === 'Suspended') return 'suspended'
      return 'single'
    },
    catch: (cause) => backendFailure('versioning', cause),
  })

const statusOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : undefined

/** the header names come back lower-cased; the sdk types them loosely */
const headerOf = (headers: Record<string, unknown> | undefined, name: string) => {
  const value = headers?.[name]
  return value === undefined || value === null ? undefined : String(value)
}

export const cosBackend = (
  settings: CosSettings,
  mode: CosBucketMode = 'single',
): StorageBackend => {
  const cos = new COS({
    SecretId: Redacted.value(settings.secretId),
    SecretKey: Redacted.value(settings.secretKey),
  })
  const object = (key: string) => ({
    Bucket: settings.bucket,
    Region: settings.region,
    Key: key,
  })

  /** one page of what the bucket keeps under a prefix: versions and delete markers alike */
  const list = (prefix: string, cursor: string | undefined) =>
    Effect.tryPromise({
      try: async () => {
        const page = await cos.listObjectVersions({
          Bucket: settings.bucket,
          Region: settings.region,
          Prefix: prefix,
          MaxKeys: '1000',
          // the sdk's own typing names the key marker `Marker`; what it
          // sends is `KeyMarker`, so that is what this passes
          ...(positionOf(cursor) as Record<string, string>),
        })
        const entries: RevisionEntry[] = [
          ...page.Versions.map((version) => ({
            key: version.Key,
            revision: revisionOf(version.VersionId),
            deleteMarker: false,
            modifiedAt: Date.parse(version.LastModified),
          })),
          ...page.DeleteMarkers.map((marker) => ({
            key: marker.Key,
            revision: revisionOf(marker.VersionId),
            deleteMarker: true,
            modifiedAt: Date.parse(marker.LastModified),
          })),
        ]
        const raw = page as unknown as Record<string, unknown>
        const nextKey = raw['NextKeyMarker'] ?? raw['NextMarker']
        const next =
          String(page.IsTruncated) === 'true' && typeof nextKey === 'string'
            ? cursorOf(nextKey, revisionOf(raw['NextVersionIdMarker']))
            : undefined
        return { entries, next }
      },
      catch: (cause) => backendFailure('list', cause),
    })

  /** exactly one version or marker; cos answers one that is not there with success */
  const remove = (key: string, revision: string | undefined) =>
    Effect.tryPromise({
      try: () =>
        cos.deleteObject({
          ...object(key),
          // the "null" version is how cos names what the key held before it
          // kept versions, and it is removed by that name
          VersionId: revision ?? 'null',
        } as COS.DeleteObjectParams),
      catch: (cause) => backendFailure('delete', cause),
    }).pipe(Effect.asVoid)

  const revisions: RevisionStore = { list, remove }

  /**
   * Every version and marker under exactly this key.
   *
   * A delete that names no version only lays a marker over the key in a bucket
   * that keeps versions, and the bytes stay; so this lists what is there and
   * removes each one by name. The listing is by prefix, and a key is also the
   * prefix of any longer key, so only entries for this key are touched.
   */
  const purge = (key: string): Effect.Effect<void, BackendUnavailable> =>
    Effect.gen(function* () {
      let cursor: string | undefined
      do {
        const page = yield* list(key, cursor)
        for (const entry of page.entries) {
          if (entry.key === key) yield* remove(entry.key, entry.revision)
        }
        cursor = page.next
      } while (cursor !== undefined)
    })

  return {
    code: 'cos',

    prepareUpload: (request) =>
      credentialForObject({
        secretId: settings.secretId,
        secretKey: settings.secretKey,
        region: settings.region,
        bucket: settings.bucket,
        key: request.key,
        maxBytes: request.maxBytes,
        seconds: (request.grantExpiresAt.getTime() - Date.now()) / 1000,
      }).pipe(
        Effect.map((credential) => ({
          driver: 'cos',
          payload: {
            bucket: settings.bucket,
            region: settings.region,
            key: request.key,
            tmpSecretId: credential.tmpSecretId,
            tmpSecretKey: credential.tmpSecretKey,
            sessionToken: credential.sessionToken,
            startTime: credential.startTime,
            expiredTime: credential.expiredTime,
            maxBytes: request.maxBytes.toString(),
          } satisfies CosUploadPayload,
        })),
      ),

    /**
     * What the bucket says about the object.
     *
     * The size comes from the response header rather than from anything the
     * uploader reported, and the fingerprint is the crc64 the store computed
     * as it wrote - which is why it is kept as a string: it is a 64-bit
     * integer, and putting it through a javascript number would quietly round
     * the fingerprint of a file.
     */
    stat: (key) =>
      Effect.tryPromise({
        try: async (): Promise<BlobStat | null> => {
          try {
            const head = await cos.headObject(object(key))
            const headers = head.headers
            const length = headerOf(headers, 'content-length')
            const crc64 = headerOf(headers, 'x-cos-hash-crc64ecma')
            if (length === undefined || crc64 === undefined) {
              throw new Error('head response carried no length or checksum')
            }
            // the version this answer is about: the checks core storage makes
            // on the size and the checksum hold for it, and for no other
            const revision = revisionOf(headerOf(headers, 'x-cos-version-id'))
            return {
              size: BigInt(length),
              integrityAlgorithm: 'crc64-ecma',
              integrityValue: crc64,
              ...(head.ETag === undefined ? {} : { etag: head.ETag }),
              ...(revision === undefined ? {} : { revision }),
            }
          } catch (error) {
            if (statusOf(error) === 404) return null
            throw error
          }
        },
        catch: (cause) => backendFailure('stat', cause),
      }),

    /**
     * A url that works for a minute and then does not.
     *
     * Signed here with the deployment's own credential rather than handed to
     * the browser: the bucket is private, there is no permanent public url for
     * any attachment, and a link somebody copies out of the address bar stops
     * working before they can paste it anywhere useful.
     */
    open: ({ key, revision }, options) =>
      Effect.tryPromise({
        try: async () => {
          const url = await new Promise<string>((resolve, reject) => {
            cos.getObjectUrl(
              {
                ...object(key),
                Sign: true,
                Method: 'GET',
                Expires: DOWNLOAD_TTL_SECONDS,
                ...(settings.downloadDomain === undefined
                  ? {}
                  : { Domain: settings.downloadDomain }),
                Query: {
                  // Two of the three rules §18 freezes, and the third is not
                  // expressible here: a signed url may override the content
                  // type, the disposition and a handful of caching headers,
                  // and nothing else - so `X-Content-Type-Options: nosniff`
                  // cannot ride this delivery the way it rides the streamed
                  // one. The disposition is what carries the weight anyway:
                  // a browser told to save a file never sniffs it.
                  //
                  // the browser must save it rather than render it: an html or
                  // svg attachment displayed inline would be somebody else's
                  // script running on a url this deployment vouched for
                  'response-content-disposition': `attachment; filename="${options.filename.replaceAll(
                    /["\r\n]/g,
                    '',
                  )}"`,
                  'response-content-type': options.mime,
                  // signed with the rest: the version the attachment
                  // completed with, whatever was written to the key since
                  ...(revision === undefined || revision === null ? {} : { versionId: revision }),
                },
              },
              (error, data) => {
                if (error) reject(error)
                else resolve(data.Url)
              },
            )
          })
          return { kind: 'redirect' as const, url, expiresInSeconds: DOWNLOAD_TTL_SECONDS }
        },
        catch: (cause) => backendFailure('open', cause),
      }),

    delete: (key) =>
      mode === 'versioned'
        ? purge(key)
        : Effect.tryPromise({
            // cos answers a delete of what is not there with success, which is
            // what a sweeper that may run twice needs
            try: () => cos.deleteObject(object(key)),
            catch: (cause) => backendFailure('delete', cause),
          }).pipe(Effect.asVoid),

    ...(mode === 'versioned' ? { revisions } : {}),
  }
}
