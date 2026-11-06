import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createServer } from 'node:http'
import path from 'node:path'
import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Fiber, Layer } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import {
  CSP_HEADER,
  composeShellPolicy,
} from '../../packages/plugins/infra/web/src/server/shell-policy.ts'
import { QUALY_IDENTITY_HEADER } from '@qualy/api-kit'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
  QUALY_RENDER_REFUSED_HEADER,
} from '@qualy/release-contract'
import { repoRoot } from '../lib/manifest.ts'
import { startQualyServer, type QualyServer } from '../lib/qualy-server.ts'

// The server-rendered document, accepted end to end on data of its own
// (docs/adr/0012-rsc-data-mode.md).
//
// Nothing here touches a developer's database or reads their .env: a scratch
// database is made from the committed lineage on the test server, seeded
// with an administrator and the demo accounts under passwords made for this
// run, and served by a backend started on exactly what this script passes.
// The production build of the server component handler (pnpm --filter
// @qualy/web-app build:rsc) is then mounted in an Effect http server the
// way a host would mount it - its own content security policy, enforced,
// with a nonce made for each response - and what a reader's browser and a
// reader's requests meet there is checked. Everything this script starts it
// stops, and the database goes last, failed run or not.
//
//   node tools/quality/rsc-acceptance.ts
//
// QUALY_TEST_DATABASE_URL names the test server (the compose stack's, on
// 5433, unless set); RSC_ACCEPTANCE_PORT the first of the two ports used.

const dist = path.join(repoRoot, 'apps/web/dist-rsc')
if (!fs.existsSync(path.join(dist, 'rsc/index.js'))) {
  console.error(
    'rsc-acceptance: no build in apps/web/dist-rsc; run pnpm --filter @qualy/web-app build:rsc',
  )
  process.exit(1)
}

process.env['QUALY_TEST_DATABASE_URL'] ??= 'postgres://qualy:qualy@localhost:5433/qualy'
const { createTestContext } = await import('@qualy/plugin-database/testkit')

const firstPort = Number(process.env['RSC_ACCEPTANCE_PORT'] ?? 3231)
const apiPort = firstPort
const hostPort = firstPort + 1
const site = `http://127.0.0.1:${hostPort}`

const password = () => randomBytes(18).toString('base64url')
const accounts = {
  admin: { email: 'admin@example.edu', password: password() },
  student: { email: 'student@example.edu', password: password() },
}

/** what was checked, and what was seen when it was not as asked */
const results: { readonly name: string; readonly ok: boolean; readonly detail?: string }[] = []
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push({ name, ok, ...(ok ? {} : { detail: JSON.stringify(detail) }) })
}

// ---------------------------------------------------------------------------
// the scratch world: database, seed, backend

const seedInto = (url: string) =>
  new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, 'tools/fixtures/seed-cli.ts')], {
      cwd: repoRoot,
      env: {
        PATH: process.env['PATH'],
        DATABASE_URL: url,
        QUALY_ADMIN_EMAIL: accounts.admin.email,
        QUALY_ADMIN_PASSWORD: accounts.admin.password,
        QUALY_SEED_DEMO: '1',
        QUALY_DEMO_PASSWORD: accounts.student.password,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()))
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`seed exited ${code}:\n${output}`)),
    )
  })

// ---------------------------------------------------------------------------
// the host: the built handler in an Effect http server

/** every render the host started, and whether its request's signal ended */
const renders: { readonly path: string; aborted: boolean; streamed: boolean }[] = []

