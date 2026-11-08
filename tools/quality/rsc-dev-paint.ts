import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { BrowserContext } from 'playwright'
import { repoRoot } from '../lib/manifest.ts'

type Paint = { nodes: { id: number; x: number; width: number; ancestry: unknown[] }[] }

/** Sample visible server content through a cold dev hydration, not only its final frame. */
export async function traceDevelopmentPaint(context: BrowserContext, href: string, name: string) {
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (/hydration|hydrated|multiple renderers|one blocker/i.test(message.text()))
      errors.push(message.text())
  })
  try {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.addInitScript(`(() => {
      globalThis.__paint = []
      let frame = 0
      const ids = new WeakMap()
      let serial = 0
      const sample = () => {
        const nodes = [...document.querySelectorAll('[data-slot="page-container"], [data-testid="roster"], [data-testid="participant-row"], [data-testid="result-empty"], [data-testid="result-ledger"] > :first-child')]
        globalThis.__paint.push({ at: performance.now(), nodes: nodes.filter(node => node.getBoundingClientRect().width > 0).slice(0, 8).map(node => {
          if (!ids.has(node)) ids.set(node, ++serial)
          const r = node.getBoundingClientRect()
          const ancestry = []
          for (let parent = node; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent)
            if (css.opacity !== '1' || css.transform !== 'none') ancestry.push({ opacity: css.opacity, transform: css.transform })
          }
          return { id: ids.get(node), x: r.x, width: r.width, ancestry }
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
    console.log(`${name}: first-paint layout and hydration passed`)
  } finally {
    await page.close()
  }
}
