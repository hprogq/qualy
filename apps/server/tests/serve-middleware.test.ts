import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serveMiddleware } from '../src/serve-middleware.ts'

// The chain in front of the router, served in front of a router of two
// routes: what an unsafe request from another origin gets back, on the
// wire, with the real status and the body the browser will read.

const port = 3210
const base = `http://127.0.0.1:${port}`

let scope: Scope.Closeable

beforeAll(async () => {
  const echo = Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true }))
  const routes = Layer.mergeAll(
    HttpRouter.add('GET', '/echo', echo),
    HttpRouter.add('POST', '/echo', echo),
  )
  const application = HttpRouter.serve(routes, {
    disableLogger: true,
    middleware: serveMiddleware({
      trustedProxies: [],
      access: { mode: 'off', level: 'Debug', exclude: [] },
    }),
  }).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })))
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
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