const mountHandler = async () => {
  // read by the handler as its module loads: where the api answers, and
  // which react it runs - a production host's, as run.ts sets it; under any
  // other the server writes development rows a production page cannot read
  process.env['QUALY_RENDER_API_ORIGIN'] = `http://127.0.0.1:${apiPort}`
  process.env['NODE_ENV'] = 'production'
  const { default: handler } = (await import(path.join(dist, 'rsc/index.js'))) as {
    default: (request: Request, context: { nonce?: string }) => Promise<Response>
  }
  const types: Record<string, string> = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff2': 'font/woff2',
    '.json': 'application/json',
  }
  const client = path.join(dist, 'client')
  const app = HttpRouter.add(
    '*',
    '/*',
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const url = new URL(request.url, site)
      // two cookies and a second line for one of them: what the host hands on
      if (url.pathname === '/__acceptance/cookies') {
        return HttpServerResponse.fromWeb(
          new Response('ok', {
            headers: [
              ['set-cookie', 'probe_a=1; Path=/'],
              ['set-cookie', 'probe_b=2; Path=/; HttpOnly'],
              ['set-cookie', 'probe_a=3; Path=/elsewhere'],
            ],
          }),
        )
      }
      const file = path.join(client, path.normalize(url.pathname))
      if (
        url.pathname !== '/' &&
        file.startsWith(client) &&
        fs.existsSync(file) &&
        fs.statSync(file).isFile()
      ) {
        return HttpServerResponse.uint8Array(fs.readFileSync(file), {
          contentType: types[path.extname(file)] ?? 'application/octet-stream',
        })
      }
      if (url.pathname.startsWith('/api') || url.pathname.startsWith('/health')) {
        const web = yield* HttpServerRequest.toWeb(request)
        const upstream = yield* Effect.promise((signal) =>
          fetch(`http://127.0.0.1:${apiPort}${url.pathname}${url.search}`, {
            method: web.method,
            headers: web.headers,
            body: web.body,
            duplex: 'half',
            signal,
            redirect: 'manual',
          } as RequestInit),
        )
        const copy = new Response(upstream.body, upstream)
        copy.headers.delete('content-length')
        copy.headers.delete('content-encoding')
        return HttpServerResponse.fromWeb(copy)
      }
      // a nonce for this response alone, named by the policy it goes out under
      const nonce = randomBytes(16).toString('base64')
      const controller = new AbortController()
      const seen = { path: url.pathname + url.search, aborted: false, streamed: false }
      renders.push(seen)
      controller.signal.addEventListener('abort', () => (seen.aborted = true))
      const response = yield* Effect.promise(() =>
        handler(
          new Request(new URL(url.pathname + url.search, site), {
            method: request.method,
            headers: request.headers as Record<string, string>,
            signal: controller.signal,
          }),
          { nonce },
        ),
      ).pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
      const body = response.body
      // the render goes on as long as its body is read; a reader who goes
      // away lets the body go, and the render's signal ends with it
      const relayed =
        body === null
          ? null
          : new ReadableStream<Uint8Array>({
              async start(sink) {
                const reader = body.getReader()
                try {
                  for (;;) {
                    const { done, value } = await reader.read()
                    if (done) break
                    sink.enqueue(value)
                  }
                  seen.streamed = true
                  sink.close()
                } catch (error) {
                  sink.error(error)
                }
              },
              cancel(reason) {
                controller.abort(reason)
                return body.cancel(reason)
              },
            })
      const headers = new Headers(response.headers)
      headers.set(CSP_HEADER.enforce, composeShellPolicy([], { scriptNonce: nonce }))
      return HttpServerResponse.fromWeb(new Response(relayed, { status: response.status, headers }))
    }),
  )
  const launched = Effect.runFork(
    Layer.launch(
      HttpRouter.serve(app, { disableLogger: true }).pipe(
        Layer.provide(NodeHttpServer.layer(createServer, { port: hostPort })),
      ),
    ),
  )
  for (let tries = 0; tries < 100; tries += 1) {
    const up = await fetch(`${site}/__acceptance/cookies`).then(
      () => true,
      () => false,
    )
    if (up) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return launched
}

// ---------------------------------------------------------------------------
// what a reader meets

const RELEASE_HEADER = QUALY_CLIENT_RELEASE_HEADER
const PROTOCOL_HEADER = QUALY_CLIENT_PROTOCOL_HEADER
const IDENTITY_HEADER = QUALY_IDENTITY_HEADER
const REFUSED_HEADER = QUALY_RENDER_REFUSED_HEADER

/**
 * Code run in the page, as source: this program is type-checked for node,
 * and what runs in a browser is the browser's to type.
 */
const inPage = <A>(page: Page, source: string) => page.evaluate(source) as Promise<A>

