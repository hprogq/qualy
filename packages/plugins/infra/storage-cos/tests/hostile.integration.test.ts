import { randomUUID } from 'node:crypto'
import { Effect } from 'effect'
import { afterAll, describe, expect, it } from 'vitest'
import { backend, clientFor, cosConfigured, cosSettings, grantFor } from './support/bucket.ts'

// What the credential is for, and everything it is not for.
//
// Written from the attacker's side: the upload helper is not used at all,
// because an attacker would not use it either. They hold the temporary
// credential and compose whatever PUT they like - a different key, a bigger
// body, a second write, and above all a write that publishes the object to
// anyone with the url. Every one of those has to come back refused by the
// store, not by anything on this side of the wire.

const key = () => `attachments/${randomUUID()}/${randomUUID()}`

/** the status the store refused with, or 'accepted' when it did not refuse */
const refusal = async (work: Promise<unknown>): Promise<number | 'accepted'> => {
  try {
    await work
    return 'accepted'
  } catch (error) {
    const status = (error as { statusCode?: number }).statusCode
    return status ?? 0
  }
}

describe.skipIf(!cosConfigured)('what a stolen upload credential cannot do', () => {
  const written: string[] = []
  afterAll(async () => {
    await Promise.all(written.map((k) => Effect.runPromise(backend().delete(k)).catch(() => {})))
  })

  it('writes the object it was issued for', async () => {
    const target = key()
    written.push(target)
    const payload = await grantFor(target, 64n)
    const result = await refusal(
      clientFor(payload).putObject({
        Bucket: payload.bucket,
        Region: payload.region,
        Key: target,
        Body: Buffer.from('legitimate'),
        ContentLength: 10,
        Headers: { 'x-cos-forbid-overwrite': 'true', 'x-cos-acl': 'private' },
      }),
    )
    expect(result).toBe('accepted')
  }, 30_000)

  it('cannot publish the object it writes', async () => {
    const target = key()
    written.push(target)
    const payload = await grantFor(target, 64n)
    const result = await refusal(
      clientFor(payload).putObject({
        Bucket: payload.bucket,
        Region: payload.region,
        Key: target,
        Body: Buffer.from('published?'),
        ContentLength: 10,
        // the whole attack: one extra header on an otherwise valid write
        Headers: { 'x-cos-forbid-overwrite': 'true', 'x-cos-acl': 'public-read' },
      }),
    )
    expect(result).toBe(403)
    // and nothing landed, so a refused publish is not a stored object either
    expect(await Effect.runPromise(backend().stat(target))).toBeNull()
  }, 30_000)

  it('cannot hand the object to a named account', async () => {
    const target = key()
    written.push(target)
    const payload = await grantFor(target, 64n)
    const grants = [
      'x-cos-grant-read',
      'x-cos-grant-read-acp',
      'x-cos-grant-write-acp',
      'x-cos-grant-full-control',
    ]
    for (const header of grants) {
      const result = await refusal(
        clientFor(payload).putObject({
          Bucket: payload.bucket,
          Region: payload.region,
          Key: target,
          Body: Buffer.from('granted?'),
          ContentLength: 8,
          Headers: {
            'x-cos-forbid-overwrite': 'true',
            'x-cos-acl': 'private',
            [header]: 'id="qcs::cam::uin/100000000001:uin/100000000001"',
          },
        }),
      )
      expect({ header, result }).toEqual({ header, result: 403 })
    }
    expect(await Effect.runPromise(backend().stat(target))).toBeNull()
  }, 60_000)

  it('cannot write any other key', async () => {
    const mine = key()
    const theirs = key()
    written.push(mine)
    const payload = await grantFor(mine, 64n)
    const result = await refusal(
      clientFor(payload).putObject({
        Bucket: payload.bucket,
        Region: payload.region,
        Key: theirs,
        Body: Buffer.from('not mine'),
        Headers: { 'x-cos-forbid-overwrite': 'true', 'x-cos-acl': 'private' },
      }),
    )
    expect(result).toBe(403)
    expect(await Effect.runPromise(backend().stat(theirs))).toBeNull()
  }, 30_000)

  it('cannot write more than the ticket reserved', async () => {
    const target = key()
    written.push(target)
    const payload = await grantFor(target, 8n)
    const oversized = Buffer.from('a'.repeat(4096))
    const result = await refusal(
      clientFor(payload).putObject({
        Bucket: payload.bucket,
        Region: payload.region,
        Key: target,
        Body: oversized,
        ContentLength: oversized.byteLength,
        Headers: { 'x-cos-forbid-overwrite': 'true', 'x-cos-acl': 'private' },
      }),
    )
    expect(result).toBe(403)
    expect(await Effect.runPromise(backend().stat(target))).toBeNull()
  }, 30_000)

  it('cannot write without the header that forbids a second write', async () => {
    const target = key()
    written.push(target)
    const payload = await grantFor(target, 64n)
    const result = await refusal(
      clientFor(payload).putObject({
        Bucket: payload.bucket,
        Region: payload.region,
        Key: target,
        Body: Buffer.from('unguarded'),
        ContentLength: 9,
      }),
    )
    expect(result).toBe(403)
  }, 30_000)

  it('cannot read, list or delete with a credential meant for writing', async () => {
    const target = key()
    written.push(target)
    const payload = await grantFor(target, 64n)
    await clientFor(payload).putObject({
      Bucket: payload.bucket,
      Region: payload.region,
      Key: target,
      Body: Buffer.from('written once'),
      ContentLength: 12,
      Headers: { 'x-cos-forbid-overwrite': 'true', 'x-cos-acl': 'private' },
    })
    const client = clientFor(payload)
    expect(
      await refusal(
        client.getObject({ Bucket: payload.bucket, Region: payload.region, Key: target }),
      ),
    ).toBe(403)
    expect(
      await refusal(
        client.deleteObject({ Bucket: payload.bucket, Region: payload.region, Key: target }),
      ),
    ).toBe(403)
    expect(
      await refusal(client.getBucket({ Bucket: payload.bucket, Region: payload.region })),
    ).toBe(403)
    // the object it was allowed to write is still there and still private
    expect(await Effect.runPromise(backend().stat(target))).not.toBeNull()
  }, 60_000)
})
