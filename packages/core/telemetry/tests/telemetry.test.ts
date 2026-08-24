import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { Cause, ConfigProvider, Effect, Exit, Layer, Metric } from 'effect'
import { telemetryLayer } from '../src/sdk.ts'
import { resourceFromEnv } from '../src/resource.ts'

// What the telemetry layer promises the composition root.
//
// Three commitments, each of which failed silently in some system before this
// one: an unset environment means genuinely off, not half-installed; a set
// endpoint means spans and metrics actually arrive carrying the service
// identity; and a collector that is down costs the business effect nothing.
// The receiver below is a plain http server, because the contract under test
// is the OTLP/HTTP wire format, not an SDK's client.

const port = 3201

interface Capture {
  path: string
  body: {
    resourceSpans?: {
      resource: { attributes: { key: string; value: { stringValue?: string } }[] }
      scopeSpans: { spans: { name: string; traceId: string }[] }[]
    }[]
    resourceMetrics?: { scopeMetrics: { metrics: { name: string }[] }[] }[]
    resourceLogs?: {
      resource: { attributes: { key: string; value: { stringValue?: string } }[] }
      scopeLogs: {
        logRecords: {
          body?: { stringValue?: string }
          traceId?: string
          spanId?: string
          severityText?: string
        }[]
      }[]
    }[]
  }
}

const captured: Capture[] = []
let receiver: Server

beforeAll(async () => {
  receiver = createServer((request, response) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      captured.push({
        path: request.url ?? '',
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{}')
    })
  })
  await new Promise<void>((resolve) => receiver.listen(port, '127.0.0.1', resolve))
})

afterAll(async () => {
  receiver.closeAllConnections()
  await new Promise<void>((resolve, reject) =>
    receiver.close((error) => (error ? reject(error) : resolve())),
  )
})

beforeEach(() => {
  captured.length = 0
})

/** the whole environment the layer sees: nothing leaks in from the real one */
const env = (vars: Record<string, string>) => ConfigProvider.layer(ConfigProvider.fromUnknown(vars))

const stack = (vars: Record<string, string>) => telemetryLayer.pipe(Layer.provide(env(vars)))

const attributesOf = (attributes: { key: string; value: { stringValue?: string } }[]) =>
  Object.fromEntries(attributes.map((entry) => [entry.key, entry.value.stringValue]))