/** resolves once the page's react has taken the document over */
const hydrated = (page: Page) =>
  // a function, not source: a predicate given as a string is evaluated in the
  // page, which the policy under test rightly refuses
  page.waitForFunction(
    () =>
      typeof (globalThis as { __reactRouterDataRouter?: unknown }).__reactRouterDataRouter ===
      'object',
    undefined,
    { timeout: 15_000 },
  )

const signIn = async (who: keyof typeof accounts): Promise<string> => {
  const response = await fetch(`${site}/api/auth/local/local/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(accounts[who]),
  })
  if (response.status !== 200) throw new Error(`${who} could not sign in: ${response.status}`)
  const line = response.headers.getSetCookie().find((cookie) => cookie.includes('qualy_session='))
  if (line === undefined) throw new Error(`${who} signed in without a session cookie`)
  return line.split(';', 1)[0]!
}

const manifestOf = async (cookie: string) =>
  (await (await fetch(`${site}/api/app/manifest`, { headers: { cookie } })).json()) as {
    viewer: string
    identity?: string
  }

/** the release and protocol a page of this build says on its navigations */
const pageOf = async () => {
  const html = await (await fetch(`${site}/login`)).text()
  const release = /data-release="([^"]+)"/.exec(html)?.[1]
  if (release === undefined) throw new Error('the document names no release')
  return { release, protocol: '5' }
}

const refusals = async () => {
  const page = await pageOf()
  const admin = await signIn('admin')
  const adminIdentity = (await manifestOf(admin)).identity!
  const navigate = (headers: Record<string, string>) =>
    fetch(`${site}/?_routes=qualy%3Adocument`, {
      headers: { accept: 'text/x-component', ...headers },
    })
  const cases: [string, Record<string, string>, string][] = [
    [
      'a build that is not this one',
      {
        cookie: admin,
        [RELEASE_HEADER]: 'r-older',
        [PROTOCOL_HEADER]: page.protocol,
        [IDENTITY_HEADER]: adminIdentity,
      },
      'release',
    ],
    [
      'a protocol this build does not speak',
      {
        cookie: admin,
        [RELEASE_HEADER]: page.release,
        [PROTOCOL_HEADER]: '4',
        [IDENTITY_HEADER]: adminIdentity,
      },
      'protocol',
    ],
    [
      'a page that says nothing of whose it is',
      { cookie: admin, [RELEASE_HEADER]: page.release, [PROTOCOL_HEADER]: page.protocol },
      'unasserted',
    ],
    [
      "a page that is somebody else's",
      {
        cookie: admin,
        [RELEASE_HEADER]: page.release,
        [PROTOCOL_HEADER]: page.protocol,
        [IDENTITY_HEADER]: 'somebody-else',
      },
      'identity-changed',
    ],
    [
      'a page whose session went',
      {
        [RELEASE_HEADER]: page.release,
        [PROTOCOL_HEADER]: page.protocol,
        [IDENTITY_HEADER]: adminIdentity,
      },
      'session',
    ],
  ]
  for (const [name, headers, expected] of cases) {
    const response = await navigate(headers)
    await response.body?.cancel()
    check(
      `refuses ${name} before rendering, privately`,
      response.status === 409 &&
        response.headers.get(REFUSED_HEADER) === expected &&
        response.headers.get('cache-control') === 'private, no-store',
      {
        status: response.status,
        refused: response.headers.get(REFUSED_HEADER),
        cache: response.headers.get('cache-control'),
      },
    )
  }
  const own = await navigate({
    cookie: admin,
    [RELEASE_HEADER]: page.release,
    [PROTOCOL_HEADER]: page.protocol,
    [IDENTITY_HEADER]: adminIdentity,
  })
  await own.text()
  check(
    "renders the page's own person's navigation, privately",
    own.status === 200 && own.headers.get('cache-control') === 'private, no-store',
    { status: own.status, cache: own.headers.get('cache-control') },
  )
}

const cookies = async (scratch: { query: (text: string) => Promise<unknown> }) => {
  // a session the api refused is cleared in the document that says so, once:
  // the administrator's newest session, run out
  const cookie = await signIn('admin')
  await scratch.query(
    `update sessions set expires_at = now() - interval '1 minute'
      where id = (select id from sessions order by created_at desc limit 1)`,
  )
  const response = await fetch(`${site}/login`, { headers: { cookie } })
  await response.text()
  const lines = response.headers.getSetCookie()
  const cleared = lines.filter((line) => line.startsWith('qualy_session=;') && /max-age=0/i.test(line))
  check(
    'clears a refused session cookie in the document, once',
    cleared.length === 1 && lines.length === 1,
    lines,
  )
  check(
    'sends a document privately',
    response.headers.get('cache-control') === 'private, no-store',
    response.headers.get('cache-control'),
  )
  const host = await fetch(`${site}/__acceptance/cookies`)
  check(
    'keeps each Set-Cookie line through the host, one per cookie name',
    host.headers.getSetCookie().length >= 2,
    host.headers.getSetCookie(),
  )
  // recorded as seen: lines for one name in two scopes
  console.log(`rsc-acceptance: the host sent ${JSON.stringify(host.headers.getSetCookie())}`)
}

const cancellation = async () => {
  const before = renders.length
  const controller = new AbortController()
  const response = await fetch(`${site}/login`, { signal: controller.signal })
  const reader = response.body!.getReader()
  await reader.read()
  controller.abort()
  await reader.cancel().catch(() => {})
  await new Promise((resolve) => setTimeout(resolve, 500))
  const render = renders[before]
  console.log(`rsc-acceptance: a reader who left after the first chunk: ${JSON.stringify(render)}`)
  check(
    'ends a render whose reader went away, or had already sent all of it',
    render !== undefined && (render.aborted || render.streamed),
    render,
  )
}

const underPolicy = async (browser: Browser) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  const violations: string[] = []
  page.on('console', (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text())) violations.push(message.text())
  })
  await page.addInitScript(`
    window.__violations = []
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__violations.push(event.violatedDirective + ' ' + event.blockedURI)
    })
  `)
  const response = await page.goto(`${site}/login`)
  const policy = response?.headers()['content-security-policy'] ?? ''
  check(
    'sends an enforced policy that names a nonce',
    /script-src 'self' 'nonce-[^']+'/.test(policy),
    policy,
  )
  await hydrated(page)
  const seen = await inPage<{
    mode: string | null
    flight: boolean
    unsigned: number
    violations: string[]
  }>(
    page,
    `({
      mode: document.documentElement.getAttribute('data-mode'),
      flight: Array.isArray(self.__FLIGHT_DATA),
      unsigned: [...document.scripts].filter((script) => !script.src && !script.nonce).length,
      violations: window.__violations,
    })`,
  )
  check(
    'runs the theme before first paint under the policy',
    seen.mode === 'light' || seen.mode === 'dark',
    seen,
  )
  check('runs the payload the html streamed under the policy', seen.flight, seen)
  check('signs every inline script it wrote', seen.unsigned === 0, seen)
  check('meets no policy violation', seen.violations.length === 0 && violations.length === 0, {
    page: seen.violations,
    console: violations,
  })
  // a navigation of the hydrated page, not a new document
  await inPage(page, 'window.__same = true')
  await inPage(page, "void window.__reactRouterDataRouter.navigate('/login?view=more')")
  await page.waitForURL(/view=more/, { timeout: 5_000 }).catch(() => {})
  const same = await inPage<boolean>(page, 'window.__same === true')
  check('navigates as the same document', same && page.url().includes('view=more'), page.url())
  await context.close()
}

/**
 * A navigation the router asks the server to render: to another page the
 * reader can open, by its address, as a link would. Answers where it went.
 */
const navigateElsewhere = (page: Page) =>
  inPage<string>(
    page,
    `(() => {
      const here = location.pathname
      const to = [...document.querySelectorAll('a[href^="/"]')]
        .map((anchor) => new URL(anchor.href).pathname)
        .find((pathname) => pathname !== here && pathname !== '/login')
      if (to === undefined) throw new Error('no other page to go to from ' + here)
      void window.__reactRouterDataRouter.navigate(to)
      return to
    })()`,
  )

/** a signed-in page whose browser then signs somebody else in */
const changedHands = async (browser: Browser) => {
  const context: BrowserContext = await browser.newContext()
  const page: Page = await context.newPage()
  await context.request.post(`${site}/api/auth/local/local/login`, { data: accounts.admin })
  await page.goto(`${site}/`)
  await hydrated(page)
  const before = page.url()
  // another tab of the same browser: the cookie is the student's now
  await context.request.post(`${site}/api/auth/local/local/login`, { data: accounts.student })
  await inPage(page, 'window.__same = true')
  const to = await navigateElsewhere(page)
  const state = await page
    .getByTestId('session-recovery')
    .getAttribute('data-state', { timeout: 10_000 })
    .catch(() => null)
  const same = await inPage<boolean>(page, 'window.__same === true')
  check(
    "locks the page when its navigation meets somebody else's session",
    state === 'switched' && same,
    {
      state,
      same,
      before,
      to,
      after: page.url(),
    },
  )
  await context.close()
}

/** a signed-in page whose session went */
const sessionWent = async (browser: Browser) => {
  const context = await browser.newContext()
  const page = await context.newPage()
  await context.request.post(`${site}/api/auth/local/local/login`, { data: accounts.admin })
  await page.goto(`${site}/`)
  await hydrated(page)
  await context.clearCookies()
  await inPage(page, 'window.__same = true')
  const to = await navigateElsewhere(page)
  const state = await page
    .getByTestId('session-recovery')
    .getAttribute('data-state', { timeout: 10_000 })
    .catch(() => null)
  const same = await inPage<boolean>(page, 'window.__same === true')
  check(
    'asks the same person back when a navigation finds the session gone',
    state === 'expired' && same,
    {
      state,
      same,
      to,
    },
  )
  await context.close()
}

// ---------------------------------------------------------------------------

const checks = async () => {
  await refusals()
  await cookies(scratch)
  await cancellation()
  browser = await chromium.launch()
  await underPolicy(browser)
  await changedHands(browser)
  await sessionWent(browser)
}

let server: QualyServer | undefined
let host: ReturnType<typeof Effect.runFork> | undefined
let browser: Browser | undefined
const scratch = await createTestContext('rsc_acceptance')
let failure: unknown
try {
  // the one database this run may write: the scratch one it just made
  const name = new URL(scratch.url).pathname.slice(1)
  if (!name.startsWith('qualy_rsc_acceptance_')) throw new Error(`not a scratch database: ${name}`)
  await seedInto(scratch.url)
  server = startQualyServer({
    port: apiPort,
    mode: 'development',
    envFile: false,
    // its own mode, whatever this process runs react as
    env: { DATABASE_URL: scratch.url, QUALY_MAIL_DEFAULT_BACKEND: 'smtp', NODE_ENV: undefined },
  })
  await server.waitUntilReady()
  host = await mountHandler()
  if (process.env['RSC_ACCEPTANCE_HOLD'] === '1') {
    // the stack kept up for looking at by hand, until interrupted
    console.log(`rsc-acceptance: holding ${site}`)
    fs.writeFileSync(
      path.join(repoRoot, 'node_modules/.cache/rsc-acceptance.json'),
      JSON.stringify({ site, accounts }),
    )
    await new Promise<void>((resolve) => process.once('SIGINT', () => resolve()))
  } else {
    await checks()
  }
} catch (error) {
  failure = error
} finally {
  await browser?.close().catch(() => {})
  if (host !== undefined) await Effect.runPromise(Fiber.interrupt(host)).catch(() => {})
  // the backend first: a database is not dropped from under its own server
  await server?.stop().catch(() => {})
  await scratch
    .dispose()
    .catch((error: unknown) => console.error('rsc-acceptance: drop failed', error))
}

for (const result of results) {
  console.log(
    `${result.ok ? 'pass' : 'FAIL'}  ${result.name}${result.detail ? `\n      ${result.detail}` : ''}`,
  )
}
if (failure !== undefined) {
  console.error('rsc-acceptance: stopped early', failure)
  if (server !== undefined) console.error(server.output().split('\n').slice(-30).join('\n'))
}
process.exit(failure === undefined && results.every((result) => result.ok) ? 0 : 1)
