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
  } finally {
    await unhydrated?.close()
    await context.close()
  }
}
