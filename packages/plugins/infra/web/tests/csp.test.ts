import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Logger, References, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { clientAssemblyLayer } from '@qualy/api-kit/client-assembly'
import { assembledBarrier, assembledLayer, AssemblyInfo } from '@qualy/api-kit/assembled'
import { NodeServer } from '@qualy/api-kit/node'
import { requestOriginGuard } from '@qualy/api-kit/origin'
import { shellPolicyLayer } from '@qualy/api-kit/shell-policy'
import { WebConfig, layer as policyLayer, routes } from '../src/server/index.ts'
import { composeShellPolicy, type CspMode } from '../src/server/shell-policy.ts'
import { TEST_CONTRACT, installTestRelease } from './support/store.ts'

// The policy on the wire: which header the shell sends in each mode, that
// an asset sends none, and what the report endpoint answers to each kind
// of body - through the same origin guard production serves behind, since
// a report is a POST and the guard is what decides whether it is heard.

process.env.NODE_ENV = 'production'

const port = 3214
const enforcePort = 3215

const HASH = 'sha256:test'
const assemblyInfo = Layer.succeed(
  AssemblyInfo,
  AssemblyInfo.of({ resolutionHash: HASH, browserContractHash: TEST_CONTRACT }),
)

const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-web-csp-'))
installTestRelease(assetRoot, { hash: HASH, assets: { 'app-abc123.js': 'export {}\n' } })

/** every line the server logs at Warn or above, with its annotations */
interface Logged {
  readonly level: string
  readonly message: string
  readonly annotations: Record<string, unknown>
}
const logged: Logged[] = []
const capture = Logger.layer([
  Logger.make((options) => {
    logged.push({
      level: options.logLevel,
      message: String(Array.isArray(options.message) ? options.message[0] : options.message),
      annotations: options.fiber.getRef(References.CurrentLogAnnotations),
    })
  }),
])

const serve = (at: number, cspMode: CspMode) =>
  HttpRouter.serve(routes, { disableLogger: true, middleware: requestOriginGuard() }).pipe(
    // the barrier runs the freeze before the server builds, as the host sequences it
    Layer.provide(assembledBarrier),
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(WebConfig, WebConfig.of({ assetRoot, sourceRoot: assetRoot, cspMode })),
        Layer.sync(NodeServer, () => createServer()),
        assemblyInfo,
        policyLayer,
      ),
    ),
    Layer.provide(Layer.mergeAll(shellPolicyLayer, assembledLayer, clientAssemblyLayer)),
    Layer.provide(NodeHttpServer.layer(createServer, { port: at })),
    Layer.provide(capture),
  )

let scope: Scope.Closeable

beforeAll(async () => {
  scope = await Effect.runPromise(Scope.make())
  // two builds rather than one merged layer: a build memoizes by layer
  // identity, and one router shared by both servers would carry the first
  // server's policy on the second's shell
  await Effect.runPromise(Layer.buildWithScope(serve(port, 'report'), scope))
  await Effect.runPromise(Layer.buildWithScope(serve(enforcePort, 'enforce'), scope))
}, 30_000)

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  fs.rmSync(assetRoot, { recursive: true, force: true })
})

const base = `http://127.0.0.1:${port}`
const expected = composeShellPolicy([])

