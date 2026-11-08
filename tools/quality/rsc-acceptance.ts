import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import { createServer, type IncomingMessage } from 'node:http'
import { connect } from 'node:net'
import type { Duplex } from 'node:stream'
import path from 'node:path'
import { NodeHttpServer } from '@effect/platform-node'
import { Effect, Fiber, Layer } from 'effect'
import { HttpRouter, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright'
import {
  CSP_HEADER,
  composeShellPolicy,
} from '../../packages/plugins/infra/web/src/server/shell-policy.ts'
import { QUALY_IDENTITY_HEADER, QUALY_LOCALE_COOKIE, QUALY_LOCALE_HEADER } from '@qualy/api-kit'
import { LIVE_CLOSE, LIVE_SUBPROTOCOL } from '@qualy/api-kit/live-socket'
import { SLOT_REFERENCE_PATH, slotReferenceHref } from '@qualy/ui-contract'
import { collectWebPlugins } from '@qualy/web-build/collect'
import {
  QUALY_CLIENT_PROTOCOL_HEADER,
  QUALY_CLIENT_RELEASE_HEADER,
  QUALY_RENDER_REFUSED_HEADER,
} from '@qualy/release-contract'
import { repoRoot } from '../lib/manifest.ts'
import { startQualyServer, type QualyServer } from '../lib/qualy-server.ts'
import { acceptEntries } from './rsc-entries.ts'
import { acceptRouteErrors } from './rsc-route-errors.ts'

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

const publicAssetNames = () => {
  const directory = path.join(dist, 'client/assets')
  const files = fs.readdirSync(directory)
  const named = files.filter((file) => !/^[ecwas]-[\w-]+\.[\w.]+$/.test(file))
  check(
    'names public chunks, styles, fonts and workers without source module names',
    named.length === 0,
    named,
  )
  const scripts = files.filter((file) => file.endsWith('.js'))
  const maps = scripts.filter((file) =>
    fs.readFileSync(path.join(directory, file), 'utf8').includes('sourceMappingURL'),
  )
  check(
    'keeps source map pointers out of the public RSC scripts',
    scripts.length > 0 && maps.length === 0,
    maps,
  )
  const shell = files.filter((file) => /^s-[\w-]+\.css$/.test(file))
  check(
    'puts the compiled StyleX rules in the document stylesheet',
    shell.length === 1 &&
      /@layer priority\d/.test(fs.readFileSync(path.join(directory, shell[0]!), 'utf8')),
  )
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

/**
 * The api's live channels, passed through to the backend as they are: the
 * upgrade, then the socket both ways. Effect's server answers every other
 * upgrade, as it registers to.
 */
const withLiveChannels = (server: ReturnType<typeof createServer>) => {
  const register = server.on.bind(server)
  const relay = (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const upstream = connect(apiPort, '127.0.0.1', () => {
      const lines = [`${request.method} ${request.url} HTTP/1.1`]
      for (let at = 0; at < request.rawHeaders.length; at += 2) {
        lines.push(`${request.rawHeaders[at]}: ${request.rawHeaders[at + 1]}`)
      }
      upstream.write(`${lines.join('\r\n')}\r\n\r\n`)
      upstream.write(head)
      socket.pipe(upstream).pipe(socket)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  }
  server.on = ((event: string, listener: (...args: any[]) => void) =>
    event === 'upgrade'
      ? register('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) =>
          request.url?.startsWith('/api')
            ? relay(request, socket, head)
            : listener(request, socket, head),
        )
      : register(event, listener)) as typeof server.on
  return server
}

const mountHandler = async () => {
  // read by the handler as its module loads: where the api answers, and
  // which react it runs - a production host's, as run.ts sets it; under any
  // other the server writes development rows a production page cannot read
  // the render reads through this host, as the browser does, so a fault the
  // host injects is met by both
  process.env['QUALY_RENDER_API_ORIGIN'] = site
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
      // A session that goes after the document started: the reader's desk
      // answered as a lapsed session, for whoever carries the fault's cookie
      if (
        url.pathname.endsWith('/me/overview') &&
        /(?:^|;\s*)acceptance_fault=session(?:;|$)/.test(String(request.headers['cookie'] ?? ''))
      ) {
        return HttpServerResponse.text(JSON.stringify({ _tag: 'SESSION_EXPIRED' }), {
          status: 401,
          contentType: 'application/json',
        })
      }
      // A server that cannot say which ways in this workspace has: the list
      // answered with a status the contract does not name
      if (
        url.pathname.endsWith('/auth/login-methods') &&
        /(?:^|;\s*)acceptance_fault=login-methods(?:;|$)/.test(
          String(request.headers['cookie'] ?? ''),
        )
      ) {
        return HttpServerResponse.text('unavailable', { status: 503 })
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
          }),
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
        Layer.provide(
          NodeHttpServer.layer(() => withLiveChannels(createServer()), { port: hostPort }),
        ),
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

/**
 * A batch the student takes part in, made as an administrator makes one:
 * through the business api, importing the student's class and type.
 */
const batchFor = async (
  scratch: {
    row: <Row>(text: string, params?: readonly unknown[]) => Promise<Row>
  },
  name = 'RSC acceptance',
): Promise<string> => {
  const admin = await signIn('admin')
  const { org, type } = await scratch.row<{ org: string; type: string }>(
    `select primary_org_node_id as org, user_type_id as type from users where email = $1`,
    [accounts.student.email],
  )
  const response = await fetch(`${site}/api/assessment/batches`, {
    method: 'POST',
    headers: { cookie: admin, 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      descriptionMd: 'Bring **the certificates** you are claiming for.',
      materialRange: { start: '2026-09-01', end: '2027-07-31' },
      timezone: 'Asia/Shanghai',
      import: { orgNodeIds: [org], userTypeIds: [type] },
    }),
  })
  if (response.status !== 200) {
    throw new Error(`the batch was not made: ${response.status} ${await response.text()}`)
  }
  return ((await response.json()) as { batch: { id: string } }).batch.id
}

/**
 * A batch whose stage is open, for the pages a participant reads: made as
 * `batchFor` makes one, given a stage, and moved into it - a participant
 * sees a round once a stage of it is current, not while it waits to begin.
 */
const startedBatchFor = async (scratch: {
  row: <Row>(text: string, params?: readonly unknown[]) => Promise<Row>
}): Promise<string> => {
  const batch = await batchFor(scratch, 'RSC acceptance running')
  const admin = await signIn('admin')
  const write = async (method: string, path: string, body: unknown) => {
    const response = await fetch(`${site}/api/assessment/batches/${batch}${path}`, {
      method,
      headers: { cookie: admin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (response.status !== 200) {
      throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
    }
    return response.json() as Promise<{ phases: { id: string }[] }>
  }
  const { phases } = await write('PUT', '/phases', {
    phases: [{ phaseKey: 'acceptance-filing', displayName: 'Acceptance filing' }],
  })
  await write('PUT', '/phase', { to: phases[0]!.id })
  const seen = await fetch(`${site}/api/assessment/batches/${batch}`, {
    headers: { cookie: await signIn('student') },
  })
  const standing = seen.ok
    ? ((await seen.json()) as { batch: { capabilities: { personal: boolean } } }).batch.capabilities
        .personal
    : false
  if (!standing) throw new Error(`the open batch is not the participant’s: ${seen.status}`)
  return batch
}

/**
 * The student made a reviewer in a batch, through the business api: a role
 * that processes reviews, granted to them over their own unit there.
 */
const reviewerIn = async (
  scratch: { row: <Row>(text: string, params?: readonly unknown[]) => Promise<Row> },
  batch: string,
) => {
  const { id: userId, primary_org_node_id: orgNodeId } = await scratch.row<{
    id: string
    primary_org_node_id: string
  }>('select id, primary_org_node_id from users where email = $1', [accounts.student.email])
  const cookie = await signIn('admin')
  const write = async <A>(method: string, path: string, input: object): Promise<A> => {
    const response = await fetch(`${site}/api${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok) {
      throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
    }
    return (await response.json()) as A
  }
  const { id: roleId, version: draft } = await write<{ id: string; version: number }>(
    'POST',
    '/iam/roles',
    { name: 'RSC review queue', kind: 'org' },
  )
  const role = `/iam/roles/${roleId}`
  const { version: eligible } = await write<{ version: number }>('PUT', `${role}/eligibility`, {
    version: draft,
    holderPolicy: { mode: 'unrestricted' },
    anchorPolicy: { mode: 'unrestricted' },
  })
  const { version: configured } = await write<{ version: number }>('PUT', `${role}/permissions`, {
    version: eligible,
    codes: ['assessment.review.process'],
  })
  await write('PUT', `${role}/status`, { version: configured, status: 'active' })
  await write('POST', `/assessment/batches/${batch}/access`, {
    roleId,
    userIds: [userId],
    orgNodeIds: [orgNodeId],
  })
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
  const cleared = lines.filter(
    (line) => line.startsWith('qualy_session=;') && /max-age=0/i.test(line),
  )
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

/**
 * A sign-in page drawn by a server that could not read the ways in: it is
 * handed no login renderer rather than every one this build carries, asks
 * the server to draw it again, says the ways in are unavailable while they
 * are, and on a retry once they are back is drawn with the one it needs.
 */
const loginMethodsUnread = async (browser: Browser) => {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await context.addCookies([{ name: 'acceptance_fault', value: 'login-methods', url: site }])
  const page = await context.newPage()
  const redraws: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (url.pathname.startsWith('/login') && request.resourceType() === 'fetch')
      redraws.push(url.pathname + url.search)
  })
  await page.goto(`${site}/login`)
  await hydrated(page)
  const handed = await inPage<string>(page, `(self.__FLIGHT_DATA || []).join('')`)
  const unavailable = await page
    .getByTestId('sign-in-unavailable')
    .waitFor({ timeout: 10_000 })
    .then(
      () => true,
      () => false,
    )
  check(
    'hands no login renderer over when the ways in could not be read, and asks to be drawn again',
    handed.includes('"login":{}') &&
      unavailable &&
      redraws.length === 1 &&
      (await page.getByTestId('sign-in-tile').count()) === 0,
    { renderers: handed.includes('"login":{}') ? 'none' : 'some', unavailable, redraws },
  )
  await context.clearCookies({ name: 'acceptance_fault' })
  await page.getByTestId('sign-in-unavailable').getByRole('button').click()
  const tile = page.getByTestId('sign-in-tile').first()
  const back = await tile.waitFor({ timeout: 10_000 }).then(
    () => true,
    () => false,
  )
  if (back) await tile.click()
  const opened = back
    ? await page
        .getByLabel(/邮箱|email/i)
        .first()
        .waitFor({ timeout: 10_000 })
        .then(
          () => true,
          () => false,
        )
    : false
  check('draws the ways in with their renderers once they can be read again', back && opened, {
    back,
    opened,
  })
  await context.close()
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

// Contexts that only exercise a signed-in page can share a session. The
// sign-in and sign-out checks create their own sessions through the form.
const browserSessions = new Map<keyof typeof accounts, string>()

/** a browser signed in as `who`, with the document's own scripts on or off */
const signedInContext = async (
  browser: Browser,
  who: keyof typeof accounts,
  options: {
    readonly javaScriptEnabled?: boolean
    readonly width?: number
    readonly timezoneId?: string
  } = {},
) => {
  const context = await browser.newContext({
    javaScriptEnabled: options.javaScriptEnabled ?? true,
    viewport: { width: options.width ?? 1400, height: 900 },
    ...(options.timezoneId === undefined ? {} : { timezoneId: options.timezoneId }),
  })
  let cookie = browserSessions.get(who)
  if (cookie === undefined) {
    cookie = await signIn(who)
    browserSessions.set(who, cookie)
  }
  await context.addCookies([
    { name: 'qualy_session', value: cookie.slice('qualy_session='.length), url: site },
  ])
  return context
}

/**
 * What the page asked the api for once it was the reader's, until the
 * batch's live channel said `sync`: the reads a page makes on its own,
 * apart from the ones the channel sets off. Ends when the channel speaks or
 * after a few seconds.
 */
const ownReads = async (page: Page, address: string): Promise<readonly string[]> => {
  const asked: string[] = []
  let synced!: () => void
  const sync = new Promise<void>((resolve) => (synced = resolve))
  let spoken = false
  page.on('request', (request) => {
    const url = request.url()
    if (!spoken && url.includes('/api/')) asked.push(url.slice(url.indexOf('/api/') + 4))
  })
  page.on('websocket', (socket) =>
    socket.on('framereceived', (frame) => {
      if (String(frame.payload).includes('"sync"')) {
        spoken = true
        synced()
      }
    }),
  )
  await page.goto(`${site}${address}`)
  await hydrated(page)
  await Promise.race([sync, new Promise((resolve) => setTimeout(resolve, 5_000))])
  return [...asked]
}

// Playwright's visibility check treats opacity: 0 as visible. A server
// document must paint its content even when the browser cannot hydrate it.
// A part that is a different tree at another width is in the html twice, the
// stylesheet showing one (AtWidth): the one shown is what has to be painted.
const painted = async (located: Locator): Promise<boolean> => {
  const element = located.filter({ visible: true }).first()
  return (await element.count()) > 0 && paintedOne(element)
}

const paintedOne = async (element: Locator): Promise<boolean> =>
  (await element.isVisible()) &&
  (await element.evaluate((node) => {
    type Ancestor = { readonly parentElement: Ancestor | null }
    const browser = globalThis as unknown as {
      getComputedStyle(element: Ancestor): { readonly opacity: string }
    }
    for (
      let ancestor = node as unknown as Ancestor | null;
      ancestor;
      ancestor = ancestor.parentElement
    ) {
      if (browser.getComputedStyle(ancestor).opacity === '0') return false
    }
    return true
  }))

const ownSessionChanges = async (browser: Browser) => {
  const context = await browser.newContext({ locale: 'en-US' })
  try {
    const page = await context.newPage()
    const list = '/assessment/batches'
    const refused: string[] = []
    page.on('response', (response) => {
      const marker = response.headers()[QUALY_RENDER_REFUSED_HEADER]
      if (marker !== undefined) refused.push(marker)
    })
    await page.goto(`${site}/login?method=local&next=${encodeURIComponent(list)}`)
    await hydrated(page)
    await page.locator('#email').fill(accounts.admin.email)
    await page.locator('#password').fill(accounts.admin.password)
    await inPage(page, 'window.__same = true')
    await page.getByTestId('local-submit').click()
    await page.waitForURL(`${site}${list}`, { timeout: 12_000 })
    await hydrated(page)
    const account = page.getByRole('button', { name: '系统管理员' })
    await account.waitFor()
    check(
      'signs in through the form into a new document without an identity refusal',
      refused.length === 0 && !(await inPage<boolean>(page, 'window.__same === true')),
      refused,
    )

    await inPage(page, 'window.__same = true')
    await account.click()
    await page.getByRole('menuitem', { name: /^(Sign out|退出登录)$/ }).click()
    await page.waitForURL(`${site}/login`, { timeout: 12_000 })
    await hydrated(page)
    check(
      'signs out from the account menu into a fresh login document',
      refused.length === 0 &&
        !(await inPage<boolean>(page, 'window.__same === true')) &&
        !(await page.getByTestId('session-recovery').isVisible()) &&
        !(await page.getByRole('progressbar').isVisible()),
      refused,
    )
  } finally {
    await context.close()
  }
}

const batchListFirstScreen = async (browser: Browser, batch: string) => {
  const list = '/assessment/batches'
  const overview = `${list}/${batch}`
  const row = `[data-testid="batch-row"][data-batch="${batch}"]`
  const staticContext = await signedInContext(browser, 'admin', { javaScriptEnabled: false })
  const html = await staticContext.newPage()
  await html.goto(`${site}${list}?q=RSC%20acceptance&status=draft&page=1`)
  check('paints the filtered batch list without JavaScript', await painted(html.locator(row)))
  await html.goto(`${site}${list}`)
  check(
    'paints the account menu on the batch list without JavaScript',
    await painted(html.getByRole('button', { name: '系统管理员' })),
  )
  const listControls = (page: Page, hydrated: boolean) =>
    inPage<{ checked: boolean; thumb: string; border: string }>(
      page,
      `(() => {
      const radio = document.querySelector('[data-slot="toggle-group"] input[value="all"]')
      const search = document.querySelector('input[name="batches-search"]')
      const thumb = ${hydrated}
        ? radio.closest('[data-slot="toggle-group"]').querySelector('.mantine-SegmentedControl-indicator')
        : radio.nextElementSibling
      return { checked: radio.checked,
        thumb: getComputedStyle(thumb, ${hydrated} ? null : '::before').backgroundColor,
        border: getComputedStyle(search).borderTopColor,
      }
    })()`,
    )
  const firstControls = await listControls(html, false)
  const malformed = await html.goto(`${site}${list}?q=${'x'.repeat(101)}`)
  check('keeps the batch list reachable with an invalid search', malformed?.status() === 200)
  await staticContext.close()

  const context = await signedInContext(browser, 'admin')
  const page = await context.newPage()
  const duplicateReads: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (
      ['/api/assessment/batches', '/api/assessment/standing', '/api/auth/session'].includes(
        pathname,
      )
    ) {
      duplicateReads.push(pathname)
    }
  })
  await page.goto(`${site}${list}`)
  await hydrated(page)
  await page.locator('.mantine-SegmentedControl-indicator').first().waitFor()
  const finalControls = await listControls(page, true)
  check(
    'paints the selected filter and search border before hydration',
    firstControls.checked &&
      finalControls.checked &&
      firstControls.thumb !== 'rgba(0, 0, 0, 0)' &&
      firstControls.thumb === finalControls.thumb &&
      firstControls.border !== 'rgba(0, 0, 0, 0)' &&
      firstControls.border === finalControls.border,
    { firstControls, finalControls },
  )
  await inPage(page, 'window.__same = true')
  const locale = await inPage<string>(page, 'document.documentElement.lang')
  const otherLocale = locale === 'zh-CN' ? 'en-US' : 'zh-CN'
  await context.addCookies([{ name: QUALY_LOCALE_COOKIE, value: otherLocale, url: site }])
  let requestedLocale: string | undefined
  let resume!: () => void
  const pending = new Promise<void>((resolve) => {
    resume = resolve
  })
  await page.route(
    (url) => url.pathname.startsWith(overview),
    async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('.rsc')) {
        requestedLocale = route.request().headers()[QUALY_LOCALE_HEADER]
      }
      await pending
      await route.continue()
    },
  )
  try {
    await page.locator(row).getByRole('link').first().click()
    const progress = page.getByRole('progressbar').filter({ visible: true })
    const indicating = await progress
      .first()
      .waitFor({ timeout: 3_000 })
      .then(
        () => true,
        () => false,
      )
    check(
      'keeps the batch list on screen and indicates a pending navigation',
      indicating && (await painted(page.locator(row))),
    )
    check(
      'takes the batch list over without asking again',
      duplicateReads.length === 0,
      duplicateReads,
    )
  } finally {
    resume()
  }
  await page.waitForURL(`${site}${overview}`)
  await page.getByTestId('batch-note').waitFor()
  check(
    'shows the overview in the same document after navigation',
    (await painted(page.getByTestId('batch-note'))) &&
      (await inPage<boolean>(page, 'window.__same === true')),
  )
  check(
    'an open RSC document keeps its own language after the locale cookie changes',
    requestedLocale === locale &&
      (await inPage<string>(page, 'document.documentElement.lang')) === locale,
  )
  await context.close()
}

/**
 * A page's first screen, drawn by the server and taken over by the page: its
 * own content is painted before any of the application's own code runs -
 * the html, and the parts the server streamed after it, which React's own
 * inline scripts put in place - and once the page
 * is the reader's it asks for none of what the server read for it - until
 * the batch's live channel says otherwise, or for a few seconds where there
 * is none. In a phone's width in another time zone too, where what the
 * device says and the server cannot is the browser's to add, without the
 * tree disagreeing with the html.
 */
const pageFirstScreen = async (
  browser: Browser,
  page: {
    readonly name: string
    readonly who: keyof typeof accounts
    readonly address: string
    /** the test id of the page's own content */
    readonly content: string
    /** the reads the server made for the page, by their api path and query */
    readonly reads: readonly RegExp[]
  },
) => {
  const still = await signedInContext(browser, page.who)
  const html = await still.newPage()
  // the application's modules never arrive: what is on screen is the server's
  await html.route('**/assets/**/*.js', (route) => route.abort())
  await html.goto(`${site}${page.address}`)
  await html.waitForLoadState('load')
  const drawn = await painted(html.getByTestId(page.content))
  // what was on screen instead, to say why when it was not
  const instead = drawn
    ? []
    : await html.locator('[data-testid]').evaluateAll((nodes) =>
        (
          nodes as unknown as {
            getClientRects(): { readonly length: number }
            getAttribute(name: string): string | null
          }[]
        )
          .filter((node) => node.getClientRects().length > 0)
          .map((node) => node.getAttribute('data-testid')),
      )
  await still.close()
  for (const [width, timezoneId] of [
    [1400, undefined],
    [390, 'America/New_York'],
  ] as const) {
    const context = await signedInContext(browser, page.who, {
      width,
      ...(timezoneId === undefined ? {} : { timezoneId }),
    })
    const tab = await context.newPage()
    const mismatches: string[] = []
    tab.on('console', (message) => {
      if (/hydrat/i.test(message.text())) mismatches.push(message.text().slice(0, 300))
    })
    tab.on('pageerror', (error) => mismatches.push(error.message.slice(0, 300)))
    const asked = await ownReads(tab, page.address)
    const again = asked.filter((url) => page.reads.some((read) => read.test(url)))
    check(
      `draws ${page.name} in the html and takes it over without asking again (${width}px)`,
      drawn && again.length === 0 && mismatches.length === 0,
      { drawn, again, mismatches, ...(drawn ? {} : { instead }) },
    )
    await context.close()
  }
}

/** the batch overview's first screen, as the server draws it and the page takes it over */
const overviewFirstScreen = async (browser: Browser, batch: string) => {
  const address = `/assessment/batches/${batch}`
  const filtered = `${address}?activityLane=participant&activityPage=2`
  const missing = '/assessment/batches/01a1b345-0000-7000-8000-000000000000'
  const firstReads = [`/assessment/batches/${batch}`, '/timeline', '/me/overview', '/me/activity']

  // the screen is in the html's own elements, scripts or none
  const still = await signedInContext(browser, 'admin', { javaScriptEnabled: false })
  const html = await still.newPage()
  for (const [at, which] of [
    [address, 'default'],
    [filtered, 'filtered and paged'],
  ] as const) {
    await html.goto(`${site}${at}`)
    const shown = await Promise.all(
      ['batch-note', 'overview-clear', 'overview-activity-empty'].map((id) =>
        painted(html.getByTestId(id)),
      ),
    )
    check(`draws the overview's first screen in the html (${which})`, shown.every(Boolean), shown)
  }
  const rail = html.getByTestId('workspace-rail')
  check(
    'paints the account and authorized workspace rail without JavaScript',
    (await painted(html.getByRole('button', { name: '系统管理员' }))) &&
      (await painted(rail.locator(`a[href="${address}/items"]`))),
  )
  // the note is the server's own: drawn there from its markup, styled by
  // rules compiled in the server component environment
  const strong = html.getByTestId('batch-note').locator('strong').first()
  const weight = (await painted(strong))
    ? await strong.evaluate(
        (node) =>
          (
            globalThis as unknown as {
              getComputedStyle(element: unknown): { readonly fontWeight: string }
            }
          ).getComputedStyle(node).fontWeight,
      )
    : null
  check("draws the batch's note on the server with its own styles", weight === '600', weight)
  // what the workspace's rail may show is the workspace's to prepare, so a
  // page of the batch with no server entry of its own is drawn with it too
  await html.goto(`${site}${address}/phases`)
  check(
    'paints the authorized workspace rail on a batch page with no server entry',
    await painted(html.getByTestId('workspace-rail').locator(`a[href="${address}/items"]`)),
  )
  await html.goto(`${site}${missing}`)
  check(
    'draws a batch that is not there as not there in the html',
    await html.locator('[data-slot=resource-state][data-state=missing]').isVisible(),
  )
  await still.close()

  // the page does not ask again for what the html was drawn from; what the
  // live channel sets off is the channel's, after it has spoken
  for (const [at, which, width, timezoneId] of [
    [address, '1400px', 1400, undefined],
    [filtered, '390px, America/New_York, filtered', 390, 'America/New_York'],
    [missing, 'a batch not there', 1400, undefined],
  ] as const) {
    const context = await signedInContext(browser, 'admin', {
      width,
      ...(timezoneId === undefined ? {} : { timezoneId }),
    })
    const page = await context.newPage()
    const mismatches: string[] = []
    page.on('console', (message) => {
      if (/hydrat/i.test(message.text())) mismatches.push(message.text().slice(0, 300))
    })
    page.on('pageerror', (error) => mismatches.push(error.message.slice(0, 300)))
    const asked = await ownReads(page, at)
    const subject = at === missing ? [missing] : firstReads
    const again = asked.filter((url) => subject.some((read) => url.split('?')[0]!.endsWith(read)))
    check(
      `takes the overview over without asking again (${which})`,
      again.length === 0 && mismatches.length === 0,
      { again, mismatches },
    )
    await context.close()
  }

  // the batch's live channel goes on as before: a plan written elsewhere
  // reaches the open page without a reload
  {
    const context = await signedInContext(browser, 'admin')
    const page = await context.newPage()
    await ownReads(page, address)
    await inPage(page, 'window.__same = true')
    const admin = await signIn('admin')
    const written = await fetch(`${site}/api/assessment/batches/${batch}/phases`, {
      method: 'PUT',
      headers: { cookie: admin, 'content-type': 'application/json' },
      body: JSON.stringify({
        phases: [{ phaseKey: 'acceptance-submission', displayName: 'Acceptance submission' }],
      }),
    })
    const arrived = await page
      .getByText('Acceptance submission')
      .first()
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      )
    const same = await inPage<boolean>(page, 'window.__same === true')
    check(
      'brings a plan written elsewhere into the open overview',
      written.status === 200 && arrived && same,
      { written: written.status, arrived, same },
    )
    await context.close()
  }

  // a session that goes after the document started: the render still draws
  // the page, without the desk it could not read, and the page's own read of
  // the desk meets the lapse and hands it to the session's recovery
  {
    const context = await signedInContext(browser, 'admin')
    await context.addCookies([{ name: 'acceptance_fault', value: 'session', url: site }])
    const page = await context.newPage()
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)))
    const response = await page.goto(`${site}${address}`)
    await hydrated(page)
    const state = await page
      .getByTestId('session-recovery')
      .getAttribute('data-state', { timeout: 10_000 })
      .catch(() => null)
    const note = await page.getByTestId('batch-note').isVisible()
    check(
      'hands a session lost after the document started to the recovery',
      response?.status() === 200 && state !== null && note && errors.length === 0,
      { status: response?.status(), state, note, errors },
    )
    await context.close()
  }
}

const hydrationPositions = async (browser: Browser, batch: string) => {
  const context = await signedInContext(browser, 'admin')
  try {
    const list = '/assessment/batches'
    const overview = `${list}/${batch}`
    const plan = await context.request.put(`${site}/api${overview}/phases`, {
      data: { phases: [{ phaseKey: 'hydration-position', displayName: '复审审核期' }] },
    })
    if (!plan.ok()) throw new Error(`could not prepare the layout fixture: ${plan.status()}`)
    const { phases } = (await plan.json()) as { phases: readonly { id: string }[] }
    const started = await context.request.put(`${site}/api${overview}/phase`, {
      data: { to: phases[0]?.id },
    })
    if (!started.ok()) throw new Error(`could not start the layout fixture: ${started.status()}`)

    for (const address of [list, overview]) {
      const page = await context.newPage()
      const isList = address === list
      const anchor = isList
        ? page.locator('[data-shell-head]').getByRole('button', { name: '系统管理员' })
        : page.getByTestId('stage-key')
      const label = isList ? 'account trigger' : 'current-stage control'
      const targets = isList ? [anchor] : [anchor, anchor.getByTestId('stage-clock')]
      let release!: () => void
      const scripts = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route('**/*', async (route) => {
        if (route.request().resourceType() === 'script') await scripts
        await route.continue()
      })
      try {
        await page.clock.setFixedTime(new Date())
        await page.goto(`${site}${address}`, { waitUntil: 'commit' })
        await Promise.all(targets.map((target) => target.waitFor()))
        await inPage(page, 'document.fonts.ready.then(() => true)')
        const gutter = await inPage<number>(
          page,
          `(() => {
          const main = document.querySelector('main')
          return main.offsetWidth - main.clientWidth
        })()`,
        )
        const before = await Promise.all(targets.map((target) => target.boundingBox()))
        release()
        await page.waitForFunction(
          () => (globalThis as { __routerInitialized?: boolean }).__routerInitialized === true,
        )
        await inPage(
          page,
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        )
        const after = await Promise.all(targets.map((target) => target.boundingBox()))
        const close = after.every((box, index) => {
          const first = before[index]
          return (
            box !== null &&
            first != null &&
            (['x', 'y', 'width', 'height'] as const).every(
              (key) => Math.abs(box[key] - first[key]) <= 0.0625,
            )
          )
        })
        check(`keeps the ${label} in place through hydration`, gutter > 0 && close, {
          gutter,
          before,
          after,
        })
      } finally {
        release()
        await page.close()
      }
    }
  } finally {
    await context.close()
  }
}

const grantSurfaces = async (browser: Browser, batch: string) => {
  const { id: userId, primary_org_node_id: orgNodeId } = await scratch.row<{
    id: string
    primary_org_node_id: string
  }>('select id, primary_org_node_id from users where email = $1', [accounts.student.email])
  const cookie = await signIn('admin')
  const write = async <A>(method: string, path: string, input: object): Promise<A> => {
    const response = await fetch(`${site}/api${path}`, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
    if (!response.ok)
      throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`)
    return (await response.json()) as A
  }
  const { id: roleId, version: draft } = await write<{ id: string; version: number }>(
    'POST',
    '/iam/roles',
    { name: 'RSC review grant', kind: 'org' },
  )
  const role = `/iam/roles/${roleId}`
  const { version: eligible } = await write<{ version: number }>('PUT', `${role}/eligibility`, {
    version: draft,
    holderPolicy: { mode: 'unrestricted' },
    anchorPolicy: { mode: 'unrestricted' },
  })
  const { version: configured } = await write<{ version: number }>('PUT', `${role}/permissions`, {
    version: eligible,
    codes: ['assessment.review.process'],
  })
  await write('PUT', `${role}/status`, { version: configured, status: 'active' })
  await write('POST', `/assessment/batches/${batch}/access`, {
    roleId,
    userIds: [userId],
    orgNodeIds: [orgNodeId],
  })

  const address = `/organization/users/${userId}/role-grants`
  const plain = await fetch(site + address, { headers: { cookie } })
  const html = await plain.text()
  check(
    'the batch grant presenter renders its own element in the first HTML',
    html.includes(`data-testid="grant-origin-batch" data-batch-id="${batch}"`),
  )
  const release = await pageOf()
  const headers = {
    cookie,
    [RELEASE_HEADER]: release.release,
    [PROTOCOL_HEADER]: release.protocol,
    [IDENTITY_HEADER]: (await manifestOf(cookie)).identity!,
  }
  const pickerHref = slotReferenceHref({
    kind: 'slot',
    slot: 'iam/org-node-picker',
    id: 'auth/org-node-picker',
  })
  const picker = await fetch(site + pickerHref, { headers })
  const pickerFlight = await picker.text()
  check(
    'an authorized slot endpoint returns a private component reference',
    picker.ok &&
      picker.headers.get('cache-control') === 'private, no-store' &&
      picker.headers.get('content-type')?.startsWith('text/x-component') === true,
  )
  // Compare import rows observed on the dedicated endpoints. The row index
  // belongs to each response, so only the reference metadata is compared.
  const reference = (body: string) => /^[\da-f]+:(I.+)$/m.exec(body)?.[1]
  const moduleMarker = reference(pickerFlight)
  const flight = await fetch(`${site}${address}.rsc?_routes=qualy%3Adocument`, {
    headers: { ...headers, accept: 'text/x-component' },
  })
  const flightText = await flight.text()
  const batchHref = slotReferenceHref({
    kind: 'slot',
    slot: 'iam/resource-grant-renderer',
    id: 'assessment/batch-grant',
  })
  const batchFlight = await (await fetch(site + batchHref, { headers })).text()
  const batchMarker = reference(batchFlight)
  check(
    'the grants Flight carries the selected renderer and omits the unopened picker',
    flight.ok &&
      batchMarker !== undefined &&
      flightText.includes(batchMarker) &&
      moduleMarker !== undefined &&
      !flightText.includes(moduleMarker),
    {
      status: flight.status,
      selectedReference: batchMarker !== undefined,
      pickerReference: moduleMarker !== undefined,
      selectedOnPage: batchMarker !== undefined && flightText.includes(batchMarker),
      pickerOnPage: moduleMarker !== undefined && flightText.includes(moduleMarker),
    },
  )

  const student = await signIn('student')
  const denied = await fetch(site + pickerHref, {
    headers: {
      ...headers,
      cookie: student,
      [IDENTITY_HEADER]: (await manifestOf(student)).identity!,
    },
  })
  check(
    'the slot endpoint checks the current viewer’s authorization',
    denied.status === 404 && denied.headers.get('cache-control') === 'private, no-store',
  )

  const context = await signedInContext(browser, 'admin', { timezoneId: 'America/Los_Angeles' })
  try {
    const page = await context.newPage()
    const loaded: string[] = []
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    page.on('request', (request) => {
      const url = new URL(request.url())
      if (url.pathname === SLOT_REFERENCE_PATH) loaded.push(url.search)
    })
    await page.goto(site + address)
    await hydrated(page)
    // the grant over the acceptance batch, of however many the person holds
    const presenter = page.locator(`[data-testid="grant-origin-batch"][data-batch-id="${batch}"]`)
    const linked = await presenter
      .getByRole('link', { name: 'RSC acceptance' })
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      )
    check(
      'GrantOrigin hydrates the batch link from its seeded renderer',
      linked && loaded.length === 0 && errors.length === 0,
      { loaded, errors },
    )
    const open = page.getByRole('button', { name: /Grant a role|授予角色/ })
    await open.click()
    const anchor = page.getByTestId('grant-anchor')
    const interactive = await anchor
      .getByRole('button')
      .first()
      .waitFor({ timeout: 10_000 })
      .then(
        () => true,
        () => false,
      )
    check(
      'opening the role dialog fetches and mounts only the needed picker',
      interactive && loaded.length === 1 && loaded[0] === new URL(pickerHref, site).search,
      { loaded, errors },
    )
  } finally {
    await context.close()
  }
}

const guardedNavigation = async (browser: Browser, batch: string) => {
  const context = await signedInContext(browser, 'admin')
  const address = `/assessment/batches/${batch}`
  const settings = `${address}/settings`
  try {
    const page = await context.newPage()
    const navigate = (target: string | number) =>
      inPage(page, `void window.__reactRouterDataRouter.navigate(${JSON.stringify(target)})`)
    const overviewLanded = async () => {
      await page.waitForURL(site + address)
      await page.getByTestId('batch-note').waitFor()
    }
    // React registers the guard after the edit commits. Wait for that same
    // registration before asking the browser to traverse history.
    const dirty = () =>
      page.waitForFunction(
        () =>
          !(globalThis as unknown as { dispatchEvent(event: Event): boolean }).dispatchEvent(
            new Event('beforeunload', { cancelable: true }),
          ),
        undefined,
        { timeout: 5_000 },
      )
    await page.goto(site + address)
    await hydrated(page)
    await page.locator(`[data-testid="workspace-rail"] a[href="${settings}"]`).click()
    await page.waitForURL(site + settings)
    const name = page.getByRole('textbox', { name: /^(名称|Name)$/ })
    await name.waitFor()
    await navigate(address)
    await overviewLanded()
    await navigate(-1)
    await page.waitForURL(site + settings)
    const draft = 'RSC acceptance edit'
    await name.fill(draft)
    await dirty()
    const question = page
      .getByRole('alertdialog')
      .or(page.getByRole('dialog'))
      .filter({
        hasText: /离开此页|Leave this page/,
      })
    const stay = question.getByRole('button', { name: /继续编辑|Keep editing/ })
    for (const step of [-1, 1]) {
      await navigate(step)
      await question.waitFor({ timeout: 10_000 })
      await stay.click()
      await question.waitFor({ state: 'hidden' })
      check(
        `a dirty editor blocks history ${step < 0 ? 'back' : 'forward'}`,
        page.url() === site + settings && (await name.inputValue()) === draft,
      )
    }
    await navigate(settings + '?guard-probe=1')
    await page.waitForURL(site + settings + '?guard-probe=1')
    const preventsUnload = await inPage<boolean>(
      page,
      "(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented })()",
    )
    check(
      'a query-only navigation keeps the draft and a reload still warns',
      (await name.inputValue()) === draft && preventsUnload && !(await question.isVisible()),
    )

    const refuse = async (route: import('playwright').Route) => {
      if (route.request().method() !== 'PATCH') return route.continue()
      await route.fulfill({ status: 503, contentType: 'application/json', body: '{}' })
    }
    const api = site + '/api' + address
    await page.route(api, refuse)
    await navigate(address)
    const save = question.getByRole('button', { name: /保存后离开|Save and leave/ })
    await save.click()
    await question.waitFor({ state: 'hidden' })
    check(
      'a refused save leaves the editor and draft in place',
      page.url().includes(settings) && (await name.inputValue()) === draft,
    )
    await page.unroute(api, refuse)
    await navigate(address)
    await save.click()
    await overviewLanded()
    await navigate(settings)
    await page.waitForURL(site + settings)
    check(
      'saving continues the held navigation and persists the edit',
      (await name.inputValue()) === draft,
    )
    await name.fill('RSC acceptance discarded edit')
    await dirty()
    await navigate(address)
    await question.getByRole('button', { name: /放弃修改|Discard/ }).click()
    await overviewLanded()
    await navigate(settings)
    await page.waitForURL(site + settings)
    check(
      'discard continues the held navigation without writing',
      (await name.inputValue()) === draft,
    )

    await name.fill('RSC acceptance preserved draft')
    await dirty()
    const original = await name.elementHandle()
    await page.route(
      (url) => url.pathname === address + '.rsc',
      (route) =>
        route.continue({ headers: { ...route.request().headers(), [RELEASE_HEADER]: 'r-older' } }),
    )
    await navigate(address)
    await question.getByRole('button', { name: /放弃修改|Discard/ }).click()
    await page.locator('[data-release-recovery]').waitFor({ timeout: 10_000 })
    const preserved = await original.evaluate((element) => {
      const input = element as unknown as {
        isConnected: boolean
        closest(selector: string): object | null
        value: string
      }
      return (
        input.isConnected &&
        input.closest('[inert]') !== null &&
        input.value === 'RSC acceptance preserved draft'
      )
    })
    check(
      'an obsolete release keeps the same dirty editor under the recovery screen',
      preserved && page.url() === site + settings,
    )
  } finally {
    await context.close()
  }
}

const frozenLiveChannels = async (browser: Browser, batch: string) => {
  const context = await signedInContext(browser, 'admin')
  try {
    const page = await context.newPage()
    const channel = page.waitForEvent('websocket', {
      predicate: (socket) => new URL(socket.url()).pathname.includes(batch),
      timeout: 10_000,
    })
    await page.goto(`${site}/assessment/batches/${batch}`)
    const socket = await channel
    const closed = socket.waitForEvent('close', { timeout: 10_000 }).then(
      () => true,
      () => false,
    )
    await context.request.post(`${site}/api/auth/local/local/login`, { data: accounts.student })
    const dial = await inPage<{ code: number; frames: number }>(
      page,
      `new Promise((resolve) => {
      const socket = new WebSocket(${JSON.stringify(socket.url())}, ${JSON.stringify(LIVE_SUBPROTOCOL)})
      let frames = 0
      const timeout = setTimeout(() => { socket.close(); resolve({ code: 0, frames }) }, 5000)
      socket.addEventListener('message', () => frames++)
      socket.addEventListener('close', (event) => {
        clearTimeout(timeout)
        resolve({ code: event.code, frames })
      })
    })`,
    )
    check(
      'an old RSC tab cannot rejoin a batch stream as the new viewer',
      dial.code === LIVE_CLOSE.identityChanged && dial.frames === 0,
      dial,
    )
    const peer = await context.newPage()
    await peer.goto(`${site}/assessment/batches`)
    await inPage(
      peer,
      `(() => {
      const channel = new BroadcastChannel('qualy:session')
      channel.postMessage({ type: 'changed' })
      channel.close()
    })()`,
    )
    const state = await page
      .getByTestId('session-recovery')
      .getAttribute('data-state', { timeout: 10_000 })
    const disconnected = await closed
    check(
      'freezing an RSC tab disconnects its already-open live channel',
      state === 'switched' && disconnected,
      { state, disconnected },
    )
  } finally {
    await context.close()
  }
}

const shellFirstPaint = async (browser: Browser) => {
  for (const width of [1440, 390]) {
    const context = await signedInContext(browser, 'admin', { width })
    try {
      for (const address of ['/library/formulas', '/organization/tree', '/organization/users']) {
        const page = await context.newPage()
        const errors: string[] = []
        page.on('pageerror', (error) => errors.push(error.message))
        let resume!: () => void
        const scripts = new Promise<void>((resolve) => {
          resume = resolve
        })
        await page.route('**/*', async (route) => {
          if (route.request().resourceType() === 'script') await scripts
          await route.continue()
        })
        try {
          await page.goto(site + address, { waitUntil: 'commit' })
          const heading = page.getByRole('heading', { level: 1 })
          const head = page.locator('[data-shell-head]')
          const side = page.getByTestId('side-nav')
          await heading.waitFor()
          await inPage(page, 'document.fonts.ready.then(() => true)')
          const before = await Promise.all([heading.boundingBox(), head.boundingBox()])
          const sidebar = await side.isVisible()
          resume()
          await hydrated(page)
          await inPage(
            page,
            'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
          )
          const after = await Promise.all([heading.boundingBox(), head.boundingBox()])
          const stable = before.every((first, index) => {
            const last = after[index]
            return (
              first !== null &&
              last != null &&
              (['x', 'y', 'width', 'height'] as const).every(
                (key) => Math.abs(first[key] - last[key]) <= 0.0625,
              )
            )
          })
          check(
            `keeps the shell geometry during hydration (${address}, ${width}px)`,
            stable &&
              sidebar === width >= 1024 &&
              (await side.isVisible()) === sidebar &&
              errors.length === 0,
            { before, after, sidebar, errors },
          )
        } finally {
          resume()
          await page.close()
        }
      }
    } finally {
      await context.close()
    }
  }
}

const recoveryLinkHydration = async (browser: Browser) => {
  const context = await browser.newContext()
  try {
    for (const path of [
      '/reset-password#token=invalid-fixture-token',
      '/confirm-email#token=invalid-fixture-token&purpose=verify',
    ]) {
      const page = await context.newPage()
      const errors: string[] = []
      const requested: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => requested.push(request.url()))
      const response = await page.goto(site + path)
      const html = await response?.text()
      await hydrated(page)
      const state = path.startsWith('/confirm-email')
        ? page.getByTestId('confirm-state')
        : page.getByRole('heading', { name: /链接已失效|Link.*expired/ })
      await state.waitFor({ timeout: 10_000 })
      check(
        `hydrates a recovery link whose token stays in the fragment (${path.split('#')[0]})`,
        response?.status() === 200 && errors.length === 0,
        errors,
      )
      check(
        `keeps a recovery credential out of document requests and HTML (${path.split('#')[0]})`,
        !requested.some((url) => url.includes('invalid-fixture-token')) &&
          html !== undefined &&
          !html.includes('invalid-fixture-token'),
      )
      await page.close()
    }
  } finally {
    await context.close()
  }
}

const pluginEntries = async (browser: Browser, batchId: string) => {
  const { userId, typeId } = await scratch.row<{ userId: string; typeId: string }>(
    'select id as "userId", user_type_id as "typeId" from users where email = $1',
    [accounts.student.email],
  )
  const { roleId } = await scratch.row<{ roleId: string }>(
    'select id as "roleId" from roles where code = $1',
    ['org-manager'],
  )
  const response = await fetch(`${site}/api/assessment/formula-functions`, {
    method: 'POST',
    headers: { cookie: await signIn('admin'), 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'RSC entry acceptance' }),
  })
  if (!response.ok) throw new Error(`could not create the entry's formula: ${response.status}`)
  const { function: formula } = (await response.json()) as { function: { id: string } }
  const plugins = await collectWebPlugins()
  await acceptEntries({
    site,
    expectedPages: plugins.flatMap((plugin) =>
      plugin.surfaces.flatMap(({ surface }) => (surface.kind === 'page' ? [surface.id] : [])),
    ),
    viewers: [
      {
        name: 'anonymous',
        context: (width) => browser.newContext({ viewport: { width, height: 900 } }),
      },
      ...(['admin', 'student'] as const).map((who) => ({
        name: who,
        context: (width: number) => signedInContext(browser, who, { width }),
      })),
    ],
    records: {
      batchId: { id: batchId },
      userId: { id: userId },
      typeId: { id: typeId },
      roleId: { id: roleId },
      functionId: { id: formula.id },
      // This fixture has neither a published formula nor a submitted review.
      // These two entries cover their explicit missing-record states only.
      versionId: { id: '00000000-0000-4000-8000-000000000001', missing: true },
      instanceId: { id: '00000000-0000-4000-8000-000000000002', missing: true },
    },
    hydrated,
    check,
  })
}

const checks = async () => {
  publicAssetNames()
  await refusals()
  await cookies(scratch)
  await cancellation()
  browser = await chromium.launch({
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--disable-features=OverlayScrollbar'],
  })
  await underPolicy(browser)
  await loginMethodsUnread(browser)
  await changedHands(browser)
  await ownSessionChanges(browser)
  await acceptRouteErrors({
    context: await signedInContext(browser, 'admin'),
    site,
    hydrated,
    check,
  })
  await sessionWent(browser)
  const batch = await batchFor(scratch)
  await batchListFirstScreen(browser, batch)
  await overviewFirstScreen(browser, batch)
  const started = await startedBatchFor(scratch)
  await pageFirstScreen(browser, {
    name: "the participant's account",
    who: 'student',
    address: `/assessment/batches/${started}/my-result`,
    content: 'result-ledger',
    reads: [/\/me\/result(?:\?|$)/, /\/items(?:\?|$)/, /\/me\/entries(?:\?|$)/],
  })
  await pageFirstScreen(browser, {
    name: "the participant's filings",
    who: 'student',
    address: `/assessment/batches/${started}/my-entries`,
    // a round with no question yet open to filing says so
    content: 'entries-empty',
    reads: [
      /\/me\/result(?:\?|$)/,
      /\/items(?:\?|$)/,
      /\/me\/entries(?:\?|$)/,
      /\/score-groups(?:\?|$)/,
    ],
  })
  await pageFirstScreen(browser, {
    name: 'the roster',
    who: 'admin',
    address: `/assessment/batches/${started}/results`,
    content: 'roster',
    reads: [/\/participant-accounts\?/, /\/roster-units\?/, /\/participant-scores\?/],
  })
  const { id: person } = await scratch.row<{ id: string }>(
    `select p.id from batch_participants p join users u on u.id = p.user_id
      where p.batch_id = $1 and u.email = $2`,
    [started, accounts.student.email],
  )
  await pageFirstScreen(browser, {
    name: 'one person on the roster',
    who: 'admin',
    address: `/assessment/batches/${started}/results?participant=${person}`,
    // the account's total, which only the person's read account says
    content: 'participant-total',
    reads: [
      /\/participants\/[0-9a-f-]+(?:\?|$)/,
      /\/participants\/[0-9a-f-]+\/result(?:\?|$)/,
      /\/participants\/[0-9a-f-]+\/entries(?:\?|$)/,
      /\/participant-accounts\?/,
      /\/roster-units\?/,
    ],
  })
  await reviewerIn(scratch, started)
  await pageFirstScreen(browser, {
    name: 'the review queue',
    who: 'student',
    address: `/assessment/batches/${started}/reviews?view=time`,
    content: 'review-inbox-empty',
    reads: [/^\/assessment\/review\/inbox\?/, /^\/assessment\/review\/supplement-requests\?/],
  })
  await pageFirstScreen(browser, {
    name: "the reader's rounds",
    who: 'student',
    address: '/account/batches',
    content: 'person-batches',
    reads: [/^\/assessment\/me\/batches(?:\?|$)/],
  })
  await hydrationPositions(browser, batch)
  await shellFirstPaint(browser)
  await recoveryLinkHydration(browser)
  await grantSurfaces(browser, batch)
  await guardedNavigation(browser, batch)
  await frozenLiveChannels(browser, batch)
  await pluginEntries(browser, batch)
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
    env: {
      DATABASE_URL: scratch.url,
      QUALY_MAIL_DEFAULT_BACKEND: 'smtp',
      NODE_ENV: undefined,
      // the filing records the sign-in page sets in its foot, when a run
      // wants the page as a deployment that has them draws it
      ...Object.fromEntries(
        ['QUALY_ICP_RECORD', 'QUALY_MPS_RECORD', 'QUALY_MPS_RECORD_URL'].map((name) => [
          name,
          process.env[name],
        ]),
      ),
    },
  })
  await server.waitUntilReady()
  host = await mountHandler()
  if (process.env['RSC_ACCEPTANCE_HOLD'] === '1') {
    // the stack kept up for looking at by hand, until interrupted
    const batch = await batchFor(scratch)
    const started = await startedBatchFor(scratch)
    await reviewerIn(scratch, started)
    console.log(`rsc-acceptance: holding ${site}`)
    fs.writeFileSync(
      path.join(repoRoot, 'node_modules/.cache/rsc-acceptance.json'),
      JSON.stringify({ site, accounts, batch, started }),
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
