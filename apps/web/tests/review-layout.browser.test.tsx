import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
// The only suite that needs the real stylesheet: what it asserts is which
// parts a width shows, and without the sheet every breakpoint is the same
// screen. Test files run in their own frame, so this stays here.
import '../src/app.css'

// The workbench at the widths it is actually used at.
//
// Three columns is what it is on a desk. On a tablet the terms lose their
// column and become a layer; on a phone the columns become one page with a
// strip that says where in it the reader is; and where the pointer is a
// thumb, sending is a press held down rather than a tap. Each of those is a
// different screen built from the same parts, and none of them is exercised
// by a test that only ever runs at one width.

const ReviewInstancePage = (await components['assessment/ReviewInstancePage']!()).default
const ReviewInboxPage = (await components['assessment/ReviewInboxPage']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444'
const INSTANCE_ID = '55555555-5555-4555-8555-555555555555'

/** what the runner gives every other suite, so this one hands it back */
const DEFAULT_VIEWPORT = { width: 414, height: 896 }

const PAGES = [
  { id: 'assessment/batch-reviews', path: '/assessment/batches/:batchId/reviews' },
  { id: 'assessment/review-instance', path: '/assessment/batches/:batchId/reviews/:instanceId' },
].map((entry) => ({ ...entry, component: entry.id, layout: 'admin' }))

const batch = () => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: false,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: true, review: true, record: true, manage: false },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 1,
  currentPhaseId: null,
  currentPhaseName: '填报期',
  createdAt: '2026-02-01T00:00:00.000Z',
})

const review = {
  id: INSTANCE_ID,
  state: 'active' as const,
  outcome: null,
  roundNo: 1,
  entryId: ENTRY_ID,
  batchId: BATCH_ID,
  itemId: ITEM_ID,
  itemTitle: '学科竞赛获奖',
  participantName: '周予安',
  businessNo: '2023011047',
  unitName: '软件2023级2班',
  submittedAt: '2026-03-03T00:00:00.000Z',
  completedAt: null,
  revision: {
    revisionNo: 1,
    payload: { name: '中国机器人大赛', note: '团队赛，本人为队长。'.repeat(20) },
    note: null,
    attachments: [],
  },
  form: {
    itemType: 'evidence',
    formConfig: {
      fields: [
        { key: 'name', type: 'text', label: '竞赛名称' },
        { key: 'note', type: 'text', label: '说明' },
      ],
    },
  },
  chain: {
    route: 'normal' as const,
    stageId: 'class',
    normal: [
      {
        id: 'class',
        index: 0,
        nodeName: '软件2023级2班',
        roleNames: ['审核员'],
        reviewers: ['张老师'],
        skipped: null,
      },
    ],
    escalation: [],
    decisions: ['approve', 'reject', 'comment'],
  },
  context: {
    worth: {
      each: '3.00',
      maxEntries: 3,
      groupName: '学业加分',
      groupCap: '75.00',
      materialRange: { start: '2026-01-01', end: '2026-06-30' },
    },
    siblings: [],
    previous: null,
  },
  events: [
    {
      kind: 'submitted',
      actorId: PARTICIPANT_ID,
      actorName: '周予安',
      reason: null,
      comment: null,
      suggestedPayload: null,
      at: '2026-03-03T00:00:00.000Z',
    },
  ],
  supplements: [],
  capabilities: {
    canDecide: true,
    canRequestSupplement: false,
    canCancelSupplement: false,
    canAnswerSupplement: false,
  },
}

const inboxRow = (over: Record<string, unknown> = {}) => ({
  instanceId: INSTANCE_ID,
  entryId: ENTRY_ID,
  batchId: BATCH_ID,
  batchName: '2026 春季综测',
  itemId: ITEM_ID,
  itemTitle: '学科竞赛获奖',
  participantName: '周予安',
  businessNo: '2023011047',
  unitId: null,
  unitName: '软件2023级2班',
  roundNo: 1,
  route: 'normal' as const,
  values: [{ label: '竞赛名称', value: '中国机器人大赛' }],
  attachmentCount: 0,
  submittedAt: '2026-03-03T00:00:00.000Z',
  ...over,
})

const queue = () =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listReviewInbox: () =>
          Effect.succeed({
            items: [inboxRow(), inboxRow({ instanceId: '99999999-9999-4999-8999-999999999999' })],
            nextCursor: null,
            handledToday: 0,
          }),
        listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
      },
    } as never),
    routes: [
      { path: '/assessment/batches/:batchId/reviews', element: <ReviewInboxPage /> },
    ] as never,
    route: `/assessment/batches/${BATCH_ID}/reviews`,
  })

