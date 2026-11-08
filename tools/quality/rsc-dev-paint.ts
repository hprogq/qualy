import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserContext } from 'playwright'
import { repoRoot } from '../lib/manifest.ts'

type Paint = {
  at: number
  scheme: string | undefined
  widgetScheme: string | undefined
  heading?: { width: number; font: string } | undefined
  nodes: {
    id: number
    x: number
    width: number
    visible: boolean
    test?: string
    display: string
    direction: string
    maxWidth: string
    grid: string
    ancestry: unknown[]
  }[]
}

/** Sample visible server content through a cold dev hydration, not only its final frame. */
export async function traceDevelopmentPaint(
  context: BrowserContext,
  href: string,
  name: string,
  expectedScheme: 'light' | 'dark',
  options: { expectLedger?: boolean; stylexUpdateDelayMs?: number } = {},
) {
  const page = await context.newPage()
  const artifactName = options.stylexUpdateDelayMs
    ? `${name}-stylex-delay-${String(options.stylexUpdateDelayMs)}`
    : name
  const directory = path.join(repoRoot, 'node_modules/.cache/rsc-first-paint')
  const errors: string[] = []
  const network: unknown[] = []
  const stylesheets: Promise<unknown>[] = []
  page.on('requestfailed', (request) => {
    network.push({ kind: 'failed', url: request.url(), at: Date.now(), error: request.failure() })
  })
  page.on('response', (response) => {
    if (
      response.headers()['content-type']?.includes('text/css') ||
      new URL(response.url()).pathname === '/virtual:stylex.css'
    )
      stylesheets.push(
        response.text().then(
          (css) => ({
            url: response.url(),
            at: response.request().timing().startTime,
            timing: response.request().timing(),
            finishedAt: Date.now(),
            status: response.status(),
            contentType: response.headers()['content-type'],
            cacheControl: response.headers()['cache-control'],
            fromServiceWorker: response.fromServiceWorker(),
            bytes: Buffer.byteLength(css),
            sha256: createHash('sha256').update(css).digest('hex'),
            css,
          }),
          (error) => ({ url: response.url(), error: String(error) }),
        ),
      )
  })
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
    if (options.stylexUpdateDelayMs) {
      await page.route('**/virtual:stylex.css?*', async (route) => {
        // Freeze the original response before delaying delivery. Waiting
        // before fetching would instead allow the server's rule pool to grow.
        const response = await route.fetch()
        network.push({ kind: 'css-delay-start', url: route.request().url(), at: Date.now() })
        await delay(options.stylexUpdateDelayMs)
        await route.fulfill({ response })
        network.push({ kind: 'css-delay-end', url: route.request().url(), at: Date.now() })
      })
    }
    if (name === 'cold-roster')
      await page.route('**/ParticipantResultsPage.tsx*', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1800))
        await route.continue()
      })
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.addInitScript(`(() => {
      globalThis.__paint = []
      globalThis.__paintDiagnostics = []
      globalThis.__paintTimeOrigin = performance.timeOrigin
      globalThis.__paintStopped = false
      let frame = 0
      const ids = new WeakMap()
      let serial = 0
      const identify = node => {
        if (!ids.has(node)) ids.set(node, ++serial)
        return ids.get(node)
      }
      const describe = node => ({
        id: identify(node), tag: node.tagName, domId: node.id,
        href: node.href, rel: node.rel, disabled: node.disabled,
        precedence: node.dataset?.precedence, viteId: node.dataset?.viteDevId,
        chars: node.tagName === 'STYLE' ? node.textContent.length : undefined,
      })
      const record = (kind, detail) => globalThis.__paintDiagnostics.push({ at: performance.now(), kind, detail })
      const cssNodes = node => {
        if (node.nodeType !== 1) return []
        return [...(node.matches('style,link[rel="stylesheet"]') ? [node] : []), ...node.querySelectorAll('style,link[rel="stylesheet"]')]
      }
      new MutationObserver(records => {
        for (const mutation of records) {
          const owner = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement
          if (owner?.matches('style,link[rel="stylesheet"]')) record('css-mutation', { type: mutation.type, attribute: mutation.attributeName, node: describe(owner) })
          for (const node of mutation.addedNodes) for (const css of cssNodes(node)) record('css-added', describe(css))
          for (const node of mutation.removedNodes) for (const css of cssNodes(node)) record('css-removed', describe(css))
        }
      }).observe(document, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['href', 'rel', 'disabled', 'media'] })
      for (const event of ['load', 'error']) document.addEventListener(event, e => {
        if (e.target?.matches?.('link[rel="stylesheet"]')) record('css-' + event, describe(e.target))
      }, true)
      let previousSheets = ''
      const sample = () => {
        const sheets = [...document.styleSheets].map(sheet => {
          let rules, error
          try { rules = sheet.cssRules.length } catch (e) { error = e.name }
          return { owner: sheet.ownerNode ? describe(sheet.ownerNode) : null, href: sheet.href, disabled: sheet.disabled, media: sheet.media.mediaText, rules, error }
        })
        const signature = JSON.stringify(sheets)
        if (signature !== previousSheets) { record('sheets', sheets); previousSheets = signature }
        const heading = document.querySelector('[data-slot="page-container"] h1')
        const nodes = [...document.querySelectorAll('[data-slot="page-container"], [data-testid="person-batches"], [data-testid="roster"], [data-testid="participant-row"], [data-testid="result-empty"], [data-testid="result-ledger"], [data-testid="result-ledger"] > div, [data-testid="result-outline"], [data-testid="result-strip"], [data-testid="ledger-group"], [data-testid="ledger-item"]')]
        globalThis.__paint.push({ at: performance.now(), readyState: document.readyState, fonts: document.fonts.status, heading: heading?.checkVisibility() ? { width: heading.getBoundingClientRect().width, font: getComputedStyle(heading).font } : undefined, scheme: document.documentElement.dataset.mode, widgetScheme: document.documentElement.dataset.mantineColorScheme, nodes: nodes.slice(0, 32).map(node => {
          const r = node.getBoundingClientRect()
          const ancestry = []
          for (let parent = node; parent; parent = parent.parentElement) {
            const css = getComputedStyle(parent)
            if (css.opacity !== '1' || css.transform !== 'none') ancestry.push({ opacity: css.opacity, transform: css.transform })
          }
          const css = getComputedStyle(node)
          return { id: identify(node), x: r.x, y: r.y, width: r.width, height: r.height, visible: r.width > 0 && node.checkVisibility(), test: node.dataset.testid, group: node.dataset.group, layout: node.dataset.layout, classes: node.className, display: css.display, direction: css.flexDirection, maxWidth: css.maxWidth, grid: css.gridTemplateColumns, container: css.containerType, padding: css.padding, font: css.font, ancestry }
        }) })
        if (++frame < 1200 && !globalThis.__paintStopped) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    })()`)
    const documentResponse = await page.goto(href, { waitUntil: 'networkidle', timeout: 90_000 })
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(
      path.join(directory, `${artifactName}-server.html`),
      await documentResponse!.text(),
    )
    if (options.expectLedger) {
      assert.equal(
        await page.getByTestId('result-empty').count(),
        0,
        'The ledger fixture is not empty',
      )
      assert.equal(await page.getByTestId('ledger-group').count(), 2, 'Both scored groups render')
      assert.equal(await page.getByTestId('ledger-item').count(), 2, 'Both scored questions render')
      assert.ok(
        await page.getByTestId('result-outline').isVisible(),
        'The wide ledger has an outline',
      )
    }
    const samples = await page.evaluate(
      () => (globalThis as unknown as { __paint: Paint[] }).__paint,
    )
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
      const visible = frame.nodes.some((node) => node.test === 'participant-row' && node.visible)
      if (rosterWasVisible)
        assert.ok(visible, `${name}: visible roster disappeared during hydration`)
      if (visible) rosterWasVisible = true
    }
    const first = new Map<number, Paint['nodes'][number]>()
    for (const { nodes } of samples)
      for (const node of nodes) {
        if (!node.visible) continue
        const before = first.get(node.id)
        if (!before) first.set(node.id, node)
        else
          assert.ok(
            Math.abs(node.x - before.x) <= 0.1 && Math.abs(node.width - before.width) <= 0.1,
            `${name}: content moved after becoming visible: ${JSON.stringify({ before, node })}`,
          )
        if (before)
          assert.deepEqual(
            [node.display, node.direction, node.maxWidth, node.grid],
            [before.display, before.direction, before.maxWidth, before.grid],
            `${name}: visible content changed its layout rules: ${JSON.stringify({ before, node })}`,
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
    console.log(`${artifactName}: first-paint layout and hydration passed`)
  } catch (error) {
    await fs.mkdir(directory, { recursive: true })
    await page
      .screenshot({ path: path.join(directory, `${artifactName}-failure.png`) })
      .catch(() => {})
    throw error
  } finally {
    try {
      const captured: unknown = await page
        .evaluate(`(() => {
        globalThis.__paintStopped = true
        return { timeOrigin: globalThis.__paintTimeOrigin, frames: globalThis.__paint, events: globalThis.__paintDiagnostics, resources: performance.getEntriesByType('resource').map(entry => entry.toJSON()) }
      })()`)
        .catch((error: unknown) => ({ error: String(error) }))
      await fs.mkdir(directory, { recursive: true })
      await fs.writeFile(
        path.join(directory, `${artifactName}.json`),
        JSON.stringify((captured as { frames?: unknown }).frames ?? []),
      )
      await fs.writeFile(
        path.join(directory, `${artifactName}-diagnostics.json`),
        JSON.stringify({ captured, network, errors, options }),
      )
      await fs.writeFile(
        path.join(directory, `${artifactName}-styles.json`),
        JSON.stringify(await Promise.all(stylesheets)),
      )
      await fs.writeFile(path.join(directory, `${artifactName}-client.html`), await page.content())
    } finally {
      await page.close()
    }
  }
}
