import fs from 'node:fs'
import path from 'node:path'
import { repoRoot } from '../lib/manifest.ts'
import { startQualyServer } from '../lib/qualy-server.ts'
import { HEALTH_LIVE_PATH, HEALTH_READY_PATH } from '@qualy/api-kit'
import { readCurrentWebRelease, storeAt } from '../../packages/build/web/src/release-store.ts'

// The production boot, actually booted - through the same runner `pnpm
// start` uses, so the command people deploy with is the path being tested.
//
// The descriptor model gave up the compile-time proof that the composition
// closes; the boot is the check now, so a boot nobody runs under production
// settings is a trust boundary nobody guards. This starts the real entry
// against the staged assets and the committed lock, asserts the process
// serves - liveness, readiness, the browser shell, the manifest endpoint,
// one hashed asset - and then asserts it can also STOP: SIGTERM has to run
// the finalizers and exit zero.

const PORT = process.env.SMOKE_PORT ?? '3197'
const base = `http://127.0.0.1:${PORT}`

const server = startQualyServer({
  port: PORT,
  env: {
    // production refuses to assume a database; the smoke falls back to the
    // compose stack's url, the same one development assumes. Migrations
    // follow the runner's production default (off): the lineage was applied
    // by `pnpm qualy deploy`, exactly as a deployment would have.
    DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy',
  },
})

const fail = (message: string): never => {
  console.error(`smoke: ${message}`)
  console.error(server.output())
  server.kill()
  process.exit(1)
}

const check = async (
  route: string,
  expect: (response: Response) => Promise<string | undefined>,
) => {
  const response = await fetch(`${base}${route}`).catch((error: unknown) => error as Error)
  if (response instanceof Error) return fail(`${route}: ${response.message}`)
  const complaint = await expect(response)
  if (complaint) return fail(`${route}: ${complaint}`)
  console.log(`smoke: ${route} ok`)
}

await server.waitUntilReady().catch((error: unknown) => fail(String(error)))
console.log(`smoke: ${HEALTH_READY_PATH} ok`)

await check(HEALTH_LIVE_PATH, async (response) =>
  response.status === 200 ? undefined : `status ${response.status}`,
)
let shell = ''
await check('/', async (response) => {
  shell = await response.text()
  if (response.status !== 200) return `status ${response.status}`
  if (!shell.includes('<!doctype html')) return 'no html shell'
  // the first frame the build wrote in place of the source's marker, and
  // no comment left for a browser to download
  if (!shell.includes('id="qualy-boot"') || !shell.includes('data-seg="1-7"')) {
    return 'the shell carries no generated first frame'
  }
  if (shell.includes('<!--')) return 'the shell carries a comment'
  // the shell's name never changes and its bytes do at every release
  if (response.headers.get('cache-control') !== 'no-cache') {
    return `cache-control: ${response.headers.get('cache-control') ?? 'absent'}, expected no-cache`
  }
  // the document-only headers, set by the static middleware rather than
  // the serve chain, which never sees these bytes
  for (const [name, expected] of [
    ['x-frame-options', 'DENY'],
    ['cross-origin-opener-policy', 'same-origin'],
    ['x-content-type-options', 'nosniff'],
    ['referrer-policy', 'strict-origin-when-cross-origin'],
    ['reporting-endpoints', 'csp="/csp-reports"'],
  ] as const) {
    const actual = response.headers.get(name)
    if (actual !== expected) return `${name}: ${actual ?? 'absent'}, expected ${expected}`
  }
  // the content security policy, frozen at the barrier from every plugin's
  // contribution, reported rather than enforced until a deployment says so
  const policy = response.headers.get('content-security-policy-report-only')
  if (policy === null) return 'no content-security-policy-report-only'
  if (!policy.includes("script-src 'self' 'sha256-"))
    return `policy hashes no inline script: ${policy}`
  if (!policy.endsWith('report-uri /csp-reports'))
    return `policy names no report endpoint: ${policy}`
  console.log(`smoke: / policy ${policy}`)
  return undefined
})
// the live channel, answered like any authenticated endpoint: no session,
// no stream - and the route resolving at all means the listener layer
// assembled with the rest of the production graph
await check('/api/assessment/batches/00000000-0000-4000-8000-000000000000/events', (response) =>
  Promise.resolve(
    response.status === 401
      ? undefined
      : `expected 401 for the live channel, got ${response.status}`,
  ),
)

