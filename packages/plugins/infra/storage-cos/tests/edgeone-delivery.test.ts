import { describe, expect, it } from 'vitest'
import { exportJWK, generateKeyPair } from 'jose'
import { createDelivery, EDGE_KEY_HEADER } from '../src/edgeone/delivery.ts'
import { signGrant, type DownloadGrant } from '../src/edgeone/protocol.ts'

// The edge function with the platform replaced: the object read answers
// whatever a case needs, and every request it would make is recorded. What
// is asserted is the contract with the reader - which status, which headers,
// which bytes - and with the bucket - exactly which read, carrying what.

const FILES = 'https://files.qualy.example.cn'
const APP = 'https://qualy.example.cn'
const NOW = 1_800_000_000
const EDGE_KEY = 'k'.repeat(40)

const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true })
const signing = { key: privateKey, kid: 'download-test' }
const published = { ...(await exportJWK(publicKey)), kid: 'download-test', alg: 'ES256' }

const env = {
  FILES_ORIGIN: FILES,
  APP_ORIGIN: APP,
  ISSUER: APP,
  VERIFY_KEYS: JSON.stringify({ keys: [published] }),
  QUALY_EDGE_KEY: EDGE_KEY,
}

const grant: DownloadGrant = {
  key: 'attachments/0190a7a0-0000-7000-8000-000000000001/0190a7a0-0000-7000-8000-000000000002',
  revision: 'MTg0NDQ5NTEwMjY3OTA2Nzg3MjE',
  filename: '获奖证书.pdf',
  mime: 'application/pdf',
}

const linkFor = async (overrides: Partial<DownloadGrant> = {}, issuedAt = NOW) =>
  `${FILES}/v1/${await signGrant({
    signing,
    issuer: APP,
    audience: FILES,
    issuedAt,
    lifetime: 60,
    grant: { ...grant, ...overrides },
  })}`

/** a body that says whether it was read or let go of */
const watchedBody = (bytes: Uint8Array) => {
  const watch = { cancelled: false }
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(bytes)
      controller.close()
    },
    cancel() {
      watch.cancelled = true
    },
  })
  return { body, watch }
}

const harness = (
  answer: (url: string, init: RequestInit) => Response | Promise<Response>,
  settings: Record<string, unknown> = env,
) => {
  const reads: { url: string; init: RequestInit; headers: Headers }[] = []
  const deliver = createDelivery({
    env: () => settings,
    fetch: async (url, init) => {
      reads.push({ url, init, headers: new Headers(init.headers) })
      return answer(url, init)
    },
    now: () => NOW,
  })
  return { deliver, reads }
}

const object = (status = 200, headers: Record<string, string> = {}) =>
  new Response(new Uint8Array([1, 2, 3]), {
    status,
    headers: { 'content-length': '3', 'content-type': 'application/octet-stream', ...headers },
  })

