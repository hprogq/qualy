import { NodeHttpServer } from '@effect/platform-node'
import { Context, Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter, HttpServer, HttpServerResponse } from 'effect/http'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

// runtime.ts hands one runtime graph to two consumers: the boot barrier,
// provided beneath the server, and the application inside HttpRouter.serve.
// Since Effect 4.0.0-rc.118 serve builds its application in a memo map forked
// from the one outside, and a layer first built in there is private to it -
// so a stateful service reached by both could be built twice, once for the
// barrier and once for the requests, each with its own pools and caches. It
// is built once only because the barrier builds it first, outside, and the
// fork looks there before building. This is that shape, with a service that
// counts, and a request that reads which instance it was handed.

class Counted extends Context.Service<Counted, { readonly instance: number }>()(
  '@qualy/app/test/Counted',
) {}

let acquired = 0
let released = 0

const graph = Layer.effect(
  Counted,
  Effect.acquireRelease(
    Effect.sync(() => Counted.of({ instance: (acquired += 1) })),
    () =>
      Effect.sync(() => {
        released += 1
      }),
  ),
)

let barrierSaw: number | undefined
const booted = Layer.effectDiscard(
  Effect.gen(function* () {
    barrierSaw = (yield* Counted).instance
  }),
).pipe(Layer.provide(graph))

// the way a plugin's handlers reach a service: taken while the route is
// built, not looked up per request
const routes = HttpRouter.use((router) =>
  Effect.gen(function* () {
    const counted = yield* Counted
    yield* router.add(
      'GET',
      '/probe/instance',
      Effect.sync(() => HttpServerResponse.jsonUnsafe({ instance: counted.instance })),
    )
  }),
)

const server = Layer.unwrap(
  Effect.sync(() => HttpRouter.serve(routes.pipe(Layer.provide(graph)), { disableLogger: true })),
).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })))

let scope: Scope.Closeable
let base: string

beforeAll(async () => {
  scope = await Effect.runPromise(Scope.make())
  const context = await Effect.runPromise(
    Layer.buildWithScope(server.pipe(Layer.provide(booted)), scope),
  )
  const address = Context.get(context, HttpServer.HttpServer).address
  if (!('port' in address)) throw new Error('expected an internet address')
  base = `http://127.0.0.1:${String(address.port)}`
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

describe('one runtime graph under the barrier and the router', () => {
  it('is built once, and the router is handed the instance the barrier saw', async () => {
    const response = await fetch(`${base}/probe/instance`)
    expect(response.status).toBe(200)
    const answer = (await response.json()) as { instance: number }
    expect(acquired).toBe(1)
    expect(barrierSaw).toBe(1)
    expect(answer.instance).toBe(1)
  })

  it('is released once when the server closes', async () => {
    const closing = await Effect.runPromise(Scope.make())
    const before = { acquired, released }
    const context = await Effect.runPromise(
      Layer.buildWithScope(server.pipe(Layer.provide(booted)), closing),
    )
    expect(Context.get(context, HttpServer.HttpServer)).toBeDefined()
    await Effect.runPromise(Scope.close(closing, Exit.void))
    expect(acquired - before.acquired).toBe(1)
    expect(released - before.released).toBe(1)
  })
})
