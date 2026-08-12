import { randomUUID } from 'node:crypto'
import COS from 'cos-nodejs-sdk-v5'
import { Effect, Redacted } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import { backendContract } from '@qualy/plugin-storage/testkit/contract'
import { cosBackend, type CosSettings } from '../src/server/backend.ts'

// The real bucket, when somebody asks for it.
//
// Opt-in because a suite that needs credentials is a suite that fails on every
// machine without them, and `pnpm test` has to be green on a laptop with no
// cloud account. Set QUALY_TEST_COS=1 with the deployment's own variables to
// run it.
//
// What it buys is the half that cannot be checked any other way: that the
// temporary credential really is confined to one object, that the store really
// refuses a second write to that object, and that a head request really
// carries the length and checksum the attachment is built from.

const enabled = process.env['QUALY_TEST_COS'] === '1'
const region = process.env['QUALY_STORAGE_COS_REGION']
const bucket = process.env['QUALY_STORAGE_COS_BUCKET']
const secretId = process.env['QUALY_STORAGE_COS_SECRET_ID']
const secretKey = process.env['QUALY_STORAGE_COS_SECRET_KEY']
const configured = Boolean(enabled && region && bucket && secretId && secretKey)

if (enabled && !configured) {
  throw new Error(
    'QUALY_TEST_COS=1 but the cos variables are not all set; run with node --env-file=.env',
  )
}

const settings: CosSettings = {
  region: region ?? '',
  bucket: bucket ?? '',
  secretId: Redacted.make(secretId ?? ''),
  secretKey: Redacted.make(secretKey ?? ''),
}

const backend = () => cosBackend(settings)

/** every key this run created, so the bucket is left as it was found */
const written: string[] = []

/**
 * Uploads the way a browser does: with the temporary credential, to the one
 * key it names, refusing to replace anything.
 *
 * The node sdk stands in for the browser one here - they speak the same api,
 * and what is under test is the credential rather than the transport.
 */
const write = async (key: string, bytes: Uint8Array) => {
  written.push(key)
  const grant = await Effect.runPromise(
    backend().prepareUpload({
      tenantId: randomUUID(),
      ownerUserId: randomUUID(),
      attachmentId: randomUUID(),
      reservationId: randomUUID(),
      key,
      maxBytes: BigInt(bytes.byteLength),
      grantExpiresAt: new Date(Date.now() + 15 * 60_000),
    }),
  )
  const payload = grant.payload as {
    tmpSecretId: string
    tmpSecretKey: string
    sessionToken: string
  }
  // the node sdk takes the token but not the validity window the browser one
  // caches by; the credential carries its own expiry either way
  const client = new COS({
    SecretId: payload.tmpSecretId,
    SecretKey: payload.tmpSecretKey,
    SecurityToken: payload.sessionToken,
  })
  await client.putObject({
    Bucket: settings.bucket,
    Region: settings.region,
    Key: key,
    Body: Buffer.from(bytes),
    ContentLength: bytes.byteLength,
    Headers: { 'x-cos-forbid-overwrite': 'true' },
  })
}

describe.skipIf(!configured)('the cos backend against a real bucket', () => {
  afterAll(async () => {
    await Promise.all(
      written.map((key) => Effect.runPromise(backend().delete(key)).catch(() => {})),
    )
  })

  for (const check of backendContract(() => ({ backend: backend(), write }))) {
    it(check.name, check.run, 30_000)
  }

  it('refuses a credential its key does not name', async () => {
    const mine = `attachments/${randomUUID()}/${randomUUID()}`
    const somebodyElses = `attachments/${randomUUID()}/${randomUUID()}`
    const grant = await Effect.runPromise(
      backend().prepareUpload({
        tenantId: randomUUID(),
        ownerUserId: randomUUID(),
        attachmentId: randomUUID(),
        reservationId: randomUUID(),
        key: mine,
        maxBytes: 64n,
        grantExpiresAt: new Date(Date.now() + 15 * 60_000),
      }),
    )
    const payload = grant.payload as {
      tmpSecretId: string
      tmpSecretKey: string
      sessionToken: string
    }
    const client = new COS({
      SecretId: payload.tmpSecretId,
      SecretKey: payload.tmpSecretKey,
      SecurityToken: payload.sessionToken,
    })

    await expect(
      client.putObject({
        Bucket: settings.bucket,
        Region: settings.region,
        Key: somebodyElses,
        Body: Buffer.from('not mine'),
      }),
    ).rejects.toBeTruthy()
    expect(await Effect.runPromise(backend().stat(somebodyElses))).toBeNull()
  }, 30_000)

  it('refuses more bytes than the credential allowed', async () => {
    const key = `attachments/${randomUUID()}/${randomUUID()}`
    written.push(key)
    const grant = await Effect.runPromise(
      backend().prepareUpload({
        tenantId: randomUUID(),
        ownerUserId: randomUUID(),
        attachmentId: randomUUID(),
        reservationId: randomUUID(),
        key,
        maxBytes: 8n,
        grantExpiresAt: new Date(Date.now() + 15 * 60_000),
      }),
    )
    const payload = grant.payload as {
      tmpSecretId: string
      tmpSecretKey: string
      sessionToken: string
    }
    const client = new COS({
      SecretId: payload.tmpSecretId,
      SecretKey: payload.tmpSecretKey,
      SecurityToken: payload.sessionToken,
    })

    const oversized = Buffer.from('a'.repeat(4096))
    await expect(
      client.putObject({
        Bucket: settings.bucket,
        Region: settings.region,
        Key: key,
        Body: oversized,
        ContentLength: oversized.byteLength,
      }),
    ).rejects.toBeTruthy()
    expect(await Effect.runPromise(backend().stat(key))).toBeNull()
  }, 30_000)

  it('signs a read url that carries the download disposition', async () => {
    const key = `attachments/${randomUUID()}/${randomUUID()}`
    await write(key, Buffer.from('downloadable'))
    const opened = await Effect.runPromise(
      backend().open(key, { filename: 'report.pdf', mime: 'application/pdf' }),
    )
    expect(opened.kind).toBe('redirect')
    if (opened.kind !== 'redirect') return
    expect(opened.url).toContain('q-signature=')
    // a tls reset on the way to another continent is not a fact about the
    // signature, and this suite has seen one
    const response = await fetch(opened.url).catch(() => fetch(opened.url))
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(await response.text()).toBe('downloadable')
  }, 30_000)
})
