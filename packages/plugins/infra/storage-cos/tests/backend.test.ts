import COS from 'cos-nodejs-sdk-v5'
import { Effect, Exit, Redacted } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { cosBackend, type CosSettings } from '../src/server/backend.ts'

// The adapter between this repository and the store's sdk, with the sdk
// answering instead of a bucket.
//
// The three integration suites next door need real credentials and are
// skipped everywhere without them, which left everything this file does -
// reading a head response, deciding what a missing object is, spelling a
// download so a browser saves it rather than runs it - with no exercised
// coverage at all. None of it needs a bucket: what it needs is an answer,
// and the sdk's prototype is where the answers come from.
//
// Deliberately not a second opinion on the signature: that is policy.test's
// job and it checks the document itself, unmockable. What is here is the
// reading and the refusing.

const settings: CosSettings = {
  region: 'ap-beijing',
  bucket: 'qualy-test-1301296774',
  secretId: Redacted.make('secret-id'),
  secretKey: Redacted.make('secret-key'),
}

type Prototype = Record<string, unknown>
const prototype = COS.prototype as unknown as Prototype
const original = new Map<string, unknown>()

/** the sdk's answer for one call, put back after every case */
const answers = (name: string, answer: (...args: never[]) => unknown) => {
  if (!original.has(name)) original.set(name, prototype[name])
  prototype[name] = answer
}

afterEach(() => {
  for (const [name, value] of original) prototype[name] = value
  original.clear()
})

/** what the sdk raises for a status, in the shape the adapter reads */
const refusal = (statusCode: number) => Object.assign(new Error('cos said no'), { statusCode })

