import type { BrowserContext } from 'playwright'

/** The same permission facts and table geometry, before and after JavaScript takes over. */
export async function acceptAccessPaint({
  context,
  address,
  check,
}: {
  context: BrowserContext
  address: string
  check: (name: string, ok: boolean, detail?: unknown) => void
}) {
  try {
    for (const width of [1920, 900, 390]) {
      const page = await context.newPage()
      await page.setViewportSize({ width, height: 1000 })
      let release!: () => void
      const scripts = new Promise<void>((resolve) => {
        release = resolve
      })
      await page.route('**/*', async (route) => {
        if (route.request().resourceType() === 'script') await scripts
        await route.continue()
      })
      const errors: string[] = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('console', (message) => {
        if (/hydration|hydrated/i.test(message.text())) errors.push(message.text())
      })
      try {
        await page.goto(address, { waitUntil: 'commit' })
        const staff = page.getByTestId('access-staff')
        const row = page.locator('[data-testid="access-subject"]:visible').first()
        await row.waitFor()
        const snapshot = () =>
          page.evaluate<{
            rect: { x: number; y: number; width: number; height: number }
            permissions: { code: string | null; state: string | null; icons: number }[]
          }>(`(() => {
          const node = [...document.querySelectorAll('[data-testid="access-subject"]')].find(node => node.getBoundingClientRect().width > 0)
          return {
            rect: node.getBoundingClientRect().toJSON(),
            permissions: [...node.querySelectorAll('[data-testid="access-grant"]')].map(mark => ({
              code: mark.getAttribute('data-permission'), state: mark.getAttribute('data-state'), icons: mark.querySelectorAll('svg').length,
            })),
          }
        })()`)
        const before = await snapshot()
        const legendBefore = await page.getByTestId('access-legend').isVisible()
        release()
        await page.waitForFunction(
          () => (globalThis as { __routerInitialized?: boolean }).__routerInitialized === true,
        )
        await page
          .locator(
            `[data-testid="access-staff"][data-shape="${width === 1920 ? 'matrix' : width === 390 ? 'cards' : 'list'}"]`,
          )
          .waitFor()
        await page.evaluate(
          'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
        )
        const after = await snapshot()
        check(
          `keeps permission facts and layout through hydration at ${width}px`,
          JSON.stringify(before.permissions) === JSON.stringify(after.permissions) &&
            (['x', 'y', 'width', 'height'] as const).every(
              (key) => Math.abs(before.rect[key] - after.rect[key]) < 0.1,
            ) &&
            legendBefore === (width === 1920) &&
            (await staff.getAttribute('data-shape')) ===
              (width === 1920 ? 'matrix' : width === 390 ? 'cards' : 'list') &&
            errors.length === 0,
          { before, after, legendBefore, errors },
        )
      } finally {
        release()
        await page.close()
      }
    }
  } finally {
    await context.close()
  }
}