// a request inside the api mount that names no route: the api's tagged
// 404, never the shell, and the request it answered named in a header
await check('/api/nope', async (response) => {
  if (response.status !== 404) return `status ${response.status}`
  if (!/^[0-9a-f-]{36}$/.test(response.headers.get('x-qualy-request-id') ?? '')) {
    return `x-qualy-request-id: ${response.headers.get('x-qualy-request-id') ?? 'absent'}`
  }
  const body = (await response.json()) as { _tag?: string }
  return body._tag === 'API_ROUTE_NOT_FOUND' ? undefined : `tag ${body._tag ?? 'absent'}`
})
// The api reference and the document behind it, which a production
// deployment does not publish. QUALY_API_DOCS is unset here, exactly as it
// is in a deployment, and `auto` reads that as off outside development; a
// deployment that wants them says QUALY_API_DOCS=public. Not registered
// means not there, so the refusal is the api's ordinary unknown route.
for (const route of ['/api/docs', '/api/openapi.json']) {
  await check(route, async (response) => {
    if (response.status !== 404) return `status ${response.status}, expected 404`
    const body = (await response.json()) as { _tag?: string }
    return body._tag === 'API_ROUTE_NOT_FOUND' ? undefined : `tag ${body._tag ?? 'absent'}`
  })
}
await check('/api/app/manifest', async (response) => {
  if (response.status !== 200) return `status ${response.status}`
  // an api answer is never cached and never sniffed; set by the serve
  // chain, which sees every Effect response
  if (response.headers.get('cache-control') !== 'no-store') {
    return `cache-control: ${response.headers.get('cache-control') ?? 'absent'}, expected no-store`
  }
  if (response.headers.get('x-content-type-options') !== 'nosniff') return 'not nosniff'
  const body = (await response.json()) as { pages?: unknown[] }
  return Array.isArray(body.pages) ? undefined : 'no pages in the manifest'
})
// The browser asks this before it decides whether to report anything, on a
// deployment that reports and on one that does not. Here nothing is selected,
// which is the answer that has to be as clear as the other one: a page that
// cannot tell "nobody" from "the request failed" either reports nowhere for
// the wrong reason or keeps asking.
// Whether this deployment reports browser failures, and with what settings -
// and nothing about WHICH vendor, which a build already decided. The keys are
// asserted rather than only the values: a field added to this document is a
// field every visitor is handed.
await check('/api/app/observability', async (response) => {
  if (response.status !== 200) return `status ${response.status}`
  const body = (await response.json()) as { schema?: number; config?: unknown }
  if (body.schema !== 2) return `schema ${String(body.schema)}`
  const keys = Object.keys(body).sort()
  if (keys.join(',') !== 'config,schema') return `keys ${keys.join(',')}`
  return body.config === null ? undefined : `reporting is configured on in this smoke`
})
// an icon is a public file of the release, not a hashed asset: never cached
// as immutable (it was, by the single server this replaced)
await check('/favicon.svg', async (response) => {
  if (response.status !== 200) return `status ${response.status}`
  const caching = response.headers.get('cache-control') ?? ''
  if (caching !== 'no-cache') return `cache-control: ${caching || 'absent'}, expected no-cache`
  return undefined
})
// the release this process pinned is the one the store points at: the
// process started after the install, and read the pointer then
const staged = readCurrentWebRelease(
  storeAt(path.join(repoRoot, 'packages/plugins/infra/web/client-dist')),
)
if (staged === undefined) fail('no web release is installed; the build did not stage one')
await check('/__qualy/release', async (response) => {
  if (response.status !== 200) return `status ${response.status}`
  if (response.headers.get('cache-control') !== 'no-store') {
    return `cache-control: ${response.headers.get('cache-control') ?? 'absent'}, expected no-store`
  }
  const probe = (await response.json()) as { releaseId?: string }
  if (probe.releaseId !== staged!.releaseId) {
    return `release ${probe.releaseId ?? 'absent'}, the store points at ${staged!.releaseId}`
  }
  // which release, and nothing else about this host: no deployment mode, no
  // protocol window. A page compares ids here and asks the api the rest.
  const fields = Object.keys(probe).sort().join(',')
  if (fields !== 'releaseId,schema') return `the probe carries ${fields}`
  console.log(`smoke: /__qualy/release ${probe.releaseId}`)
  return undefined
})
// The old-tab matrix, against the real store this process pinned from.
//
// A deployment that only changed code must leave every open tab working, and
// one that changed which plugins are in the product must not - that page has
// screens whose api is not here. Both answers come from the same place: the
// release a page names, looked up in the store, compared by the assembly it
// was built from.
//
// All four cases run every time, because the two interesting ones are PUT
// there rather than looked for. They used to depend on what the store
// happened to hold, which on a developer's machine is months of builds and on
// a fresh checkout is one - so the two cases that matter most were the two
// that only ever ran where they were least needed. A retained release is a
// directory with a metadata file in it; the smoke writes two, asks, and takes
// them away again.
{
  const releasesDir = path.join(repoRoot, 'packages/plugins/infra/web/client-dist', 'releases')
  // Both halves of what makes an old tab safe: the same plugins (the
  // assembly) AND the same browser surfaces (the contract). A release of the
  // same selection can still have added or renamed a page in ordinary code,
  // and that page's manifest would name a surface the older bundle cannot
  // render.
  const claiming = (releaseId: string) =>
    fetch(`${base}/api/app/manifest`, { headers: { 'x-qualy-web-release': releaseId } })

  const current = staged!.releaseId
  const mine = JSON.parse(
    fs.readFileSync(path.join(releasesDir, current, '.qualy-release.json'), 'utf8'),
  ) as Record<string, unknown>

  /** a release the store holds and this process did not build */
  const plant = (id: string, differing: Record<string, unknown>) => {
    const at = path.join(releasesDir, id)
    fs.mkdirSync(at, { recursive: true })
    fs.writeFileSync(
      path.join(at, '.qualy-release.json'),
      `${JSON.stringify({ ...mine, releaseId: id, ...differing }, null, 2)}\n`,
    )
    return at
  }
  const sameAssembly = 'r_smoke_same_assembly'
  const otherAssembly = 'r_smoke_other_assembly'
  const planted = [
    // one an ordinary code-only deployment leaves behind: same plugins, same
    // surfaces, different build
    plant(sameAssembly, {}),
    // and one from a deployment whose plugin selection moved
    plant(otherAssembly, { resolutionHash: 'sha256:another-assembly-entirely' }),
  ]

  const own = await claiming(current)
  if (own.status !== 200) fail(`the pinned release was refused: ${own.status}`)
  console.log('smoke: a page on the pinned release is served')

  const gone = await claiming('r_collectedLongAgo')
  if (gone.status !== 409 || gone.headers.get('x-qualy-client-unsupported') !== 'release') {
    fail(
      `a page naming an unknown release got ${gone.status} / ${gone.headers.get('x-qualy-client-unsupported') ?? 'no reason'}`,
    )
  }
  console.log('smoke: a page naming a release this host never installed is told to reload')

  {
    const older = await claiming(sameAssembly)
    if (older.status !== 200) {
      fail(`an older page of this same assembly was refused: ${older.status}`)
    }
    console.log(`smoke: an older page (${sameAssembly}) of this assembly goes on being served`)
  }
  {
    const foreign = await claiming(otherAssembly)
    if (
      foreign.status !== 409 ||
      foreign.headers.get('x-qualy-client-unsupported') !== 'assembly'
    ) {
      fail(
        `a page of another assembly got ${foreign.status} / ${foreign.headers.get('x-qualy-client-unsupported') ?? 'no reason'}`,
      )
    }
    console.log(`smoke: a page of another assembly (${otherAssembly}) is told to reload`)
  }

  // A release this host also refuses, for the other half of the contract: the
  // same plugins, a different set of browser surfaces. Ordinary code can add
  // or rename a page without moving the assembly hash at all.
  const movedSurfaces = plant('r_smoke_moved_surfaces', {
    browserContractHash: 'sha256:one-page-more',
  })
  planted.push(movedSurfaces)
  {
    const skewed = await claiming('r_smoke_moved_surfaces')
    if (skewed.status !== 409 || skewed.headers.get('x-qualy-client-unsupported') !== 'assembly') {
      fail(
        `a page whose surfaces moved got ${skewed.status} / ${skewed.headers.get('x-qualy-client-unsupported') ?? 'no reason'}`,
      )
    }
    console.log('smoke: a page built from a different set of surfaces is told to reload')
  }

  for (const at of planted) fs.rmSync(at, { recursive: true, force: true })
}

