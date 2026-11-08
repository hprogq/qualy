import fs from 'node:fs/promises'
import path from 'node:path'
import type { BrowserContext, Page } from 'playwright'
import { primaryNavigation } from '@qualy/ui-contract'
import { repoRoot } from '../lib/manifest.ts'

interface NavigationEntry {
  readonly target: { readonly kind: string; readonly path?: string }
}

/** A real failed Flight navigation, using the production build and its authorized links. */
export const acceptRouteErrors = async ({
  context,
  site,
  hydrated,
  check,
}: {
  readonly context: BrowserContext
  readonly site: string
  readonly hydrated: (page: Page) => Promise<unknown>
  readonly check: (name: string, ok: boolean, detail?: unknown) => void
}) => {
  try {
    await context.addCookies([{ name: 'qualy.locale', value: 'zh-CN', url: site }])
    const projection = (await (await context.request.get(`${site}/api/app/manifest`)).json()) as {
      collections: Record<string, NavigationEntry[]>
    }
    const paths = (projection.collections[primaryNavigation.key] ?? []).flatMap(({ target }) =>
      target.kind === 'page' && target.path !== undefined && !target.path.includes(':')
        ? [target.path]
        : [],
    )
    const [from, to] = [...new Set(paths)]
    if (from === undefined || to === undefined)
      throw new Error('Route error acceptance needs two authorized navigation entries')
    const page = await context.newPage()
    let documents = 0
    page.on('request', (request) => {
      if (request.isNavigationRequest()) documents++
    })
    await page.goto(`${site}${from}`)
    await hydrated(page)
    let attempts = 0
    await page.route(/\.rsc(?:\?|$)/, (route) =>
      ++attempts === 1 ? route.abort('failed') : route.continue(),
    )
    await page
      .locator(`a[href=${JSON.stringify(to)}]`)
      .first()
      .click()
    const error = page.getByTestId('route-error')
    await error.waitFor({ state: 'visible' })
    check(
      'shows the product offline state for a failed RSC navigation',
      (await error.locator('[data-slot="resource-state"]').getAttribute('data-state')) ===
        'offline',
    )
    const text = await page.locator('body').innerText()
    check(
      'keeps router diagnostics and implementation paths out of the error page',
      !/Unexpected Application Error|Hey developer|rendered-fetch\.ts|TypeError:/.test(text),
    )
    check(
      'keeps the document identity and styles on the route error',
      (await page.locator('html').getAttribute('data-release')) !== null &&
        (await page.evaluate<string>(
          "getComputedStyle(document.querySelector('[data-testid=route-error] h1')).fontSize",
        )) === '20px',
    )
    await page.evaluate('document.fonts.ready')
    const directory = path.join(repoRoot, 'node_modules/.cache/rsc-error-preview')
    await fs.mkdir(directory, { recursive: true })
    await page.screenshot({ path: path.join(directory, 'light.png'), animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.locator('html[data-mode="dark"][data-mantine-color-scheme="dark"]').waitFor()
    await page.screenshot({ path: path.join(directory, 'dark.png'), animations: 'disabled' })
    await error.getByRole('button').click()
    await error.waitFor({ state: 'hidden' })
    check(
      'retries a failed RSC navigation successfully without a document reload',
      attempts >= 2 && documents === 1 && new URL(page.url()).pathname === to,
    )
  } finally {
    await context.close()
  }
}
