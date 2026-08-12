import { randomUUID } from 'node:crypto'
import COS from 'cos-nodejs-sdk-v5'
import { Effect, Exit, Layer, Redacted } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestContext,
  databaseFor,
  postgresAvailable,
  type TestContext,
} from '@qualy/plugin-database/testkit'
import { entities } from '@qualy/plugin-storage/db'
import { DEFAULT_LIMITS, StorageConfig } from '@qualy/plugin-storage/server'
import { registryLayer, StorageBackends } from '@qualy/plugin-storage/server/registry'
import { Storage, serviceLayer } from '@qualy/plugin-storage/server/service'
import { cosBackend, type CosSettings } from '../src/server/backend.ts'
import type { CosUploadPayload } from '../src/payload.ts'

// One file, all the way through, against the real bucket.
//
// The other suites each prove half of it: the core suite proves the service
// does the right bookkeeping with an in-memory store, and the backend suite
// proves the bucket behaves. Neither proves they meet - that the credential
// the service hands out is one the bucket accepts, and that the attachment row
// afterwards carries the checksum the bucket actually computed.
//
// Opt-in like its sibling: QUALY_TEST_COS=1 plus the deployment's variables.

const enabled = process.env['QUALY_TEST_COS'] === '1'
const region = process.env['QUALY_STORAGE_COS_REGION']
const bucket = process.env['QUALY_STORAGE_COS_BUCKET']
const secretId = process.env['QUALY_STORAGE_COS_SECRET_ID']
const secretKey = process.env['QUALY_STORAGE_COS_SECRET_KEY']
const configured = Boolean(
  enabled && region && bucket && secretId && secretKey && postgresAvailable,
)

const settings: CosSettings = {
  region: region ?? '',
  bucket: bucket ?? '',
  secretId: Redacted.make(secretId ?? ''),
  secretKey: Redacted.make(secretKey ?? ''),
}

const stack = (url: string) => {
  const config = Layer.succeed(StorageConfig, {
    defaultBackend: 'cos',
    limits: DEFAULT_LIMITS,
  })
  const registered = Layer.effectDiscard(
    Effect.flatMap(StorageBackends, (registry) => registry.register(cosBackend(settings))),
  ).pipe(Layer.provideMerge(registryLayer), Layer.provideMerge(config))
  return serviceLayer.pipe(
    Layer.provideMerge(registered),
    Layer.provideMerge(databaseFor(url, { entities: [...entities] })),
  )
}

/**
 * Fetches over the public internet, which sometimes simply does not work.
 *
 * A tls reset on the way to another continent is not a fact about this code,
 * and a test that reports it as one gets ignored within a week.
 */
const fetchWithRetry = async (url: string, attempts = 3): Promise<Response> => {
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

/** the browser's half, done here with the node sdk and the same credential */
const putWithGrant = async (payload: CosUploadPayload, bytes: Buffer) => {
  const client = new COS({
    SecretId: payload.tmpSecretId,
    SecretKey: payload.tmpSecretKey,
    SecurityToken: payload.sessionToken,
  })
  await client.putObject({
    Bucket: payload.bucket,
    Region: payload.region,
    Key: payload.key,
    Body: bytes,
    ContentLength: bytes.byteLength,
    ContentType: 'text/plain',
    Headers: { 'x-cos-forbid-overwrite': 'true' },
  })
}

describe.skipIf(!configured)('an attachment, end to end, on the real bucket', () => {
  let context: TestContext
  const written: string[] = []
  beforeAll(async () => {
    context = await createTestContext('storage-cos-e2e')
  })
  afterAll(async () => {
    await Promise.all(
      written.map((key) => Effect.runPromise(cosBackend(settings).delete(key)).catch(() => {})),
    )
    await context?.dispose()
  })

  it('reserves, uploads, completes, reads back and binds', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const bytes = Buffer.from(`qualy end-to-end ${randomUUID()}`)

    const result = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const storage = yield* Storage

        const ticket = yield* storage.prepareUpload({
          tenantId,
          ownerUserId,
          filename: '证明材料.pdf',
          declaredMime: 'application/pdf',
          size: BigInt(bytes.byteLength),
        })
        expect(ticket.grant.driver).toBe('cos')
        const payload = ticket.grant.payload as CosUploadPayload
        written.push(payload.key)
        // the server chose the key; the credential is only good for that one
        expect(payload.key).toBe(`attachments/${tenantId}/${ticket.attachmentId}`)

        yield* Effect.promise(() => putWithGrant(payload, bytes))

        const meta = yield* storage.completeUpload({
          tenantId,
          ownerUserId,
          reservationId: ticket.reservationId,
        })

        const opened = yield* storage.open({ tenantId, attachmentId: meta.id }, () => Effect.void)
        const bound = yield* storage.bind({ tenantId, attachmentId: meta.id, ownerUserId })
        return { ticket, meta, opened, bound }
      }).pipe(Effect.provide(stack(context.url))),
    )

    if (Exit.isFailure(result)) throw new Error(JSON.stringify(result.cause, null, 2))
    const { meta, opened, bound } = result.value

    // the size and fingerprint came from the bucket, not from anything above
    expect(meta.size).toBe(BigInt(bytes.byteLength))
    expect(meta.integrityAlgorithm).toBe('crc64-ecma')
    expect(meta.integrityValue).toMatch(/^\d+$/)
    expect(meta.backend).toBe('cos')
    expect(meta.status).toBe('staged')

    // the row says the same thing the service returned
    const row = await context.row<{ size: string; backend: string; status: string }>(
      'select size::text as size, backend, status from storage_attachments where id = $1',
      [meta.id],
    )
    expect(row).toMatchObject({ size: String(bytes.byteLength), backend: 'cos', status: 'bound' })

    // and the signed url really serves those bytes
    expect(opened.target.kind).toBe('redirect')
    if (opened.target.kind !== 'redirect') return
    const response = await fetchWithRetry(opened.target.url)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer()).equals(bytes)).toBe(true)
    expect(response.headers.get('content-disposition')).toContain('attachment')

    expect(bound.status).toBe('bound')
    expect(bound.boundAt).not.toBeNull()
  }, 60_000)

  it('refuses a second upload on a completed ticket, and keeps the first object', async () => {
    const tenantId = randomUUID()
    const ownerUserId = randomUUID()
    const first = Buffer.from('the original')

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const storage = yield* Storage
        const ticket = yield* storage.prepareUpload({
          tenantId,
          ownerUserId,
          filename: 'once.txt',
          declaredMime: 'text/plain',
          size: BigInt(first.byteLength),
        })
        const payload = ticket.grant.payload as CosUploadPayload
        written.push(payload.key)
        yield* Effect.promise(() => putWithGrant(payload, first))
        yield* storage.completeUpload({
          tenantId,
          ownerUserId,
          reservationId: ticket.reservationId,
        })
        // the same credential, a second time: the bucket refuses it
        return yield* Effect.promise(() =>
          putWithGrant(payload, Buffer.from('the replacement')).then(
            () => 'accepted' as const,
            () => 'refused' as const,
          ),
        )
      }).pipe(Effect.provide(stack(context.url))),
    )

    expect(Exit.isSuccess(exit) && exit.value).toBe('refused')
  }, 60_000)
})
