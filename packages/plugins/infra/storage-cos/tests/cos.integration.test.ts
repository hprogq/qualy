import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import {
  backend as cosBackendUnderTest,
  clientFor,
  cosConfigured,
  cosSettings,
  fetchWithRetry,
  grantFor,
  versionedBackend,
  versionedConfigured,
  versionedSettings,
} from './support/bucket.ts'
import { backendContract } from '@qualy/plugin-storage/testkit/contract'
import { bucketModeOf, type CosSettings } from '../src/server/backend.ts'

// The real bucket, when somebody asks for it.
//
// Opt-in because a suite that needs credentials is a suite that fails on every
// machine without them, and `pnpm test` has to be green on a laptop with no
// cloud account. Set QUALY_TEST_COS=1 with the deployment's own variables to
// run it.
//
// What it buys is the half that cannot be checked any other way: that a head
// request really carries the length and checksum an attachment is built from,
// that a bucket which never kept versions really refuses a second write, and
// that in one which keeps them - where that refusal silently does nothing - a
// read still gets the bytes that were checked. The second needs
// QUALY_TEST_COS_VERSIONED_BUCKET as well. What a stolen credential cannot do
// is next door, in the hostile suite.

const backend = cosBackendUnderTest

/** every key this run created, so each bucket is left as it was found */
const written: { key: string; versioned: boolean }[] = []

/**
 * Uploads the way a browser does: with the temporary credential, to the one
 * key it names, refusing to replace anything.
 *
 * The node sdk stands in for the browser one here - they speak the same api,
 * and what is under test is the credential rather than the transport.
 */
const writeTo = (settings: CosSettings) => async (key: string, bytes: Uint8Array) => {
  written.push({ key, versioned: settings === versionedSettings })
  const payload = await grantFor(key, BigInt(bytes.byteLength), settings)
  await clientFor(payload).putObject({
    Bucket: payload.bucket,
    Region: payload.region,
    Key: key,
    Body: Buffer.from(bytes),
    ContentLength: bytes.byteLength,
    Headers: { 'x-cos-forbid-overwrite': 'true', 'x-cos-acl': 'private' },
  })
}

const write = writeTo(cosSettings)

const fetchBytes = async (url: string) => {
  const response = await fetchWithRetry(url)
  if (response.status !== 200) throw new Error(`fetching a signed url answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

afterAll(async () => {
  await Promise.all(
    written.map(({ key, versioned }) =>
      Effect.runPromise((versioned ? versionedBackend() : backend()).delete(key)).catch(() => {}),
    ),
  )
})

describe.skipIf(!cosConfigured)('the cos backend against a real bucket', () => {
  it('finds a bucket that never kept versions', async () => {
    expect(await Effect.runPromise(bucketModeOf(cosSettings))).toBe('single')
  }, 30_000)

  for (const check of backendContract(() => ({
    backend: backend(),
    write,
    fetch: fetchBytes,
  }))) {
    it(check.name, check.run, 30_000)
  }

  it('signs a read url that carries the download disposition', async () => {
    const key = `attachments/${randomUUID()}/${randomUUID()}`
    await write(key, Buffer.from('downloadable'))
    const opened = await Effect.runPromise(
      backend().open({ key }, { filename: 'report.pdf', mime: 'application/pdf' }),
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

describe.skipIf(!versionedConfigured)(
  'the cos backend against a bucket that keeps versions',
  () => {
    const writeVersioned = writeTo(versionedSettings)

    it('finds that the bucket keeps versions', async () => {
      expect(await Effect.runPromise(bucketModeOf(versionedSettings))).toBe('versioned')
    }, 30_000)

    for (const check of backendContract(() => ({
      backend: versionedBackend(),
      write: writeVersioned,
      fetch: fetchBytes,
    }))) {
      it(check.name, check.run, 30_000)
    }

    // the refusal header the credential demands is accepted and then ignored
    // here, so the second write lands; what matters is what a read gets
    it('reads the checked version after the same credential writes again', async () => {
      const key = `attachments/${randomUUID()}/${randomUUID()}`
      const payload = await grantFor(key, 64n, versionedSettings)
      written.push({ key, versioned: true })
      const put = (text: string) =>
        clientFor(payload).putObject({
          Bucket: payload.bucket,
          Region: payload.region,
          Key: key,
          Body: Buffer.from(text),
          ContentLength: Buffer.byteLength(text),
          Headers: { 'x-cos-forbid-overwrite': 'true', 'x-cos-acl': 'private' },
        })
      await put('checked')
      const cos = versionedBackend()
      const checked = await Effect.runPromise(cos.stat(key))
      expect(checked?.revision).toBeDefined()
      await put('swapped in later')

      const newest = await Effect.runPromise(cos.stat(key))
      expect(newest?.revision).not.toBe(checked?.revision)
      const opened = await Effect.runPromise(
        cos.open({ key, revision: checked!.revision }, { filename: 'a.txt', mime: 'text/plain' }),
      )
      if (opened.kind !== 'redirect') throw new Error('cos signs a url')
      expect(Buffer.from(await fetchBytes(opened.url)).toString()).toBe('checked')

      // the later version is listed, and removing it by name leaves the checked one
      const listed = await Effect.runPromise(cos.revisions!.list(key, undefined))
      const mine = listed.entries.filter((entry) => entry.key === key)
      expect(mine).toHaveLength(2)
      expect(new Set(mine.map((entry) => entry.revision))).toEqual(
        new Set([checked!.revision, newest!.revision]),
      )
      await Effect.runPromise(cos.revisions!.remove(key, newest!.revision))
      expect((await Effect.runPromise(cos.stat(key)))?.revision).toBe(checked!.revision)
    }, 60_000)
  },
)
