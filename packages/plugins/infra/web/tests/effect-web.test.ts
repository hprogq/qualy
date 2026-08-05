import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { NodeServer } from '@qualy/api-kit/node'
import { WebConfig, routes } from '../src/server/index.ts'

// The boundary between the api and the browser shell.
//
// A spa fallback answers html for anything it does not recognise, which is
// what makes deep links work and what makes a mistyped endpoint look like a
// success. The api owns everything under its mount, matched or not: a request
// to /api/nope has to be a 404, not a page.
//
// This is not hypothetical. A client built with the mount as its base asked
// for /api/api/app/manifest, and the fallback answered 200 with the shell, so
// the browser failed on parsing html as json rather than on a 404 - four
// layers from the line that caused it.

const port = 3191
const base = `http://127.0.0.1:${port}`
const assetRoot = new URL('../client-dist/', import.meta.url).pathname

let scope: Scope.Scope

beforeAll(async () => {
  const application = HttpRouter.serve(
    Layer.mergeAll(
      // one declared api route, so "unmatched inside the prefix" is a real
      // case rather than the only case
      HttpRouter.add('GET', `${QUALY_API_PREFIX}/probe`, HttpServerResponse.text('probe')),
      routes,
    ),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(WebConfig, WebConfig.of({ mode: 'production', assetRoot })),
        Layer.sync(NodeServer, () => createServer()),
      ),
    ),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
}, 30_000)

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

describe('the shell against the api mount', () => {
  it('serves the shell for a route the browser owns', async () => {
    const response = await fetch(`${base}/ping`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
  })

  it('leaves a declared api route alone', async () => {
    const response = await fetch(`${base}${QUALY_API_PREFIX}/probe`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('probe')
  })

  it('refuses an unmatched path inside the api mount instead of serving html', async () => {
    for (const path of [
      `${QUALY_API_PREFIX}/nope`,
      // the doubled mount, which is what a client built with the prefix as its
      // base actually asks for
      `${QUALY_API_PREFIX}${QUALY_API_PREFIX}/app/manifest`,
      QUALY_API_PREFIX,
    ]) {
      const response = await fetch(`${base}${path}`)
      expect(response.status, `${path} should not be answered by the shell`).toBe(404)
      expect(response.headers.get('content-type') ?? '').not.toContain('text/html')
    }
  })
})
