import { Effect, Exit, Layer, Logger, References, Scope } from 'effect'
import { createServer } from 'node:http'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { NodeHttpServer } from '@effect/platform-node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { nameEndpoint } from '@qualy/api-kit/request'
import { serveMiddleware } from '../src/serve-middleware.ts'

// What a request line names.
//
// One of this product's own doors carries its credential in a path segment:
// the local upload ticket is the whole authority to write those bytes. A
// line naming the concrete address therefore put a live credential into
// every log pipeline for as long as the ticket lived.

const port = 3299
const logged: string[] = []
const capture = Logger.layer([
  Logger.make((options) => {
    logged.push(String(Array.isArray(options.message) ? options.message[0] : options.message))
    void options.fiber.getRef(References.CurrentLogAnnotations)
  }),
])

let scope: Scope.Closeable

beforeAll(async () => {
  const ok = Effect.succeed(HttpServerResponse.jsonUnsafe({ ok: true }))
  // a door whose address is a credential names itself, the way the local
  // upload door does
  const ticketed: Effect.Effect<HttpServerResponse.HttpServerResponse> = Effect.as(
    nameEndpoint('PUT /probe/uploads/:reservationId'),
    HttpServerResponse.jsonUnsafe({ ok: true }),
  )
  const routes = Layer.mergeAll(
    HttpRouter.add('PUT', `${QUALY_API_PREFIX}/probe/uploads/:reservationId`, ticketed),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe/plain`, ok),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(
    Layer.buildWithScope(
      HttpRouter.serve(routes, {
        disableLogger: true,
        middleware: serveMiddleware({
          trustedProxies: [],
          access: { mode: 'api', level: 'Info', exclude: [] },
        }),
      }).pipe(
        Layer.provide(NodeHttpServer.layer(createServer, { port })),
        Layer.provide(capture),
      ),
      scope,
    ),
  )
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

describe('the access log', () => {
  it('names the endpoint, never the credential in the address', async () => {
    const secret = 'res_01JQZ8Y7K3N4P5Q6R7S8T9UAVW'
    await fetch(`http://127.0.0.1:${port}${QUALY_API_PREFIX}/probe/uploads/${secret}`, {
      method: 'PUT',
    })
    await fetch(`http://127.0.0.1:${port}${QUALY_API_PREFIX}/probe/plain`)

    const lines = logged.filter((line) => line.includes('/probe/'))
    expect(lines.length).toBeGreaterThan(1)
    expect(lines.join('\n')).not.toContain(secret)
    // the endpoint is still named, so a line still says what was asked
    expect(lines.some((line) => line.includes('/probe/uploads/:reservationId'))).toBe(true)
    expect(lines.some((line) => line.includes('/probe/plain'))).toBe(true)
  }, 30_000)
})
