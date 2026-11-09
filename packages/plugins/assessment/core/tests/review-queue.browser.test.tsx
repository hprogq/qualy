import { reviewClient } from './support/review-client.tsx'
import ReviewInboxPage from '../src/client/review/ReviewInboxPage.tsx'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
import { lazy } from 'react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commands, page } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, emptyManifest, renderScreen } from './support/screen.tsx'

// The review queue in the room the product actually gives it.
//
// The shell stands a rail of the batch's sections beside every page of it,
// a quarter of a laptop's window. Laid out by the window, the queue put its
// list and a question's table side by side in room for one of them - the
// answers squeezed to nothing and each column's name one character a line -
// and a suite that rendered the queue on its own never saw it. So these
// render it inside the shell, rail open, at the widths people use.

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ITEM = '66666666-6666-4666-8666-666666666666'

/** what the runner gives every other suite, so this one hands it back */
const DEFAULT_VIEWPORT = { width: 414, height: 896 }

const PAGES = [
  { id: 'assessment/batch-reviews', path: '/assessment/batches/:batchId/reviews' },
  { id: 'assessment/review-instance', path: '/assessment/batches/:batchId/reviews/:instanceId' },
].map((entry) => ({ ...entry, layout: 'admin' }))

const text = (value: string) => value
const rail = [
  {
    id: 'assessment/batch-reviews/rail',
    label: text('审核工作'),
    target: {
      kind: 'page',
      pageId: 'assessment/batch-reviews',
      path: '/assessment/batches/:batchId/reviews',
    },
    order: 10,
  },
]

const batch = {
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: false,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: {
    personal: false,
    review: true,
    record: false,
    manage: false,
    redetermine: false,
    readAll: false,
  },
  participantCount: 120,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 1,
  currentPhaseId: null,
  currentPhaseName: '材料审核',
  createdAt: '2026-02-01T00:00:00.000Z',
}

