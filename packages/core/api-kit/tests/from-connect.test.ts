import { NodeHttpServer } from '@effect/platform-node'
import { Cause, Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fromConnect, type ConnectMiddleware } from '../src/node.ts'

// The bridge from a connect-style middleware into the Effect pipeline.
//
// A middleware writes to the raw Node response instead of returning anything,
// so the handler has to wait for one of two outcomes and tell them apart. Both
// mistakes are silent: treating a decline as handled answers 200 with no body,
// and treating a handled request as declined answers 404 after the bytes have
// already gone out.

const port = 3192
const base = `http://127.0.0.1:${port}`

/** answers /handled itself, declines everything else, faults on /broken, throws on /throws* */
const middleware: ConnectMiddleware = (request, response, next) => {
  if (request.url === '/broken') return next(new Error('middleware fault'))
  if (request.url === '/throws-before-head') throw new Error('thrown before anything was sent')
  if (request.url === '/throws-after-head') {
    // what a static file server does when its read stream refuses the range
    // it has already announced
    response.writeHead(206, { 'content-length': '100', 'content-type': 'text/plain' })
    throw new Error('thrown after the head went out')
  }
  if (request.url === '/streaming') {
    // a large file on its way: the head and a first piece out, the rest
    // still to come when the client leaves
    response.writeHead(200, { 'content-length': '1000000', 'content-type': 'text/plain' })
    response.write('x'.repeat(1024))
    return
  }
  if (request.url !== '/handled') return next()
  response.writeHead(201, { 'content-type': 'text/plain', 'x-from': 'middleware' })
  response.end('served by the middleware')
}

let scope: Scope.Scope
/** how each request to /streaming ended, as the server saw it, write included */
const streamingExits: Exit.Exit<HttpServerResponse.HttpServerResponse, unknown>[] = []

beforeAll(async () => {
  const routes = Layer.mergeAll(
    // a concrete route, to prove the wildcard does not shadow one
    HttpRouter.add('GET', '/declared', HttpServerResponse.text('declared')),
    HttpRouter.add('*', '/*', fromConnect(middleware)),
  )
  const application = HttpRouter.serve(routes, {
    middleware: (httpApp) =>
      Effect.onExit(httpApp, (exit) =>
        Effect.sync(() => {
          streamingExits.push(exit)
        }),
      ),
  }).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })))
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

describe('a connect middleware as a route handler', () => {
  it('lets the middleware answer, headers and status and all', async () => {
    const response = await fetch(`${base}/handled`)
    // the middleware wrote the raw response; the handler still returned one,
    // and the platform ignores it because the response had already ended
    expect(response.status).toBe(201)
    expect(response.headers.get('x-from')).toBe('middleware')
    expect(await response.text()).toBe('served by the middleware')
  })

  it('turns a decline into a 404 rather than an empty 200', async () => {
    const response = await fetch(`${base}/nothing-here`)
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('')
  })

  it('leaves a declared route alone', async () => {
    // the router matches by specificity, so the wildcard is not a precedence
    // question and a declared path cannot be shadowed by registration order
    const response = await fetch(`${base}/declared`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('declared')
  })

  it('does not answer a middleware fault as a missing page', async () => {
    // next(error) means the fallback is broken, not that the path is unknown;
    // answering 404 would hide the fault and blame the caller
    const response = await fetch(`${base}/broken`)
    expect(response.status).toBe(500)
  })

  it('answers a middleware that throws before writing as a fault', async () => {
    const response = await fetch(`${base}/throws-before-head`, {
      signal: AbortSignal.timeout(5_000),
    })
    expect(response.status).toBe(500)
  })

  it('cuts the connection of a middleware that throws after its head went out', async () => {
    // The head promised a hundred bytes and none are coming. Ended politely,
    // the kept-alive connection left the client waiting for them; cut, the
    // client learns at once that the answer is broken.
    const outcome = await fetch(`${base}/throws-after-head`, {
      signal: AbortSignal.timeout(5_000),
    })
      .then((response) => response.text())
      .then(
        () => 'finished',
        (error: unknown) => (error instanceof Error ? error.name : 'failed'),
      )
    expect(outcome).not.toBe('TimeoutError')
    expect(outcome).not.toBe('finished')
  })
})

describe('a client that leaves while the middleware is writing', () => {
  it('ends the request with the head it sent, not with a second head over the first', async () => {
    streamingExits.length = 0
    const leaving = new AbortController()
    const response = await fetch(`${base}/streaming`, { signal: leaving.signal })
    const reader = response.body!.getReader()
    await reader.read()
    leaving.abort()
    await reader.read().catch(() => undefined)
    for (let attempt = 0; attempt < 40 && streamingExits.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(streamingExits).toHaveLength(1)
    const exit = streamingExits[0]!
    // nothing went wrong on this side: no defect, and no second head
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).not.toContain('Cannot write headers')
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    } else {
      expect(exit.value.status).toBe(200)
    }
  })
})
