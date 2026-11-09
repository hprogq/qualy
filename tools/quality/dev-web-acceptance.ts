import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:net'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { chromium, type APIResponse, type Browser } from 'playwright'
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
import { traceDevelopmentPaint } from './rsc-dev-paint.ts'
import { checkLayoutPreferences } from './rsc-layout-preferences.ts'

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
const stylexUpdateDelayMs = Number(process.env['DEV_WEB_STYLEX_UPDATE_DELAY_MS'] ?? 0)
assert.ok(Number.isFinite(stylexUpdateDelayMs) && stylexUpdateDelayMs >= 0)
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
  const apiBase = backend.base

  const resolution = await resolveAssembly({ manifestPath: path.join(repoRoot, 'qualy.yml') })
  const spec = devTopology(resolution).find((service) => service.id === 'web')
  assert.ok(spec, 'The product must declare a web development service')
  assert.equal(spec.runtime, 'bun')
  const module = path.join(temporary, 'service.mjs')
  await fs.writeFile(
    module,
    `import * as web from ${JSON.stringify(spec.moduleUrl)}
const ask = globalThis.fetch
// Force roster reads beyond the server HTML wait, including persisted-layout reloads.
globalThis.fetch = async (request, options) => {
  if (String(request instanceof Request ? request.url : request).includes('/participant-accounts')) {
    await new Promise(resolve => setTimeout(resolve, 400))
  }
  return ask(request, options)
}
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
  const launchRenderer = async () => {
    const child = forkService({ ...spec, moduleUrl: pathToFileURL(module).href }, apiBase, {
      ...process.env,
      QUALY_DEV_RUNTIME: undefined,
      QUALY_CONFIG: path.join(repoRoot, 'qualy.yml'),
      NODE_ENV: 'development',
    })
    web = child
    assert.equal(child.process.spawnfile, 'bun')
    await servicePrepared(child)
    send(child, { protocol: PROTOCOL, type: 'accept' })
    await serviceReady(child)
    return child
  }
  web = await launchRenderer()
  cancelled.signal.throwIfAborted()

  browser = await chromium.launch()
  if (cancelled.signal.aborted) {
    await browser.close()
    cancelled.signal.throwIfAborted()
  }
  const context = await browser.newContext({ locale: 'en-US', colorScheme: 'dark' })
  const login = await context.request.post(`${site}/api/auth/local/local/login`, { data: account })
  assert.equal(login.status(), 200, 'Login POST must survive the Bun Vite proxy')
  const student = await scratch.row<{ id: string; org: string; type: string }>(
    'select id, primary_org_node_id as org, user_type_id as type from users where email=$1',
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
  // Exercise the real multi-group ledger, not only its empty-state branch.
  // All facts enter through business APIs on the test context's scratch DB.
  const paperResponse = await context.request.put(
    `${site}/api/assessment/batches/${createdBatch.batch.id}/score-groups`,
    {
      data: {
        expectedVersion: 1,
        groups: [{ name: 'Paint fixture paper', parentGroupId: null, cap: '20.00', floor: null }],
      },
    },
  )
  assert.equal(paperResponse.status(), 200, await paperResponse.text())
  const paper = (await paperResponse.json()) as {
    groups: {
      id: string
      name: string
      parentGroupId: string | null
      cap: string | null
      floor: string | null
    }[]
    version: number
  }
  assert.equal(paper.groups.length, 1)
  const grouped = await context.request.put(
    `${site}/api/assessment/batches/${createdBatch.batch.id}/score-groups`,
    {
      data: {
        expectedVersion: paper.version,
        groups: [
          paper.groups[0],
          ...['Academic paint fixture', 'Activity paint fixture'].map((name) => ({
            name,
            parentGroupId: paper.groups[0]!.id,
            cap: '10.00',
            floor: null,
          })),
        ],
      },
    },
  )
  assert.equal(grouped.status(), 200, await grouped.text())
  const tree = (await grouped.json()) as { groups: { id: string; parentGroupId: string | null }[] }
  const groups = tree.groups.filter((group) => group.parentGroupId !== null)
  assert.equal(groups.length, 2)
  const fixtureItems: { id: string; revisionId: string }[] = []
  for (const [index, group] of groups.entries()) {
    const item = await context.request.post(
      `${site}/api/assessment/batches/${createdBatch.batch.id}/items`,
      {
        data: {
          itemType: 'declaration',
          title: `Scored paint fixture ${String(index + 1)}`,
          scoreGroupId: group.id,
          maxEntries: 1,
          config: {
            entryChannels: ['administrative'],
            formConfig: {},
            scoringConfig: {
              calculator: { ref: 'fixed@1', config: { value: index === 0 ? '3.00' : '5.00' } },
              aggregator: { ref: 'sum@1', config: {} },
            },
            reviewPolicy: { mode: 'none' },
          },
        },
      },
    )
    assert.equal(item.status(), 200, await item.text())
    const { item: question } = (await item.json()) as { item: { id: string } }
    const activated = await context.request.put(
      `${site}/api/assessment/items/${question.id}/status`,
      {
        data: { status: 'active' },
      },
    )
    assert.equal(activated.status(), 200, await activated.text())
    const { item: active } = (await activated.json()) as {
      item: { currentRevision: { id: string } | null }
    }
    assert.ok(active.currentRevision)
    fixtureItems.push({ id: question.id, revisionId: active.currentRevision.id })
  }
  const record = await browser.newContext({
    storageState: await context.storageState(),
    locale: 'zh-CN',
    colorScheme: 'dark',
  })
  try {
    await traceDevelopmentPaint(
      record,
      `${site}/organization/users/${student.id}/assessment/batches`,
      'cold-user-batches',
      'dark',
    )
  } finally {
    await record.close()
  }
  await traceDevelopmentPaint(
    context,
    `${site}/assessment/batches/${createdBatch.batch.id}/settings`,
    'cold-settings',
    'dark',
  )
  await traceDevelopmentPaint(
    context,
    `${site}/assessment/batches/${createdBatch.batch.id}/results`,
    'cold-roster',
    'dark',
  )

  const planned = await context.request.put(
    `${site}/api/assessment/batches/${createdBatch.batch.id}/phases`,
    {
      data: {
        phases: [
          {
            phaseKey: 'paint-check',
            displayName: 'Paint check',
            permissionProfile: ['assessment.entry.record'],
          },
        ],
      },
    },
  )
  assert.equal(planned.status(), 200)
  const { phases } = (await planned.json()) as { phases: { id: string }[] }
  const started = await context.request.put(
    `${site}/api/assessment/batches/${createdBatch.batch.id}/phase`,
    { data: { to: phases[0]!.id } },
  )
  assert.equal(started.status(), 200)
  const rosterResponse = await context.request.get(
    `${site}/api/assessment/batches/${createdBatch.batch.id}/participants`,
  )
  assert.equal(rosterResponse.status(), 200)
  const roster = (await rosterResponse.json()) as { items: { id: string; userId: string }[] }
  const enrolled = roster.items.find((one) => one.userId === student.id)
  assert.ok(enrolled, 'The isolated student is enrolled in the fixture batch')
  for (const item of fixtureItems) {
    const recorded: APIResponse = await context.request.post(`${site}/api/assessment/entries`, {
      data: {
        itemId: item.id,
        participantId: enrolled.id,
        expectedItemRevisionId: item.revisionId,
        payload: {},
        note: 'Isolated cold-paint fixture.',
      },
    })
    assert.equal(recorded.status(), 200, await recorded.text())
    assert.equal(
      ((await recorded.json()) as { entry: { status: string } }).entry.status,
      'approved',
    )
  }
  const participant = await browser.newContext({ locale: 'en-US' })
  try {
    const signedIn = await participant.request.post(`${site}/api/auth/local/local/login`, {
      data: { email: 'student@example.edu', password: account.password },
    })
    assert.equal(signedIn.status(), 200)
    const result = await participant.request.get(
      `${site}/api/assessment/batches/${createdBatch.batch.id}/me/result`,
    )
    assert.equal(result.status(), 200, await result.text())
    assert.equal(((await result.json()) as { total: string }).total, '8.00')
    await traceDevelopmentPaint(
      participant,
      `${site}/assessment/batches/${createdBatch.batch.id}/my-result`,
      'cold-my-result',
      'light',
      { expectLedger: true },
    )
    await stop(web, 10_000)
    web = await launchRenderer()
    await traceDevelopmentPaint(
      participant,
      `${site}/assessment/batches/${createdBatch.batch.id}/my-result`,
      'restart-my-result',
      'light',
      { expectLedger: true, stylexUpdateDelayMs },
    )
  } finally {
    await participant.close()
  }

  await stop(web, 10_000)
  web = await launchRenderer()
  await traceDevelopmentPaint(
    context,
    `${site}/assessment/batches/${createdBatch.batch.id}/settings`,
    'restart-settings',
    'dark',
    { stylexUpdateDelayMs },
  )

  await traceDevelopmentPaint(
    context,
    `${site}/assessment/batches/${createdBatch.batch.id}/settings`,
    'warm-settings',
    'dark',
  )
  for (const choice of ['light', 'dark'] as const) {
    const themed = await browser.newContext({
      storageState: await context.storageState(),
      colorScheme: choice === 'light' ? 'dark' : 'light',
    })
    try {
      await themed.addInitScript((value) => localStorage.setItem('qualy.theme', value), choice)
      await traceDevelopmentPaint(
        themed,
        `${site}/assessment/batches/${createdBatch.batch.id}/settings`,
        `stored-${choice}`,
        choice,
      )
    } finally {
      await themed.close()
    }
  }

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
      /one blocker|multiple renderers|hydration|hydrated|preloaded using link preload/i.test(
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
    if (suffix !== '')
      await page.evaluate(`(() => {
        const samples = []
        const read = () => {
          const rail = [...document.querySelectorAll('[data-testid="workspace-rail"]')].find(
            (node) => node.checkVisibility(),
          )
          samples.push({
            bones: rail?.querySelector('[data-testid="rail-bones"]')?.checkVisibility() === true,
            links: rail?.querySelectorAll('a').length ?? 0,
            active: rail?.querySelector('[aria-current="page"]')?.textContent ?? null,
          })
        }
        const observer = new MutationObserver(read)
        observer.observe(document.body, { childList: true, subtree: true, attributes: true })
        read()
        globalThis.__railNavigation = { samples, observer }
      })()`)
    if (suffix === '')
      await page.evaluate((to) => {
        return (
          globalThis as unknown as {
            __reactRouterDataRouter: { navigate: (to: string) => Promise<void> }
          }
        ).__reactRouterDataRouter.navigate(to)
      }, href)
    else await page.getByTestId('workspace-rail').locator(`a[href="${href}"]`).click()
    await page.waitForURL(`${site}${href}`)
    await page.waitForLoadState('networkidle')
    // A router promise settles before React commits its transition. Wait
    // for the actual destination, not an account menu in the outgoing shell.
    if (suffix === '/results') await page.getByTestId('roster').waitFor()
    else
      await page
        .getByRole('heading', { name: suffix === '/phases' ? 'Stages' : 'Overview', exact: true })
        .waitFor()
    if (suffix !== '') {
      const samples = await page.evaluate<
        { bones: boolean; links: number; active: string | null }[]
      >(`(() => {
        const { samples, observer } = globalThis.__railNavigation
        observer.disconnect()
        delete globalThis.__railNavigation
        return samples.filter(
          (one, i) => i === 0 || JSON.stringify(one) !== JSON.stringify(samples[i - 1]),
        )
      })()`)
      console.log('workspace navigation', suffix, samples)
      const current = await page
        .getByTestId('workspace-rail')
        .locator('[aria-current="page"]')
        .textContent()
      const active = new Set([samples[0]!.active, current])
      assert.ok(
        samples.every(
          (sample) =>
            !sample.bones && sample.links === samples[0]!.links && active.has(sample.active),
        ),
        'Workspace navigation must retain its entries and selection without skeletons',
      )
    }
  }
  const rosterUrl = page.url()
  const oldRail = page.getByTestId('workspace-rail')
  const selection = await oldRail.locator('[aria-current="page"]').textContent()
  const links = await oldRail.locator('a').count()
  const visibleOutgoing = await page.evaluateHandle<
    () => { links: number; active: string | null; bones: boolean }[]
  >(`(() => {
    const rail = [...document.querySelectorAll('[data-testid="workspace-rail"]')].find(node => node.checkVisibility())
    if (!rail) throw new Error('No visible outgoing rail')
    const samples = []
    const record = () => {
      if (!rail.isConnected || !rail.checkVisibility()) return
      samples.push({
        links: rail.querySelectorAll('a').length,
        active: rail.querySelector('[aria-current="page"]')?.textContent ?? null,
        bones: rail.querySelector('[data-testid="rail-bones"]') !== null,
      })
    }
    const observer = new MutationObserver(record)
    observer.observe(document.body, { childList: true, subtree: true, attributes: true })
    record()
    return () => {
      observer.disconnect()
      return samples
    }
  })()`)
  await page.getByRole('link', { name: 'All rounds', exact: true }).click()
  await page.waitForURL(`${site}/assessment/batches`)
  await oldRail.waitFor({ state: 'hidden' })
  const outgoing = await visibleOutgoing.evaluate((finish) => finish())
  await visibleOutgoing.dispose()
  assert.ok(outgoing.length > 1, 'Sample the outgoing batch rail during navigation')
  assert.deepEqual(
    [...new Set(outgoing.map((sample) => JSON.stringify(sample)))].map((one) => JSON.parse(one)),
    [{ links, active: selection, bones: false }],
    'Leaving the batch must not erase the outgoing workspace rail',
  )
  console.log('workspace navigation: returning to all rounds kept the outgoing rail intact')
  await page.goto(rosterUrl, { waitUntil: 'networkidle' })
  await checkLayoutPreferences(page, rosterUrl, `${site}/organization/users`)
  // The old audit join differed across Bun and Chromium even for the same
  // locale and instant. Check HTML and hydration with a different device zone.
  const auditContext = await browser.newContext({
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 390, height: 844 },
    reducedMotion: 'reduce',
    storageState: await context.storageState(),
  })
  try {
    const auditUrl = `${site}/organization/audit`
    const response = await auditContext.request.get(auditUrl)
    assert.match(await response.text(), /<button[^>]+data-testid="audit-row"/)
    const audit = await auditContext.newPage()
    audit.on('pageerror', (error) => errors.push(error.message))
    await audit.goto(auditUrl, { waitUntil: 'networkidle' })
    await audit.getByTestId('audit-row').first().click()
    await audit.getByTestId('audit-detail').waitFor()
    console.log('audit: real HTML rows and English hydration in another device zone passed')
    let releasePeople!: () => void
    const people = new Promise<void>((resolve) => {
      releasePeople = resolve
    })
    await audit.route('**/api/iam/users?**', async (route) => {
      await people
      const response = await route.fetch()
      const read = (await response.json()) as { items: { id: string }[] }
      assert.ok(read.items[0])
      // Give the test a genuinely full page and pager without mutating the directory.
      const items = Array.from({ length: 20 }, (_, i) => ({
        ...read.items[i % read.items.length]!,
        id: read.items[0]!.id.slice(0, -3) + i.toString(16).padStart(3, '0'),
      }))
      await route.fulfill({ response, json: { ...read, items, total: 45 } })
    })
    const shapes = await audit.evaluateHandle<(stop?: boolean) => number[]>(`(() => {
      const heights = new Set()
      const sample = () => {
        const dialog = document.querySelector('[data-slot="dialog-content"]')
        if (dialog?.checkVisibility()) heights.add(Math.round(dialog.getBoundingClientRect().height))
      }
      const observer = new MutationObserver(sample)
      observer.observe(document.body, { childList: true, subtree: true, attributes: true })
      const frames = setInterval(sample, 16)
      return (stop) => {
        if (stop) {
          observer.disconnect()
          clearInterval(frames)
        }
        return [...heights]
      }
    })()`)
    try {
      await audit.getByRole('button', { name: 'Anybody', exact: true }).click()
      const picker = audit.getByTestId('people-picker')
      const list = audit.getByTestId('people-picker-list')
      const dialog = audit.getByRole('dialog', { name: 'Whose operations' })
      await list.and(audit.locator('[aria-busy="true"]')).waitFor()
      const before = (await dialog.boundingBox())?.height
      assert.ok(before && before > 300)
      releasePeople()
      await picker.getByTestId('people-picker-row').first().waitFor()
      const pager = picker.getByTestId('people-picker-pager')
      await pager.waitFor()
      const after = (await dialog.boundingBox())?.height
      assert.ok(after)
      assert.ok(Math.abs(after - before) <= 1, 'Rows and pagination must fit the same dialog seat')
      const frames = await shapes.evaluate((read) => read())
      assert.ok(
        frames.length > 0 && frames.every((height) => Math.abs(height - after) <= 1),
        `Audit picker height must stay fixed through loading: ${frames.join(', ')}`,
      )
      const bottom = (await pager.boundingBox())!
      assert.ok(bottom.y + bottom.height <= 844, 'The pager must remain inside the mobile sheet')
      console.log('audit: cold mobile picker kept its height and pagination in view')
    } finally {
      releasePeople()
      await shapes.evaluate((read) => read(true))
      await shapes.dispose()
    }
  } finally {
    await auditContext.close()
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
