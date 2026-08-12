import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import {
  backend as cosBackendUnderTest,
  clientFor,
  cosConfigured,
  fetchWithRetry,
  grantFor,
} from './support/bucket.ts'
import { backendContract } from '@qualy/plugin-storage/testkit/contract'

// The real bucket, when somebody asks for it.
//
// Opt-in because a suite that needs credentials is a suite that fails on every
// machine without them, and `pnpm test` has to be green on a laptop with no
// cloud account. Set QUALY_TEST_COS=1 with the deployment's own variables to
// run it.
//
// What it buys is the half that cannot be checked any other way: that a head
// request really carries the length and checksum an attachment is built from,
// and that the store really refuses a second write to an object. What a
// stolen credential cannot do is next door, in the hostile suite.

const backend = cosBackendUnderTest

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
  const payload = await grantFor(key, BigInt(bytes.byteLength))
  await clientFor(payload).putObject({
    Bucket: payload.bucket,
    Region: payload.region,
    Key: key,
    Body: Buffer.from(bytes),
    ContentLength: bytes.byteLength,
    Headers: { 'x-cos-forbid-overwrite': 'true', 'x-cos-acl': 'private' },
  })
}

describe.skipIf(!cosConfigured)('the cos backend against a real bucket', () => {
  afterAll(async () => {
    await Promise.all(
      written.map((key) => Effect.runPromise(backend().delete(key)).catch(() => {})),
    )
  })

  for (const check of backendContract(() => ({ backend: backend(), write }))) {
    it(check.name, check.run, 30_000)
  }

  it('signs a read url that carries the download disposition', async () => {
    const key = `attachments/${randomUUID()}/${randomUUID()}`
    await write(key, Buffer.from('downloadable'))
    const opened = await Effect.runPromise(
      backend().open(key, { filename: 'report.pdf', mime: 'application/pdf' }),
    )
    expect(opened.kind).toBe('redirect')
    if (opened.kind !== 'redirect') return
    expect(opened.url).toContain('q-signature=')
    const response = await fetchWithRetry(opened.url)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-disposition')).toContain('attachment')
    expect(await response.text()).toBe('downloadable')
  }, 30_000)
})
