import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Option, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { createServer } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  RequestContext,
  bindSessionId,
  clientAddressOf,
  requestContext,
  trustedProxies,
} from '../src/request.ts'

// The identity of one request: a minted id, the client address behind the
// trusted proxy tier, and the trace the platform's own span runs under.
//
// The address policy is the part worth being paranoid about. Forwarded
// headers are attacker-writable, so the resolution must anchor on the one
// fact this process observed - the socket peer - and only follow the header
// through hops the deployment itself declared trustworthy.

describe('the trusted-proxy client address', () => {
  const none = trustedProxies([])

  it('answers with the socket peer when no proxy is trusted', () => {
    expect(clientAddressOf('203.0.113.7', '198.51.100.1', none)).toBe('203.0.113.7')
  })

  it('unmaps the v4-in-v6 form Node reports for plain IPv4 sockets', () => {
    expect(clientAddressOf('::ffff:203.0.113.7', undefined, none)).toBe('203.0.113.7')
  })

  it('ignores a forwarded header written by an untrusted peer', () => {
    const trust = trustedProxies(['10.0.0.1'])
    expect(clientAddressOf('203.0.113.7', '198.51.100.99', trust)).toBe('203.0.113.7')
  })

  it('follows the header through a trusted peer to the client', () => {
    const trust = trustedProxies(['10.0.0.1'])
    expect(clientAddressOf('10.0.0.1', '198.51.100.1', trust)).toBe('198.51.100.1')
  })

  it('stops at the first untrusted hop, ignoring what stands beyond it', () => {
    // the client wrote "1.1.1.1" into its own request; the proxy appended
    // the address it actually saw - only the appended one is vouched for
    const trust = trustedProxies(['10.0.0.1', '10.0.0.2'])
    expect(clientAddressOf('10.0.0.1', '1.1.1.1, 198.51.100.1, 10.0.0.2', trust)).toBe(
      '198.51.100.1',
    )
  })

  it('trusts a CIDR block as one entry', () => {
    const trust = trustedProxies(['10.0.0.0/8'])
    expect(clientAddressOf('10.20.30.40', '198.51.100.1', trust)).toBe('198.51.100.1')
  })

  it('answers with the leftmost address when the whole chain is internal', () => {
    const trust = trustedProxies(['10.0.0.0/8'])
    expect(clientAddressOf('10.0.0.1', '10.0.0.9, 10.0.0.5', trust)).toBe('10.0.0.9')
  })

  it('answers unknown rather than an attacker-chosen string', () => {
    const trust = trustedProxies(['10.0.0.1'])
    expect(clientAddressOf('10.0.0.1', 'not-an-ip, 10.0.0.1', trust)).toBeUndefined()
    expect(clientAddressOf(undefined, '198.51.100.1', trust)).toBeUndefined()
  })

  it('strips ports and brackets from forwarded entries', () => {
    const trust = trustedProxies(['10.0.0.1'])
    expect(clientAddressOf('10.0.0.1', '198.51.100.1:44312', trust)).toBe('198.51.100.1')
    expect(clientAddressOf('10.0.0.1', '[2001:db8::1]:443', trust)).toBe('2001:db8::1')
  })

  it('refuses a proxy list entry that is not an address', () => {
    expect(() => trustedProxies(['not-an-ip'])).toThrow(/invalid trusted proxy entry/)
    expect(() => trustedProxies(['10.0.0.0/64'])).toThrow(/invalid trusted proxy entry/)
  })
})

// Through a real server: the middleware provides the context, handlers read
// it optionally, and the trace id is the span the platform opened.

const port = 3196
const base = `http://127.0.0.1:${port}`

let scope: Scope.Scope

beforeAll(async () => {
  const echo = Effect.gen(function* () {
    const context = Option.getOrUndefined(yield* Effect.serviceOption(RequestContext))
    return HttpServerResponse.jsonUnsafe({
      requestId: context?.requestId ?? null,
      clientIp: context?.clientIp ?? null,
      userAgent: context?.userAgent ?? null,
      traceId: context?.traceId ?? null,
      sessionId: context?.sessionId ?? null,
    })
  })
  const routes = Layer.mergeAll(
    HttpRouter.add('GET', '/context', echo),
    HttpRouter.add(
      'GET',
      '/bound',
      Effect.gen(function* () {
        yield* bindSessionId('session-under-test')
        return yield* echo
      }),
    ),
  )
  const application = HttpRouter.serve(routes, {
    // the loopback peer stands in for the deployment's proxy tier
    middleware: requestContext({ trustedProxies: ['127.0.0.1'] }),
  }).pipe(Layer.provide(NodeHttpServer.layer(createServer, { port })))
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
})

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('the request context on a live server', () => {
  it('mints a fresh request id per request', async () => {
    const first = (await (await fetch(`${base}/context`)).json()) as { requestId: string }
    const second = (await (await fetch(`${base}/context`)).json()) as { requestId: string }
    expect(first.requestId).toMatch(UUID)
    expect(second.requestId).toMatch(UUID)
    expect(first.requestId).not.toBe(second.requestId)
  })

  it('resolves the client through the trusted loopback peer', async () => {
    const body = (await (
      await fetch(`${base}/context`, {
        headers: { 'x-forwarded-for': '198.51.100.1', 'user-agent': 'qualy-test/1.0' },
      })
    ).json()) as { clientIp: string; userAgent: string }
    expect(body.clientIp).toBe('198.51.100.1')
    expect(body.userAgent).toBe('qualy-test/1.0')
  })

  it('runs under the server span the platform opened, inheriting traceparent', async () => {
    const fresh = (await (await fetch(`${base}/context`)).json()) as { traceId: string }
    // the platform's tracer wraps every request, telemetry backend or not
    expect(fresh.traceId).toMatch(/^[0-9a-f]{32}$/)

    const inherited = (await (
      await fetch(`${base}/context`, {
        headers: { traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01' },
      })
    ).json()) as { traceId: string }
    expect(inherited.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  it('carries the session someone bound onto the same request', async () => {
    const body = (await (await fetch(`${base}/bound`)).json()) as { sessionId: string }
    expect(body.sessionId).toBe('session-under-test')
    // and the binding died with its request
    const next = (await (await fetch(`${base}/context`)).json()) as { sessionId: null }
    expect(next.sessionId).toBeNull()
  })
})
