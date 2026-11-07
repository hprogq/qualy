import type { BrowserContext, Page, Request as BrowserRequest } from 'playwright'
import { SIGN_IN_PAGE } from '@qualy/auth-contract/sign-in-failure'

// Entry coverage comes from the authorized manifests, so adding a plugin
// page adds a check without adding its name to a host-owned route list.
// Record parameters come from this run's scratch world. A missing record
// exercises only the page's refusal state, and is reported as such.

interface PageEntry {
  readonly id: string
  readonly path: string
}

interface EntryChecks {
  readonly site: string
  readonly expectedPages: readonly string[]
  readonly viewers: readonly {
    readonly name: string
    readonly context: (width: number) => Promise<BrowserContext>
  }[]
  readonly records: Readonly<Record<string, { readonly id: string; readonly missing?: boolean }>>
  readonly hydrated: (page: Page) => Promise<unknown>
  readonly check: (name: string, ok: boolean, detail?: unknown) => void
}

/** The initial reads have settled; polling and live updates are not a page load. */
const initialReads = (page: Page) => {
  const pending = new Set<BrowserRequest>()
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (pathname.startsWith('/api/') || pathname.endsWith('.rsc')) pending.add(request)
  })
  const ended = (request: BrowserRequest) => pending.delete(request)
  page.on('requestfinished', ended)
  page.on('requestfailed', ended)
  return async () => {
    const deadline = Date.now() + 10_000
    let quietSince = Date.now()
    while (Date.now() < deadline) {
      if (pending.size > 0) quietSince = Date.now()
      else if (Date.now() - quietSince >= 150) return
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    throw new Error('initial API reads did not settle')
  }
}

export const acceptEntries = async ({
  site,
  expectedPages,
  viewers,
  records,
  hydrated,
  check,
}: EntryChecks) => {
  const covered = new Set<string>()
  for (const viewer of viewers) {
    for (const width of [1440, 390]) {
      const context = await viewer.context(width)
      try {
        const manifest = await context.request.get(`${site}/api/app/manifest`)
        if (!manifest.ok()) throw new Error(`manifest refused: ${manifest.status()}`)
        const { pages } = (await manifest.json()) as { readonly pages: readonly PageEntry[] }
        console.log(`rsc-acceptance: ${viewer.name} entries at ${width}px (${pages.length})`)
        for (const entry of pages) {
          const absent: string[] = []
          const address = entry.path.replace(/:([a-zA-Z][a-zA-Z0-9]*)/g, (_, parameter: string) => {
            const record = records[parameter]
            if (record === undefined) throw new Error(`no entry fixture for :${parameter}`)
            if (record.missing) absent.push(parameter)
            return encodeURIComponent(record.id)
          })
          const label = `${entry.id}, ${viewer.name}, ${width}px${absent.length === 0 ? '' : `, missing ${absent.join(', ')}`}`
          const page = await context.newPage()
          const errors: string[] = []
          const settled = initialReads(page)
          page.on('pageerror', (error) => errors.push(error.message))
          page.on('console', (message) => {
            if (
              message.type() === 'error' &&
              /hydration|Minified React error|\[qualy\].*(?:failed|missing from this build)|ErrorBoundary/i.test(
                message.text(),
              )
            ) {
              errors.push(message.text())
            }
          })
          try {
            const response = await page.goto(site + address)
            const html = await response?.text()
            await hydrated(page)
            await settled()
            const matches = await page.evaluate(() => {
              const router = (
                globalThis as unknown as {
                  __reactRouterDataRouter: { state: { matches: { route: { id: string } }[] } }
                }
              ).__reactRouterDataRouter
              return router.state.matches.map((match) => match.route.id)
            })
            const matched = matches.includes(`page:${entry.id}`)
            // A signed-in visitor may be sent home by the sign-in page.
            // Every other entry must actually reach its own route.
            const signedInRedirect =
              entry.id === SIGN_IN_PAGE &&
              viewer.name !== 'anonymous' &&
              new URL(page.url()).pathname !== address
            const serverFailed = html === undefined || /<template\b[^>]*\bdata-dgst=/.test(html)
            const failed = page
              .getByTestId('session-recovery')
              .or(page.locator('[data-release-recovery]'))
            const ok =
              response?.ok() === true &&
              response.headers()['cache-control'] === 'private, no-store' &&
              !serverFailed &&
              errors.length === 0 &&
              (matched || signedInRedirect) &&
              !(await failed.isVisible())
            check(`renders and hydrates the plugin entry (${label})`, ok, {
              status: response?.status(),
              matches,
              serverFailed,
              errors,
            })
            if (ok) covered.add(entry.id)
          } catch (error) {
            check(`renders and hydrates the plugin entry (${label})`, false, {
              error: String(error),
              errors,
            })
          } finally {
            await page.close()
          }
        }
      } finally {
        await context.close()
      }
    }
  }
  const missing = expectedPages.filter((id) => !covered.has(id))
  check('exercises every page declared by the active plugins', missing.length === 0, { missing })
  console.log(`rsc-acceptance: exercised ${covered.size} distinct plugin page entries`)
}
