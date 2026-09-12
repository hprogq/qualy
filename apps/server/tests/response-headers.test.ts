import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Scope, Stream } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { serveMiddleware } from '../src/serve-middleware.ts'

// The headers the serve chain puts on api and health responses, read back
// off the wire behind a router of the shapes that matter: a plain json
// answer, one that already chose its own caching, an event stream, a health
// probe, and a path outside both prefixes.

const port = 3213
const base = `http://127.0.0.1:${port}`

let scope: Scope.Closeable

beforeAll(async () => {
  const encoder = new TextEncoder()
  const routes = Layer.mergeAll(
    HttpRouter.add('GET', '/api/echo', Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true }))),
    HttpRouter.add(
      'GET',
      '/api/cached',
      Effect.succeed(
        HttpServerResponse.text('cached', { headers: { 'cache-control': 'private, max-age=60' } }),
      ),
    ),
    HttpRouter.add(
      'GET',
      '/api/stream',
      Effect.succeed(
        HttpServerResponse.stream(Stream.make(encoder.encode('data: one\n\n')), {
          contentType: 'text/event-stream',
        }),
      ),
    ),
    HttpRouter.add('GET', '/health/live', Effect.succeed(HttpServerResponse.text('ok'))),
    HttpRouter.add('GET', '/elsewhere', Effect.succeed(HttpServerResponse.text('page'))),
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

const headersOf = async (route: string) => {
  const response = await fetch(`${base}${route}`)
  return { status: response.status, headers: response.headers }
}

describe('headers on api and health responses', () => {
  it('puts the four headers on a json answer', async () => {
    const { status, headers } = await headersOf('/api/echo')
    expect(status).toBe(200)
    expect(headers.get('cache-control')).toBe('no-store')
    expect(headers.get('x-content-type-options')).toBe('nosniff')
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin')
  })

  it('leaves a caching decision the handler already made', async () => {
    const { headers } = await headersOf('/api/cached')
    expect(headers.get('cache-control')).toBe('private, max-age=60')
    // the rest still arrives
    expect(headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('tells an event stream no-cache rather than no-store', async () => {
    const { headers } = await headersOf('/api/stream')
    expect(headers.get('content-type')).toContain('text/event-stream')
    expect(headers.get('cache-control')).toBe('no-cache')
    expect(headers.get('cross-origin-resource-policy')).toBe('same-origin')
  })

  it('covers the health probes', async () => {
    const { headers } = await headersOf('/health/live')
    expect(headers.get('cache-control')).toBe('no-store')
    expect(headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('carries them on a refusal too', async () => {
    const response = await fetch(`${base}/api/echo`, {
      method: 'POST',
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(response.status).toBe(403)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('touches nothing outside the api and health prefixes', async () => {
    const { status, headers } = await headersOf('/elsewhere')
    expect(status).toBe(200)
    expect(headers.get('cache-control')).toBeNull()
    expect(headers.get('x-content-type-options')).toBeNull()
    expect(headers.get('referrer-policy')).toBeNull()
  })
})
