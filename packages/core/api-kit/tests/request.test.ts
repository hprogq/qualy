import { NodeHttpClient, NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Metric, Option, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import { OtlpSerialization, OtlpTracer } from 'effect/unstable/observability'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  RequestContext,
  bindSessionId,
  clientAddressOf,
  httpMetrics,
  requestContext,
  routeSpanNames,
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
// one suite, one extra listener: the OTLP receiver the exported spans land
// on; 3203 is claimed here the way `port` claims 3196 - keep both unique
// across suites
const receiverPort = 3203

interface ExportedSpan {
  name: string
  traceId: string
  attributes: { key: string; value: { stringValue?: string } }[]
}

const exported: ExportedSpan[] = []
let receiver: Server
let scope: Scope.Scope

beforeAll(async () => {
  receiver = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        resourceSpans?: { scopeSpans: { spans: ExportedSpan[] }[] }[]
      }
      for (const resourceSpan of body.resourceSpans ?? [])
        for (const scopeSpan of resourceSpan.scopeSpans) exported.push(...scopeSpan.spans)
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
    })
  })
  await new Promise<void>((resolve) => receiver.listen(receiverPort, '127.0.0.1', resolve))

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
    HttpRouter.add('GET', '/things/:thingId', echo),
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
    middleware: (httpApp) =>
      requestContext({ trustedProxies: ['127.0.0.1'] })(httpMetrics(routeSpanNames(httpApp))),
  }).pipe(
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    // the exporting tracer, so the names this suite pins are the names a
    // telemetry backend would receive, not an in-process observation
    Layer.provide(
      OtlpTracer.layer({
        url: `http://127.0.0.1:${receiverPort}/v1/traces`,
        resource: { serviceName: 'api-kit-under-test' },
        exportInterval: 50,
      }).pipe(
        Layer.provide(OtlpSerialization.layerJson),
        Layer.provide(NodeHttpClient.layerUndici),
      ),
    ),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  receiver.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    receiver.close((error) => (error ? reject(error) : resolve())),
  )
})

/** the exported span for one request, once the 50ms batch has flushed */
const exportedSpan = async (predicate: (span: ExportedSpan) => boolean): Promise<ExportedSpan> => {
  for (let attempt = 0; attempt < 40; attempt++) {
    const found = exported.find(predicate)
    if (found !== undefined) return found
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`no exported span matched; saw: ${exported.map((span) => span.name).join(', ')}`)
}

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

describe('the span a request exports', () => {
  it('is named by its route template, carrying the inbound trace', async () => {
    // a trace id no other request in this suite can collide with
    const inbound = 'aaaabbbbccccddddeeeeffff00001111'
    await fetch(`${base}/things/9f1c0a52-cafe-4bot-8000-000000000000`, {
      headers: { traceparent: `00-${inbound}-00f067aa0ba902b7-01` },
    })
    const span = await exportedSpan((candidate) => candidate.traceId === inbound)
    // the pin: if either span implementation stops reading `name` after the
    // rename in routeSpanNames, this reverts to 'http.server GET'
    expect(span.name).toBe('GET /things/:thingId')
    const route = span.attributes.find((attribute) => attribute.key === 'http.route')
    expect(route?.value.stringValue).toBe('/things/:thingId')
  })

  it('keeps the method-only name when no route matched', async () => {
    const inbound = '2222333344445555666677778888aaaa'
    await fetch(`${base}/no-such-route`, {
      headers: { traceparent: `00-${inbound}-00f067aa0ba902b7-01` },
    })
    const span = await exportedSpan((candidate) => candidate.traceId === inbound)
    // a 404 has no template; the raw URL must not become the name
    expect(span.name).toBe('http.server GET')
  })
})

describe('the labels a request becomes', () => {
  it('measures by template and never by the URL it actually served', async () => {
    // the id below must not exist anywhere in the metric registry afterwards
    const uuid = '019loudb-cafe-4bad-8000-0f0f0f0f0f0f'
    await fetch(`${base}/things/${uuid}`)
    await fetch(`${base}/no-such-route/${uuid}`)
    const snapshot = await Effect.runPromise(Metric.snapshot)
    const requests = snapshot.filter((state) => state.id === 'http.server.request.duration')
    expect(requests.length).toBeGreaterThan(0)
    const routes = requests.map((state) => state.attributes?.['http.route'])
    expect(routes).toContain('/things/:thingId')
    for (const state of requests) {
      for (const [key, value] of Object.entries(state.attributes ?? {})) {
        expect(`${key}=${value}`).not.toContain(uuid)
      }
      // the label set is closed: method, status, route template, unit
      expect(
        Object.keys(state.attributes ?? {}).every((key) =>
          ['http.request.method', 'http.response.status_code', 'http.route', 'unit'].includes(key),
        ),
      ).toBe(true)
    }
    // the unmatched request was counted, without inventing a route label
    expect(
      requests.some(
        (state) =>
          state.attributes?.['http.response.status_code'] === '404' &&
          state.attributes?.['http.route'] === undefined,
      ),
    ).toBe(true)
  })
})