const open = (stubs: Record<string, unknown> = {}) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listReviewInbox: () =>
          Effect.succeed({
            items: [
              inboxRow(),
              inboxRow({
                instanceId: '99999999-9999-4999-8999-999999999999',
                participantName: '李明',
              }),
            ],
            nextCursor: null,
            handledToday: 0,
          }),
        getReviewInstance: () => Effect.succeed({ review }),
        getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
        ...stubs,
      },
    } as never),
    routes: [
      {
        path: '/assessment/batches/:batchId/reviews/:instanceId',
        // the height the shell gives it, so the parts scroll inside the
        // workbench the way they do in the app rather than growing the page
        element: (
          <div className="flex h-dvh flex-col overflow-hidden">
            <ReviewInstancePage />
          </div>
        ),
      },
    ] as never,
    route: `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
  })

/** a pointer with no hover and no precision, whatever the runner's is */
const asThumb = () => {
  const real = window.matchMedia.bind(window)
  window.matchMedia = ((query: string) =>
    query.includes('pointer: fine')
      ? { matches: false, media: query, addEventListener() {}, removeEventListener() {} }
      : real(query)) as typeof window.matchMedia
  return () => {
    window.matchMedia = real
  }
}

const parts = () =>
  [...document.querySelectorAll('[data-workbench-part]')]
    .filter((node) => node instanceof HTMLElement && node.offsetParent !== null)
    .map((node) => (node as HTMLElement).dataset['workbenchPart'])

afterEach(() => page.viewport(DEFAULT_VIEWPORT.width, DEFAULT_VIEWPORT.height))

describe('one workbench, three widths', () => {
  it('stacks the parts into one page and marks the one being read', async () => {
    page.viewport(390, 844)
    open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()

    // all three parts are on the page - the terms are the last section of
    // it, not something the reader has to go somewhere else for
    expect(parts()).toEqual(['flow', 'filing', 'about'])

    const anchors = page.getByTestId('workbench-anchor')
    expect(anchors.elements()).toHaveLength(3)
    await expect.element(anchors.first()).toHaveAttribute('data-reading', 'yes')

    // the strip moves the page rather than replacing it: pressing a part
    // marks it, and every part is still there afterwards
    await page.getByTestId('workbench-anchor').nth(2).click()
    await vi.waitFor(async () => {
      await expect
        .element(page.getByTestId('workbench-anchor').nth(2))
        .toHaveAttribute('data-reading', 'yes')
    })
    await expect.element(anchors.first()).toHaveAttribute('data-reading', 'no')
    expect(parts()).toEqual(['flow', 'filing', 'about'])
  })

  it('keeps three columns and trades the queue rail away on a laptop', async () => {
    page.viewport(1280, 800)
    open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    // the columns get the width first: all three stand, and the queue
    // becomes the key at the left of the header instead of a rail
    expect(parts()).toEqual(['flow', 'filing', 'about'])
    await expect.element(page.getByTestId('queue-key')).toBeVisible()
    await expect.element(page.getByText('李明')).not.toBeVisible()
  })

  it('stands the queue rail beside the columns only on a desk', async () => {
    page.viewport(1680, 950)
    open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    expect(parts()).toEqual(['flow', 'filing', 'about'])
    // the rail names the rest of the queue; the header key stands down
    await expect.element(page.getByText('李明')).toBeVisible()
    await expect.element(page.getByTestId('queue-key')).not.toBeVisible()
  })

  it('keeps the queue inside the width it is given', async () => {
    page.viewport(390, 844)
    queue()
    await expect.element(page.getByText('周予安').first()).toBeVisible()
    // A table of fixed tracks is 11rem of name before anything else on a
    // 390px screen, and the rest of the row runs off the end of it. The
    // card around the list clips rather than scrolls, so the page looks
    // whole while the time and the standing have left it - the row itself
    // is the only thing that can say so.
    const row = page
      .getByRole('button', { name: /周予安/ })
      .first()
      .element()
    expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
  })
})

describe('sending, under a thumb', () => {
  it('takes a press held down, and lets a tap go', async () => {
    const restore = asThumb()
    try {
      page.viewport(390, 844)
      open()
      await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()

      await page.getByRole('button', { name: /^通过/ }).click()
      const hold = page.getByTestId('hold-submit')
      await expect.element(hold).toBeVisible()

      // a tap is not a send: the press has to survive the full hold, and
      // the key says so by never starting
      await hold.click()
      await new Promise((done) => setTimeout(done, 300))
      expect(page.getByTestId('decision-staged').elements()).toHaveLength(0)

      // held down, and only then
      const key = hold.element()
      key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      await expect.element(hold).toHaveAttribute('data-holding', 'yes')
      await vi.waitFor(
        () => expect(page.getByTestId('decision-staged').elements()).toHaveLength(1),
        { timeout: 3000 },
      )
      await expect
        .element(page.getByTestId('decision-staged'))
        .toHaveAttribute('data-decision', 'approve')
    } finally {
      restore()
    }
  })

  it('drops the hold when the press is let go early', async () => {
    const restore = asThumb()
    try {
      page.viewport(390, 844)
      open()
      await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
      await page.getByRole('button', { name: /^通过/ }).click()

      const hold = page.getByTestId('hold-submit')
      const key = hold.element()
      key.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 }))
      await expect.element(hold).toHaveAttribute('data-holding', 'yes')
      await new Promise((done) => setTimeout(done, 200))
      key.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }))
      await expect.element(hold).toHaveAttribute('data-holding', 'no')

      // well past the full hold, and nothing went out
      await new Promise((done) => setTimeout(done, 1200))
      expect(page.getByTestId('decision-staged').elements()).toHaveLength(0)
    } finally {
      restore()
    }
  })
})
