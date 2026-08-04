import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import { HttpApiBuilder, OpenApi } from 'effect/unstable/httpapi'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sessionApi, sessionHandlers } from '../src/session.ts'

// The gap M1b left open, and ADR 0003's remaining gate: an HttpOnly cookie
// holding an opaque session token, resolved once by middleware into a
// principal that handlers receive.
//
// Over a real server rather than the in-memory client, because the thing being
// tested is Set-Cookie and the browser's own cookie handling, which an
// in-memory transport would not exercise.

const port = 3196
const base = `http://127.0.0.1:${port}`

const application = HttpRouter.serve(
  HttpApiBuilder.layer(sessionApi).pipe(Layer.provide(sessionHandlers)),
).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })))

let scope: Scope.Scope

beforeAll(async () => {
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

describe('session over an httponly cookie', () => {
  it('refuses an unauthenticated request with the declared status', async () => {
    const response = await fetch(`${base}/session/me`)
    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ _tag: 'Unauthorized' })
  })

  it('sets an httponly cookie on login and accepts it afterwards', async () => {
    const login = await fetch(`${base}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: 'ada' }),
    })
    expect(login.status).toBe(200)

    const setCookie = login.headers.get('set-cookie')
    expect(setCookie, 'login must set a cookie').toBeTruthy()
    // the properties that make it a session cookie rather than a token the
    // page can read: script cannot reach it, and it does not travel over http
    expect(setCookie!.toLowerCase()).toContain('httponly')
    expect(setCookie!.toLowerCase()).toContain('secure')
    // and the token itself is not in the body
    expect(JSON.stringify(await login.json())).not.toContain('session-token')

    const cookie = setCookie!.split(';')[0]!
    const me = await fetch(`${base}/session/me`, { headers: { cookie } })
    expect(me.status).toBe(200)
    expect(await me.json()).toEqual({ userId: 'ada' })
  })

  it('refuses a cookie that is not a valid session', async () => {
    const me = await fetch(`${base}/session/me`, {
      headers: { cookie: 'qualy_session=not-a-real-token' },
    })
    expect(me.status).toBe(401)
  })

  it('describes the cookie scheme in the generated document', async () => {
    // what a third party integrating against the API would read: the scheme is
    // declared once on the middleware and reaches the document from there
    const document = OpenApi.fromApi(sessionApi) as {
      components?: { securitySchemes?: Record<string, { type?: string; in?: string; name?: string }> }
      paths: Record<string, Record<string, { security?: unknown }>>
    }
    const schemes = Object.values(document.components?.securitySchemes ?? {})
    expect(schemes).toContainEqual(
      expect.objectContaining({ type: 'apiKey', in: 'cookie', name: 'qualy_session' }),
    )
    // and it is attached to the endpoint that requires it, while the one that
    // does not gets an empty requirement list rather than no entry
    expect(document.paths['/session/me']!.get!.security).toEqual([{ session: [] }])
    expect(document.paths['/session']!.post!.security).toEqual([])
  })
})