describe('what the store is asked, and what comes back', () => {
  // A crc64 is a 64-bit integer and the fingerprint of somebody's file. Read
  // through a javascript number it rounds, silently, and two different files
  // would then agree about what they are - so it stays a string the whole
  // way. This value is past Number.MAX_SAFE_INTEGER on purpose.
  it('keeps the checksum as the digits the store wrote', async () => {
    answers('headObject', async () => ({
      headers: { 'content-length': '1048577', 'x-cos-hash-crc64ecma': '18446744073709551615' },
      ETag: '"deadbeef"',
    }))
    const stat = await Effect.runPromise(cosBackend(settings).stat('attachments/t/a'))
    expect(stat).toEqual({
      size: 1_048_577n,
      integrityAlgorithm: 'crc64-ecma',
      integrityValue: '18446744073709551615',
      etag: '"deadbeef"',
    })
    // and the digits survived: through a number this would come back as
    // 18446744073709552000
    expect(stat!.integrityValue).toBe('18446744073709551615')
  })

  // An object that is not there is an answer, not a fault: a sweeper that
  // may run twice and a claim whose upload never landed both ask this.
  it('reads a missing object as nothing, and every other refusal as a fault', async () => {
    answers('headObject', async () => {
      throw refusal(404)
    })
    expect(await Effect.runPromise(cosBackend(settings).stat('attachments/t/gone'))).toBeNull()

    answers('headObject', async () => {
      throw refusal(403)
    })
    const denied = await Effect.runPromiseExit(cosBackend(settings).stat('attachments/t/a'))
    expect(Exit.isFailure(denied)).toBe(true)
  })

  // The size and the fingerprint are the whole reason this call exists - the
  // uploader's word is not trusted for either - so a head that carries
  // neither must not come back as a fact about the file.
  it('refuses a head response that says nothing about the bytes', async () => {
    answers('headObject', async () => ({ headers: { 'content-length': '12' } }))
    const missing = await Effect.runPromiseExit(cosBackend(settings).stat('attachments/t/a'))
    expect(Exit.isFailure(missing)).toBe(true)
  })

  // §18: an html or svg attachment rendered inline would be somebody else's
  // script running on a url this deployment vouched for, so the browser is
  // told to save it. A filename carrying a quote or a newline would end the
  // header field and start one of its own.
  it('spells a download so the browser saves it, whatever the file is called', async () => {
    let asked: Record<string, unknown> = {}
    answers('getObjectUrl', (options: never, done: never) => {
      asked = options
      ;(done as unknown as (error: null, data: { Url: string }) => void)(null, {
        Url: 'https://bucket.example/signed',
      })
    })
    const opened = await Effect.runPromise(
      cosBackend(settings).open(
        { key: 'attachments/t/a' },
        {
          filename: 'a "report"\r\nX-Evil: 1.svg',
          mime: 'image/svg+xml',
        },
      ),
    )
    // a redirect rather than bytes through this process, and one that expires
    expect(opened.kind).toBe('redirect')
    if (opened.kind !== 'redirect') throw new Error('not a redirect')
    expect(opened.url).toBe('https://bucket.example/signed')
    expect(opened.expiresInSeconds).toBeGreaterThan(0)
    expect(opened.expiresInSeconds).toBeLessThanOrEqual(300)

    const query = asked['Query'] as Record<string, string>
    expect(asked['Sign']).toBe(true)
    // saved, not rendered
    expect(query['response-content-disposition']).toMatch(/^attachment; filename="/)
    // and the name cannot end the field: no quote, no carriage return, no
    // newline survives into the header
    expect(query['response-content-disposition']).not.toMatch(/[\r\n]/)
    expect(query['response-content-disposition']).toBe(
      'attachment; filename="a reportX-Evil: 1.svg"',
    )
    expect(query['response-content-type']).toBe('image/svg+xml')
  })

  // A sweeper may run twice over the same key, and the store answers the
  // second run with success rather than a fault. Whatever this adapter adds,
  // it must not turn that into one.
  it('lets a delete of what is already gone succeed', async () => {
    let deleted: string | undefined
    answers('deleteObject', async (options: never) => {
      deleted = (options as unknown as { Key: string }).Key
      return {}
    })
    await Effect.runPromise(cosBackend(settings).delete('attachments/t/gone'))
    expect(deleted).toBe('attachments/t/gone')
  })

  // The key is the caller's; the bucket and the region are this deployment's
  // and are never read off anything that arrived in a request.
  it('names the bucket and the region from its own settings', async () => {
    let asked: Record<string, unknown> = {}
    answers('headObject', async (options: never) => {
      asked = options
      return { headers: { 'content-length': '1', 'x-cos-hash-crc64ecma': '2' } }
    })
    await Effect.runPromise(cosBackend(settings).stat('attachments/t/a'))
    expect(asked).toEqual({
      Bucket: 'qualy-test-1301296774',
      Region: 'ap-beijing',
      Key: 'attachments/t/a',
    })
  })
})

// In a bucket that keeps versions a second write to a key, made while the
// upload credential is still good, becomes the newest version - the header
// that forbids it is ignored there. What protects an attachment is that the
// version its checks were made against is the one every read names.
describe('a bucket that keeps a version of every write', () => {
  it('reports the version a head answered about, and none for what came before versions', async () => {
    answers('headObject', async () => ({
      headers: {
        'content-length': '3',
        'x-cos-hash-crc64ecma': '42',
        'x-cos-version-id': 'MTg0NDUxNTc2NjcxNDQ3NzE5MjY',
      },
    }))
    const stat = await Effect.runPromise(cosBackend(settings, 'versioned').stat('attachments/t/a'))
    expect(stat?.revision).toBe('MTg0NDUxNTc2NjcxNDQ3NzE5MjY')

    // an object from before the bucket kept versions is called "null"
    answers('headObject', async () => ({
      headers: {
        'content-length': '3',
        'x-cos-hash-crc64ecma': '42',
        'x-cos-version-id': 'null',
      },
    }))
    const older = await Effect.runPromise(cosBackend(settings, 'versioned').stat('attachments/t/a'))
    expect(older?.revision).toBeUndefined()
  })

  it('signs the version into a read, and signs none where there is none', async () => {
    let asked: Record<string, unknown> = {}
    answers('getObjectUrl', (options: never, done: never) => {
      asked = options
      ;(done as unknown as (error: null, data: { Url: string }) => void)(null, {
        Url: 'https://bucket.example/signed',
      })
    })
    await Effect.runPromise(
      cosBackend(settings, 'versioned').open(
        { key: 'attachments/t/a', revision: 'v1' },
        { filename: 'a.pdf', mime: 'application/pdf' },
      ),
    )
    // in the query the signature covers, so the link cannot be pointed at
    // another version by editing it
    expect((asked['Query'] as Record<string, string>)['versionId']).toBe('v1')

    await Effect.runPromise(
      cosBackend(settings, 'versioned').open(
        { key: 'attachments/t/a', revision: null },
        { filename: 'a.pdf', mime: 'application/pdf' },
      ),
    )
    expect((asked['Query'] as Record<string, string>)['versionId']).toBeUndefined()
  })

  it('deletes every version and marker under exactly the key, page after page', async () => {
    const pages = [
      {
        Versions: [
          { Key: 'attachments/t/a', VersionId: 'v2', LastModified: '2026-09-28T00:00:00Z' },
          { Key: 'attachments/t/a', VersionId: 'v1', LastModified: '2026-09-27T00:00:00Z' },
          // a longer key the prefix also matches: not this object
          { Key: 'attachments/t/ab', VersionId: 'x1', LastModified: '2026-09-27T00:00:00Z' },
        ],
        DeleteMarkers: [],
        IsTruncated: 'true',
        NextKeyMarker: 'attachments/t/ab',
        NextVersionIdMarker: 'x1',
      },
      {
        Versions: [
          { Key: 'attachments/t/a', VersionId: 'null', LastModified: '2026-09-01T00:00:00Z' },
        ],
        DeleteMarkers: [
          { Key: 'attachments/t/a', VersionId: 'm1', LastModified: '2026-09-28T01:00:00Z' },
        ],
        IsTruncated: 'false',
      },
    ]
    const listed: Record<string, unknown>[] = []
    answers('listObjectVersions', async (options: never) => {
      listed.push(options)
      return pages[listed.length - 1]
    })
    const deleted: { Key: string; VersionId?: string }[] = []
    answers('deleteObject', async (options: never) => {
      deleted.push(options)
      return {}
    })
    await Effect.runPromise(cosBackend(settings, 'versioned').delete('attachments/t/a'))
    // the second page was asked for from where the first ended
    expect(listed[1]).toMatchObject({ KeyMarker: 'attachments/t/ab', VersionIdMarker: 'x1' })
    expect(deleted.map((one) => `${one.Key}@${one.VersionId}`)).toEqual([
      'attachments/t/a@v2',
      'attachments/t/a@v1',
      'attachments/t/a@null',
      'attachments/t/a@m1',
    ])
  })

  it('deletes plainly in a bucket that never kept versions', async () => {
    let asked: Record<string, unknown> = {}
    let listed = false
    answers('listObjectVersions', async () => {
      listed = true
      return { Versions: [], DeleteMarkers: [], IsTruncated: 'false' }
    })
    answers('deleteObject', async (options: never) => {
      asked = options
      return {}
    })
    const backend = cosBackend(settings, 'single')
    expect(backend.revisions).toBeUndefined()
    await Effect.runPromise(backend.delete('attachments/t/a'))
    expect(listed).toBe(false)
    expect(asked['VersionId']).toBeUndefined()
  })
})