describe('what the telemetry layer promises', () => {
  it('exports spans and metrics carrying the service identity', async () => {
    const counter = Metric.counter('qualy_test_requests')
    await Effect.runPromise(
      Effect.gen(function* () {
        yield* Metric.update(counter, 1)
        yield* Effect.succeed('traced').pipe(Effect.withSpan('test-operation'))
      }).pipe(
        Effect.provide(
          stack({
            OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
            // the operator's word beats the default namespace below
            OTEL_RESOURCE_ATTRIBUTES: 'service.namespace=elsewhere',
          }),
        ),
      ),
    )

    const traces = captured.filter((capture) => capture.path === '/v1/traces')
    expect(traces).toHaveLength(1)
    const resourceSpan = traces[0]!.body.resourceSpans![0]!
    const resource = attributesOf(resourceSpan.resource.attributes)
    expect(resource['service.name']).toBe('qualy-server')
    expect(resource['service.namespace']).toBe('elsewhere')
    expect(resource['deployment.environment.name']).toBe('development')
    expect(resource['service.instance.id']).toBeTruthy()
    const span = resourceSpan.scopeSpans[0]!.spans[0]!
    expect(span.name).toBe('test-operation')
    expect(span.traceId).toMatch(/^[0-9a-f]{32}$/)

    const metricNames = captured
      .filter((capture) => capture.path === '/v1/metrics')
      .flatMap((capture) => capture.body.resourceMetrics!)
      .flatMap((resourceMetrics) => resourceMetrics.scopeMetrics)
      .flatMap((scope) => scope.metrics.map((metric) => metric.name))
    expect(metricNames).toContain('qualy_test_requests')
  })

  it('exports only the signal whose endpoint is set', async () => {
    await Effect.runPromise(
      Effect.succeed('traced').pipe(
        Effect.withSpan('lonely-signal'),
        Effect.provide(
          stack({
            // signal-specific endpoints are full URLs, path included
            OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: `http://127.0.0.1:${port}/v1/traces`,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
          }),
        ),
      ),
    )
    expect(captured.map((capture) => capture.path)).toEqual(['/v1/traces'])
  })

  it('exports logs only when asked, carrying the ids of the emitting span', async () => {
    // opt-in pinned first: an endpoint alone must not start a log exporter
    await Effect.runPromise(
      Effect.log('never exported').pipe(
        Effect.provide(
          stack({
            OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
          }),
        ),
      ),
    )
    expect(captured.filter((capture) => capture.path === '/v1/logs')).toEqual([])

    captured.length = 0
    const spoke = await Effect.runPromise(
      Effect.gen(function* () {
        const span = yield* Effect.currentSpan
        yield* Effect.log('a line inside the operation')
        return span
      }).pipe(
        Effect.withSpan('logged-operation'),
        Effect.provide(
          stack({
            OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
            OTEL_LOGS_EXPORTER: 'otlp',
          }),
        ),
      ),
    )
    const logs = captured.filter((capture) => capture.path === '/v1/logs')
    expect(logs.length).toBeGreaterThan(0)
    const records = logs
      .flatMap((capture) => capture.body.resourceLogs!)
      .flatMap((resourceLog) => resourceLog.scopeLogs)
      .flatMap((scope) => scope.logRecords)
    const line = records.find(
      (record) => record.body?.stringValue === 'a line inside the operation',
    )!
    // the record names the exact span it spoke under - what APM<->CLS
    // correlation keys on
    expect(line.traceId).toBe(spoke.traceId)
    expect(line.spanId).toBe(spoke.spanId)
    const resource = attributesOf(logs[0]!.body.resourceLogs![0]!.resource.attributes)
    expect(resource['service.name']).toBe('qualy-server')
  })

  it('is genuinely off when disabled, endpoint or not', async () => {
    await Effect.runPromise(
      Effect.succeed('quiet').pipe(
        Effect.withSpan('never-exported'),
        Effect.provide(
          stack({
            OTEL_SDK_DISABLED: 'true',
            OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
          }),
        ),
      ),
    )
    expect(captured).toEqual([])
  })

  it('is genuinely off when no endpoint is configured', async () => {
    await Effect.runPromise(
      Effect.succeed('quiet').pipe(Effect.withSpan('never-exported'), Effect.provide(stack({}))),
    )
    expect(captured).toEqual([])
  })

  it('costs the business effect nothing when the collector is down', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.succeed('answer').pipe(
        Effect.withSpan('unheard'),
        Effect.provide(
          stack({
            // nothing listens there; the flush gives up within its bound
            OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port + 1}`,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'http/json',
          }),
        ),
      ),
    )
    expect(Exit.isSuccess(exit) ? exit.value : exit.cause).toBe('answer')
  })

  it('refuses a protocol this process does not speak', async () => {
    const exit = await Effect.runPromiseExit(
      Effect.void.pipe(
        Effect.provide(
          stack({
            OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${port}`,
            OTEL_EXPORTER_OTLP_PROTOCOL: 'grpc',
          }),
        ),
      ),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Cause.pretty(exit.cause)).toContain('grpc is not supported')
    }
  })
})

describe('the identity the resource resolves to', () => {
  const resolve = (vars: Record<string, string>) =>
    Effect.runPromise(resourceFromEnv.pipe(Effect.provide(env(vars))))

  it('fills only what the environment left unsaid', async () => {
    const description = await resolve({
      OTEL_SERVICE_NAME: 'alpha',
      OTEL_RESOURCE_ATTRIBUTES: 'service.name=beta,service.instance.id=machine-7',
      QUALY_VERSION: '1.2.3',
      NODE_ENV: 'production',
    })
    // OTEL_SERVICE_NAME outranks the attribute form, per the OTel spec
    expect(description.serviceName).toBe('alpha')
    expect(description.serviceVersion).toBe('1.2.3')
    expect(description.attributes['service.namespace']).toBe('qualy')
    expect(description.attributes['deployment.environment.name']).toBe('production')
    // the operator named the instance; no random id replaces it
    expect(description.attributes['service.instance.id']).toBeUndefined()
  })

  it('mints a stable default identity from nothing', async () => {
    const description = await resolve({ QUALY_INSTANCE_ID: 'replica-2' })
    expect(description.serviceName).toBe('qualy-server')
    expect(description.serviceVersion).toBeUndefined()
    expect(description.attributes['service.instance.id']).toBe('replica-2')
    expect(description.attributes['deployment.environment.name']).toBe('development')
  })
})
