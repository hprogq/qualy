import { NodeHttpServer } from '@effect/platform-node'
import { clientAssemblyLayer } from '@qualy/api-kit/client-assembly'
import { Effect, Exit, Layer, Logger, References, Scope } from 'effect'
import { HttpRouter } from 'effect/unstable/http'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { chromium, type Browser } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { AssemblyInfo } from '@qualy/api-kit/assembled'
import { NodeServer } from '@qualy/api-kit/node'
import { requestOriginGuard } from '@qualy/api-kit/origin'
import { WebConfig, routes } from '../src/server/index.ts'
import { composeShellPolicy, ShellPolicyHeader } from '../src/server/shell-policy.ts'
import { TEST_CONTRACT, installTestRelease } from './support/store.ts'

// One real violation, end to end: a browser loads a shell served with the
// policy, the shell carries an inline script the policy does not hash, the
// browser posts a report, and the report is a line in the log.
//
// A real browser because nothing else sends a report: the component suite
// runs inside a page it does not serve and cannot give it our headers, so
// this is the one test in the node suite that drives Chromium. It skips
// when no Chromium is installed (the integration job on ci does not
// install one; the browser job does, and does not run this suite), which
// is recorded in STATUS as a gap the browser-executed production smoke
// will close.
//
// The policy served here names report-uri only. With report-to present a
// browser ignores report-uri and batches reports through the Reporting
// API on its own schedule - a minute in Chromium - which is fine for a
// deployment and useless for a test; the served header is otherwise the
// composed policy.

process.env.NODE_ENV = 'production'

const port = 3216
const base = `http://127.0.0.1:${port}`

// Whether a browser can be launched is only known by launching one:
// `executablePath()` names the full Chromium, while a headless launch uses
// the headless shell, and either may be the one installed
let browser: Browser | undefined
let unavailable: string | undefined

const HASH = 'sha256:test'
const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-web-violation-'))
installTestRelease(assetRoot, {
  hash: HASH,
  shell: [
    '<!doctype html>',
    '<html><head><meta charset="utf-8"><title>violation</title>',
    "<script>document.title = 'the inline script ran'</script>",
    '</head><body>shell</body></html>',
  ].join('\n'),
})

interface Logged {
  readonly message: string
  readonly annotations: Record<string, unknown>
}
const logged: Logged[] = []
const capture = Logger.layer([
  Logger.make((options) => {
    logged.push({
      message: String(Array.isArray(options.message) ? options.message[0] : options.message),
      annotations: options.fiber.getRef(References.CurrentLogAnnotations) as Record<
        string,
        unknown
      >,
    })
  }),
])

const withoutReportTo = composeShellPolicy([]).replace('report-to csp; ', '')

let scope: Scope.Closeable

beforeAll(async () => {
  try {
    browser = await chromium.launch()
  } catch (error) {
    unavailable = error instanceof Error ? error.message.split('\n')[0] : String(error)
    return
  }
  const application = HttpRouter.serve(routes, {
    disableLogger: true,
    middleware: requestOriginGuard(),
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          WebConfig,
          WebConfig.of({ assetRoot, sourceRoot: assetRoot, cspMode: 'report' }),
        ),
        Layer.sync(NodeServer, () => createServer()),
        Layer.succeed(
          AssemblyInfo,
          AssemblyInfo.of({ resolutionHash: HASH, browserContractHash: TEST_CONTRACT }),
        ),
        Layer.succeed(ShellPolicyHeader, ShellPolicyHeader.of({ value: () => withoutReportTo })),
        clientAssemblyLayer,
      ),
    ),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
    Layer.provide(capture),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
}, 30_000)

afterAll(async () => {
  await browser?.close()
  if (scope !== undefined) await Effect.runPromise(Scope.close(scope, Exit.void))
  fs.rmSync(assetRoot, { recursive: true, force: true })
})

describe('a browser reporting a violation', () => {
  it('posts the blocked inline script to the endpoint, which logs it', async ({ skip }) => {
    if (browser === undefined) {
      skip(`no browser to drive: ${unavailable ?? 'unknown'}`)
      return
    }
    const page = await browser.newPage()
    try {
      await page.goto(`${base}/`)
      // report-only: the script still ran, and the report was still sent
      expect(await page.title()).toBe('the inline script ran')
      const violation = () =>
        logged.find(
          (line) =>
            line.message.includes('content security policy violation') &&
            line.annotations['effectiveDirective'] === 'script-src-elem',
        )
      const deadline = Date.now() + 10_000
      while (violation() === undefined && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      const line = violation()
      expect(line).toBeDefined()
      expect(line!.annotations).toMatchObject({
        source: '@qualy/plugin-web',
        documentUri: `${base}/`,
        blockedUri: 'inline',
        disposition: 'report',
      })
    } finally {
      await page.close()
    }
  }, 30_000)
})
