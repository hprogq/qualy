import fs from 'node:fs'
import path from 'node:path'
import {
  chromium,
  devices,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, onTestFailed } from 'vitest'

// What every journey shares: the deployment e2e-stack.ts started, one browser
// per file, a fresh context per journey, and - when a journey fails - its
// trace, a screenshot, and the console and network as they happened, under
// .qualy/e2e/artifacts/<journey>/. A journey drives the product the way a
// person does; nothing here reaches past the browser.

const repoRoot = path.resolve(import.meta.dirname, '../..')
const artifacts = path.join(repoRoot, '.qualy/e2e/artifacts')

interface Stack {
  readonly base: string
  readonly release: string
  readonly accounts: Record<string, { readonly email: string; readonly password: string }>
}

export const stack: Stack = (() => {
  const file = path.join(repoRoot, '.qualy/e2e/stack.json')
  if (!fs.existsSync(file)) {
    throw new Error(
      'no .qualy/e2e/stack.json: start the deployment with node tools/quality/e2e-stack.ts up',
    )
  }
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Stack
})()

export type Account = 'admin' | 'student' | 'classLead' | 'counsellor' | 'lead'

/** a phone, as the product's phone layout is meant for */
export const PHONE = devices['iPhone 13']

/**
 * A browser for this file and a context per journey, with its evidence kept
 * when the journey fails. `engine` is WebKit for a phone: the phone layout's
 * users are on Safari.
 */
export const browsing = (
  options: {
    engine?: 'chromium' | 'webkit'
    device?: typeof PHONE
    context?: BrowserContextOptions
  } = {},
) => {
  let browser: Browser
  let context: BrowserContext
  const logs: string[] = []
  const state = { page: undefined as Page | undefined }

  beforeAll(async () => {
    browser = await (options.engine === 'webkit' ? webkit : chromium).launch()
  })
  afterAll(async () => {
    await browser.close()
  })
  beforeEach(async (test) => {
    logs.length = 0
    context = await browser.newContext({
      baseURL: stack.base,
      locale: 'zh-CN',
      // the local edge's certificate is its own
      ignoreHTTPSErrors: true,
      ...options.device,
      ...options.context,
    })
    await context.tracing.start({ screenshots: true, snapshots: true })
    const page = await context.newPage()
    page.on('console', (message) => logs.push(`console ${message.type()}: ${message.text()}`))
    page.on('response', (response) => {
      if (new URL(response.url()).pathname.startsWith('/api/')) {
        logs.push(`${String(response.status())} ${response.request().method()} ${response.url()}`)
      }
    })
    page.on('requestfailed', (request) =>
      logs.push(
        `failed ${request.method()} ${request.url()}: ${request.failure()?.errorText ?? ''}`,
      ),
    )
    state.page = page
    onTestFailed(async () => {
      const dir = path.join(artifacts, test.task.name.replace(/[^\w一-龥-]+/g, '-'))
      fs.mkdirSync(dir, { recursive: true })
      await page.screenshot({ path: path.join(dir, 'screen.png'), fullPage: true }).catch(() => {})
      await context.tracing.stop({ path: path.join(dir, 'trace.zip') }).catch(() => {})
      fs.writeFileSync(path.join(dir, 'log.txt'), `${logs.join('\n')}\n`)
    })
  })
  afterEach(async () => {
    await context.tracing.stop().catch(() => {})
    await context.close()
  })
  return {
    /** the page of the journey now running */
    page: (): Page =>
      state.page ??
      (() => {
        throw new Error('no page outside a journey')
      })(),
  }
}

/**
 * Signs in with an email and password, as a person does on the sign-in page -
 * from the front door, or (`here`) on the sign-in page the browser was
 * already sent to.
 */
export const signIn = async (page: Page, who: Account, options: { here?: boolean } = {}) => {
  const account = stack.accounts[who]
  if (account === undefined) throw new Error(`the stack has no ${who} account`)
  if (options.here !== true) await page.goto('/')
  // a narrow screen lists the ways in first; a wide one opens on the form
  // (whichever shows first: a narrow screen keeps the form in the page, hidden)
  const byPassword = page.getByRole('button', { name: '邮箱密码' })
  const email = page.getByLabel('邮箱', { exact: true })
  await Promise.race([email.waitFor().catch(() => {}), byPassword.waitFor().catch(() => {})])
  if (await byPassword.isVisible()) await byPassword.click()
  await page.getByLabel('邮箱', { exact: true }).fill(account.email)
  await page.getByLabel('密码', { exact: true }).fill(account.password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 60_000 })
}
