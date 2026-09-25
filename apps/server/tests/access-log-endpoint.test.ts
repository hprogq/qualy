import { Effect, Exit, Layer, Logger, References, Scope } from 'effect'
import { createServer } from 'node:http'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { NodeHttpServer } from '@effect/platform-node'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { nameEndpoint } from '@qualy/api-kit/request'
import { unavailable, unavailableDependencies } from '@qualy/api-kit/unavailable'
import { serveMiddleware } from '../src/serve-middleware.ts'

// What a request line names.
//
// One of this product's own doors carries its credential in a path segment:
// the local upload ticket is the whole authority to write those bytes. A
// line naming the concrete address therefore put a live credential into
// every log pipeline for as long as the ticket lived.

const port = 3299
const logged: string[] = []
/** each line again, with the level it was written at */
const leveled: string[] = []
const capture = Logger.layer([
  Logger.make((options) => {
    const message = String(Array.isArray(options.message) ? options.message[0] : options.message)
    logged.push(message)
    leveled.push(`${options.logLevel} ${message}`)
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
  // a request that died because the database could not serve it, marked the
  // way the database plugin marks its own query failures
  const down = Effect.die(
    Object.assign(new Error('timeout exceeded when trying to connect'), {
      [unavailable]: 'database',
    }),
  )
  const routes = Layer.mergeAll(
    HttpRouter.add('PUT', `${QUALY_API_PREFIX}/probe/uploads/:reservationId`, ticketed),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe/plain`, ok),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe/down`, down),
    unavailableDependencies,
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
      }).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })), Layer.provide(capture)),
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

  it('writes a 503 for an unavailable dependency at Error, with what it died of', async () => {
    const response = await fetch(`http://127.0.0.1:${port}${QUALY_API_PREFIX}/probe/down`)
    expect(response.status).toBe(503)
    expect(((await response.json()) as { _tag?: string })._tag).toBe('SERVICE_UNAVAILABLE')
    // an api answer like any other: the id the operator finds the line by
    expect(response.headers.get('x-qualy-request-id')).not.toBeNull()

    const line = leveled.find((entry) => entry.includes('/probe/down'))
    expect(line?.startsWith('Error GET /api/probe/down 503')).toBe(true)
    expect(line).toContain('timeout exceeded when trying to connect')
  }, 30_000)
})
