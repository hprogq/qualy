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
import { stack } from './stack.ts'

// What every journey shares: the deployment e2e-stack.ts started, one browser
// per file, a fresh context per journey, and - when a journey fails - its
// trace, a screenshot, and the console and network as they happened, under
// .qualy/e2e/artifacts/<journey>/. A journey drives the product the way a
// person does; nothing here reaches past the browser.

const artifacts = path.resolve(import.meta.dirname, '../../.qualy/e2e/artifacts')

export { signIn, stack, submitSignIn, type Account } from './stack.ts'

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
