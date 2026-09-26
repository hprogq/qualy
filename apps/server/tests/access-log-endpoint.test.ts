import { Effect, Exit, Layer, Logger, References, Scope } from 'effect'
import { createServer } from 'node:http'
import {
  HttpRouter,
  HttpServerError,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from 'effect/unstable/http'
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
/** a second server whose access level is development's, Debug */
const quietPort = 3298
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

/** the level a probe's line was written at, once it has been written */
const levelOf = (path: string, status: number): string | undefined =>
  leveled.find((entry) => entry.includes(`${QUALY_API_PREFIX}${path} ${status} `))?.split(' ', 1)[0]

/** a refusal that arrives as a failure carrying its response, as a handler's own error does */
class Throttled implements HttpServerRespondable.Respondable {
  [HttpServerRespondable.symbol]() {
    return Effect.succeed(HttpServerResponse.empty({ status: 429 }))
  }
}

let scope: Scope.Closeable
let quietScope: Scope.Closeable

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
  const answering = (status: number) => Effect.succeed(HttpServerResponse.empty({ status }))
  // a request no route claims, refused by an error the handler failed with
  const unclaimed = Effect.flatMap(Effect.service(HttpServerRequest.HttpServerRequest), (request) =>
    Effect.fail(new HttpServerError.RouteNotFound({ request })),
  )
  const refusals = Layer.mergeAll(
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe/fine`, answering(200)),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe/signed-out`, answering(401)),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe/forbidden`, answering(403)),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe/unclaimed`, unclaimed),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe/throttled`, answering(429)),
    HttpRouter.add(
      'GET',
      `${QUALY_API_PREFIX}/probe/throttled-failing`,
      Effect.fail(new Throttled()),
    ),
    HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe/broken`, answering(500)),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(
    Layer.buildWithScope(
      HttpRouter.serve(Layer.mergeAll(routes, refusals), {
        disableLogger: true,
        middleware: serveMiddleware({
          trustedProxies: [],
          access: { mode: 'api', level: 'Info', exclude: [] },
        }),
      }).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })), Layer.provide(capture)),
      scope,
    ),
  )
  // Development's access level. The global minimum is opened all the way so
  // a Debug line reaches the capture at all; what is asserted is the level
  // each line was WRITTEN at, which the global filter never changes.
  quietScope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(
    Layer.buildWithScope(
      HttpRouter.serve(refusals, {
        disableLogger: true,
        middleware: serveMiddleware({
          trustedProxies: [],
          access: { mode: 'api', level: 'Debug', exclude: [] },
        }),
      }).pipe(
        Layer.provide(NodeHttpServer.layer(createServer, { port: quietPort })),
        Layer.provide(capture),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, 'All')),
      ),
      quietScope,
    ),
  )
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  await Effect.runPromise(Scope.close(quietScope, Exit.void))
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

// A client error is the client's answer, not this process's trouble. The
// anonymous "am I signed in" probe every fresh tab sends is answered 401 by
// design, and at a fixed Info it was the one line left standing in a
// development terminal that silences successes, reading like a fault. So a
// refusal is written where a success is: Debug in development, Info in
// production. Throttling stays a warning and a server fault an error.
describe('the level of a request line', () => {
  const ask = (at: number, path: string) =>
    fetch(`http://127.0.0.1:${at}${QUALY_API_PREFIX}${path}`).then((response) => response.status)

  it('writes a client error at the access level, like a success', async () => {
    expect(await ask(quietPort, '/probe/fine')).toBe(200)
    expect(await ask(quietPort, '/probe/signed-out')).toBe(401)
    expect(await ask(quietPort, '/probe/forbidden')).toBe(403)
    // refused by a failure that carries its response, the other way out
    expect(await ask(quietPort, '/probe/unclaimed')).toBe(404)

    await expect.poll(() => levelOf('/probe/unclaimed', 404)).toBeDefined()
    expect(levelOf('/probe/fine', 200)).toBe('Debug')
    expect(levelOf('/probe/signed-out', 401)).toBe('Debug')
    expect(levelOf('/probe/forbidden', 403)).toBe('Debug')
    expect(levelOf('/probe/unclaimed', 404)).toBe('Debug')
  }, 30_000)

  it('keeps throttling a warning and a server fault an error', async () => {
    const before = leveled.length
    expect(await ask(quietPort, '/probe/throttled')).toBe(429)
    expect(await ask(quietPort, '/probe/throttled-failing')).toBe(429)
    expect(await ask(quietPort, '/probe/broken')).toBe(500)

    await expect.poll(() => levelOf('/probe/broken', 500)).toBeDefined()
    const lines = leveled.slice(before)
    const at = (path: string, status: number) =>
      lines
        .find((entry) => entry.includes(`${QUALY_API_PREFIX}${path} ${status} `))
        ?.split(' ', 1)[0]
    expect(at('/probe/throttled', 429)).toBe('Warn')
    expect(at('/probe/throttled-failing', 429)).toBe('Warn')
    expect(at('/probe/broken', 500)).toBe('Error')
  }, 30_000)

  it('writes a client error at Info where the access level is production’s', async () => {
    const before = leveled.length
    expect(await ask(port, '/probe/signed-out')).toBe(401)
    await expect
      .poll(() => leveled.slice(before).find((entry) => entry.includes('/probe/signed-out 401 ')))
      .toBeDefined()
    expect(
      leveled
        .slice(before)
        .find((entry) => entry.includes('/probe/signed-out 401 '))
        ?.split(' ', 1)[0],
    ).toBe('Info')
  }, 30_000)
})
