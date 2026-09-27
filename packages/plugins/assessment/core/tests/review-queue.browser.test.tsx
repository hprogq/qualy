import ReviewInboxPage from '../src/client/review/ReviewInboxPage.tsx'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
import { lazy } from 'react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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

const text = (value: string) => ({ kind: 'literal' as const, value })
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
  capabilities: { personal: false, review: true, record: false, manage: false, redetermine: false },
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

const shelled = (items: readonly Record<string, unknown>[], search = '') =>
  renderScreen({
    client: fakeClient({
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

/** how wide the cells holding a row's answers are drawn, row by row */
const answerCells = () =>
  rows()
    .elements()
    .flatMap((row) =>
      [
        ...row.querySelectorAll(
          '[data-testid="inbox-row-answer"], [data-testid="inbox-row-summary"]',
        ),
      ].map((answer) => (answer.parentElement as HTMLElement).getBoundingClientRect().width),
    )

afterEach(() => page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height))

describe('the queue beside the rail', () => {
  // The line is the queue's own room: 1024 with the rail open leaves the
  // queue about as wide as a tablet, where the list and a question's table
  // do not both fit; from about 1280 they do.
  for (const [width, height, shape] of [
    [1024, 768, 'drill'],
    [1280, 800, 'split'],
    [1440, 900, 'split'],
    [1920, 1080, 'split'],
  ] as const) {
    it(`gives a question's answers room at ${String(width)}, rail open`, async () => {
      await page.viewport(width, height)
      await shelled(both(), `?item=${ITEM_ID}`)
      await expect.element(page.getByTestId('workspace-rail')).toBeVisible()
      await expect.element(rows().first()).toBeVisible()
      await expect.element(layout()).toHaveAttribute('data-layout', shape)
      // every answer on the page has at least a few characters' room,
      // whether each has a column or they share one
      const widths = answerCells()
      expect(widths.length).toBeGreaterThan(0)
      expect(Math.min(...widths)).toBeGreaterThanOrEqual(48)
      // and no row runs out of the card it is in
      for (const row of rows().elements()) {
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
      }
    })
  }

  // Narrower than the two need, the list is a screen of its own, and a
  // question is a step in from it that the back key steps out of - at a
  // desk width too, where the rail has taken the room.
  it('steps into a question from the list where the rail leaves too little room', async () => {
    await page.viewport(1024, 768)
    await shelled(both())
    const masters = page.getByTestId('queue-master-row')
    await expect.element(masters.first()).toBeVisible()
    expect(rows().elements()).toHaveLength(0)
    await masters.nth(1).click()
    await expect.element(page.getByTestId('queue-pane')).toHaveAttribute('data-key', OTHER_ITEM)
    await page.getByTestId('queue-pane-back').click()
    await expect.poll(() => addressNow()).not.toContain('item=')
    await expect.element(masters.first()).toBeVisible()
  })

  // A table's answers take the room their longest entries need, the
  // shortest first, so a grade and a date are whole before a competition's
  // name is cut; and an answer the room still cuts short says the whole of
  // itself on hover.
  it('gives the longest answer the room there is, and the whole of it on hover', async () => {
    for (const [width, height] of [
      [1440, 900],
      [1920, 1080],
    ] as const) {
      await page.viewport(width, height)
      const shown = await shelled(both(), `?item=${ITEM_ID}`)
      await expect.element(rows().first()).toBeVisible()
      await expect
        .element(page.getByTestId('queue-pane'))
        .toHaveAttribute('data-answers', 'columns')
      const cells = rows()
        .elements()
        .flatMap((row) => [...row.querySelectorAll('[data-testid="inbox-row-answer"]')])
        .map((answer) => answer.parentElement as HTMLElement)
      expect(cells.length).toBeGreaterThan(0)
      for (const cell of cells) {
        const cut = cell.scrollWidth > cell.clientWidth + 1
        if (cut) expect(cell.getAttribute('title')).toBe(cell.textContent)
      }
      // the short ones are never what gives way
      const firstRow = rows().first().element()
      const [, grade, date] = [
        ...firstRow.querySelectorAll('[data-testid="inbox-row-answer"]'),
      ].map((answer) => answer.parentElement as HTMLElement)
      for (const cell of [grade!, date!]) {
        expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth + 1)
      }
      if (width === 1920) {
        // and with room to spare nothing is cut at all
        expect(cells.every((cell) => cell.scrollWidth <= cell.clientWidth + 1)).toBe(true)
      }
      await shown.unmount()
    }
  })

  // The name is how a row is found. The number beside it goes under it
  // before the name loses a character, and a name longer than the cell
  // still says its whole self on hover.
  it('keeps a long name whole and moves the number under it', async () => {
    await page.viewport(1440, 900)
    await shelled(both(), `?item=${ITEM_ID}`)
    const name = page.getByTestId('inbox-row-name').first()
    await expect.element(name).toHaveTextContent(LONG_NAME)
    const drawn = name.element() as HTMLElement
    expect(drawn.scrollWidth).toBeLessThanOrEqual(drawn.clientWidth + 1)
    expect(drawn.getAttribute('title')).toBe(LONG_NAME)
    const number = drawn.nextElementSibling as HTMLElement
    expect(number.getBoundingClientRect().top).toBeGreaterThan(drawn.getBoundingClientRect().top)
  })

  // Where a round stands rides under when it arrived rather than taking a
  // column that is empty on nearly every row.
  it('marks a round under its time, with no column of its own', async () => {
    await page.viewport(1440, 900)
    await shelled(both(), `?item=${ITEM_ID}`)
    const marks = page.getByTestId('inbox-row-mark')
    await expect.element(marks.first()).toBeVisible()
    expect(marks.elements().map((mark) => mark.getAttribute('data-mark'))).toEqual([
      'round',
      'escalated',
    ])
    // each mark stands in the time's own cell, under the time
    for (const mark of marks.elements()) {
      const when = mark.parentElement as HTMLElement
      expect(when.firstElementChild?.textContent).toMatch(/\d{2}:\d{2}/)
      expect(mark.getBoundingClientRect().top).toBeGreaterThan(
        (when.firstElementChild as HTMLElement).getBoundingClientRect().top,
      )
    }
    // who, the answers, when, and the way in: no track for the standing
    const pane = page.getByTestId('queue-pane').element() as HTMLElement
    const answers = pane.dataset['answers'] === 'columns' ? 4 : 1
    const tracks = getComputedStyle(rows().first().element()).gridTemplateColumns.split(' ')
    expect(tracks).toHaveLength(answers + 3)
  })

  // The list stands beside the filings while they are paged, and never
  // reaches below the window: it scrolls inside itself instead of growing
  // the page.
  it('keeps the list beside the filings inside the window', async () => {
    await page.viewport(1440, 900)
    const many = Array.from({ length: 24 }, (_, n) =>
      filing(n, {
        itemId: `cccccccc-cccc-4ccc-8ccc-${String(n).padStart(12, '0')}`,
        itemTitle: `第 ${String(n + 1)} 个项目`,
      }),
    )
    await shelled(many)
    const seat = page.getByTestId('queue-master-seat')
    await expect.element(seat).toBeVisible()
    await expect
      .poll(() => (seat.element() as HTMLElement).getBoundingClientRect().bottom)
      .toBeLessThanOrEqual(window.innerHeight)
  })

  // Paging moves the reader to the top of the page they asked for; one who
  // asked for less motion is taken there at once.
  it('pages without a glide where less motion is asked for', async () => {
    await page.viewport(1440, 900)
    await shelled(both(), `?item=${ITEM_ID}`)
    const glide = vi.spyOn(Element.prototype, 'scrollIntoView')
    try {
      await page.getByTestId('review-queue-pager').getByRole('button', { name: '2' }).click()
      await expect.poll(() => addressNow()).toContain('page=2')
      const asked = glide.mock.calls.map(
        ([how]) => (how as ScrollIntoViewOptions | undefined)?.behavior,
      )
      expect(asked).toContain('auto')
      expect(asked).not.toContain('smooth')
    } finally {
      glide.mockRestore()
    }
  })

  // By time, the question takes a column only where there is room for one
  // beside the answers; narrower it rides under the name, and the answers
  // keep the width.
  for (const [width, height, where] of [
    [1024, 768, 'under-name'],
    [1440, 900, 'column'],
  ] as const) {
    it(`puts the question where the room allows it by time at ${String(width)}`, async () => {
      await page.viewport(width, height)
      await shelled(both(), '?view=time')
      await expect.element(rows().first()).toBeVisible()
      await expect.element(page.getByTestId('queue-pane')).toHaveAttribute('data-item', where)
      const summary = rows().first().element().querySelector('[data-testid="inbox-row-summary"]')!
        .parentElement as HTMLElement
      expect(summary.getBoundingClientRect().width).toBeGreaterThanOrEqual(240)
      const item = rows().first().element().querySelector('[data-testid="inbox-row-item"]')!
      expect(item.textContent).toBe('学科竞赛获奖')
      if (where === 'under-name') {
        const name = rows().first().element().querySelector('[data-testid="inbox-row-name"]')!
        expect(item.getBoundingClientRect().top).toBeGreaterThan(name.getBoundingClientRect().top)
      }
      for (const row of rows().elements()) {
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
      }
    })
  }
})

// The few filings of the one question or person open are laid out whole,
// every answer under its label, whatever the rest of the queue holds: a
// question of two in a queue of many was a strip of table over an empty
// pane, and so was every person, who has one or two.
describe('a question or a person of a few, open in a longer queue', () => {
  /** five filings over three questions: two, two and one */
  const sparse = () => [filing(0), filing(1), volunteering(2), volunteering(5), cadre(6)]
  const CADRE_ITEM = '77777777-7777-4777-8777-777777777777'
  function cadre(n: number) {
    return filing(n, {
      itemId: CADRE_ITEM,
      itemTitle: '学生干部任职',
      values: [
        { label: '任职组织', value: '计算机学院学生会', files: null },
        { label: '职务', value: '学习部部长', files: null },
        { label: '任职起止', value: '2025-09-01 至 2026-06-30', files: null },
      ],
    })
  }
  /** every answer on screen says all of itself */
  const wholly = () => {
    for (const value of document.querySelectorAll<HTMLElement>(
      '[data-testid="queue-pane"] [data-testid="inbox-row-value"]',
    )) {
      expect(value.scrollWidth).toBeLessThanOrEqual(value.clientWidth + 1)
      expect(value.scrollHeight).toBeLessThanOrEqual(value.clientHeight + 1)
    }
  }

  for (const [question, count, fields] of [
    [ITEM_ID, 2, 4],
    [CADRE_ITEM, 1, 3],
  ] as const) {
    it(`lays a question of ${String(count)} out whole beside the list at 1440`, async () => {
      await page.viewport(1440, 900)
      await shelled(sparse(), `?item=${question}`)
      await expect.element(layout()).toHaveAttribute('data-layout', 'split')
      const pane = page.getByTestId('queue-pane')
      await expect.element(pane).toHaveAttribute('data-key', question)
      await expect.element(pane).toHaveAttribute('data-answers', 'spread')
      await expect.element(rows().first()).toBeVisible()
      expect(rows().elements()).toHaveLength(count)
      for (const row of rows().elements()) {
        expect(row.getAttribute('data-answers')).toBe(String(fields))
        // one line of answers where the pane has the room for them
        expect(row.getAttribute('data-answers-line')).toBe('one')
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
      }
      wholly()
      // one filing is its own way in; a run over the question is worth a key
      // only where it holds more
      expect(pane.getByTestId('queue-run').elements()).toHaveLength(count > 1 ? 1 : 0)
    })
  }

  it('lines the answers of one question up under each other', async () => {
    await page.viewport(1440, 900)
    await shelled(sparse(), `?item=${ITEM_ID}`)
    await expect.element(rows().nth(1)).toBeVisible()
    const lefts = rows()
      .elements()
      .map((row) =>
        [...row.querySelectorAll('[data-testid="inbox-row-value"]')].map((value) =>
          Math.round(value.getBoundingClientRect().left),
        ),
      )
    // every answer of both, each in the same place as the other's
    expect(lefts[0]).toHaveLength(4)
    expect(lefts[0]).toEqual(lefts[1])
  })

  it('lays the one person open out whole, by the question each filing is on', async () => {
    await page.viewport(1440, 900)
    await shelled(sparse(), '?view=person')
    const pane = page.getByTestId('queue-pane')
    await expect.element(pane).toHaveAttribute('data-answers', 'spread')
    await expect.element(rows().first()).toBeVisible()
    expect(rows().elements()).toHaveLength(1)
    expect(rows().first().element().getAttribute('data-answers')).toBe('4')
    wholly()
    expect(pane.getByTestId('queue-run').elements()).toHaveLength(0)
  })

  it('lays a question of a few out whole a step in on a phone', async () => {
    await page.viewport(390, 844)
    await shelled(sparse(), `?item=${OTHER_ITEM}`)
    await expect.element(layout()).toHaveAttribute('data-layout', 'drill')
    await expect.element(page.getByTestId('queue-pane')).toHaveAttribute('data-answers', 'spread')
    await expect.element(rows().first()).toBeVisible()
    for (const row of rows().elements()) {
      expect(row.getAttribute('data-answers')).toBe('2')
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
    }
    wholly()
  })
})

// The shell hands a badge its context as one prop, the entry's id inside
// it; a badge that read the id off a prop of its own never drew at all.
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

describe('a queue of a few', () => {
  // One or two filings are all there is to read, so they are laid out
  // whole - every answer under its label - rather than as a strip of table
  // across an empty page, and a phone does not make the reader step into
  // a list of one to see them.
  for (const [width, height] of [
    [390, 844],
    [834, 1112],
    [1440, 900],
  ] as const) {
    it(`lays two filings out whole at ${String(width)}`, async () => {
      await page.viewport(width, height)
      await shelled([filing(0), filing(1)])
      await expect.element(layout()).toHaveAttribute('data-layout', 'spread')
      await expect.element(rows().first()).toBeVisible()
      expect(rows().elements()).toHaveLength(2)
      expect(page.getByTestId('queue-master-row').elements()).toHaveLength(0)
      // every answer the filing has, each with its own label
      for (const row of rows().elements()) {
        expect(row.getAttribute('data-answers')).toBe('4')
        expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
      }
    })
  }

  it('lays a few out whole whichever way the queue is read', async () => {
    await page.viewport(1280, 800)
    for (const [view, groups] of [
      ['time', 1],
      ['person', 2],
    ] as const) {
      const shown = await shelled([filing(0), volunteering(1)], `?view=${view}`)
      await expect.element(layout()).toHaveAttribute('data-layout', 'spread')
      expect(page.getByTestId('queue-spread').elements()).toHaveLength(groups)
      expect(
        rows()
          .elements()
          .map((row) => row.getAttribute('data-answers')),
      ).toEqual(['4', '2'])
      await shown.unmount()
    }
  })

  it('groups a few filings by question, and opens one on a press', async () => {
    await page.viewport(1440, 900)
    await shelled([filing(0), volunteering(1)])
    const groups = page.getByTestId('queue-spread')
    await expect.element(groups.first()).toBeVisible()
    expect(groups.elements().map((group) => group.getAttribute('data-key'))).toEqual([
      ITEM_ID,
      OTHER_ITEM,
    ])
    await rows().nth(1).click()
    await expect.poll(() => addressNow()).toContain(rowId(1))
    expect(addressNow()).toContain(`run=item%3A${OTHER_ITEM}`)
  })

  // A queue of one question is that question's filings, with nothing to
  // pick them from: full width at a desk, and no step in on a phone.
  for (const [width, height] of [
    [390, 844],
    [1440, 900],
  ] as const) {
    it(`opens the only question straight away at ${String(width)}`, async () => {
      await page.viewport(width, height)
      await shelled(Array.from({ length: 12 }, (_, n) => filing(n)))
      await expect.element(layout()).toHaveAttribute('data-layout', 'single')
      await expect.element(rows().first()).toBeVisible()
      expect(page.getByTestId('queue-master-row').elements()).toHaveLength(0)
      expect(page.getByTestId('queue-pane-back').elements()).toHaveLength(0)
      expect(rows().elements()).toHaveLength(10)
    })
  }
})
