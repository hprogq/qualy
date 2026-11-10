import type { BrowserContext, Page } from 'playwright'

export async function acceptItemEditor({
  context,
  site,
  batchId,
  hydrated,
  check,
}: {
  context: BrowserContext
  site: string
  batchId: string
  hydrated: (page: Page) => Promise<unknown>
  check: (name: string, ok: boolean, detail?: unknown) => void
}) {
  const write = async (method: string, path: string, data: unknown) => {
    const response = await context.request.fetch(site + '/api' + path, { method, data })
    if (!response.ok())
      throw new Error(`editor fixture refused ${response.status()}: ${await response.text()}`)
    return response.json()
  }
  const groups = (await write('PUT', `/assessment/batches/${batchId}/score-groups`, {
    expectedVersion: 1,
    groups: [{ name: 'Editor group', parentGroupId: null, cap: '10.00', floor: null }],
  })) as { groups: { id: string }[] }
  const offered = await context.request.get(
    `${site}/api/assessment/batches/${batchId}/item-options`,
  )
  const options = (await offered.json()) as { orgTypes: { id: string }[]; roles: { id: string }[] }
  const stage = {
    id: 'review',
    selector: {
      kind: 'roleAt',
      nodeTypeId: options.orgTypes[0]!.id,
      roleIds: [options.roles[0]!.id],
    },
    quorum: { type: 'any' },
  }
  const title = 'RSC editor first paint'
  const { item } = (await write('POST', `/assessment/batches/${batchId}/items`, {
    itemType: 'evidence',
    title,
    scoreGroupId: groups.groups[0]!.id,
    maxEntries: 1,
    config: {
      entryChannels: ['participant'],
      formConfig: { fields: [] },
      scoringConfig: {
        version: 2,
        calculator: { ref: 'fixed@1', config: { value: '3.00' } },
        aggregator: { ref: 'sum@1', config: {} },
        recognitions: {},
        bindings: {},
      },
      reviewPolicy: { normal: { stages: [stage] }, escalation: { stages: [] } },
    },
  })) as { item: { id: string } }
  for (const width of [1440, 1024, 390]) {
    const page = await context.newPage()
    await page.setViewportSize({ width, height: 900 })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    const geometry = () =>
      page.evaluate<{
        heading: string | null
        band: number[]
        tabs: number[]
        panel: number[]
        pending: string | null
        method: string | null
      }>(String.raw`(() => {
      const band = document.querySelector('[data-testid="item-band"]')
      const tabs = [...document.querySelectorAll('[data-testid="item-tabs"]')].find((node) => node.checkVisibility())
      const panel = document.querySelector('[data-testid="item-editor-panel"]')
      const rect = (element) => { const box = element.getBoundingClientRect(); return [box.x, box.y, box.width, box.height] }
      return { heading: band.textContent, band: rect(band), tabs: rect(tabs), panel: rect(panel),
        pending: document.querySelector('[data-testid="pending-trigger"]')?.textContent ?? null,
        method: document.querySelector('[data-testid="calculator-summary"]')?.textContent ?? null,
      }
    })()`)

    try {
      await page.route('**/assets/*.js', async (route) => {
        await held
        await route.continue()
      })
      await page.goto(
        `${site}/assessment/batches/${batchId}/items?question=${item.id}&panel=scoring`,
        { waitUntil: 'commit' },
      )
      await page.getByTestId('item-band').waitFor({ state: 'visible' })
      await page.getByTestId('item-editor-panel').waitFor({ state: 'visible' })
      const before = await geometry()
      release()
      await hydrated(page)
      await page.waitForTimeout(250)
      const after = await geometry()
      const delta = Math.max(
        ...(['band', 'tabs', 'panel'] as const).flatMap((part) =>
          before[part].map((value, i) => Math.abs(value - after[part][i]!)),
        ),
      )
      check(
        `keeps editor title, navigation and problem summary through hydration (${width}px)`,
        before.heading?.includes(title) === true &&
          after.heading?.includes(title) === true &&
          before.pending === after.pending &&
          before.method === after.method &&
          delta <= 1 &&
          errors.length === 0,
        { before, after, delta, errors },
      )
    } finally {
      release()
      await page.close()
    }
  }
  await context.close()
}
