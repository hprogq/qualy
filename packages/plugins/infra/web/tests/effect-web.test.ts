import { NodeHttpServer } from '@effect/platform-node'
import {
  ClientAssembly,
  clientAssemblyLayer,
  type ReleaseStanding,
} from '@qualy/api-kit/client-assembly'
import { Context, Effect, Exit, Layer, Logger, Schema, Scope } from 'effect'
import { HttpRouter, HttpServerResponse } from 'effect/unstable/http'
import fs from 'node:fs'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QUALY_API_PREFIX } from '@qualy/api-kit'
import { QUALY_RELEASE_ENDPOINT, ReleaseProbeSchema } from '@qualy/release-contract'
import { AssemblyInfo } from '@qualy/api-kit/assembled'
import { NodeServer } from '@qualy/api-kit/node'
import { WebConfig, namesHiddenPath, routes } from '../src/server/index.ts'
import { ShellPolicyHeader } from '../src/server/shell-policy.ts'
import { viteLogger } from '../src/dev/index.ts'
import { TEST_CONTRACT, TEST_HASH, installTestRelease } from './support/store.ts'

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

// The serving half is a deployment's: a development backend leaves the
// browser to the dev service in front of it, so these cases say which they
// are testing rather than relying on whatever NODE_ENV the runner has.
process.env.NODE_ENV = 'production'

const port = 3191
const base = `http://127.0.0.1:${port}`

// A store of its own, not the staged build.
//
// Every property here is about which side of the api mount a path falls on
// and what each side is cached as, and none of them reads the bundle.
// Pointing at client-dist made the suite depend on `pnpm build` having run,
// which on CI it has not: the whole file died with WebUnservable, in a job
// where the build step comes after the tests. It also meant these assertions
// could only run after a full frontend build, for no gain.
const HASH = TEST_HASH
const installFixture = installTestRelease

const assetRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-web-assets-'))
// Two releases an open tab could still be running, beside the one this
// process pins: one from an earlier deployment of the SAME assembly, which
// is the tab this store exists to keep working, and one built from a
// different plugin selection. The default install goes last so the pointer
// names it again.
installFixture(assetRoot, { releaseId: 'kept-release' })
installFixture(assetRoot, { releaseId: 'foreign-release', hash: 'sha256:another-assembly' })
// the same plugins, and a browser half that offers different surfaces: a
// page added, renamed or removed in ordinary code, which the assembly hash
// cannot see because page ids are not part of what a lock records
installFixture(assetRoot, {
  releaseId: 'other-surfaces-release',
  browserContract: 'sha256:other-surfaces',
})
installFixture(assetRoot)
const assemblyInfo = Layer.succeed(
  AssemblyInfo,
  AssemblyInfo.of({ resolutionHash: HASH, browserContractHash: TEST_CONTRACT }),
)
// a policy already frozen: which header the shell sends is another suite's question
const policy = Layer.succeed(
  ShellPolicyHeader,
  ShellPolicyHeader.of({ value: () => "default-src 'self'" }),
)

let scope: Scope.Scope
/** what this process says about a release a page claims to be running */
let standingOf: (releaseId: string) => ReleaseStanding

beforeAll(async () => {
  scope = await Effect.runPromise(Scope.make())
  // built first and handed in, so the test can ask the registry the same
  // question the serve chain asks it per request. The judgement itself is
  // registered by the plugin while its own layer builds; nothing here
  // reaches into the plugin to get it.
  const registry = await Effect.runPromise(Layer.buildWithScope(clientAssemblyLayer, scope))
  const assembly = Context.getUnsafe(registry, ClientAssembly)
  standingOf = assembly.standingOf
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
        Layer.succeed(
          WebConfig,
          WebConfig.of({ assetRoot, sourceRoot: assetRoot, cspMode: 'report' }),
        ),
        Layer.sync(NodeServer, () => createServer()),
        assemblyInfo,
        policy,
        Layer.succeed(ClientAssembly, assembly),
      ),
    ),
    Layer.provide(NodeHttpServer.layer(createServer, { port })),
  )
  await Effect.runPromise(Layer.buildWithScope(application, scope))
}, 30_000)

