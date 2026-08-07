import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Exit, Layer, Logger, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { AssemblyInfo } from '@qualy/api-kit/assembled'
import { NodeServer } from '@qualy/api-kit/node'
import { WebConfig, routes, viteLogger } from '../src/server/index.ts'

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

// A shell of its own, not the staged build.
//
// Every property here is about which side of the api mount a path falls on,
// and none of them reads the bundle. Pointing at client-dist made the suite
// depend on `pnpm build` having run, which on CI it has not: the whole file
// died with WebUnservable, in a job where the build step comes after the
// tests. It also meant these assertions could only run after a full frontend
// build, for no gain.
const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-web-assets-'))
fs.writeFileSync(path.join(assetRoot, 'index.html'), '<!doctype html><title>shell</title>')
// the fingerprint stage writes, matching the assembly the fake host declares
const HASH = 'sha256:test'
fs.writeFileSync(
  path.join(assetRoot, '.qualy-assembly.json'),
  JSON.stringify({ resolutionHash: HASH }),
)
const assemblyInfo = Layer.succeed(AssemblyInfo, AssemblyInfo.of({ resolutionHash: HASH }))

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
        assemblyInfo,
      ),
    ),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
  )
  scope = await Effect.runPromise(Scope.make())
  await Effect.runPromise(Layer.buildWithScope(application, scope))
}, 30_000)

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  fs.rmSync(assetRoot, { recursive: true, force: true })
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

  it('refuses to build at all when the assets it would serve are absent', async () => {
    // Enabling this plugin is a claim that the shell can be served, so a
    // missing build is a startup failure rather than a silent downgrade to a
    // headless deployment. Asserted here because the suite used to depend on
    // the staged build existing, which both hid this property and made the
    // file die outright on CI, where the tests run before the build.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-web-empty-'))
    try {
      const exit = await Effect.runPromiseExit(
        Effect.scoped(
          Layer.build(
            routes.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(WebConfig, WebConfig.of({ mode: 'production', assetRoot: empty })),
                  Layer.sync(NodeServer, () => createServer()),
                  assemblyInfo,
                  HttpRouter.layer,
                ),
              ),
            ),
          ),
        ),
      )
      expect(Exit.isFailure(exit)).toBe(true)
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it('refuses assets built from a different assembly, and unstamped assets', async () => {
    // the bundle and the process each name their assembly; a mismatch means
    // the browser registry and the served api are different selections
    const buildAt = (root: string, info: Layer.Layer<AssemblyInfo>) =>
      Effect.runPromiseExit(
        Effect.scoped(
          Layer.build(
            routes.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(WebConfig, WebConfig.of({ mode: 'production', assetRoot: root })),
                  Layer.sync(NodeServer, () => createServer()),
                  info,
                  HttpRouter.layer,
                ),
              ),
            ),
          ),
        ),
      )
    const other = Layer.succeed(AssemblyInfo, AssemblyInfo.of({ resolutionHash: 'sha256:other' }))
    expect(Exit.isFailure(await buildAt(assetRoot, other))).toBe(true)

    const unstamped = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-web-unstamped-'))
    try {
      fs.writeFileSync(path.join(unstamped, 'index.html'), '<!doctype html><title>shell</title>')
      expect(Exit.isFailure(await buildAt(unstamped, assemblyInfo))).toBe(true)
    } finally {
      fs.rmSync(unstamped, { recursive: true, force: true })
    }
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

// Vite calls its logger synchronously from its own work, so the adapter cannot
// yield*. What matters is that a line still arrives at the application's
// logger, with its level intact - otherwise the dev output is two formats
// again and nobody notices until they are reading it.
describe("vite's logger, adapted", () => {
  const captured = async (
    expected: number,
    use: (logger: Awaited<ReturnType<typeof build>>) => void,
  ) => {
    const lines: string[] = []
    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* viteLogger
        use(logger)
        // the forked drain runs on its own fiber; a fixed sleep raced the
        // scheduler under a loaded suite, so wait for the lines themselves,
        // then one settle tick so an unexpected extra line still shows up
        const deadline = Date.now() + 5_000
        while (lines.length < expected && Date.now() < deadline) {
          yield* Effect.sleep(5)
        }
        yield* Effect.sleep(20)
      }).pipe(
        Effect.scoped,
        Effect.provide(
          Logger.layer([
            Logger.make(({ logLevel, message }) => lines.push(`${logLevel}:${String(message)}`)),
          ]),
        ),
      ),
    )
    return lines
  }
  const build = () => Effect.runPromise(Effect.scoped(viteLogger))

  it('carries each level through to the application logger', async () => {
    expect(
      await captured(3, (logger) => {
        logger.info('mounted')
        logger.warn('careful')
        logger.error('broken')
      }),
    ).toEqual(['Info:mounted', 'Warn:careful', 'Error:broken'])
  })

  it('says a repeated warning once, and remembers that it warned', async () => {
    let logger: Awaited<ReturnType<typeof build>>
    const lines = await captured(1, (made) => {
      logger = made
      expect(made.hasWarned).toBe(false)
      made.warnOnce('same')
      made.warnOnce('same')
    })
    expect(lines).toEqual(['Warn:same'])
    expect(logger!.hasWarned).toBe(true)
  })
})