// one hashed asset out of the shell it actually served, so the check follows
// the build instead of hardcoding a chunk name
const asset = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(shell)?.[1]
if (!asset) fail('the shell references no /assets/*.js entry')
await check(asset!, async (response) => {
  if (response.status !== 200) return `status ${response.status}`
  // a hashed asset keeps its immutable caching and is not sniffed
  const caching = response.headers.get('cache-control') ?? ''
  if (!caching.includes('immutable'))
    return `cache-control: ${caching || 'absent'}, expected immutable`
  if (response.headers.get('x-content-type-options') !== 'nosniff') return 'not nosniff'
  // not a document: the framing and opener headers belong to the shell only
  if (response.headers.get('x-frame-options') !== null) return 'x-frame-options on an asset'
  return undefined
})
// and it arrives compressed: the twins are written by the staging step and
// served by the static server, two halves that fail silently on their own -
// a missing twin just means the raw file goes out, five times the bytes
{
  const response = await fetch(`${base}${asset}`, { headers: { 'accept-encoding': 'br' } })
  const encoding = response.headers.get('content-encoding')
  if (encoding !== 'br') {
    fail(`${asset}: served with content-encoding ${encoding ?? 'none'}, expected br`)
  }
  console.log(`smoke: ${asset} served brotli-compressed`)
}