const LONG_NAME = '阿卜杜热合曼·买买提艾力'
const rowId = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`

/** one filing on the competition question, its answers as long as a real one's */
const filing = (n: number, over: Record<string, unknown> = {}) => ({
  instanceId: rowId(n),
  entryId: `bbbbbbbb-bbbb-4bbb-8bbb-${String(n).padStart(12, '0')}`,
  batchId: BATCH_ID,
  batchName: '2026 春季综测',
  itemId: ITEM_ID,
  itemTitle: '学科竞赛获奖',
  participantName: n === 0 ? LONG_NAME : `参评人${String(n)}`,
  businessNo: `20230${String(11000 + n).padStart(5, '0')}`,
  unitId: null,
  unitName: '软件工程2023级1班',
  roundNo: n === 3 ? 2 : 1,
  route: n === 4 ? ('escalation' as const) : ('normal' as const),
  values: [
    { label: '竞赛名称', value: '第十六届全国大学生数学竞赛（非数学类）', files: null },
    { label: '获奖等级', value: '国家级一等奖', files: null },
    { label: '获奖时间', value: '2025-11-12', files: null },
    { label: '获奖证书', value: '', files: 1 },
  ],
  attachmentCount: 1,
  submittedAt: new Date(Date.UTC(2026, 2, 3, 0, n)).toISOString(),
  ...over,
})

/** one on the volunteering question, which has other fields */
const volunteering = (n: number) =>
  filing(n, {
    itemId: OTHER_ITEM,
    itemTitle: '志愿服务时长认定',
    values: [
      { label: '服务组织', value: '南京市青年志愿者协会', files: null },
      { label: '服务时长', value: '24', files: null },
    ],
  })

/** two questions, the first with more than a page */
const both = () => [
  ...Array.from({ length: 12 }, (_, n) => filing(n)),
  ...Array.from({ length: 3 }, (_, n) => volunteering(40 + n)),
]

/** the rail's count beside the entry it belongs to, as the product mounts it */
const badges = {
  manifest: {
    'workspace-shell/navigation-badge': [{ id: 'assessment/reviews-waiting', order: 0 }],
  },
  registry: {
    slots: {
      'workspace-shell/navigation-badge': {
        'assessment/reviews-waiting': lazy(() => import('../src/client/review/QueueBadge.tsx')),
      },
    },
  },
}

const shelled = (
  items: readonly Record<string, unknown>[],
  search = '',
  overrides: Record<string, unknown> = {},
) =>
  renderScreen({
    client: reviewClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: PAGES,
            collections: {
              'app-shell/navigation-groups': [],
              'app-shell/navigation-primary': [],
              'workspace-shell/navigation': rail,
            },
            slots: badges.manifest,
          }),
      },
      assessment: {
        getBatch: () => Effect.succeed({ batch }),
        listReviewInbox: () =>
          Effect.succeed({ items, nextCursor: null, handledToday: 2, judging: true }),
        listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
        getMyOverview: () =>
          Effect.succeed({
            participant: null,
            reviewer: {
              pendingCount: items.length,
              answeredAskCount: 0,
              queueGroups: [],
              answeredAsks: [],
            },
          }),
        ...overrides,
      },
    }),
    registry: badges.registry,
    route: `/assessment/batches/${BATCH_ID}/reviews${search}`,
    children: (
      <Routes>
        <Route element={<WorkspaceShell />}>
          <Route path="/assessment/batches/:batchId/reviews" element={<ReviewInboxPage />} />
        </Route>
      </Routes>
    ),
  })

const layout = () => page.getByTestId('queue-layout')
const rows = () => page.getByTestId('inbox-row')

const index = () => page.getByTestId('queue-index-row')
const groups = () => page.getByTestId('queue-group')

afterEach(() => page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height))

describe('the queue in brief', () => {
  it('keeps the queue tabs inside the full-width band when switching to awaiting material', async () => {
    await page.viewport(1440, 900)
    await shelled(both())
    const band = page.getByTestId('batch-band')
    const waiting = band.getByRole('tab', { name: '待补材料' })
    await expect.element(waiting).toBeVisible()
    await expect.element(rows().first()).toBeVisible()
    // The band measures its text once its real font is ready. Do not compare
    // the loading frame against the settled band after the click.
    await document.fonts.ready
    const frame = band.element()
    const tabs = frame.querySelector('[role="tablist"]')!
    const grouping = page
      .getByRole('tab', { name: '按项目' })
      .element()
      .closest('[role="tablist"]')!
    const bounds = frame.getBoundingClientRect()
    expect(bounds.width).toBeCloseTo(frame.closest('main')!.clientWidth, 0)
    expect(tabs.getBoundingClientRect().bottom).toBeCloseTo(bounds.bottom - 1, 0)
    expect(tabs.getBoundingClientRect().left).toBeCloseTo(grouping.getBoundingClientRect().left, 0)
    await waiting.click()
    const empty = page.getByTestId('review-inbox-empty')
    await expect.element(empty).toHaveAttribute('data-empty', 'no-asks')
    await expect
      .element(empty.getByText('发出补充材料请求后，可在这里查看补充进度。'))
      .toBeVisible()
    const after = frame.getBoundingClientRect()
    expect({ top: after.top, height: after.height }).toEqual({
      top: bounds.top,
      height: bounds.height,
    })
  })

  // Nothing picked, every project shows its oldest few and a way to all of
  // them; the index beside it says how much each one holds.
  it('lays every project out in brief beside an index of them', async () => {
    await page.viewport(1440, 900)
    await shelled(both())
    await expect.element(layout()).toHaveAttribute('data-layout', 'overview')
    await expect.element(page.getByTestId('queue-index')).toBeVisible()
    await expect.element(page.getByTestId('queue-scope')).not.toBeVisible()
    expect(
      index()
        .elements()
        .map((row) => row.getAttribute('data-count')),
    ).toEqual(['15', '12', '3'])
    expect(
      groups()
        .elements()
        .map((group) => group.getAttribute('data-key')),
    ).toEqual([ITEM_ID, OTHER_ITEM])
    expect(rows().elements()).toHaveLength(6)
    // the way to all of a project shown in part, and none where all of it shows
    expect(page.getByTestId('queue-group-more').elements()).toHaveLength(1)
  })

  it.each([390, 1024, 1440])(
    'waits for the selected grouping at %ipx without reusing old groups',
    async (width) => {
      await page.viewport(width, 900)
      const items = [filing(1), { ...volunteering(40), submittedAt: '2026-03-04T02:00:00.000Z' }]
      const reply = { items, handledToday: 2, judging: true }
      let showTime!: () => void
      let showPerson!: () => void
      const byTime = new Promise<typeof reply>((resolve) => {
        showTime = () => resolve(reply)
      })
      const byPerson = new Promise<typeof reply>((resolve) => {
        showPerson = () => resolve(reply)
      })
      const list = ({ query }: { query: { view?: string } }) => {
        if (query.view === 'time') return Effect.promise(() => byTime)
        if (query.view === 'person') return Effect.promise(() => byPerson)
        return Effect.succeed(reply)
      }
      await shelled(items, '', { listReviewInbox: list })
      await expect.element(layout()).toHaveAttribute('data-grouping', 'item')

      const filters = page.getByTestId('review-filters').element()
      const start = page.getByTestId('review-start').element()
      const time = page.getByRole('tab', { name: '按时间' })
      const person = page.getByRole('tab', { name: '按人员' })
      const loading = page.getByRole('status', { name: '加载中' })
      const expectLoading = async (tab: typeof time) => {
        await expect.element(tab).toHaveAttribute('aria-selected', 'true')
        await expect.element(loading).toBeVisible()
        expect(groups().elements()).toHaveLength(0)
        expect(rows().elements()).toHaveLength(0)
        expect(index().elements()).toHaveLength(0)
        expect(page.getByTestId('queue-scope').elements()).toHaveLength(0)
        expect(page.getByTestId('review-filters').element()).toBe(filters)
        expect(page.getByTestId('review-start').element()).toBe(start)
      }

      try {
        await time.click()
        await expectLoading(time)
        await person.click()
        await expectLoading(person)
        showPerson()
        await expect.element(layout()).toHaveAttribute('data-grouping', 'person')

        await time.click()
        await expectLoading(time)
        const skeleton = loading.element()
        const firstCard = skeleton.querySelector('[data-slot="review-group-placeholder"]')!
        const firstTable = firstCard.querySelector('[data-slot="review-group-table"]')!
        const before = firstCard.getBoundingClientRect()
        const headerHeight = firstTable.firstElementChild!.getBoundingClientRect().height
        showTime()
        await expect.element(layout()).toHaveAttribute('data-grouping', 'time')
        await expect.element(loading).not.toBeInTheDocument()
        expect(
          groups()
            .elements()
            .map((group) => group.getAttribute('data-key')),
        ).toEqual(['2026-03-04', '2026-03-03'])
        expect(rows().elements()).toHaveLength(2)
        const actual = groups().first().element()
        const after = actual.getBoundingClientRect()
        const columns = actual.querySelector('[data-slot="review-group-table"]')!.firstElementChild!
        expect(before.x).toBeCloseTo(after.x, 0)
        expect(before.y).toBeCloseTo(after.y, 0)
        expect(before.width).toBeCloseTo(after.width, 0)
        expect(headerHeight).toBeCloseTo(columns.getBoundingClientRect().height, 0)
      } finally {
        showPerson()
        showTime()
      }
    },
  )

  it('opens a project whole from the index or from its own card', async () => {
    await page.viewport(1440, 900)
    await shelled(both())
    await index().nth(1).click()
    await expect.element(layout()).toHaveAttribute('data-layout', 'group')
    expect(addressNow()).toContain(`item=${ITEM_ID}`)
    await expect.element(index().nth(1)).toHaveAttribute('aria-current', 'true')
    expect(rows().elements()).toHaveLength(12)

    // the whole queue is the index's first entry
    await index().first().click()
    await expect.element(layout()).toHaveAttribute('data-layout', 'overview')
    expect(addressNow()).not.toContain('item=')

    await page.getByTestId('queue-group-more').click()
    await expect.element(layout()).toHaveAttribute('data-layout', 'group')
    expect(rows().elements()).toHaveLength(12)
  })

  it.each([390, 1440])(
    'selects the project immediately and loads only its results at %ipx',
    async (width) => {
      await page.viewport(width, 900)
      const reply = { items: both(), handledToday: 0, judging: true }
      let showProject!: () => void
      const pending = new Promise<typeof reply>((resolve) => {
        showProject = () => resolve(reply)
      })
      try {
        await shelled(reply.items, '', {
          listReviewInbox: ({ query }: { query: { itemId?: string } }) =>
            query.itemId === ITEM_ID ? Effect.promise(() => pending) : Effect.succeed(reply),
        })
        await expect.element(layout()).toHaveAttribute('data-layout', 'overview')
        if (width === 390) {
          const pick = page.getByTestId('queue-scope').getByRole('combobox', { name: '查找项目' })
          const input = pick.element()
          await pick.click()
          await page.getByRole('option', { name: /学科竞赛获奖/ }).click()
          await expect.element(pick).toHaveValue('学科竞赛获奖')
          expect(pick.element()).toBe(input)
        } else {
          const pick = index().nth(1)
          const button = pick.element()
          await pick.click()
          await expect.element(pick).toHaveAttribute('aria-current', 'true')
          expect(pick.element()).toBe(button)
        }
        const loading = page.getByRole('status', { name: '加载中' })
        await expect.element(loading).toBeVisible()
        expect(rows().elements()).toHaveLength(0)
        showProject()
        await expect.element(layout()).toHaveAttribute('data-layout', 'group')
        await expect.element(loading).not.toBeInTheDocument()
        await expect.element(groups().first()).toHaveAttribute('data-key', ITEM_ID)
      } finally {
        showProject()
      }
    },
  )

  // Beside the rail of a laptop the queue has no room for a column of
  // projects; the same choice is a select above the list.
  it('picks from a select where the rail leaves no room for the index', async () => {
    await page.viewport(1024, 768)
    await shelled(both())
    await expect.element(rows().first()).toBeVisible()
    await expect.element(page.getByTestId('queue-scope')).toBeVisible()
    await expect.element(page.getByTestId('queue-index')).not.toBeVisible()
  })

  it('keeps the group and status controls distinct with badge counts on a phone', async () => {
    await page.viewport(390, 844)
    await shelled(both())
    const scope = page.getByTestId('queue-scope')
    const project = scope.getByRole('combobox', { name: '查找项目' })
    const status = page.getByRole('combobox', { name: '按审核状态筛选' })
    await expect.element(project).toHaveValue('全部项目')
    await expect.element(status.getByText('全部状态', { exact: true })).toBeVisible()
    expect(scope.element().querySelector('[data-slot="count"]')?.textContent).toBe('15')
    expect(status.element().querySelector('[data-slot="count"]')?.textContent).toBe('15')
    const projectBox = project.element().getBoundingClientRect()
    const statusBox = status.element().getBoundingClientRect()
    expect(projectBox.top).toBeCloseTo(statusBox.top, 0)
    expect(projectBox.right).toBeLessThan(statusBox.left)
    expect(statusBox.right).toBeLessThanOrEqual(390)
    await status.click()
    await page.getByRole('option', { name: /重新提交/ }).click()
    await expect.poll(() => addressNow()).toContain('mark=resubmitted')
    await expect.element(status.getByText('重新提交', { exact: true })).toBeVisible()
  })

  it('keeps the toolbar controls in bounds on both sides of each layout break', async () => {
    await page.viewport(1600, 900)
    await shelled([filing(1, { unitId: 'unit-a' }), volunteering(2)])
    const toolbar = page.getByTestId('review-filters')
    await expect.element(toolbar).toBeVisible()
    await expect.element(rows().first()).toBeVisible()
    for (const width of [1600, 1480, 1210, 1130, 1024, 930, 760, 630, 598, 560, 390, 320]) {
      await page.viewport(width, 900)
      const region = toolbar.element()
      const frame = region.getBoundingClientRect()
      const groups = region.querySelector('[role="tablist"]')!.getBoundingClientRect()
      const status = [...region.querySelectorAll('[role="group"], button[role="combobox"]')]
        .find(
          (node) =>
            node.getAttribute('aria-label') === '按审核状态筛选' &&
            node.getBoundingClientRect().width > 0,
        )!
        .getBoundingClientRect()
      if (frame.width >= 880) expect(Math.abs(groups.top - status.top)).toBeLessThanOrEqual(2)
      else expect(status.top).toBeGreaterThanOrEqual(groups.bottom)
      const visible = [
        ...region.querySelectorAll(
          '[role="tablist"], [role="combobox"], [role="group"], #review-queue-search, button[aria-controls="review-queue-search"]',
        ),
      ]
        .map((control) => control.getBoundingClientRect())
        .filter((rect) => rect.width > 0 && rect.height > 0)
      expect(visible.length).toBeGreaterThanOrEqual(4)
      for (const [index, rect] of visible.entries()) {
        expect(rect.left).toBeGreaterThanOrEqual(frame.left - 1)
        expect(rect.right).toBeLessThanOrEqual(frame.right + 1)
        for (const other of visible.slice(index + 1)) {
          const overlaps =
            Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1 &&
            Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1
          expect(overlaps).toBe(false)
        }
      }
    }
  })

  it('waits for Chinese composition to finish before searching', async () => {
    await page.viewport(1000, 850)
    const items = both()
    const searches: string[] = []
    await shelled(items, '', {
      listReviewInbox: ({ query }: { query: { search?: string } }) => {
        if (query.search !== undefined) searches.push(query.search)
        return Effect.succeed({ items, handledToday: 0, judging: true })
      },
    })
    await expect.element(rows().first()).toBeVisible()
    const field = page.getByRole('textbox', { name: '搜索姓名、学号或申报内容' })
    const input = field.element() as HTMLInputElement
    input.focus()
    const enter = (value: string, isComposing: boolean) => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, isComposing }))
    }
    enter('x', false)
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    enter('xiang', true)
    await page.viewport(390, 844)
    await expect.element(field).toBeVisible()
    // A pause longer than the debounce while picking a candidate must not navigate.
    await new Promise((resolve) => setTimeout(resolve, 350))
    expect(addressNow()).not.toContain('q=')
    expect(searches).toEqual([])
    expect(document.activeElement).toBe(input)
    enter('项目', true)
    input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '项目' }))
    expect(searches).toEqual([])
    await vi.waitFor(() => expect(searches).toEqual(['项目']))
    expect(field.element()).toBe(input)
    expect(input.value).toBe('项目')
  })

  it('starts a run over a project from its key', async () => {
    await page.viewport(1440, 900)
    await shelled(both())
    const run = groups().first().getByTestId('queue-run')
    await expect.element(run).toBeVisible()
    // a project of one is its own way in
    expect(groups().nth(1).getByTestId('queue-run').elements()).toHaveLength(1)
  })

  it('forgets the picked project when the queue is grouped another way', async () => {
    await page.viewport(1440, 900)
    await shelled(both(), `?item=${ITEM_ID}`)
    await expect.element(layout()).toHaveAttribute('data-layout', 'group')
    await page.getByRole('tab', { name: '按人员' }).click()
    await expect.poll(() => addressNow()).toContain('view=person')
    expect(addressNow()).not.toContain('item=')
    await expect.element(layout()).toHaveAttribute('data-layout', 'overview')
  })
})

describe('a filing in a row', () => {
  it('keeps the round badge in the narrow row header instead of under the answers', async () => {
    await page.viewport(390, 844)
    await shelled([filing(3)])
    const row = rows().first()
    const badge = row.getByTestId('inbox-row-mark')
    await expect.element(badge).toBeVisible()
    const answer = row.getByTestId('inbox-row-value').first().element()
    expect(badge.element().getBoundingClientRect().bottom).toBeLessThan(
      answer.getBoundingClientRect().top,
    )
  })

  it('allocates only the summary tracks used by each project, even when the entry has attachments', async () => {
    await page.viewport(1440, 900)
    await shelled([
      filing(3),
      filing(2, {
        itemId: OTHER_ITEM,
        itemTitle: '无摘要的项目',
        values: [{ label: '证明材料', value: '', files: 1 }],
        attachmentCount: 1,
      }),
    ])
    await expect.element(rows().nth(1)).toBeVisible()
    // Applicant, up to three summary fields, status, time and the way in.
    const tables = rows()
      .elements()
      .map((row) => row.closest('[data-slot="review-group-table"]')!)
    const tracks = tables.map((table) => getComputedStyle(table).gridTemplateColumns.split(' '))
    expect(tracks.map((columns) => columns.length)).toEqual([7, 4])
    const badge = rows().first().getByTestId('inbox-row-mark').element().getBoundingClientRect()
    expect(Number.parseFloat(tracks[0]![4]!)).toBeCloseTo(badge.width, 0)
  })

  // On a desk a row's answers are columns beside who filed it; on a phone
  // they stand under the name, and nothing runs past the screen's edge.
  for (const [width, height, beside] of [
    [1440, 900, true],
    [414, 896, false],
  ] as const) {
    it(`lays a filing's answers ${beside ? 'beside' : 'under'} its name at ${String(width)}`, async () => {
      await page.viewport(width, height)
      await shelled(both(), `?item=${ITEM_ID}`)
      await expect.element(rows().first()).toBeVisible()
      for (const row of rows().elements().slice(0, 3)) {
        const name = row.querySelector<HTMLElement>('[data-testid="inbox-row-name"]')!
        const value = row.querySelector<HTMLElement>('[data-testid="inbox-row-value"]')!
        const nameBox = name.getBoundingClientRect()
        const valueBox = value.getBoundingClientRect()
        if (beside) expect(valueBox.left).toBeGreaterThan(nameBox.right)
        else expect(valueBox.top).toBeGreaterThanOrEqual(nameBox.bottom)
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
      }
    })
  }

  it("lines one project's answers up under each other", async () => {
    await page.viewport(1440, 900)
    await shelled(both(), `?item=${ITEM_ID}`)
    await expect.element(rows().first()).toBeVisible()
    const lefts = rows()
      .elements()
      .map((row) =>
        Math.round(
          row.querySelector('[data-testid="inbox-row-value"]')!.getBoundingClientRect().left,
        ),
      )
    expect(new Set(lefts).size).toBe(1)
  })

  it('gives three answers at most, whole on hover', async () => {
    await page.viewport(1440, 900)
    await shelled(both(), `?item=${ITEM_ID}`)
    await expect.element(rows().first()).toBeVisible()
    const values = [
      ...rows().first().element().querySelectorAll<HTMLElement>('[data-testid="inbox-row-value"]'),
    ]
    expect(values).toHaveLength(3)
    expect(values[0]!.getAttribute('title')).toBe('第十六届全国大学生数学竞赛（非数学类）')
    // a name too long for its cell is whole on hover
    const name = rows().first().element().querySelector('[data-testid="inbox-row-name"]')!
    expect(name.getAttribute('title')).toBe(LONG_NAME)
  })

  it('marks only the rounds that are more than waiting', async () => {
    await page.viewport(1440, 900)
    await shelled(both(), `?item=${ITEM_ID}`)
    await expect.element(rows().first()).toBeVisible()
    const marks = rows()
      .elements()
      .slice(0, 5)
      .map((row) => row.querySelector('[data-testid="inbox-row-mark"]')?.getAttribute('data-mark'))
    expect(marks).toEqual([undefined, undefined, undefined, 'round', 'escalated'])
  })

  it('names the project a filing is on where the queue is grouped by person', async () => {
    await page.viewport(1440, 900)
    await shelled([filing(1), volunteering(1)], '?view=person')
    await expect.element(rows().first()).toBeVisible()
    expect(groups().elements()).toHaveLength(1)
    expect(
      rows()
        .elements()
        .map((row) => row.textContent),
    ).toEqual([
      expect.stringContaining('学科竞赛获奖'),
      expect.stringContaining('志愿服务时长认定'),
    ])
  })

  it('sections the queue by the day each filing came in', async () => {
    await page.viewport(1440, 900)
    await shelled(
      [
        filing(1),
        filing(2, { submittedAt: new Date(Date.UTC(2026, 2, 4, 2)).toISOString() }),
        filing(5, { submittedAt: new Date(Date.UTC(2026, 2, 4, 3)).toISOString() }),
      ],
      '?view=time',
    )
    await expect.element(layout()).toHaveAttribute('data-grouping', 'time')
    await expect.element(groups().first()).toHaveAttribute('data-key', '2026-03-04')
    expect(
      groups()
        .elements()
        .map((group) => group.getAttribute('data-count')),
    ).toEqual(['2', '1'])
  })
})

