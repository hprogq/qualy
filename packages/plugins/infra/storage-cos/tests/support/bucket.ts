import COS from 'cos-nodejs-sdk-v5'
import { Effect, Redacted } from 'effect'
import { postgresAvailable } from '@qualy/plugin-database/testkit'
import { cosBackend, type CosSettings } from '../../src/server/backend.ts'
import type { CosUploadPayload } from '../../src/payload.ts'

// The real bucket, for the two suites that talk to it.
//
// Opt-in: a suite that needs credentials fails on every machine without them,
// and `pnpm test` has to be green on a laptop with no cloud account.

const enabled = process.env['QUALY_TEST_COS'] === '1'
const region = process.env['QUALY_STORAGE_COS_REGION']
const bucket = process.env['QUALY_STORAGE_COS_BUCKET']
const secretId = process.env['QUALY_STORAGE_COS_SECRET_ID']
const secretKey = process.env['QUALY_STORAGE_COS_SECRET_KEY']
// a second bucket with versioning switched on, reached with the same
// credential; the suites that need one skip without it
const versionedBucket = process.env['QUALY_TEST_COS_VERSIONED_BUCKET']

export const cosConfigured = Boolean(enabled && region && bucket && secretId && secretKey)
export const versionedConfigured = Boolean(cosConfigured && versionedBucket)
export const cosAndPostgres = cosConfigured && postgresAvailable

if (enabled && !cosConfigured) {
  throw new Error(
    'QUALY_TEST_COS=1 but the cos variables are not all set; run with node --env-file=.env',
  )
}

export const cosSettings: CosSettings = {
  region: region ?? '',
  bucket: bucket ?? '',
  secretId: Redacted.make(secretId ?? ''),
  secretKey: Redacted.make(secretKey ?? ''),
}

export const versionedSettings: CosSettings = { ...cosSettings, bucket: versionedBucket ?? '' }

export const backend = () => cosBackend(cosSettings)

/** the backend as a deployment builds it over the versioned bucket */
export const versionedBackend = () => cosBackend(versionedSettings, 'versioned')

export const grantFor = (key: string, maxBytes: bigint, settings: CosSettings = cosSettings) =>
  Effect.runPromise(
    cosBackend(settings)
      .prepareUpload({
        tenantId: crypto.randomUUID(),
        ownerUserId: crypto.randomUUID(),
        attachmentId: crypto.randomUUID(),
        reservationId: crypto.randomUUID(),
        key,
        maxBytes,
        grantExpiresAt: new Date(Date.now() + 15 * 60_000),
      })
      .pipe(Effect.map((grant) => grant.payload as CosUploadPayload)),
  )

/** a client holding exactly what the browser would hold, and nothing more */
export const clientFor = (payload: CosUploadPayload) =>
  new COS({
    SecretId: payload.tmpSecretId,
    SecretKey: payload.tmpSecretKey,
    SecurityToken: payload.sessionToken,
  })

/**
 * Fetches over the public internet, which sometimes simply does not work.
 *
 * A tls reset on the way to another continent is not a fact about this code,
 * and a test that reports it as one gets ignored within a week.
 */
export const fetchWithRetry = async (url: string, attempts = 3): Promise<Response> => {
  let last: unknown
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await fetch(url)
    } catch (error) {
      last = error
    }
  }
  throw last
}
