import { Effect, Redacted } from 'effect'
import STS from 'qcloud-cos-sts'
import { backendFailure } from '@qualy/plugin-storage/errors'
import { objectWritePolicy } from './policy.ts'

// Asking tencent cloud for a credential that can write one object.
//
// The sdk is callback-first with a promise overload; the promise is used, and
// its rejection becomes a backend fault rather than a defect - a temporary
// credential service being unreachable is an outage, not a bug, and the caller
// has a reservation to release either way.

export interface TemporaryCredential {
  readonly tmpSecretId: string
  readonly tmpSecretKey: string
  readonly sessionToken: string
  /** seconds since the epoch, as the sdk reports them */
  readonly startTime: number
  readonly expiredTime: number
}

/** the shortest and longest lifetimes the api accepts, in seconds */
const MIN_DURATION = 900
const MAX_DURATION = 7200

export const credentialForObject = (input: {
  readonly secretId: Redacted.Redacted
  readonly secretKey: Redacted.Redacted
  readonly region: string
  readonly bucket: string
  readonly key: string
  readonly maxBytes: bigint
  readonly seconds: number
}): Effect.Effect<TemporaryCredential, ReturnType<typeof backendFailure>> =>
  Effect.tryPromise({
    try: async () => {
      const data = await STS.getCredential({
        secretId: Redacted.value(input.secretId),
        secretKey: Redacted.value(input.secretKey),
        region: input.region,
        durationSeconds: Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.ceil(input.seconds))),
        policy: objectWritePolicy({
          region: input.region,
          bucket: input.bucket,
          key: input.key,
          maxBytes: input.maxBytes,
        }),
      })
      return {
        tmpSecretId: data.credentials.tmpSecretId,
        tmpSecretKey: data.credentials.tmpSecretKey,
        sessionToken: data.credentials.sessionToken,
        startTime: data.startTime,
        expiredTime: data.expiredTime,
      }
    },
    catch: (cause) => backendFailure('sts', cause),
  })
