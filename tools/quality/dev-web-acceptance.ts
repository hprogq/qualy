import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type Browser } from 'playwright'
import { resolveAssembly } from '@qualy/assembly'
import { compileMessages } from '@qualy/message-build'
import {
  forkService,
  send,
  servicePrepared,
  serviceReady,
  stop,
  type Child,
} from '../../apps/server/src/dev/child.ts'
import { PROTOCOL } from '../../apps/server/src/dev/protocol.ts'
import { devTopology } from '../../apps/server/src/dev/topology.ts'
import { repoRoot } from '../lib/manifest.ts'
import { startQualyServer, type QualyServer } from '../lib/qualy-server.ts'

// A real Node API and Bun Vite, using this product's plugin declaration and
// rendering configuration. Only the preview port and cache are overridden.
// No production build, developer environment, source mutation or external mail.
//
// Run with pnpm test:dev-web; the database is always a test context's own.
assert.equal(process.versions['bun'], undefined, 'The acceptance driver must run on Node')
process.env['QUALY_TEST_DATABASE_URL'] ??= 'postgres://qualy:qualy@127.0.0.1:5433/qualy'
const { createTestContext } = await import('@qualy/plugin-database/testkit')
const apiPort = Number(process.env['DEV_WEB_API_PORT'] ?? 3330)
const port = Number(process.env['DEV_WEB_ACCEPTANCE_PORT'] ?? 5186)
// Never accept readiness from a server this run did not start, and never
// change ports behind the browser's back.
for (const candidate of [apiPort, port]) {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject)
    probe.listen(candidate, () => probe.close((error) => (error ? reject(error) : resolve())))
  })
}
const scratch = await createTestContext('dev-web-acceptance')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'qualy-dev-web-'))
const site = `http://127.0.0.1:${String(port)}`
const account = { email: 'admin@example.edu', password: randomBytes(18).toString('base64url') }
let backend: QualyServer | undefined
let web: Child | undefined
let browser: Browser | undefined
const cancelled = new AbortController()
const interrupt = () => {
  cancelled.abort(new Error('dev-web-acceptance interrupted'))
  void browser?.close().catch((error: unknown) => console.error(error))
  if (web) send(web, { protocol: PROTOCOL, type: 'shutdown' })
  backend?.kill()
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, interrupt)

