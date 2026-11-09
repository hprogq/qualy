import type { BrowserContext, Page } from 'playwright'

/** Watch the whole transition, not only the title after the router settles. */
export const acceptTitleNavigation = async ({
  context,
  site,
  batchId,
  hydrated,
  check,
}: {
  readonly context: BrowserContext
  readonly site: string
  readonly batchId: string
  readonly hydrated: (page: Page) => Promise<unknown>
  readonly check: (name: string, ok: boolean, detail?: unknown) => void
}) => {
  try {
    await context.addCookies([{ name: 'qualy.locale', value: 'zh-CN', url: site }])
    const overview = `/assessment/batches/${batchId}`
    const entries = `${overview}/my-entries`
    const before = '概览 - Qualy'
    const after = '我的申报 - Qualy'
    const page = await context.newPage()
    await page.goto(site + overview)
    await hydrated(page)
    const titles = await page.evaluateHandle(`(() => {
      const seen = new Set([document.title]);
      const observer = new MutationObserver((changes) => {
        for (const change of changes) {
          if (change.target.parentElement?.tagName === 'TITLE' && change.oldValue !== null)
            seen.add(change.oldValue);
          for (const node of [...change.removedNodes, ...change.addedNodes]) {
            if (node.nodeName === 'TITLE' || change.target.nodeName === 'TITLE')
              seen.add(node.textContent);
          }
        }
        seen.add(document.title);
      });
      observer.observe(document.head, {
        subtree: true, childList: true, characterData: true, characterDataOldValue: true,
      });
      return () => { observer.disconnect(); return [...seen] };
    })()`)
    const flight = (url: URL) => url.pathname === `${entries}.rsc`
    let resume!: () => void
    const held = new Promise<void>((resolve) => {
      resume = resolve
    })
    await page.route(flight, async (route) => {
      await held
      await route.continue()
    })
    try {
      const request = page.waitForRequest((request) => flight(new URL(request.url())))
      await page
        .locator(`a[href=${JSON.stringify(entries)}]`)
        .first()
        .click()
      await request
      check(
        'keeps the previous title while an RSC navigation is waiting',
        (await page.title()) === before,
      )
    } finally {
      resume()
    }
    await page.waitForURL(site + entries)
    await page.waitForFunction((expected) => {
      return (globalThis as { document?: { title: string } }).document?.title === expected
    }, after)
    const seen = await titles.evaluate((read) => (read as () => readonly string[])())
    check(
      'switches from overview to filings without an intermediate browser title',
      seen.length === 2 && seen[0] === before && seen[1] === after,
      seen,
    )
  } finally {
    await context.close()
  }
}