const stopped = await server.stop()
if (stopped.timedOut) fail(`SIGTERM did not stop the process within ${String(stopped.ms)}ms`)
if (stopped.exitCode !== 0) fail(`shutdown exited ${String(stopped.exitCode)}`)
// the finalizers are the only evidence the teardown ran at all: the entry
// point logs this because a finalizer ran, so a silent exit zero is a
// shutdown that skipped them
if (!server.output().includes('shutdown complete')) {
  fail('SIGTERM exited zero without reporting a completed shutdown')
}
console.log('smoke: shutdown clean (exit 0), finalizers reported')

// And the same request from a keyboard.
//
// A production instance is stopped by a supervisor, but `kill -INT` and a
// terminal both reach it, and the process must not answer those by telling
// whoever is reading the log to press a key. It is the same graceful path -
// this asserts the exit and the finalizers again, because a message-only
// change that quietly took either with it is exactly what this guards.
{
  const interrupted = startQualyServer({
    port: PORT,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy',
    },
  })
  await interrupted.waitUntilReady().catch((error: unknown) => {
    console.error(interrupted.output())
    interrupted.kill()
    return fail(`the interrupt probe never became ready: ${String(error)}`)
  })
  const ended = await interrupted.stop({ signal: 'SIGINT' })
  const said = interrupted.output()
  if (ended.timedOut) fail(`SIGINT did not stop the process within ${String(ended.ms)}ms`)
  if (ended.exitCode !== 0) fail(`a graceful SIGINT exited ${String(ended.exitCode)}`)
  if (!said.includes('SIGINT: shutting down')) fail('SIGINT did not name itself')
  if (said.includes('press Ctrl+C again')) {
    fail('a production instance offered its log file a second Ctrl+C')
  }
  if (!said.includes('shutdown complete')) {
    fail('SIGINT exited zero without reporting a completed shutdown')
  }
  console.log('smoke: SIGINT shuts down the same way, and offers nobody a keystroke')
}

