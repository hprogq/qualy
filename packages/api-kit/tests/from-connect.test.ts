import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Scope } from 'effect'
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

/** answers /handled itself, declines everything else, faults on /broken */
const middleware: ConnectMiddleware = (request, response, next) => {
  if (request.url === '/broken') return next(new Error('middleware fault'))
  if (request.url !== '/handled') return next()
  response.writeHead(201, { 'content-type': 'text/plain', 'x-from': 'middleware' })
  response.end('served by the middleware')
}

let scope: Scope.Scope

beforeAll(async () => {
  const routes = Layer.mergeAll(
    // a concrete route, to prove the wildcard does not shadow one
    HttpRouter.add('GET', '/declared', HttpServerResponse.text('declared')),
    HttpRouter.add('*', '/*', fromConnect(middleware)),
  )
  const application = HttpRouter.serve(routes).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
  )
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
})
