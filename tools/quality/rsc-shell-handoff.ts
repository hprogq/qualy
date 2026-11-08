import type { BrowserContext } from 'playwright'

/** A POP across layouts must keep the outgoing chrome intact until replacement. */
export async function acceptShellHandoff({
  context,
  site,
  check,
}: {
  context: BrowserContext
  site: string
  check: (name: string, ok: boolean, detail?: unknown) => void
}) {
  const page = await context.newPage()
  try {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(`${site}/account/batches`, { waitUntil: 'networkidle' })
    await page.getByTestId('person-batch').first().click()
    await page.getByTestId('batch-context-bar').waitFor()
    await page.route('**/account/batches.rsc*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 300))
      await route.continue()
    })
    await page.evaluate(`(() => {
      globalThis.__handoff = { done: false, frames: [] }
      const sample = () => {
        const rail = document.querySelector('[data-testid="workspace-rail"]')
        const bar = document.querySelector('[data-testid="batch-context-bar"]')
        globalThis.__handoff.frames.push({
          workspace: rail?.checkVisibility() === true,
          bar: bar?.checkVisibility() === true,
          back: bar?.querySelector('a')?.textContent?.trim(),
          bones: document.querySelector('[data-testid="head-bones"]')?.checkVisibility() === true,
        })
        if (!globalThis.__handoff.done) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })()`)
    await page.goBack()
    await page.getByTestId('person-batches').waitFor()
    const frames = await page.evaluate<
      { workspace: boolean; bar: boolean; back?: string; bones: boolean }[]
    >(`(() => {
      globalThis.__handoff.done = true
      return globalThis.__handoff.frames
    })()`)
    const outgoing = frames.filter((frame) => frame.workspace)
    check(
      'preserves the outgoing batch chrome through account history navigation',
      outgoing.length > 0 && outgoing.every((frame) => frame.bar && !!frame.back && !frame.bones),
      frames,
    )
  } finally {
    await page.close()
    await context.close()
  }
}
