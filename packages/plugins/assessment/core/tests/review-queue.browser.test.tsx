import ReviewInboxPage from '../src/client/review/ReviewInboxPage.tsx'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
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
          }),
      },
      assessment: {
        getBatch: () => Effect.succeed({ batch }),
        listReviewInbox: () =>
          Effect.succeed({ items, nextCursor: null, handledToday: 2, judging: true }),
        listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
      },
    }),
    route: `/assessment/batches/${BATCH_ID}/reviews${search}`,
    children: (
      <Routes>
        <Route element={<WorkspaceShell />}>
          <Route path="/assessment/batches/:batchId/reviews" element={<ReviewInboxPage />} />
        </Route>
      </Routes>
    ),
  })

afterEach(() => page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height))

describe('the queue beside the rail', () => {
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
})