describe('the policy on the shell', () => {
  it('reports by default, with the endpoint the policy refers to', async () => {
    const response = await fetch(`${base}/`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy-report-only')).toBe(expected)
    expect(response.headers.get('content-security-policy')).toBeNull()
    expect(response.headers.get('reporting-endpoints')).toBe('csp="/csp-reports"')
    // the first step's document headers are still there
    expect(response.headers.get('x-frame-options')).toBe('DENY')
  })

  it('enforces under the other header name when told to', async () => {
    const response = await fetch(`http://127.0.0.1:${enforcePort}/`)
    expect(response.headers.get('content-security-policy')).toBe(expected)
    expect(response.headers.get('content-security-policy-report-only')).toBeNull()
  })

  it('puts no policy on a hashed asset', async () => {
    const response = await fetch(`${base}/assets/app-abc123.js`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-security-policy-report-only')).toBeNull()
    expect(response.headers.get('content-security-policy')).toBeNull()
    expect(response.headers.get('reporting-endpoints')).toBeNull()
    expect(response.headers.get('cache-control')).toContain('immutable')
  })
})

const legacy = (report: Record<string, unknown>) =>
  JSON.stringify({
    'csp-report': {
      'document-uri': `${base}/`,
      'effective-directive': 'script-src-elem',
      'blocked-uri': 'inline',
      'source-file': `${base}/`,
      'line-number': 7,
      disposition: 'report',
      ...report,
    },
  })

const post = (body: string, contentType: string, extra: Record<string, string> = {}) =>
  fetch(`${base}/csp-reports`, {
    method: 'POST',
    headers: { 'content-type': contentType, 'sec-fetch-site': 'same-origin', ...extra },
    body,
  })

const violations = () =>
  logged.filter(
    (line) => line.level === 'Warn' && line.message.includes('content security policy violation'),
  )

describe('the report endpoint', () => {
  it('takes a report-uri body and logs the six fields, never the sample', async () => {
    const before = violations().length
    const response = await post(
      legacy({ 'blocked-uri': 'https://elsewhere.example/x.js', 'script-sample': 'alert(1)' }),
      'application/csp-report',
    )
    expect(response.status).toBe(204)
    const lines = violations().slice(before)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.annotations).toMatchObject({
      source: '@qualy/plugin-web',
      documentUri: `${base}/`,
      effectiveDirective: 'script-src-elem',
      blockedUri: 'https://elsewhere.example/x.js',
      sourceFile: `${base}/`,
      lineNumber: 7,
      disposition: 'report',
      suppressed: 0,
    })
    expect(JSON.stringify(lines[0])).not.toContain('alert(1)')
  })

  it('takes a reporting api body', async () => {
    const before = violations().length
    const response = await post(
      JSON.stringify([
        {
          type: 'csp-violation',
          body: {
            documentURL: `${base}/batches`,
            effectiveDirective: 'connect-src',
            blockedURL: 'https://api.elsewhere.example/',
            sourceFile: `${base}/assets/app-abc123.js`,
            lineNumber: 1,
            disposition: 'report',
          },
        },
      ]),
      'application/reports+json',
    )
    expect(response.status).toBe(204)
    const lines = violations().slice(before)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.annotations).toMatchObject({
      effectiveDirective: 'connect-src',
      blockedUri: 'https://api.elsewhere.example/',
    })
  })

  it('refuses a body of another type', async () => {
    expect((await post('hello', 'text/plain')).status).toBe(415)
    expect((await post('{}', 'application/json')).status).toBe(415)
  })

  it('refuses a body over the limit', async () => {
    const big = legacy({ 'source-file': 'x'.repeat(70 * 1024) })
    expect((await post(big, 'application/csp-report')).status).toBe(413)
  })

  it('drops what it cannot read without complaint', async () => {
    const before = violations().length
    expect((await post('{not json', 'application/csp-report')).status).toBe(204)
    expect((await post('{"other": true}', 'application/csp-report')).status).toBe(204)
    expect((await post('{"not": "a list"}', 'application/reports+json')).status).toBe(204)
    expect(violations().length).toBe(before)
  })

  it('logs one line a minute for the same directive, url and file', async () => {
    const before = violations().length
    const same = legacy({ 'blocked-uri': 'https://repeated.example/x.js', 'line-number': 1 })
    for (let index = 0; index < 3; index += 1) {
      expect((await post(same, 'application/csp-report')).status).toBe(204)
    }
    // a different line number is the same key: the count is of the source
    expect(
      (
        await post(
          legacy({ 'blocked-uri': 'https://repeated.example/x.js', 'line-number': 2 }),
          'application/csp-report',
        )
      ).status,
    ).toBe(204)
    expect(violations().slice(before)).toHaveLength(1)
  })

  it('is heard from this application only', async () => {
    expect(
      (await post(legacy({}), 'application/csp-report', { 'sec-fetch-site': 'cross-site' })).status,
    ).toBe(403)
    // no fetch metadata and a foreign origin: judged against the host
    const response = await fetch(`${base}/csp-reports`, {
      method: 'POST',
      headers: { 'content-type': 'application/csp-report', origin: 'https://evil.example' },
      body: legacy({}),
    })
    expect(response.status).toBe(403)
  })
})
