import { Effect, Redacted } from 'effect'
import COS from 'cos-nodejs-sdk-v5'
import { backendFailure } from '@qualy/plugin-storage/errors'
import type { BlobStat, StorageBackend } from '@qualy/plugin-storage/backend'
import type { CosUploadPayload } from '../payload.ts'
import { credentialForObject } from './sts.ts'

// Tencent cloud object storage, as three calls and a signature.
//
// The bytes never pass through this process: a browser writes them straight to
// the bucket with a credential minted here, and everything this file does
// afterwards is ask the bucket what actually arrived. That is the whole reason
// `stat` is trusted and the uploader is not.

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

const statusOf = (error: unknown) =>
  typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode?: unknown }).statusCode)
    : undefined

/** the header names come back lower-cased; the sdk types them loosely */
const headerOf = (headers: Record<string, unknown> | undefined, name: string) => {
  const value = headers?.[name]
  return value === undefined || value === null ? undefined : String(value)
}

export const cosBackend = (settings: CosSettings): StorageBackend => {
  const cos = new COS({
    SecretId: Redacted.value(settings.secretId),
    SecretKey: Redacted.value(settings.secretKey),
  })
  const object = (key: string) => ({
    Bucket: settings.bucket,
    Region: settings.region,
    Key: key,
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
            const headers = head.headers as Record<string, unknown> | undefined
            const length = headerOf(headers, 'content-length')
            const crc64 = headerOf(headers, 'x-cos-hash-crc64ecma')
            if (length === undefined || crc64 === undefined) {
              throw new Error('head response carried no length or checksum')
            }
            return {
              size: BigInt(length),
              integrityAlgorithm: 'crc64-ecma',
              integrityValue: crc64,
              ...(head.ETag === undefined ? {} : { etag: head.ETag }),
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
    open: (key, options) =>
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
                  // the browser must save it rather than render it: an html or
                  // svg attachment displayed inline would be somebody else's
                  // script running on a url this deployment vouched for
                  'response-content-disposition': `attachment; filename="${options.filename.replaceAll(
                    /["\r\n]/g,
                    '',
                  )}"`,
                  'response-content-type': options.mime,
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
      Effect.tryPromise({
        // cos answers a delete of what is not there with success, which is
        // what a sweeper that may run twice needs
        try: () => cos.deleteObject(object(key)),
        catch: (cause) => backendFailure('delete', cause),
      }).pipe(Effect.asVoid),
  }
}