// A boot that refuses has to end, and say why.
//
// Both halves of the artifact check raise from inside the launched
// application, and for a long time neither reached a reader: the entry point
// raced the launch against the stop request for the first SUCCESS, so a
// launch that died left the race waiting on a request only a signal would
// ever send. The process stayed alive, never became ready, printed nothing,
// and on SIGTERM reported an ordinary shutdown - a misconfigured instance
// that an orchestrator keeps rather than replaces, with empty logs.
//
// So this asserts the process outcome rather than the layer's: the layer's
// refusal is the web plugin's own suite, and what could not be seen there is
// that nothing carried it to the exit. The two fields are tampered in the
// installed metadata, which is exactly the shape of the deployment this
// guards - a server updated over a store whose release was built from
// something else.
const pinned = path.join(
  repoRoot,
  'packages/plugins/infra/web/client-dist/releases',
  staged!.releaseId,
  '.qualy-release.json',
)
const original = fs.readFileSync(pinned, 'utf8')
const refusalPort = String(Number(PORT) + 1)

/** boots with one field of the pinned release spoiled, and returns how it ended */
const refuses = async (field: 'resolutionHash' | 'browserContractHash') => {
  fs.writeFileSync(
    pinned,
    `${JSON.stringify({ ...JSON.parse(original), [field]: 'sha256:not-this-one' }, null, 2)}\n`,
  )
  const refused = startQualyServer({
    port: refusalPort,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy',
    },
  })
  try {
    const deadline = Date.now() + 60_000
    while (refused.exited() === null && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200))
    }
    return { exited: refused.exited(), output: refused.output() }
  } finally {
    refused.kill()
    fs.writeFileSync(pinned, original)
  }
}

for (const field of ['resolutionHash', 'browserContractHash'] as const) {
  const outcome = await refuses(field)
  if (outcome.exited === null) {
    fail(`a release with the wrong ${field} left the process running instead of refusing`)
  }
  if (outcome.exited !== '1') {
    fail(`a release with the wrong ${field} exited ${outcome.exited!}, expected 1`)
  }
  const said = outcome.output
    .split('\n')
    .find((line) => line.includes('startup failed') && line.includes(staged!.releaseId))
  if (!said) {
    console.error(outcome.output)
    fail(`a release with the wrong ${field} exited 1 without saying which release it refused`)
  }
  console.log(`smoke: a release with the wrong ${field} is refused, and named (exit 1)`)
}

// And a production process without a key for its secrets does not start.
//
// Every value an entrance keeps is encrypted under it, so coming up without
// one means coming up unable to read what is already stored - and, worse,
// able to write more under a key nobody chose. The variable is passed empty
// here, because an unset one would be filled in by the harness the way every
// other probe above has it.
{
  const refused = startQualyServer({
    port: refusalPort,
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://qualy:qualy@localhost:5432/qualy',
      QUALY_SECRETS_MASTER_KEY: '',
    },
  })
  const deadline = Date.now() + 60_000
  while (refused.exited() === null && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  const ended = refused.exited()
  const said = refused.output()
  refused.kill()
  if (ended === null) fail('a production start without a master key stayed up')
  else if (!said.includes('QUALY_SECRETS_MASTER_KEY must be base64-encoded 32 bytes')) {
    console.error(said)
    fail(`a production start without a master key exited ${ended} without saying why`)
  } else {
    console.log(`smoke: a production start without a master key is refused (exit ${ended})`)
  }
}