afterAll(async () => {
  await Effect.runPromise(Scope.close(scope, Exit.void))
  fs.rmSync(assetRoot, { recursive: true, force: true })
})

describe('what the shell refuses to serve', () => {
  it('reads a hidden name through its escapes', () => {
    // The guard used to test the raw url, while the file lookup works from
    // the decoded one: `%2E` is a dot and `%2F` is a separator, so the raw
    // text named the release's own metadata while carrying neither.
    for (const hidden of [
      '/.qualy-release.json',
      '/%2Equaly-release.json',
      '/assets%2F.hidden',
      '/a/.git/config',
      // an escape that does not decode cannot name a servable file either
      '/%ZZ',
    ]) {
      expect(namesHiddenPath(hidden), hidden).toBe(true)
    }
    for (const served of ['/', '/index.html', '/assets/index-abc.js', '/ping', '/batches?x=1']) {
      expect(namesHiddenPath(served), served).toBe(false)
    }
  })
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
                  Layer.succeed(
                    WebConfig,
                    WebConfig.of({ assetRoot: empty, sourceRoot: empty, cspMode: 'report' }),
                  ),
                  Layer.sync(NodeServer, () => createServer()),
                  assemblyInfo,
                  policy,
                  clientAssemblyLayer,
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

  it('refuses a release built from a different assembly, and one without metadata', async () => {
    // the release and the process each name their assembly; a mismatch means
    // the browser registry and the served api are different selections
    const buildAt = (root: string, info: Layer.Layer<AssemblyInfo>) =>
      Effect.runPromiseExit(
        Effect.scoped(
          Layer.build(
            routes.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(
                    WebConfig,
                    WebConfig.of({ assetRoot: root, sourceRoot: root, cspMode: 'report' }),
                  ),
                  Layer.sync(NodeServer, () => createServer()),
                  clientAssemblyLayer,
                  info,
                  policy,
                  HttpRouter.layer,
                ),
              ),
            ),
          ),
        ),
      )
    const other = Layer.succeed(
      AssemblyInfo,
      AssemblyInfo.of({ resolutionHash: 'sha256:other', browserContractHash: TEST_CONTRACT }),
    )
    expect(Exit.isFailure(await buildAt(assetRoot, other))).toBe(true)

    // The same refusal for the half the assembly hash cannot see. Adding,
    // renaming or removing a page or a slot moves no lock and bumps no
    // version, so a server updated over a reused store would answer a
    // manifest naming surfaces its own bundle cannot render.
    const movedSurfaces = Layer.succeed(
      AssemblyInfo,
      AssemblyInfo.of({ resolutionHash: HASH, browserContractHash: 'sha256:one-more-page' }),
    )
    expect(Exit.isFailure(await buildAt(assetRoot, movedSurfaces))).toBe(true)

    const unstamped = fs.mkdtempSync(path.join(os.tmpdir(), 'qualy-web-unstamped-'))
    try {
      installFixture(unstamped, { metadata: false })
      expect(Exit.isFailure(await buildAt(unstamped, assemblyInfo))).toBe(true)
    } finally {
      fs.rmSync(unstamped, { recursive: true, force: true })
    }
  })

  it('serves the shell and its public files uncached, and the hashed assets immutable', async () => {
    // the shell's name never changes and its bytes do at every release
    const page = await fetch(`${base}/`)
    expect(page.status).toBe(200)
    expect(page.headers.get('cache-control')).toBe('no-cache')
    expect(page.headers.get('x-frame-options')).toBe('DENY')
    expect(page.headers.get('content-security-policy-report-only')).toBe("default-src 'self'")
    // an icon is a public file of the release, not a hashed asset: the same
    // rule as the shell, and none of the document-only headers
    const icon = await fetch(`${base}/favicon.svg`)
    expect(icon.status).toBe(200)
    expect(icon.headers.get('cache-control')).toBe('no-cache')
    expect(icon.headers.get('x-frame-options')).toBeNull()
    expect(icon.headers.get('x-content-type-options')).toBe('nosniff')
    // a hashed asset's name promises its bytes
    const asset = await fetch(`${base}/assets/index-current.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public,max-age=31536000,immutable')
    expect(asset.headers.get('x-frame-options')).toBeNull()
  })

  it('keeps serving an asset the current release does not name, for the tab that still needs it', async () => {
    const asset = await fetch(`${base}/assets/page-old.js`)
    expect(asset.status).toBe(200)
    expect(asset.headers.get('cache-control')).toBe('public,max-age=31536000,immutable')
    expect(await asset.text()).toContain('old')
  })

  it('answers which release it serves, uncached, outside the api mount', async () => {
    const response = await fetch(`${base}${QUALY_RELEASE_ENDPOINT}`)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    // the bytes as they go out: which release, and nothing about the host
    const body: unknown = await response.json()
    expect(body).toEqual({ schema: 2, releaseId: 'test-release' })
    expect(Schema.decodeUnknownSync(ReleaseProbeSchema)(body).releaseId).toBe('test-release')
  })

  it('tells the host which assembly each release a page might claim was built from', () => {
    // The judgement the serve chain asks for per request, answered by the
    // only thing that can: the store records, beside each installed
    // release's shell, the assembly it was built from.
    //
    // Same assembly is one answer for two cases on purpose - this process's
    // own release and an older one built the same way - because an older tab
    // going on working is what keeping releases around is FOR. A different
    // selection is not a code difference: that page has screens whose api
    // may not be here, and will ask a manifest for surfaces its own bundle
    // does not carry.
    expect(standingOf('test-release')).toBe('compatible')
    expect(standingOf('kept-release')).toBe('compatible')
    expect(standingOf('foreign-release')).toBe('other-assembly')
    // the assembly matches and the browser contract does not, which is the
    // case the assembly hash alone could not catch: same plugins, different
    // surfaces, and a manifest this page's own bundle cannot render
    expect(standingOf('other-surfaces-release')).toBe('other-assembly')
    // collected, or never here at all: nothing to compare, so nothing to allow
    expect(standingOf('r_collectedLongAgo')).toBe('unknown')
  })

  it('serves the release it pinned at boot, whatever the pointer says later', async () => {
    // an installer moves the pointer to a newer release while this process
    // runs: this process is one api assembly and one shell, until replaced
    installFixture(assetRoot, {
      releaseId: 'other-release',
      shell: '<!doctype html><title>other</title>',
    })
    expect(JSON.parse(fs.readFileSync(path.join(assetRoot, 'current.json'), 'utf8'))).toEqual({
      schema: 1,
      releaseId: 'other-release',
    })
    const page = await fetch(`${base}/`)
    expect(await page.text()).toContain('<title>shell</title>')
    const probe = Schema.decodeUnknownSync(ReleaseProbeSchema)(
      await (await fetch(`${base}${QUALY_RELEASE_ENDPOINT}`)).json(),
    )
    expect(probe.releaseId).toBe('test-release')
  })

  it('answers 404 for an asset removed after boot, and stays up', async () => {
    // an installer's collection took the file away while this host ran; a
    // table of files taken at boot made the host open what was gone and
    // die of the stream's error
    const removed = path.join(assetRoot, 'assets', 'removed-after-boot.js')
    fs.writeFileSync(removed, 'export {}\n')
    const before = await fetch(`${base}/assets/removed-after-boot.js`)
    expect(before.status).toBe(200)
    fs.rmSync(removed)
    const after = await fetch(`${base}/assets/removed-after-boot.js`)
    expect(after.status).toBe(404)
    expect((await fetch(`${base}/`)).status).toBe(200)
  })

  it('answers a missing asset with a 404 and never with the shell', async () => {
    for (const missing of ['/assets/nope.js', '/assets/', '/assets']) {
      const response = await fetch(`${base}${missing}`)
      expect(response.status, missing).toBe(404)
      expect(response.headers.get('content-type') ?? '').not.toContain('text/html')
    }
    // and nothing of the store's own is reachable through the shell
    for (const internal of [
      '/.qualy-release.json',
      '/current.json',
      '/releases/test-release/index.html',
    ]) {
      const response = await fetch(`${base}${internal}`)
      expect(response.status, internal).toBe(404)
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
      // the api's own tagged 404, read by its tag like every other refusal
      expect(await response.json()).toEqual({
        _tag: 'API_ROUTE_NOT_FOUND',
        message: expect.any(String),
      })
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