try {
  await compileMessages({ all: true })
  cancelled.signal.throwIfAborted()
  await promisify(execFile)(process.execPath, [path.join(repoRoot, 'tools/fixtures/seed-cli.ts')], {
    cwd: repoRoot,
    timeout: 90_000,
    signal: cancelled.signal,
    env: {
      PATH: process.env['PATH'],
      DATABASE_URL: scratch.url,
      QUALY_ADMIN_EMAIL: account.email,
      QUALY_ADMIN_PASSWORD: account.password,
      QUALY_SEED_DEMO: '1',
      QUALY_DEMO_PASSWORD: account.password,
    },
  })
  cancelled.signal.throwIfAborted()
  backend = startQualyServer({
    port: apiPort,
    mode: 'development',
    envFile: false,
    env: {
      DATABASE_URL: scratch.url,
      NODE_ENV: 'development',
      QUALY_CONFIG: path.join(repoRoot, 'qualy.yml'),
    },
  })
  await backend.waitUntilReady()
  cancelled.signal.throwIfAborted()

  const resolution = await resolveAssembly({ manifestPath: path.join(repoRoot, 'qualy.yml') })
  const spec = devTopology(resolution).find((service) => service.id === 'web')
  assert.ok(spec, 'The product must declare a web development service')
  assert.equal(spec.runtime, 'bun')
  const module = path.join(temporary, 'service.mjs')
  await fs.writeFile(
    module,
    `import * as web from ${JSON.stringify(spec.moduleUrl)}
export const prepare = web.prepare
export const acquire = (prepared, context) => web.acquire({
  ...prepared,
  vite: { ...prepared.vite, createServer: options => prepared.vite.createServer({
    ...options,
    cacheDir: ${JSON.stringify(path.join(temporary, 'vite-cache'))},
    server: { ...options.server, host: '127.0.0.1', port: ${String(port)} },
  }) },
}, context)
`,
  )
  web = forkService({ ...spec, moduleUrl: pathToFileURL(module).href }, backend.base, {
    ...process.env,
    QUALY_DEV_RUNTIME: undefined,
    QUALY_CONFIG: path.join(repoRoot, 'qualy.yml'),
    NODE_ENV: 'development',
  })
  assert.equal(web.process.spawnfile, 'bun')
  await servicePrepared(web)
  send(web, { protocol: PROTOCOL, type: 'accept' })
  await serviceReady(web)
  cancelled.signal.throwIfAborted()

  browser = await chromium.launch()
  if (cancelled.signal.aborted) {
    await browser.close()
    cancelled.signal.throwIfAborted()
  }
  const context = await browser.newContext({ locale: 'en-US' })
  const login = await context.request.post(`${site}/api/auth/local/local/login`, { data: account })
  assert.equal(login.status(), 200, 'Login POST must survive the Bun Vite proxy')
  const student = await scratch.row<{ org: string; type: string }>(
    'select primary_org_node_id as org, user_type_id as type from users where email=$1',
    ['student@example.edu'],
  )
  const batchName = 'Mixed development acceptance'
  const created = await context.request.post(`${site}/api/assessment/batches`, {
    data: {
      name: batchName,
      descriptionMd: 'Isolated test fixture.',
      materialRange: { start: '2026-09-01', end: '2027-07-31' },
      timezone: 'Asia/Shanghai',
      import: { orgNodeIds: [student.org], userTypeIds: [student.type] },
    },
  })
  assert.equal(created.status(), 200, 'The proxy must preserve a JSON business write')
  const createdBatch = (await created.json()) as { batch: { id: string } }

  const anonymous = await browser.newContext({ locale: 'en-US' })
  try {
    await Promise.all(
      Array.from({ length: 3 }, async () => {
        const [known, unknown] = await Promise.all([
          context.request.get(`${site}/assessment/batches`, {
            headers: { 'x-qualy-locale': 'zh-CN' },
          }),
          anonymous.request.get(`${site}/login`, { headers: { 'x-qualy-locale': 'en-US' } }),
        ])
        assert.equal(known.status(), 200)
        assert.equal(unknown.status(), 200)
        const [personal, publicPage] = await Promise.all([known.text(), unknown.text()])
        assert.ok(personal.includes('data-locale="zh-CN"') && personal.includes(batchName))
        assert.ok(
          publicPage.includes('data-locale="en-US"') &&
            publicPage.includes('data-testid="auth-shell"'),
        )
        assert.ok(
          !publicPage.includes(batchName),
          'Anonymous HTML must not contain personal batch data',
        )
      }),
    )
  } finally {
    await anonymous.close()
  }
  await context.clearCookies()
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (
      /one blocker|multiple renderers|Hydration failed|preloaded using link preload/.test(
        message.text(),
      )
    )
      errors.push(message.text())
  })
  const unsupported: string[] = []
  page.on('response', (response) => {
    if (response.status() === 415) unsupported.push(new URL(response.url()).pathname)
  })
  await page.goto(`${site}/login?method=local&next=%2Fassessment%2Fbatches`)
  // Cold development modules load separately; these assertions concern the
  // hydrated interaction, not progressive enhancement of the initial form.
  await page.waitForLoadState('networkidle')
  await page.locator('#email').fill(account.email)
  await page.locator('#password').fill(account.password)
  await page.getByTestId('local-submit').click()
  await page.waitForURL(`${site}/assessment/batches`)
  await page.waitForLoadState('networkidle')
  for (const suffix of ['', '/results', '/phases', '/results']) {
    const href = `/assessment/batches/${createdBatch.batch.id}${suffix}`
    await page.evaluate((to) => {
      return (
        globalThis as unknown as {
          __reactRouterDataRouter: { navigate: (to: string) => Promise<void> }
        }
      ).__reactRouterDataRouter.navigate(to)
    }, href)
    await page.waitForURL(`${site}${href}`)
    await page.waitForLoadState('networkidle')
  }
  await page.getByRole('button', { name: '系统管理员' }).click()
  const [ended] = await Promise.all([
    page.waitForResponse(
      (response) =>
        response.request().method() === 'DELETE' &&
        new URL(response.url()).pathname === '/api/auth/session',
    ),
    page.getByRole('menuitem', { name: /^(Sign out|退出登录)$/ }).click(),
  ])
  assert.equal(ended.status(), 200)
  await page.waitForURL(`${site}/login`)
  await page.waitForLoadState('networkidle')
  assert.equal(
    await page.locator('[data-last="true"]').count(),
    1,
    'The last login method must survive logout as a server-rendered preference',
  )
  assert.deepEqual(unsupported, [])
  assert.deepEqual(errors, [])
  console.log('dev-web-acceptance: login, JSON writes, concurrent SSR and browser logout passed')
} finally {
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.off(signal, interrupt)
  const failures: unknown[] = []
  for (const release of [
    () => browser?.close(),
    () => (web === undefined ? undefined : stop(web, 10_000)),
    () => backend?.stop(),
    () => scratch.dispose(),
    () => fs.rm(temporary, { recursive: true, force: true }),
  ]) {
    try {
      await release()
    } catch (error) {
      failures.push(error)
    }
  }
  if (failures.length > 0) {
    console.error(new AggregateError(failures, 'dev-web-acceptance cleanup failed'))
    process.exitCode = 1
  }
}