describe('a delivery the link grants', () => {
  it('makes exactly the read the link grants, and hands the bytes back as a download', async () => {
    const { deliver, reads } = harness(() => object(200, { etag: '"e"', 'eo-cache-status': 'HIT' }))
    const answer = await deliver(new Request(await linkFor()))
    expect(answer.status).toBe(200)
    expect(new Uint8Array(await answer.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]))
    expect(answer.headers.get('content-type')).toBe('application/pdf')
    expect(answer.headers.get('content-disposition')).toBe(
      `attachment; filename="____.pdf"; filename*=UTF-8''%E8%8E%B7%E5%A5%96%E8%AF%81%E4%B9%A6.pdf`,
    )
    expect(answer.headers.get('x-content-type-options')).toBe('nosniff')
    expect(answer.headers.get('cache-control')).toBe('private, no-store')
    expect(answer.headers.get('etag')).toBe('"e"')
    expect(answer.headers.get('x-qualy-cache')).toBe('HIT')

    expect(reads).toHaveLength(1)
    expect(reads[0]!.url).toBe(`${FILES}/${grant.key}?versionId=${grant.revision}`)
    expect(reads[0]!.init.redirect).toBe('manual')
    expect(reads[0]!.headers.get(EDGE_KEY_HEADER)).toBe(EDGE_KEY)
    expect(reads[0]!.headers.get('accept-encoding')).toBe('identity')
  })

  it('reads without naming a version when the grant names none', async () => {
    const { deliver, reads } = harness(() => object())
    await deliver(new Request(await linkFor({ revision: null })))
    expect(reads[0]!.url).toBe(`${FILES}/${grant.key}`)
  })

  it('reads the version before versioning by its own name', async () => {
    const { deliver, reads } = harness(() => object())
    await deliver(new Request(await linkFor({ revision: 'null' })))
    expect(reads[0]!.url).toBe(`${FILES}/${grant.key}?versionId=null`)
  })

  it('passes on the reader’s cookies and credentials to nobody', async () => {
    const { deliver, reads } = harness(() => object())
    await deliver(
      new Request(await linkFor(), {
        headers: { cookie: 'session=1', authorization: 'Bearer x', 'x-forwarded-for': '1.1.1.1' },
      }),
    )
    const sent = [...reads[0]!.headers.keys()].sort()
    expect(sent).toEqual(['accept-encoding', EDGE_KEY_HEADER])
  })

  it('serves one range, and ignores a request for several rather than mislabel them', async () => {
    const { deliver, reads } = harness(() =>
      object(206, { 'content-range': 'bytes 0-2/300', 'content-length': '3' }),
    )
    const answer = await deliver(new Request(await linkFor(), { headers: { range: 'bytes=0-2' } }))
    expect(answer.status).toBe(206)
    expect(answer.headers.get('content-range')).toBe('bytes 0-2/300')
    expect(reads[0]!.headers.get('range')).toBe('bytes=0-2')

    await deliver(new Request(await linkFor(), { headers: { range: 'bytes=0-1,5-6' } }))
    expect(reads[1]!.headers.get('range')).toBeNull()
  })

  it('answers HEAD with the object’s headers and no body', async () => {
    const { body, watch } = watchedBody(new Uint8Array([1]))
    const { deliver } = harness(() => new Response(body, { status: 200 }))
    const answer = await deliver(new Request(await linkFor(), { method: 'HEAD' }))
    expect(answer.status).toBe(200)
    expect(answer.body).toBeNull()
    expect(watch.cancelled).toBe(true)
  })

  it('lets the application read the delivery from script, and nobody else', async () => {
    const { deliver } = harness(() => object())
    const ours = await deliver(new Request(await linkFor(), { headers: { origin: APP } }))
    expect(ours.headers.get('access-control-allow-origin')).toBe(APP)
    expect(ours.headers.get('access-control-expose-headers')).toContain('Content-Disposition')
    const theirs = await deliver(
      new Request(await linkFor(), { headers: { origin: 'https://evil.example' } }),
    )
    expect(theirs.status).toBe(200)
    expect(theirs.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('answers the application’s preflight without reading anything', async () => {
    const { deliver, reads } = harness(() => object())
    const answer = await deliver(
      new Request(await linkFor(), { method: 'OPTIONS', headers: { origin: APP } }),
    )
    expect(answer.status).toBe(204)
    expect(answer.headers.get('access-control-allow-origin')).toBe(APP)
    expect(reads).toHaveLength(0)
  })
})

describe('what gets no file', () => {
  /** the status, the reason, and whether the bucket was asked at all */
  const refusal = async (
    request: Request | Promise<Request>,
    answer: (url: string, init: RequestInit) => Response = () => object(),
    settings?: Record<string, unknown>,
  ) => {
    const { deliver, reads } = harness(answer, settings)
    const response = await deliver(await request)
    return {
      status: response.status,
      reason: response.headers.get('x-qualy-reason'),
      read: reads.length > 0,
      response,
    }
  }

  it('a link that is expired, altered or not one at all, and nothing is read', async () => {
    expect(await refusal(new Request(await linkFor({}, NOW - 70)))).toMatchObject({
      status: 403,
      reason: 'expired',
      read: false,
    })
    const link = await linkFor()
    const altered = link.slice(0, -2) + (link.endsWith('A') ? 'BB' : 'AA')
    expect(await refusal(new Request(altered))).toMatchObject({
      status: 403,
      reason: 'invalid',
      read: false,
    })
    expect(await refusal(new Request(`${FILES}/v1/garbage`))).toMatchObject({
      status: 400,
      reason: 'malformed',
      read: false,
    })
  })

  it('anything beside the link, however it is spelled', async () => {
    const link = await linkFor()
    // a bare "?" carries nothing and is read as no query at all
    for (const extra of ['?versionId=x', '?eo-img.resize=w/9999', '?=', '?t=1']) {
      expect(await refusal(new Request(`${link}${extra}`))).toMatchObject({
        status: 400,
        reason: 'unexpected_query',
        read: false,
      })
    }
  })

  it('a request on any host but the file host, or any path but a delivery', async () => {
    const link = await linkFor()
    const elsewhere = link.replace(FILES, 'https://qualy-file-delivery.eo-edgefunctions.com')
    expect(await refusal(new Request(elsewhere))).toMatchObject({
      status: 404,
      reason: 'wrong_host',
      read: false,
    })
    expect(await refusal(new Request(`${FILES}/${grant.key}`))).toMatchObject({
      status: 404,
      reason: 'not_a_delivery',
      read: false,
    })
  })

  it('a method that is not a read, saying which are', async () => {
    const answer = await refusal(new Request(await linkFor(), { method: 'POST', body: 'x' }))
    expect(answer).toMatchObject({ status: 405, reason: 'method', read: false })
    expect(answer.response.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
  })

  it('a function missing any of its settings', async () => {
    for (const name of ['FILES_ORIGIN', 'ISSUER', 'VERIFY_KEYS', 'QUALY_EDGE_KEY']) {
      const { [name as keyof typeof env]: _gone, ...rest } = env
      const answer = await refusal(new Request(await linkFor()), undefined, rest)
      expect(answer.read).toBe(false)
      expect(answer.status === 502 || answer.status === 404).toBe(true)
    }
  })

  it('an object the bucket does not have, letting go of its answer', async () => {
    const { body, watch } = watchedBody(new Uint8Array([9]))
    expect(
      await refusal(new Request(await linkFor()), () => new Response(body, { status: 404 })),
    ).toMatchObject({ status: 404, reason: 'object_missing' })
    expect(watch.cancelled).toBe(true)
  })

  it('a range the object does not have', async () => {
    const answer = await refusal(
      new Request(await linkFor(), { headers: { range: 'bytes=999-' } }),
      () => new Response(null, { status: 416, headers: { 'content-range': 'bytes */300' } }),
    )
    expect(answer).toMatchObject({ status: 416, reason: 'range' })
    expect(answer.response.headers.get('content-range')).toBe('bytes */300')
  })

  it('anything from the bucket that is not the object, letting go of it', async () => {
    for (const status of [301, 302, 401, 403, 500, 503]) {
      const { body, watch } = watchedBody(new Uint8Array([9]))
      const answer = await refusal(
        new Request(await linkFor()),
        () => new Response(body, { status, headers: { location: 'https://bucket.example/x' } }),
      )
      expect(answer).toMatchObject({ status: 502, reason: 'upstream_status' })
      expect(answer.response.headers.get('location')).toBeNull()
      expect(answer.response.headers.get('x-qualy-upstream')).toBe(String(status))
      expect(watch.cancelled).toBe(true)
    }
  })

  it('an object read that fails before it answers', async () => {
    expect(
      await refusal(new Request(await linkFor()), () => {
        throw new Error('connection reset')
      }),
    ).toMatchObject({ status: 502, reason: 'upstream_fetch_failed' })
  })

  it('bytes that come back encoded, or as several ranges', async () => {
    const { body, watch } = watchedBody(new Uint8Array([0x1f, 0x8b]))
    expect(
      await refusal(
        new Request(await linkFor()),
        () => new Response(body, { status: 200, headers: { 'content-encoding': 'gzip' } }),
      ),
    ).toMatchObject({ status: 502, reason: 'unexpected_encoding' })
    expect(watch.cancelled).toBe(true)
    expect(
      await refusal(
        new Request(await linkFor()),
        () =>
          new Response('x', {
            status: 206,
            headers: { 'content-type': 'multipart/byteranges; boundary=b' },
          }),
      ),
    ).toMatchObject({ status: 502, reason: 'unexpected_type' })
  })

  it('says why in words, readable by the application’s scripts', async () => {
    const expired = new Request(await linkFor({}, NOW - 70), {
      headers: { origin: APP, 'accept-language': 'zh-CN,zh;q=0.9' },
    })
    const answer = await refusal(expired)
    expect(answer.response.headers.get('access-control-allow-origin')).toBe(APP)
    expect(answer.response.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await answer.response.text()).toContain('下载链接已失效')

    const fromScript = await refusal(
      new Request(await linkFor({}, NOW - 70), { headers: { accept: 'application/json' } }),
    )
    expect(await fromScript.response.json()).toEqual({ code: 'expired' })
  })
})