describe('when reviewing is open', () => {
  const HOUR = 3_600_000
  const at = (hours: number) => new Date(Date.now() + hours * HOUR).toISOString()
  const stage = (
    displayName: string,
    status: 'ended' | 'current' | 'future',
    reviewing: boolean,
    hours: number | null,
  ) => ({
    phaseId: displayName,
    displayName,
    entryNote: '',
    description: '',
    status,
    reviewing,
    entry:
      hours === null
        ? { kind: 'pending', at: null }
        : { kind: status === 'future' ? 'planned' : 'entered', at: at(hours) },
    scope: { items: null, participantsLimited: false, includesReader: null },
  })
  const docked = (timeline: readonly unknown[]) =>
    shelled(both(), '', { getTimeline: () => Effect.succeed({ timeline }) })

  it('counts down to the end of the run of reviewing stages', async () => {
    await page.viewport(1440, 900)
    await docked([
      stage('初审期', 'current', true, -48),
      stage('复审期', 'future', true, 24),
      stage('公示期', 'future', false, 24 * 5 + 2),
    ])
    const dock = page.getByTestId('review-dock')
    await expect.element(dock).toHaveAttribute('data-window', 'closes')
    await expect.element(dock).toHaveAttribute('data-tone', 'calm')
    await expect.element(dock).toHaveAttribute('data-left', 'day:5')
  })

  it('uses the same urgent tone as the stage clock in the last hour', async () => {
    await page.viewport(1440, 900)
    await docked([stage('审核期', 'current', true, -48), stage('公示期', 'future', false, 0.5)])
    await expect.element(page.getByTestId('review-dock')).toHaveAttribute('data-tone', 'urgent')
  })

  it('says when reviewing opens where this stage keeps it shut', async () => {
    await page.viewport(1440, 900)
    await docked([stage('申报期', 'current', false, -2), stage('审核期', 'future', true, 50)])
    const dock = page.getByTestId('review-dock')
    await expect.element(dock).toHaveAttribute('data-window', 'opens')
    await expect.element(dock).toHaveAttribute('data-left', 'day:2')
  })

  it('stays open without a countdown where no stage ahead closes it', async () => {
    await page.viewport(1440, 900)
    await docked([stage('审核期', 'current', true, -2)])
    const dock = page.getByTestId('review-dock')
    await expect.element(dock).toHaveAttribute('data-window', 'stays-open')
    await expect.element(dock).not.toHaveAttribute('data-left')
  })

  it.each([390, 1440])(
    'keeps the deadline above the foot at %ipx without hiding the last row',
    async (width) => {
      await page.viewport(width, 700)
      await shelled(both(), `?item=${ITEM_ID}`, {
        getTimeline: () => Effect.succeed({ timeline: [stage('审核期', 'current', true, -2)] }),
      })
      const dock = page.getByTestId('review-dock')
      await expect.element(dock).toBeVisible()
      await expect.element(layout()).toHaveAttribute('data-layout', 'group')
      const main = page.getByRole('main').element() as HTMLElement
      const footer = parseFloat(getComputedStyle(main).paddingBottom)
      if (width < 600) expect(footer).toBeGreaterThan(0)
      const before = dock.element().getBoundingClientRect()
      expect(before.bottom).toBeLessThan(main.getBoundingClientRect().bottom - footer)
      expect(getComputedStyle(dock.element()).animationName).toBe('none')

      main.scrollTop = main.scrollHeight
      expect(main.scrollTop).toBeGreaterThan(0)
      const after = dock.element().getBoundingClientRect()
      expect(after.bottom).toBeGreaterThan(main.getBoundingClientRect().bottom - footer - 80)
      expect(rows().last().element().getBoundingClientRect().bottom).toBeLessThanOrEqual(after.top)
    },
  )

  it('animates a deadline that arrives after the page opens', async () => {
    await commands.emulateMedia({ reducedMotion: 'no-preference' })
    let showTimeline!: () => void
    const pending = new Promise<{ timeline: readonly unknown[] }>((resolve) => {
      showTimeline = () => resolve({ timeline: [stage('审核期', 'current', true, -2)] })
    })
    try {
      await shelled(both(), '', { getTimeline: () => Effect.promise(() => pending) })
      await expect.element(rows().first()).toBeVisible()
      const dock = page.getByTestId('review-dock')
      await expect.element(dock).not.toBeInTheDocument()
      showTimeline()
      await expect.element(dock).toBeVisible()
      expect(getComputedStyle(dock.element()).animationName).not.toBe('none')
    } finally {
      showTimeline()
      await commands.emulateMedia({ reducedMotion: 'reduce' })
    }
  })
})

describe('the rail beside the queue', () => {
  it('counts what is waiting beside the entry that opens it', async () => {
    await page.viewport(1440, 900)
    await shelled(both())
    const entry = page.getByRole('link', { name: /审核工作/ })
    await expect.element(entry).toBeVisible()
    await expect
      .element(entry.getByTestId('queue-badge'))
      .toHaveAttribute('data-count', String(both().length))
  })
})
