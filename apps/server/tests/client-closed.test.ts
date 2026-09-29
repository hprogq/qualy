import { NodeHttpClient, NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Logger, Metric, References, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/http'
import { OtlpSerialization, OtlpTracer } from 'effect/observability'
import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { platformTracerOff } from '@qualy/api-kit/request'
import { serveMiddleware } from '../src/serve-middleware.ts'

// One client disconnect, said the same way by all three of the places that
// record a request. The access log wrote it at Debug as "client closed" while
// the trace backend showed a red error whose message was the platform's 499 -
// and a fix that turned only the trace green would have left the RED
// histogram counting it as a server error. So the three are asked together,
// behind the chain production serves behind, with a real fault beside them
// that all three must still call one.

const port = 3334
const receiverPort = 3335
const base = `http://127.0.0.1:${port}${QUALY_API_PREFIX}`

interface ExportedSpan {
  traceId: string
  status?: { code?: number }
  attributes: { key: string; value: { intValue?: string | number } }[]
}
const exported: ExportedSpan[] = []
const leveled: string[] = []
let receiver: Server
let scope: Scope.Closeable

const capture = Logger.layer([
  Logger.make((options) => {
    const message = String(Array.isArray(options.message) ? options.message[0] : options.message)
    leveled.push(`${options.logLevel} ${message}`)
  }),
])

beforeAll(async () => {
  receiver = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
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

  const routes = Layer.mergeAll(
    // a slow read the reader does not wait for
    HttpRouter.add(
      'GET',
      `${QUALY_API_PREFIX}/probe/slow`,
      Effect.as(Effect.sleep('2 seconds'), HttpServerResponse.jsonUnsafe({ ok: true })),
    ),
    // the shape production's disconnect reached the trace backend in: the
    // platform's 499 carried as a failure, which stripping defects misses
    HttpRouter.add(
      'GET',
      `${QUALY_API_PREFIX}/probe/closed-as-failure`,
      Effect.fail(HttpServerResponse.empty({ status: 499 })),
    ),
    // and a fault of this process, which every one of the three must name
    HttpRouter.add(
      'GET',
      `${QUALY_API_PREFIX}/probe/fault`,
      Effect.die(new Error('a fault of this process')),
    ),
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
        Layer.provide(platformTracerOff),
        Layer.provide(NodeHttpServer.layer(createServer, { port })),
        Layer.provide(
          OtlpTracer.layer({
            url: `http://127.0.0.1:${receiverPort}/v1/traces`,
            resource: { serviceName: 'client-closed-under-test' },
            exportInterval: 50,
          }).pipe(
            Layer.provide(OtlpSerialization.layerJson),
            Layer.provide(NodeHttpClient.layerUndici),
          ),
        ),
        Layer.provide(capture),
        Layer.provide(Layer.succeed(References.MinimumLogLevel, 'All')),
      ),
      scope,
    ),
  )
})

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  receiver.closeAllConnections()
  await new Promise<void>((resolve) => receiver.close(() => resolve()))
})

const traced = (traceId: string) => ({ traceparent: `00-${traceId}-00f067aa0ba902b7-01` })

const spanOf = async (traceId: string): Promise<ExportedSpan> => {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const found = exported.find((span) => span.traceId === traceId)
    if (found !== undefined) return found
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`no span exported for ${traceId}`)
}

/** the RED histogram's series for a route, by the status and error type they carry */
const seriesOf = async (path: string) =>
  (await Effect.runPromise(Metric.snapshot))
    .filter(
      (state) =>
        state.id === 'http.server.request.duration' &&
        state.attributes?.['http.route'] === `${QUALY_API_PREFIX}${path}`,
    )
    .map((state) => ({
      status: state.attributes?.['http.response.status_code'],
      errorType: state.attributes?.['error.type'],
    }))

const lineOf = (path: string) =>
  leveled.find((line) => line.includes(`${QUALY_API_PREFIX}${path} `))

/** what the three say of one request */
const saidOf = async (traceId: string, path: string) => {
  const span = await spanOf(traceId)
  return {
    traceError: span.status?.code === 2,
    traceStatus: Number(
      span.attributes.find((attribute) => attribute.key === 'http.response.status_code')?.value
        .intValue,
    ),
    series: await seriesOf(path),
    line: lineOf(path),
  }
}

describe('a client disconnect, as the log, the trace and the histogram say it', () => {
  it('is a reader who left a slow read', async () => {
    const traceId = '4499449944994499abcdabcdabcdabcd'
    const leaving = new AbortController()
    const asked = fetch(`${base}/probe/slow`, {
      headers: traced(traceId),
      signal: leaving.signal,
    }).catch(() => undefined)
    await new Promise((resolve) => setTimeout(resolve, 100))
    leaving.abort()
    await asked
    const said = await saidOf(traceId, '/probe/slow')
    expect(said.line).toMatch(/^Debug .* client closed /)
    expect(said.traceError).toBe(false)
    expect(said.traceStatus).toBe(499)
    expect(said.series).toEqual([{ status: '499', errorType: undefined }])
  })

  it('is the platform’s 499 carried as a failure', async () => {
    const traceId = '4990499049904990abcdabcdabcdabcd'
    await fetch(`${base}/probe/closed-as-failure`, { headers: traced(traceId) })
    const said = await saidOf(traceId, '/probe/closed-as-failure')
    expect(said.line).toMatch(/^Debug .* client closed /)
    expect(said.traceError).toBe(false)
    expect(said.traceStatus).toBe(499)
    expect(said.series).toEqual([{ status: '499', errorType: undefined }])
  })

  it('is not a fault of this process, which all three still name', async () => {
    const traceId = '5005500550055005abcdabcdabcdabcd'
    await fetch(`${base}/probe/fault`, { headers: traced(traceId) })
    const said = await saidOf(traceId, '/probe/fault')
    expect(said.line).toMatch(/^Error .* 500 /)
    expect(said.traceError).toBe(true)
    expect(said.traceStatus).toBe(500)
    expect(said.series).toEqual([{ status: '500', errorType: '500' }])
  })
})
