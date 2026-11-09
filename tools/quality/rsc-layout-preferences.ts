import assert from 'node:assert/strict'
import type { BrowserContext, Page } from 'playwright'

type Layout = {
  outline: boolean
  rail: number | undefined
  main: number
  side: number
  handle: number | undefined
  control: number | undefined
  hidden: boolean
}

/** Let the inline document script and CSS run, but hold the client runtime. */
async function firstPaint(
  context: BrowserContext,
  url: string,
  ready: (page: Page) => Promise<unknown>,
  expected: { rail?: number; side: number; hidden: boolean },
) {
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (/hydrat(?:ed|ion|ing)|content security policy/i.test(message.text()))
      errors.push(message.text())
  })
  let release!: () => void
  let seen!: () => void
  const delayed = new Promise<void>((resolve) => {
    release = resolve
  })
  const requested = new Promise<void>((resolve) => {
    seen = resolve
  })
  try {
    await page.route(
      (target) => target.pathname.includes('virtual:vite-rsc/entry-browser'),
      async (route) => {
        seen()
        await delayed
        await route.continue()
      },
    )
    await page.addInitScript(`(() => {
      const get = Storage.prototype.getItem
      let reads = 0
      Storage.prototype.getItem = function (key) {
        if (this === localStorage && key === 'qualy.ui') reads++
        return get.call(this, key)
      }
      globalThis.__layoutPrefReads = () => reads
      globalThis.__splitFrame = () => {
        const frame = [...document.querySelectorAll('[data-split]')].find(node => node.checkVisibility() && node.getBoundingClientRect().width > 0)
        if (!frame || getComputedStyle(frame).display !== 'grid') return null
        const [side] = frame.children
        const rail = document.querySelector('[data-testid="workspace-rail"]')
        const handle = frame.querySelector('[data-testid="split-handle"]')
        const control = frame.querySelector('[data-testid="roster-tree-toggle"]')
        return {
          outline: !!frame.closest('[data-testid="roster-pending"]'),
          rail: rail?.getBoundingClientRect().width,
          main: frame.lastElementChild.getBoundingClientRect().left,
          side: side.getBoundingClientRect().width,
          handle: handle?.checkVisibility({ visibilityProperty: true }) ? handle.getBoundingClientRect().left : undefined,
          control: control?.getBoundingClientRect().width,
          hidden: !side.checkVisibility({ visibilityProperty: true }),
        }
      }
      const frames = []
      let running = true
      const read = () => {
        if (!running) return
        const frame = globalThis.__splitFrame()
        if (frame) frames.push(frame)
        requestAnimationFrame(read)
      }
      globalThis.__finishLayoutTrace = () => { running = false; return frames }
      requestAnimationFrame(read)
    })()`)
    await page.goto(url, { waitUntil: 'commit' })
    await Promise.race([
      requested,
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error('The browser entry was not intercepted')),
          15_000,
        )
        timer.unref()
        void requested.then(() => clearTimeout(timer))
      }),
    ])
    const split = page.locator('[data-split]').filter({
      has: page.getByTestId(url.includes('/results') ? 'roster' : 'unit-tree'),
    })
    await split.waitFor()
    const before = await page.evaluate<Layout>('globalThis.__splitFrame()')
    assert.equal(before.rail, expected.rail)
    assert.equal(before.side, expected.side)
    assert.equal(before.hidden, expected.hidden)
    const handle = page.getByTestId('split-handle')
    assert.equal(await handle.getAttribute('aria-valuenow'), null)
    assert.equal(await handle.isVisible(), !expected.hidden)
    assert.equal(await handle.isEnabled(), false)
    if (expected.hidden) {
      const toggle = page.getByTestId('roster-tree-toggle')
      assert.equal(await toggle.getAttribute('aria-expanded'), null)
      assert.equal(await toggle.isEnabled(), false)
      // CSS, not an effect or a focus handler, excludes the hidden content.
      const focusedHidden = await page.evaluate<boolean>(`(() => {
        const side = document.querySelector('[data-split] [data-testid="split-side"]')
        side.querySelector('button')?.focus()
        return side.contains(document.activeElement)
      })()`)
      assert.equal(focusedHidden, false)
    }
    release()
    await ready(page)
    await page.waitForLoadState('networkidle')
    const frames = await page.evaluate<Layout[]>('globalThis.__finishLayoutTrace()')
    assert.ok(frames.length > 1)
    if (url.includes('/results')) assert.ok(frames.some((frame) => frame.outline))
    for (const frame of frames) {
      if (frame.outline) {
        assert.equal(frame.rail, before.rail)
        assert.equal(frame.side, before.side)
        assert.equal(frame.hidden, before.hidden)
        assert.equal(frame.main, before.main)
      } else assert.deepEqual(frame, before)
    }
    assert.equal(await page.evaluate<number>('globalThis.__layoutPrefReads()'), 1)
    assert.deepEqual(errors, [])
  } finally {
    release()
    await page.close()
  }
}

export async function checkLayoutPreferences(page: Page, rosterUrl: string, usersUrl: string) {
  await page.setViewportSize({ width: 1600, height: 1000 })
  const rail = page.getByTestId('workspace-rail')
  const railToggle = rail.getByRole('button', { name: 'Toggle sidebar' })
  const rosterToggle = page.getByTestId('roster-tree-toggle')
  await railToggle.click()
  await page.getByTestId('split-handle').press('ArrowLeft')
  await rosterToggle.click()
  await page.locator('[data-testid="roster-tree-toggle"][aria-expanded="false"]').waitFor()
  await page.goto(usersUrl, { waitUntil: 'networkidle' })
  await page.getByTestId('split-handle').press('ArrowRight')
  await page.locator('[data-testid="split-handle"][aria-valuenow="316"]').waitFor()
  assert.equal(
    (await page.context().cookies()).some(({ name }) => name.startsWith('qualy-layout-')),
    false,
  )

  const context = await page
    .context()
    .browser()!
    .newContext({
      locale: 'en-US',
      viewport: { width: 1600, height: 1000 },
      storageState: await page.context().storageState(),
    })
  try {
    await firstPaint(
      context,
      rosterUrl,
      (next) => next.locator('[data-testid="roster-tree-toggle"][aria-expanded="false"]').waitFor(),
      { rail: 52, side: 0, hidden: true },
    )
    const open = await context.newPage()
    await open.goto(rosterUrl)
    await open.getByTestId('roster-tree-toggle').click()
    await open.locator('[data-testid="roster-tree-toggle"][aria-expanded="true"]').waitFor()
    await open.close()
    await firstPaint(
      context,
      rosterUrl,
      (next) => next.locator('[data-testid="split-handle"][aria-valuenow="296"]').waitFor(),
      { rail: 52, side: 296, hidden: false },
    )
    await firstPaint(
      context,
      usersUrl,
      (next) => next.locator('[data-testid="split-handle"][aria-valuenow="316"]').waitFor(),
      { side: 316, hidden: false },
    )
    console.log('layout preferences: one read, first paint and delayed hydration passed')
  } finally {
    await context.close()
  }
}
