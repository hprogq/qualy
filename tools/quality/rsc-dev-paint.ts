import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BrowserContext } from 'playwright'
import { repoRoot } from '../lib/manifest.ts'

type Paint = {
  scheme: string | undefined
  widgetScheme: string | undefined
  heading?: { width: number; font: string } | undefined
  nodes: { id: number; x: number; width: number; test?: string; ancestry: unknown[] }[]
}

/** Sample visible server content through a cold dev hydration, not only its final frame. */
export async function traceDevelopmentPaint(
  context: BrowserContext,
  href: string,
  name: string,
  expectedScheme: 'light' | 'dark',
) {
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (
      /hydration|hydrated|multiple renderers|one blocker|preloaded using link preload/i.test(
        message.text(),
      )
    )
      errors.push(message.text())
  })
  try {
    if (name === 'cold-roster')
      await page.route('**/ParticipantResultsPage.tsx*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1800))
        await route.continue()
      })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.addInitScript(`(() => {
      globalThis.__paint = []
      let frame = 0
      const ids = new WeakMap()
      let serial = 0
      const sample = () => {
        const heading = document.querySelector('[data-slot="page-container"] h1')
        const nodes = [...document.querySelectorAll('[data-slot="page-container"], [data-testid="person-batches"], [data-testid="roster"], [data-testid="participant-row"], [data-testid="result-empty"], [data-testid="result-ledger"] > :first-child')]
        globalThis.__paint.push({ at: performance.now(), heading: heading?.checkVisibility() ? { width: heading.getBoundingClientRect().width, font: getComputedStyle(heading).font } : undefined, scheme: document.documentElement.dataset.mode, widgetScheme: document.documentElement.dataset.mantineColorScheme, nodes: nodes.filter(node => node.getBoundingClientRect().width > 0 && node.checkVisibility()).slice(0, 8).map(node => {
          if (!ids.has(node)) ids.set(node, ++serial)
          const r = node.getBoundingClientRect()
          const ancestry = []
          for (let parent = node; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent)
            if (css.opacity !== '1' || css.transform !== 'none') ancestry.push({ opacity: css.opacity, transform: css.transform })
          }
          return { id: ids.get(node), x: r.x, width: r.width, test: node.dataset.testid, ancestry }
        }) })
        if (++frame < 1200) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })()`)
    await page.goto(href, { waitUntil: 'networkidle', timeout: 90_000 })
    const samples = await page.evaluate(
      () => (globalThis as unknown as { __paint: Paint[] }).__paint,
    )
    const directory = path.join(repoRoot, 'node_modules/.cache/rsc-first-paint')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, `${name}.json`), JSON.stringify(samples))
    assert.deepEqual(errors, [], `${name}: no hydration failures`)
    assert.equal(
      (await page.locator('style').allTextContents()).some((text) => text.includes('@font-face')),
      false,
      `${name}: font declarations remain in external CSS`,
    )
    let rosterWasVisible = false
    const scheme = samples.find((frame) => frame.scheme !== undefined)?.scheme
    assert.equal(scheme, expectedScheme, `${name}: the first theme matches the reader's preference`)
    for (const frame of samples) {
      if (frame.scheme !== undefined) {
        assert.equal(frame.scheme, scheme, `${name}: document theme changed during hydration`)
        assert.equal(
          frame.widgetScheme,
          scheme,
          `${name}: widget theme disagrees with the document`,
        )
      }
      const visible = frame.nodes.some((node) => node.test === 'participant-row')
      if (rosterWasVisible)
        assert.ok(visible, `${name}: visible roster disappeared during hydration`)
      if (visible) rosterWasVisible = true
    }
    const first = new Map<number, Paint['nodes'][number]>()
    for (const { nodes } of samples)
      for (const node of nodes) {
        const before = first.get(node.id)
        if (!before) first.set(node.id, node)
        else
          assert.ok(
            Math.abs(node.x - before.x) <= 0.1 && Math.abs(node.width - before.width) <= 0.1,
            `${name}: content moved after becoming visible: ${JSON.stringify({ before, node })}`,
          )
        assert.deepEqual(
          node.ancestry,
          [],
          `${name}: no replayed entrance over visible server content`,
        )
      }
    assert.ok(first.size > 0, `${name}: actual content was sampled`)
    if (name === 'cold-roster')
      assert.equal(
        new Set(
          samples.flatMap((frame) =>
            frame.nodes.filter((node) => node.test === 'roster').map((node) => node.id),
          ),
        ).size,
        1,
        'The visible server roster is hydrated in place',
      )
    if (name === 'warm-settings') {
      const headings = samples.flatMap((frame) =>
        frame.heading === undefined ? [] : [frame.heading],
      )
      assert.ok(headings.length > 0, 'A real heading was sampled on the cached visit')
      for (const heading of headings)
        assert.deepEqual(
          heading,
          headings[0],
          'Cached document typography remains stable through hydration',
        )
    }
    console.log(`${name}: first-paint layout and hydration passed`)
  } finally {
    await page.close()
  }
}
