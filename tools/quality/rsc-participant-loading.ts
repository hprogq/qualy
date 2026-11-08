import fs from 'node:fs/promises'
import path from 'node:path'
import type { Browser, BrowserContext } from 'playwright'
import { repoRoot } from '../lib/manifest.ts'

/** Slow account reads must stream the account's room, not the workspace rail. */
export async function acceptParticipantLoading({
  browser,
  context,
  site,
  address,
  check,
}: {
  browser: Browser
  context: BrowserContext
  site: string
  address: string
  check: (name: string, ok: boolean, detail?: unknown) => void
}) {
  let unhydrated: BrowserContext | undefined
  try {
    await context.addCookies([{ name: 'acceptance_fault', value: 'participant-slow', url: site }])
    const cookies = (await context.cookies())
      .map(({ name, value }) => `${name}=${value}`)
      .join('; ')
    const response = await fetch(`${site}${address}`, {
      headers: { cookie: cookies },
      signal: AbortSignal.timeout(15_000),
    })
    const reader = response.body!.getReader()
    let first = ''
    const decoder = new TextDecoder()
    try {
      while (!first.includes('data-testid="participant-pending"')) {
        const part = await reader.read()
        if (part.done) break
        first += decoder.decode(part.value, { stream: true })
      }
      check(
        'streams the participant layout and waiting body as real HTML',
        response.ok &&
          /<div\b[^>]*data-testid="participant-pending"/.test(first) &&
          /<div\b[^>]*data-screen-aside=""/.test(first),
      )
    } finally {
      await reader.cancel()
    }

    unhydrated = await browser.newContext({
      storageState: await context.storageState(),
      javaScriptEnabled: false,
      viewport: { width: 1440, height: 900 },
    })
    const page = await unhydrated.newPage()
    await page.goto(`${site}${address}`)
    check(
      'keeps the participant column and workspace outline visible before hydration',
      (await page.getByTestId('participant-column').first().isVisible()) &&
        (await page.getByTestId('participant-pending').isVisible()),
    )
    check(
      'hides the batch navigation rail before hydration on a participant detail',
      !(await page.getByTestId('workspace-rail').isVisible()),
    )
    const directory = path.join(repoRoot, 'node_modules/.cache/rsc-participant-preview')
    await fs.mkdir(directory, { recursive: true })
    await page.screenshot({
      path: path.join(directory, 'before-hydration.png'),
      animations: 'disabled',
    })
    await page.setViewportSize({ width: 390, height: 844 })
    check(
      'draws the participant header above the pending work on a narrow unhydrated page',
      (await page.getByTestId('participant-pending').getByTestId('participant-head').isVisible()) &&
        !(await page.getByTestId('participant-column').first().isVisible()),
    )
    await unhydrated.close()
    unhydrated = undefined

    await context.addCookies([{ name: 'acceptance_fault', value: 'roster-slow', url: site }])
    const roster = new URL(address, site).pathname
    const slow = await fetch(`${site}${roster}`, {
      headers: {
        cookie: (await context.cookies()).map(({ name, value }) => `${name}=${value}`).join('; '),
      },
      signal: AbortSignal.timeout(15_000),
    })
    const listReader = slow.body!.getReader()
    let outline = ''
    try {
      while (!outline.includes('data-testid="roster-pending"')) {
        const part = await listReader.read()
        if (part.done) break
        outline += decoder.decode(part.value, { stream: true })
      }
      check(
        'streams a roster heading and row skeleton instead of a centered spinner',
        slow.ok &&
          outline.includes('data-testid="roster-pending"') &&
          outline.includes('data-testid="roster-skeleton"'),
      )
    } finally {
      await listReader.cancel()
    }
    unhydrated = await browser.newContext({
      storageState: await context.storageState(),
      javaScriptEnabled: false,
    })
    const listPage = await unhydrated.newPage()
    await listPage.goto(`${site}${roster}`)
    check(
      'keeps the slow roster outline visible without hydration',
      await listPage.getByTestId('roster-pending').isVisible(),
    )
    await listPage.screenshot({
      path: path.join(directory, 'roster-before-hydration.png'),
      animations: 'disabled',
    })
    await unhydrated.close()
    unhydrated = undefined
    await context.addCookies([{ name: 'acceptance_fault', value: 'scores-slow', url: site }])
    const totals = await context.newPage()
    await totals.emulateMedia({ reducedMotion: 'no-preference' })
    await totals.addInitScript(`(() => {
      globalThis.__scorePaints = []
      const ids = new WeakMap()
      let serial = 0
      const sample = () => {
        const row = document.querySelector('[data-testid="participant-row"]')
        if (row && row.getBoundingClientRect().width > 0) {
          if (!ids.has(row)) ids.set(row, ++serial)
          const rect = row.getBoundingClientRect()
          let steady = true
          for (let parent = row; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent)
            if (css.opacity !== '1' || css.transform !== 'none') steady = false
          }
          globalThis.__scorePaints.push({ id: ids.get(row), x: rect.x, width: rect.width, steady, state: row.querySelector('[data-testid="participant-score"]')?.getAttribute('data-score-state') })
        }
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })()`)
    const errors: string[] = []
    totals.on('pageerror', (error) => errors.push(error.message))
    totals.on('console', (message) => {
      if (/hydration|hydrated/i.test(message.text())) errors.push(message.text())
    })
    await totals.goto(`${site}${roster}`)
    await totals
      .locator('[data-testid="participant-score"][data-score-state="scored"]')
      .first()
      .waitFor()
    await totals.evaluate(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    )
    const samples = await totals.evaluate(
      () =>
        (
          globalThis as unknown as {
            __scorePaints: {
              id: number
              x: number
              width: number
              steady: boolean
              state: string
            }[]
          }
        ).__scorePaints,
    )
    const firstRow = samples[0]
    check(
      'keeps streamed roster rows in place when current totals arrive with motion enabled',
      firstRow !== undefined &&
        samples.some((sample) => sample.state === 'pending') &&
        samples.some((sample) => sample.state === 'scored') &&
        samples.every(
          (sample) =>
            sample.id === firstRow.id &&
            sample.steady &&
            Math.abs(sample.x - firstRow.x) < 0.1 &&
            Math.abs(sample.width - firstRow.width) < 0.1,
        ) &&
        errors.length === 0,
      {
        first: firstRow,
        last: samples.at(-1),
        states: [...new Set(samples.map((sample) => sample.state))],
        errors,
      },
    )
    await totals.close()
  } finally {
    await unhydrated?.close()
    await context.close()
  }
}
