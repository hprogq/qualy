import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_UNSUPPORTED_HEADER,
} from '@qualy/release-contract'
import { apiRouteFallback } from '@qualy/api-kit/route-fallback'
import { CLIENT_PROTOCOL_UNSUPPORTED } from '../src/client-compatibility.ts'
import { serveMiddleware } from '../src/serve-middleware.ts'

// The chain in front of the router, served in front of a router of two
// routes: what an unsafe request from another origin gets back, on the
// wire, with the real status and the body the browser will read.

const port = 3210
const base = `http://127.0.0.1:${port}`
/** a second chain, serving a wider protocol window: the expand step of a breaking change */
const widerPort = 3217
const wider = `http://127.0.0.1:${widerPort}`

let scope: Scope.Closeable

beforeAll(async () => {
  const echo = Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true }))
  const routes = Layer.mergeAll(
    HttpRouter.add('GET', '/echo', echo),
    HttpRouter.add('POST', '/echo', echo),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/echo`, echo),
    HttpRouter.add('POST', `${QUALY_API_PREFIX}/echo`, echo),
    // the mount's own not-found, as the host serves it
    apiRouteFallback,
  )
  const serve = (at: number, clientProtocol?: { min: number; max: number }) =>
    HttpRouter.serve(routes, {
      disableLogger: true,
      middleware: serveMiddleware({
        trustedProxies: [],
        access: { mode: 'off', level: 'Debug', exclude: [] },
        ...(clientProtocol === undefined ? {} : { clientProtocol }),
      }),
    }).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port: at })))
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(
    Layer.buildWithScope(Layer.mergeAll(serve(port), serve(widerPort, { min: 1, max: 2 })), scope),
  )
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

describe('what every api answer carries', () => {
  it('names the request it answered, on the api and the probes, never elsewhere', async () => {
    const api = await fetch(`${base}${QUALY_API_PREFIX}/echo`)
    const id = api.headers.get('x-qualy-request-id')
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    // one id per request: the next answer names another
    const again = await fetch(`${base}${QUALY_API_PREFIX}/echo`)
    expect(again.headers.get('x-qualy-request-id')).not.toBe(id)
    // a refusal is an answer too
    const refused = await fetch(`${base}${QUALY_API_PREFIX}/echo`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(refused.status).toBe(403)
    expect(refused.headers.get('x-qualy-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    // outside the mount and the probes, nothing is named
    const page = await fetch(`${base}/echo`)
    expect(page.headers.get('x-qualy-request-id')).toBeNull()
  })

  it('answers an unmatched route inside the mount with the tagged 404', async () => {
    const response = await fetch(`${base}${QUALY_API_PREFIX}/nope`)
    expect(response.status).toBe(404)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-qualy-request-id')).toMatch(/^[0-9a-f-]{36}$/)
    expect(await response.json()).toEqual({
      _tag: 'API_ROUTE_NOT_FOUND',
      message: expect.any(String),
    })
    // outside the mount the router's own answer stands
    const elsewhere = await fetch(`${base}/nope`)
    expect(elsewhere.status).toBe(404)
    expect(await elsewhere.text()).toBe('')
  })
})

describe('the web client protocol', () => {
  const api = (headers: Record<string, string>, origin = base) =>
    fetch(`${origin}${QUALY_API_PREFIX}/echo`, { headers })

  it('serves a request that names no protocol: the api is not the web page alone', async () => {
    expect((await api({})).status).toBe(200)
  })

  it('serves the generation it speaks', async () => {
    expect((await api({ [QUALY_CLIENT_PROTOCOL_HEADER]: '2' })).status).toBe(200)
  })

  it('refuses a generation outside the window, at once, with the signal the page reads', async () => {
    for (const declared of ['0', '1', '3', 'one', '-1', '2.0']) {
      const response = await api({ [QUALY_CLIENT_PROTOCOL_HEADER]: declared })
      expect(response.status, declared).toBe(409)
      expect(response.headers.get(QUALY_CLIENT_UNSUPPORTED_HEADER)).toBe('1')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('content-type')).toContain('application/json')
      expect(await response.json()).toEqual({
        _tag: CLIENT_PROTOCOL_UNSUPPORTED,
        received: /^\d+$/.test(declared) ? Number(declared) : declared,
        supported: { min: 2, max: 2 },
      })
    }
  })

  it('judges only the api mount: the shell, probes and the release endpoint answer anyone', async () => {
    const response = await fetch(`${base}/echo`, {
      headers: { [QUALY_CLIENT_PROTOCOL_HEADER]: '0' },
    })
    expect(response.status).toBe(200)
  })

  it('speaks two generations while a breaking change rolls out', async () => {
    for (const declared of ['1', '2']) {
      expect((await api({ [QUALY_CLIENT_PROTOCOL_HEADER]: declared }, wider)).status).toBe(200)
    }
    expect((await api({ [QUALY_CLIENT_PROTOCOL_HEADER]: '3' }, wider)).status).toBe(409)
  })

  it('sits inside the origin guard: a request from elsewhere learns nothing about the window', async () => {
    const response = await fetch(`${base}${QUALY_API_PREFIX}/echo`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site', [QUALY_CLIENT_PROTOCOL_HEADER]: '0' },
    })
    expect(response.status).toBe(403)
    expect(response.headers.get(QUALY_CLIENT_UNSUPPORTED_HEADER)).toBeNull()
    // and a same-origin request outside the window is refused before any handler
    const refused = await fetch(`${base}${QUALY_API_PREFIX}/echo`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'same-origin', [QUALY_CLIENT_PROTOCOL_HEADER]: '0' },
    })
    expect(refused.status).toBe(409)
  })
})

const post = (headers: Record<string, string>) => fetch(`${base}/echo`, { method: 'POST', headers })

describe('unsafe requests from elsewhere', () => {
  it('refuses a cross-site request with the api error shape', async () => {
    const response = await post({ 'sec-fetch-site': 'cross-site' })
    expect(response.status).toBe(403)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(await response.json()).toEqual({
      _tag: 'REQUEST_ORIGIN_REFUSED',
      message: expect.any(String),
    })
  })

  it('refuses a same-site request: a sibling subdomain is not this application', async () => {
    expect((await post({ 'sec-fetch-site': 'same-site' })).status).toBe(403)
  })

  it('serves a same-origin request', async () => {
    expect((await post({ 'sec-fetch-site': 'same-origin' })).status).toBe(200)
  })

  it('judges an origin against the host when no fetch metadata came', async () => {
    expect((await post({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await post({ origin: `http://127.0.0.1:${port}` })).status).toBe(200)
  })

  it('serves a request that says nothing about where it came from', async () => {
    expect((await post({})).status).toBe(200)
  })

  it('serves a safe request from anywhere', async () => {
    const response = await fetch(`${base}/echo`, { headers: { 'sec-fetch-site': 'cross-site' } })
    expect(response.status).toBe(200)
  })
})
