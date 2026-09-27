import ReviewInstancePage from '../src/client/review/ReviewInstancePage.tsx'
import ReviewInboxPage from '../src/client/review/ReviewInboxPage.tsx'
import QueueBadge from '../src/client/review/QueueBadge.tsx'
import { UNNAMED } from '../src/client/roster/unit-path.ts'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect, Stream } from 'effect'
import { ScreenFillScope, useScreenFillClaimed } from '@qualy/web-runtime'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'
// The only suite that needs the real stylesheet: what it asserts is which
// parts a width shows, and without the sheet every breakpoint is the same
// screen. Test files run in their own frame, so this stays here.

// The workbench at the widths it is actually used at.
//
// Three columns is what it is on a desk. On a tablet the terms lose their
// column and become a layer; on a phone the columns become one page with a
// strip that says where in it the reader is; and where the pointer is a
// thumb, sending is a press held down rather than a tap. Each of those is a
// different screen built from the same parts, and none of them is exercised
// by a test that only ever runs at one width.

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
].map((entry) => ({ ...entry, layout: 'admin' }))

const batch = () => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: false,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: true, review: true, record: true, manage: false, redetermine: false },
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
  unitPath: ['示例大学', '软件学院', '软件2023级2班'],
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
        label: null,
        nodeName: '软件2023级2班',
        roleNames: ['审核员'],
        reviewers: ['张老师'],
        skipped: null,
        opinions: null,
      },
    ],
    escalation: [],
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
  actions: {
    approve: { state: 'available' as const, reason: null },
    reject: { state: 'available' as const, reason: null },
    escalate: { state: 'blocked' as const, reason: 'no-route' },
    supplement: { state: 'available' as const, reason: null },
    // a normal-route round: a rejection here goes back to whoever filed
    rejectionReturns: true,
    approvalConcludes: true,
  },
  capabilities: {
    canDecide: true,
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
  values: [{ label: '竞赛名称', value: '中国机器人大赛', files: null }],
  attachmentCount: 0,
  submittedAt: '2026-03-03T00:00:00.000Z',
  ...over,
})

const queue = (inbox?: Record<string, unknown>, search = '') =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listReviewInbox: () =>
          Effect.succeed(
            inbox ?? {
              items: [inboxRow(), inboxRow({ instanceId: '99999999-9999-4999-8999-999999999999' })],
              nextCursor: null,
              handledToday: 0,
              judging: true,
            },
          ),
        listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
      },
    }),
    routes: [
      { path: '/assessment/batches/:batchId/reviews', element: <ReviewInboxPage /> },
    ] as never,
    route: `/assessment/batches/${BATCH_ID}/reviews${search}`,
  })

// One decision announces its round, the queue, the claim and the account in
// one burst. Every reviewer with the round open used to read the whole queue
// once per kind of that burst; now once for all of it.
describe('the wake-ups of one decision', () => {
  it('reads the queue once for the whole burst', async () => {
    let reads = 0
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const burst = [
      'review-instance-changed',
      'review-inbox-changed',
      'entries-changed',
      'result-changed',
    ] as const
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
        assessment: {
          getBatch: () => Effect.succeed({ batch: batch() }),
          getMyOverview: () => Effect.succeed({}),
          listReviewInbox: () => {
            reads += 1
            return Effect.succeed({
              items: [inboxRow()],
              nextCursor: null,
              handledToday: 0,
              judging: true,
            })
          },
          listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
          watchBatch: () =>
            Effect.succeed(
              Stream.concat(
                Stream.fromEffect(Effect.promise(() => gate)).pipe(
                  Stream.flatMap(() => Stream.fromIterable(burst.map((kind) => ({ kind })))),
                ),
                Stream.never,
              ),
            ),
        },
      }),
      routes: [
        { path: '/assessment/batches/:batchId/reviews', element: <ReviewInboxPage /> },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews`,
    })
    await expect.element(page.getByText('周予安').first()).toBeVisible()
    await vi.waitFor(() => expect(reads).toBeGreaterThan(0))
    const before = reads
    release()
    await vi.waitFor(() => expect(reads).toBe(before + 1))
    // and nothing more follows once the burst has settled
    await new Promise((resolve) => setTimeout(resolve, 800))
    expect(reads).toBe(before + 1)
  })
})

const open = (stubs: Record<string, unknown> = {}, locale: 'zh-CN' | 'en-US' = 'zh-CN') =>
  renderScreen({
    locale,
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
    }),
    routes: [
      {
        path: '/assessment/batches/:batchId/reviews/:instanceId',
        // the height the shell gives it, so the parts scroll inside the
        // workbench the way they do in the app rather than growing the page
        // inline for the same reason as the paper fixture: tests sit outside
        // the Tailwind scan and must not borrow utilities from production
        element: (
          <div
            style={{
              display: 'flex',
              height: '100dvh',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
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
  it('pages the parts on a phone and opens on the filing', async () => {
    await page.viewport(390, 844)
    await open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()

    // all three faces exist side by side - the pager shows one whole face
    // at a time, and nothing was traded away to get there
    expect(parts()).toEqual(['flow', 'filing', 'about'])

    // the judged material is the visual centre: the pager opens on the
    // filing, not on the first page in reading order
    const anchors = page.getByTestId('workbench-anchor')
    expect(anchors.elements()).toHaveLength(3)
    await expect.element(anchors.nth(1)).toHaveAttribute('data-reading', 'yes')

    // the strip moves the pager rather than replacing anything: pressing a
    // face marks it, and every face is still there afterwards
    await page.getByTestId('workbench-anchor').nth(2).click()
    await vi.waitFor(async () => {
      await expect
        .element(page.getByTestId('workbench-anchor').nth(2))
        .toHaveAttribute('data-reading', 'yes')
    })
    await expect.element(anchors.nth(1)).toHaveAttribute('data-reading', 'no')
    expect(parts()).toEqual(['flow', 'filing', 'about'])
  })

  it('keeps three columns and trades the queue rail away on a laptop', async () => {
    await page.viewport(1280, 800)
    await open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    // the columns get the width first: all three stand, and the queue
    // becomes the key at the left of the header instead of a rail
    expect(parts()).toEqual(['flow', 'filing', 'about'])
    await expect.element(page.getByTestId('queue-key')).toBeVisible()
    expect(document.querySelector('[data-testid="queue-sheet"]')).toBeNull()
  })

  // The queue never stands beside the bench: who else is waiting is looked
  // up when the reviewer wants to jump, so it comes out from the side when
  // asked for, at every width, and the three columns keep the room.
  it('brings the queue out from the side when asked, on a desk as on a laptop', async () => {
    await page.viewport(1680, 950)
    await open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    expect(parts()).toEqual(['flow', 'filing', 'about'])
    expect(document.querySelector('[data-testid="queue-sheet"]')).toBeNull()
    await page.getByTestId('queue-key').click()
    await expect.element(page.getByTestId('queue-sheet')).toBeVisible()
    await expect.element(page.getByTestId('queue-sheet').getByText('李明')).toBeVisible()
  })

  it('lets the outer columns be dragged, between bounds it advertises', async () => {
    await page.viewport(1680, 950)
    await open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    const flowWidth = () =>
      document.querySelector<HTMLElement>('[data-workbench-part="flow"]')?.getBoundingClientRect()
        .width ?? 0
    const handle = page.getByTestId('bench-handle-flow')
    const seat = handle.element() as HTMLElement
    // the boundary says what it will take, the way any separator does: a
    // column dragged to a sliver is one the next filing cannot be read in
    expect(seat.getAttribute('role')).toBe('separator')
    expect(seat.getAttribute('aria-valuemin')).toBe('272')
    expect(seat.getAttribute('aria-valuemax')).toBe('640')

    const { userEvent } = await import('vitest/browser')
    const before = flowWidth()
    seat.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect.poll(flowWidth).toBeGreaterThan(before)
    const grown = flowWidth()
    await userEvent.keyboard('{ArrowLeft}')
    await expect.poll(flowWidth).toBeLessThan(grown)
    // and never outside what it advertised
    const now = Number(seat.getAttribute('aria-valuenow'))
    expect(now).toBeGreaterThanOrEqual(272)
    expect(now).toBeLessThanOrEqual(640)
    window.localStorage.removeItem('qualy:review-bench-columns')
  })

  it('opens the queue from the keyboard and walks it with the arrows', async () => {
    await page.viewport(1680, 950)
    await open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    const { userEvent } = await import('vitest/browser')
    await userEvent.keyboard('q')
    await expect.element(page.getByTestId('queue-sheet')).toBeVisible()
    const stoodOn = () =>
      document
        .querySelector('[data-testid="queue-row"][data-at="true"]')
        ?.getAttribute('data-queue-index')
    const before = stoodOn()
    await userEvent.keyboard('{ArrowDown}')
    await expect.poll(stoodOn).not.toBe(before)
    await userEvent.keyboard('q')
    await expect.poll(() => document.querySelector('[data-testid="queue-sheet"]')).toBeNull()
  })

  // A phase that keeps judging shut empties the queue however much is
  // waiting, and nothing arrives until it opens: the empty queue says so
  // rather than promising new work.
  it('says judging is closed rather than that nothing has arrived', async () => {
    await queue({ items: [], nextCursor: null, handledToday: 0, judging: false })
    await expect
      .element(page.getByTestId('review-inbox-empty'))
      .toHaveAttribute('data-empty', 'closed')
  })

  it('says nothing has arrived while judging is open', async () => {
    await queue({ items: [], nextCursor: null, handledToday: 0, judging: true })
    await expect
      .element(page.getByTestId('review-inbox-empty'))
      .toHaveAttribute('data-empty', 'nothing')
  })

  // The workbench is a screenful at every width and scrolls its parts
  // inside itself, so it says so to the shell: a shell that keeps room for
  // a page scrollbar beside it only draws an empty strip down its right.
  it('claims the whole screen from the shell around it', async () => {
    await page.viewport(1440, 900)
    function Claimed() {
      return <span data-testid="fill-claimed" data-claimed={String(useScreenFillClaimed())} />
    }
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
        assessment: {
          getBatch: () => Effect.succeed({ batch: batch() }),
          listReviewInbox: () =>
            Effect.succeed({ items: [inboxRow()], nextCursor: null, handledToday: 0 }),
          getReviewInstance: () => Effect.succeed({ review }),
          getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
        },
      }),
      routes: [
        {
          path: '/assessment/batches/:batchId/reviews/:instanceId',
          element: (
            <ScreenFillScope>
              <Claimed />
              <div style={{ display: 'flex', height: '90dvh', flexDirection: 'column' }}>
                <ReviewInstancePage />
              </div>
            </ScreenFillScope>
          ),
        },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
    })
    await expect.element(page.getByTestId('fill-claimed')).toHaveAttribute('data-claimed', 'true')
  })

  // The run is said once, on the run's own terms. A strip above used to
  // count the sitting and the bar below it what was left, and "4/12" over
  // "1/9" on one screen read as two runs.
  it('says the run’s place once, counting what the sitting already dealt with', async () => {
    await page.viewport(1440, 900)
    await open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    const place = page.getByTestId('run-position')
    expect(place.elements()).toHaveLength(1)
    await expect.element(place).toHaveAttribute('data-at', '1')
    await expect.element(place).toHaveAttribute('data-total', '2')
    // one way out of the run, not three
    expect(document.querySelectorAll('[data-testid="queue-back"]')).toHaveLength(1)

    await page.getByRole('button', { name: /^通过/ }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^通过/ })
      .click()
    // the next one is the second of the same two, with the first behind it
    await expect.element(place).toHaveAttribute('data-at', '2')
    await expect.element(place).toHaveAttribute('data-done', '1')
    await expect.element(place).toHaveAttribute('data-total', '2')
    expect(page.getByTestId('run-position').elements()).toHaveLength(1)
    // the key to the rest of the queue is named for where it leads, and
    // carries no second count to set against the place
    expect(page.getByTestId('queue-key').element().textContent).not.toMatch(/\d/)
  })

  // Narrow, the place is said in figures and the key keeps its name: a
  // lone word beside a list mark read as a direction, not as the queue.
  for (const width of [390, 834]) {
    it(`keeps one place and a named key at ${String(width)}`, async () => {
      await page.viewport(width, 844)
      await open()
      await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
      const place = page.getByTestId('run-position')
      await expect.element(place).toBeVisible()
      expect(place.element().textContent).toContain('1')
      const key = page.getByTestId('queue-key')
      await expect.element(key).toBeVisible()
      const text = key.element().textContent ?? ''
      expect(text.trim()).not.toBe('')
      expect(text).not.toMatch(/\d/)
      await key.click()
      await expect.element(page.getByTestId('queue-sheet')).toBeVisible()
    })
  }

  // One list, one name for it in each language: the key to it, the sheet
  // it opens and the way back to it all say the same word, and the key's
  // word is whole on a phone and a tablet.
  for (const locale of ['zh-CN', 'en-US'] as const) {
    for (const width of [390, 834]) {
      it(`names the queue one way throughout at ${String(width)} in ${locale}`, async () => {
        await page.viewport(width, 844)
        await open({}, locale)
        const key = page.getByTestId('queue-key')
        await expect.element(key).toBeVisible()
        const seat = key.element() as HTMLElement
        // the key's own word, without the letter that presses it
        const bare = seat.cloneNode(true) as HTMLElement
        for (const letter of bare.querySelectorAll('kbd')) letter.remove()
        const word = (bare.textContent ?? '').trim().toLowerCase()
        expect(word).not.toBe('')
        expect(seat.scrollWidth).toBeLessThanOrEqual(seat.clientWidth + 1)
        const back = page.getByTestId('queue-back').element().getAttribute('aria-label') ?? ''
        expect(back.toLowerCase()).toContain(word)
        await key.click()
        const sheet = page.getByTestId('queue-sheet')
        await expect.element(sheet).toBeVisible()
        const title = sheet.getByRole('heading').first().element().textContent ?? ''
        expect(title.toLowerCase()).toContain(word)
      })
    }
  }

  it('keeps the queue inside the width it is given', async () => {
    await page.viewport(390, 844)
    // a phone opens on the list of questions; the filings are a step in
    await queue(undefined, `?item=${ITEM_ID}`)
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

/** the same round standing on the ladder, contested and carrying opinions */
const onLadder = () => ({
  ...review,
  chain: {
    route: 'escalation' as const,
    stageId: 'd2',
    normal: review.chain.normal,
    escalation: [
      {
        id: 'g1',
        index: 0,
        label: '年级合议',
        nodeName: '软件2023级2班',
        roleNames: ['年级负责人'],
        reviewers: ['王老师', '李老师'],
        skipped: null,
        opinions: [
          {
            who: '王老师',
            decision: 'approve' as const,
            reason: null,
            comment: '材料充分，可以认定',
            at: '2026-03-04T00:00:00.000Z',
          },
          {
            who: '李老师',
            decision: 'reject' as const,
            reason: null,
            comment: '日期超出认定范围',
            at: '2026-03-04T01:00:00.000Z',
          },
        ],
      },
      {
        id: 'd2',
        index: 1,
        label: '辅导员终审',
        nodeName: '软件2023级2班',
        roleNames: ['辅导员'],
        reviewers: ['陈老师'],
        skipped: null,
        opinions: null,
      },
    ],
  },
  events: [
    ...review.events,
    {
      kind: 'appealed',
      actorId: PARTICIPANT_ID,
      actorName: '周予安',
      reason: null,
      comment: '原审核认定证书超期，但赛事实际举办日期在范围内',
      suggestedPayload: null,
      at: '2026-03-03T10:00:00.000Z',
    },
  ],
  actions: {
    approve: { state: 'available' as const, reason: null },
    reject: { state: 'available' as const, reason: null },
    escalate: { state: 'blocked' as const, reason: 'route-end' },
    supplement: { state: 'available' as const, reason: null },
    // a normal-route round: a rejection here goes back to whoever filed
    rejectionReturns: true,
    approvalConcludes: true,
  },
})

/** the same round returning with history behind it: a prior verdict and older rounds */
const withHistory = () => ({
  ...review,
  context: {
    ...review.context,
    previous: {
      roundNo: 4,
      kind: 'rerouted',
      reason: null,
      comment: null,
      actorName: null,
      at: '2026-08-20T15:49:37.000Z',
    },
    earlier: [
      {
        roundNo: 3,
        kind: 'cancelled-by-submitter',
        reason: null,
        actorName: null,
        at: '2026-08-20T12:47:52.000Z',
      },
      {
        roundNo: 1,
        kind: 'rejected',
        reason: '相关时间不在有效范围内',
        actorName: '示例辅导员',
        at: '2026-08-20T10:13:27.000Z',
      },
    ],
  },
})

describe('the history under the flow pane', () => {
  it('keeps the grounds readable and the clock inside the card, however narrow the column', async () => {
    // three columns at exactly the beside breakpoint: the flow column at
    // its narrowest real width, where the second-bearing clock used to run
    // out of the card and squeeze the grounds to nothing
    await page.viewport(1024, 900)
    await open({ getReviewInstance: () => Effect.succeed({ review: withHistory() }) })
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()

    const rows = page.getByTestId('earlier-row').elements()
    expect(rows.length).toBe(2)
    for (const row of rows) {
      // nothing leaves the row's own box
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
    }
    // the grounds keep readable width rather than being truncated away
    const grounds = page.getByText('相关时间不在有效范围内').first().element() as HTMLElement
    expect(grounds.getBoundingClientRect().width).toBeGreaterThan(60)
    // and the card itself holds everything, clock included
    const card = grounds.closest('[data-testid="prior-round-card"]') as HTMLElement
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1)
  })
})

// The claim above, read by the shell the product actually draws around the
// workbench: with the rail open at a desk width, the page scroller keeps no
// strip for a scrollbar the workbench never needs.
describe('the workbench inside the workspace shell', () => {
  it('stands inside the shell\u2019s main and gives up the scrollbar strip beside it', async () => {
    await page.viewport(1440, 900)
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: PAGES,
              collections: {
                'app-shell/navigation-groups': [],
                'app-shell/navigation-primary': [],
                'workspace-shell/navigation': [
                  {
                    id: 'assessment/batch-reviews/rail',
                    label: { kind: 'literal', value: '审核工作' },
                    target: {
                      kind: 'page',
                      pageId: 'assessment/batch-reviews',
                      path: '/assessment/batches/:batchId/reviews',
                    },
                    order: 10,
                  },
                ],
              },
            }),
        },
        assessment: {
          getBatch: () => Effect.succeed({ batch: batch() }),
          listReviewInbox: () =>
            Effect.succeed({ items: [inboxRow()], nextCursor: null, handledToday: 0 }),
          getReviewInstance: () => Effect.succeed({ review }),
          getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
        },
      }),
      route: `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
      children: (
        <Routes>
          <Route element={<WorkspaceShell />}>
            <Route
              path="/assessment/batches/:batchId/reviews/:instanceId"
              element={<ReviewInstancePage />}
            />
          </Route>
        </Routes>
      ),
    })
    await expect.element(page.getByTestId('workspace-rail')).toBeVisible()
    await expect.element(page.getByTestId('queue-key')).toBeVisible()
    // one place called the page's content: the shell's, with the filing a
    // named part of it rather than a second main inside the first
    expect(page.getByRole('main').elements()).toHaveLength(1)
    await expect.element(page.getByRole('region', { name: '申报内容' })).toBeInTheDocument()
    const main = page.getByRole('main').element()
    await expect.poll(() => getComputedStyle(main).scrollbarGutter).toBe('auto')
  })

  // Beside the rail a laptop's bench is narrower than the window says; the
  // three columns give way together rather than the terms being pushed off
  // its right edge - whether they share the room by their own measure or
  // were dragged wide on a bigger screen.
  for (const [width, height, dragged] of [
    [1024, 768, false],
    [1024, 768, true],
    [1280, 800, true],
  ] as const) {
    it(`keeps the three columns inside the bench at ${String(width)}, rail open${dragged ? ', dragged wide' : ''}`, async () => {
      await page.viewport(width, height)
      await renderScreen({
        storage: dragged
          ? { 'qualy:review-bench-columns': JSON.stringify({ flow: 640, about: 480 }) }
          : {},
        client: fakeClient({
          app: {
            getManifest: () =>
              Effect.succeed({
                ...emptyManifest(),
                pages: PAGES,
                collections: {
                  'app-shell/navigation-groups': [],
                  'app-shell/navigation-primary': [],
                  'workspace-shell/navigation': [
                    {
                      id: 'assessment/batch-reviews/rail',
                      label: { kind: 'literal', value: '审核工作' },
                      target: {
                        kind: 'page',
                        pageId: 'assessment/batch-reviews',
                        path: '/assessment/batches/:batchId/reviews',
                      },
                      order: 10,
                    },
                  ],
                },
              }),
          },
          assessment: {
            getBatch: () => Effect.succeed({ batch: batch() }),
            listReviewInbox: () =>
              Effect.succeed({ items: [inboxRow()], nextCursor: null, handledToday: 0 }),
            getReviewInstance: () => Effect.succeed({ review }),
            getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
          },
        }),
        route: `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
        children: (
          <Routes>
            <Route element={<WorkspaceShell />}>
              <Route
                path="/assessment/batches/:batchId/reviews/:instanceId"
                element={<ReviewInstancePage />}
              />
            </Route>
          </Routes>
        ),
      })
      await expect.element(page.getByTestId('workspace-rail')).toBeVisible()
      await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
      expect(parts()).toEqual(['flow', 'filing', 'about'])
      const edge = page.getByRole('main').element().getBoundingClientRect().right
      await expect
        .poll(() =>
          Math.max(
            ...[...document.querySelectorAll<HTMLElement>('[data-workbench-part]')].map(
              (part) => part.getBoundingClientRect().right,
            ),
          ),
        )
        .toBeLessThanOrEqual(edge + 1)
      // and each column keeps a readable width while it gives way
      for (const part of document.querySelectorAll<HTMLElement>('[data-workbench-part]')) {
        expect(part.getBoundingClientRect().width).toBeGreaterThanOrEqual(200)
      }
    })
  }
})

// Opened cold from an address - a bookmark, a link in a message, a round
// somebody else settled since - the round may not be there at all. Said in
// the room the workbench would have taken, with the way back to the queue,
// and never with a retry that cannot bring a different answer.
describe('a round the address names that is not there', () => {
  it('says so where the workbench would stand, and leads back to the queue', async () => {
    await page.viewport(1440, 900)
    await open({
      getReviewInstance: () => Effect.fail(apiError('ASSESSMENT_REVIEW_NOT_FOUND')),
    })
    const failure = page.getByTestId('review-failure')
    await expect.element(failure).toHaveAttribute('data-state', 'missing')
    // a pane's state inside the page, not the page's own heading
    await expect.element(failure.getByRole('heading', { level: 2 })).toBeVisible()
    expect(failure.getByRole('heading', { level: 1 }).elements()).toHaveLength(0)
    // nothing another try could change
    expect(failure.getByRole('button', { name: /重试/ }).elements()).toHaveLength(0)
    expect(page.getByTestId('queue-key').elements()).toHaveLength(0)
    const back = failure.getByRole('link', { name: '返回待审核列表' })
    await expect.element(back).toBeVisible()
    await back.click()
    // to the queue as this tab last left it
    await expect.poll(() => addressNow()).not.toContain(INSTANCE_ID)
    expect(addressNow()).toMatch(new RegExp(`^/assessment/batches/${BATCH_ID}/reviews(\\?|$)`))
  })

  it('does not ask about an address that cannot name a round', async () => {
    await page.viewport(1440, 900)
    const asked = vi.fn(() => Effect.succeed({ review }))
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
        assessment: {
          getBatch: () => Effect.succeed({ batch: batch() }),
          listReviewInbox: () =>
            Effect.succeed({ items: [inboxRow()], nextCursor: null, handledToday: 0 }),
          getReviewInstance: asked,
        },
      }),
      routes: [
        {
          path: '/assessment/batches/:batchId/reviews/:instanceId',
          element: <ReviewInstancePage />,
        },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews/not-a-round`,
    })
    await expect
      .element(page.getByTestId('review-failure'))
      .toHaveAttribute('data-state', 'missing')
    expect(asked).not.toHaveBeenCalled()
  })

  it('offers another try where the connection failed', async () => {
    await page.viewport(1440, 900)
    let reachable = false
    await open({
      getReviewInstance: () =>
        reachable
          ? Effect.succeed({ review })
          : Effect.fail({ _tag: 'HttpClientError', reason: { _tag: 'TransportError' } }),
    })
    await expect
      .element(page.getByTestId('review-failure'))
      .toHaveAttribute('data-state', 'offline')
    reachable = true
    await page
      .getByTestId('review-failure')
      .getByRole('button', { name: /重试/ })
      .click()
    await expect.element(page.getByTestId('queue-key')).toBeVisible()
    expect(page.getByTestId('review-failure').elements()).toHaveLength(0)
  })
})

describe('the round moving on mid-thought', () => {
  it('keeps the workbench up, says what happened, and offers the way on', async () => {
    await page.viewport(1440, 900)
    // reads succeed until the round is settled elsewhere; from then on the
    // server refuses them the way it refuses a round that stopped being
    // this reviewer's. Flag-driven, not call-counted: StrictMode makes the
    // number of initial fetches nobody's business.
    let settledElsewhere = false
    const detail = vi.fn(() =>
      settledElsewhere
        ? Effect.fail(apiError('ASSESSMENT_REVIEW_NOT_FOUND'))
        : Effect.succeed({ review }),
    )
    // one wake-up naming this round - held until the workbench has drawn,
    // the way a real decision elsewhere lands mid-read, not mid-load
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const wake = () =>
      Effect.succeed(
        Stream.concat(
          Stream.fromEffect(
            Effect.promise(() => gate).pipe(
              Effect.as({ kind: 'review-instance-changed' as const }),
            ),
          ),
          Stream.never,
        ),
      )
    await open({ getReviewInstance: detail, watchBatch: wake })

    await expect.element(page.getByText('周予安').first()).toBeVisible()
    settledElsewhere = true
    release()

    // the wake-up arrives, the refetch is refused, and the screen says so
    // where the reader stands - the workbench is not replaced by an error
    await expect.element(page.getByTestId('review-gone')).toBeVisible()
    await expect.element(page.getByText('周予安').first()).toBeVisible()

    // acting on a round that no longer exists is shut; leaving is offered
    expect(page.getByRole('button', { name: '通过', exact: true }).elements()).toHaveLength(0)
    const banner = page.getByTestId('review-gone')
    await expect.element(banner.getByRole('button', { name: '继续审核下一条' })).toBeVisible()
  })
})

// The rail's badge reads the desk's own count, not the queue, so every
// wake-up the workbench hears about the queue has to reach that count too;
// otherwise the badge sits on a stale number until its own half-minute poll.
describe('the rail badge beside the workbench', () => {
  it.each(['sync', 'phase-changed', 'review-instance-changed', 'review-inbox-changed'] as const)(
    'counts again when the queue is woken by %s',
    async (kind) => {
      await page.viewport(1440, 900)
      let waiting = 3
      const desk = () =>
        Effect.succeed({
          participant: null,
          reviewer: {
            pendingCount: waiting,
            answeredAskCount: 0,
            queueGroups: [{ name: '学业', count: waiting }],
            answeredAsks: [],
          },
        })
      let release = () => {}
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })
      const wake = () =>
        Effect.succeed(
          Stream.concat(
            Stream.fromEffect(Effect.promise(() => gate).pipe(Effect.as({ kind }))),
            Stream.never,
          ),
        )
      await renderScreen({
        client: fakeClient({
          app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
          assessment: {
            getBatch: () => Effect.succeed({ batch: batch() }),
            listReviewInbox: () =>
              Effect.succeed({ items: [inboxRow()], nextCursor: null, handledToday: 0 }),
            getReviewInstance: () => Effect.succeed({ review }),
            getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
            getMyOverview: desk,
            watchBatch: wake,
          },
        }),
        routes: [
          {
            path: '/assessment/batches/:batchId/reviews/:instanceId',
            // the rail the shell draws beside the page, holding the badge
            element: (
              <>
                <QueueBadge context={{ navigationId: 'assessment/batch-reviews/rail' }} />
                <div style={{ display: 'flex', height: '90dvh', flexDirection: 'column' }}>
                  <ReviewInstancePage />
                </div>
              </>
            ),
          },
        ] as never,
        route: `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
      })
      await expect.element(page.getByTestId('queue-badge')).toHaveAttribute('data-count', '3')

      // somebody else takes one off the queue, and the wake-up says so
      waiting = 2
      release()
      await expect.element(page.getByTestId('queue-badge')).toHaveAttribute('data-count', '2')
    },
  )
})

describe('the escalation environment', () => {
  it('wears the caution band, names the steps, and hands the judge every earlier opinion', async () => {
    await page.viewport(1440, 900)
    await open({ getReviewInstance: () => Effect.succeed({ review: onLadder() }) })
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()

    // the mode is worn, not explained: a band over the workbench, and the
    // route attribute the shell styles by
    await expect.element(page.getByTestId('escalation-light')).toBeVisible()
    await expect.element(page.getByTestId('escalation-card')).toBeVisible()
    expect(document.querySelector('[data-review-route="escalation"]')).not.toBeNull()

    // the appellant's grounds are business evidence, and they are on screen
    // (twice, in fact: the banner leads with them and the trail records them)
    await expect
      .element(page.getByText('原审核认定证书超期，但赛事实际举办日期在范围内').first())
      .toBeVisible()

    // the administrator's names for the steps carry the route
    await expect.element(page.getByText('年级合议')).toBeVisible()
    await expect.element(page.getByText('辅导员终审')).toBeVisible()

    // the concluded sitting's opinions, each with its direction on record
    const opinions = page.getByTestId('stage-opinions')
    await expect.element(opinions).toBeVisible()
    const directions = [...opinions.element().querySelectorAll('[data-opinion]')].map((node) =>
      node.getAttribute('data-opinion'),
    )
    expect(directions).toEqual(['approve', 'reject'])
    await expect.element(page.getByText('日期超出认定范围')).toBeVisible()

    // on the ladder's last rung the four acts stand, escalating explained away
    await expect.element(page.getByTestId('act-escalate')).toHaveAttribute('data-offer', 'blocked')
    await expect.element(page.getByTestId('act-reject')).toHaveAttribute('data-offer', 'available')
  })
})

describe('the four acts, always on the bar', () => {
  it('shows a blocked act standing, and a press answers with the reason', async () => {
    const restore = asThumb()
    try {
      await page.viewport(390, 844)
      await open()
      await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()

      // all four acts stand whatever this round offers; the blocked one is
      // dimmed, not gone
      for (const act of ['escalate', 'supplement', 'reject', 'approve']) {
        await expect.element(page.getByTestId(`act-${act}`)).toBeVisible()
      }
      await expect
        .element(page.getByTestId('act-escalate'))
        .toHaveAttribute('data-offer', 'blocked')

      // Under a thumb there is no hover, so the press itself asks why -
      // and the act must not open anything. A DOM click, because the
      // runner's actionability check refuses aria-disabled targets; a real
      // thumb is under no such rule, which is exactly why the key answers.
      ;(page.getByTestId('act-escalate').element() as HTMLElement).click()
      expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull()
      // the press answered: something was said, and the key names the fact
      // it was said about. The sentence itself is the localization suite's.
      await expect
        .element(page.getByTestId('act-escalate'))
        .toHaveAttribute('data-blocked-reason', 'no-route')
      await expect.poll(() => document.querySelectorAll('[data-sonner-toast]').length).toBe(1)
    } finally {
      restore()
    }
  })

  it('keeps the routing pair compact and the verdict pair full-width on a phone', async () => {
    await page.viewport(390, 844)
    await open()
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    const of = (id: string) => page.getByTestId(id).element().getBoundingClientRect()
    const escalate = of('act-escalate')
    const supplement = of('act-supplement')
    const reject = of('act-reject')
    const approve = of('act-approve')
    // a 2x2 matrix: both rows edge to edge, no stray blank beside anybody
    expect(escalate.top).toBe(supplement.top)
    expect(reject.top).toBe(approve.top)
    expect(reject.top).toBeGreaterThan(escalate.bottom - 1)
    expect(Math.abs(reject.width - approve.width)).toBeLessThan(2)
    expect(Math.abs(escalate.width - reject.width)).toBeLessThan(2)
    // and a register between the rows: the verdicts stand taller
    expect(reject.height).toBeGreaterThan(escalate.height)
  })

  // Half a phone's width is what each routing key has, in either language:
  // a name that runs past it is a key whose act nobody can read.
  for (const locale of ['zh-CN', 'en-US'] as const) {
    it(`says each act whole on a phone (${locale})`, async () => {
      await page.viewport(390, 844)
      await open({}, locale)
      await expect.element(page.getByTestId('act-supplement')).toBeVisible()
      for (const act of ['act-escalate', 'act-supplement', 'act-reject', 'act-approve']) {
        const key = page.getByTestId(act).element() as HTMLElement
        // the key and whatever inside it holds the words
        for (const part of [key, ...key.querySelectorAll<HTMLElement>('*')]) {
          expect(part.scrollWidth, act).toBeLessThanOrEqual(part.clientWidth + 1)
        }
      }
    })
  }
})

describe('the pager knows what must not be missed', () => {
  it('lifts the escalation over the pager, dots the flow face, and guards the verdict', async () => {
    await page.viewport(390, 844)
    await open({ getReviewInstance: () => Effect.succeed({ review: onLadder() }) })
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()

    // the notice stands over the faces, readable while the filing is up
    await expect.element(page.getByTestId('escalation-card')).toBeVisible()
    // the filing face opens with its two-line situation strip
    await expect.element(page.getByTestId('filing-summary')).toBeVisible()
    // and the flow face wears a fact dot: something there shaped this round
    await expect
      .element(page.getByTestId('workbench-anchor').nth(0))
      .toHaveAttribute('data-attention', 'yes')

    // the verdict asks its one quiet question when the face is still unread
    await page.getByTestId('act-approve').click()
    await expect.element(page.getByTestId('decision-caution')).toBeVisible()

    // its first link walks to the flow face; the dot has done its work
    const caution = () => page.getByTestId('decision-caution')
    await caution().getByRole('button', { name: '查看' }).first().click()
    await vi.waitFor(async () => {
      await expect
        .element(page.getByTestId('workbench-anchor').nth(0))
        .toHaveAttribute('data-reading', 'yes')
    })
    await expect
      .element(page.getByTestId('workbench-anchor').nth(0))
      .toHaveAttribute('data-attention', 'no')

    // the terms face still owes a look: the question comes back one line
    // shorter, and its link settles the last of it
    await page.getByTestId('act-approve').click()
    await expect.element(caution()).toBeVisible()
    await caution().getByRole('button', { name: '查看' }).first().click()
    await vi.waitFor(async () => {
      await expect
        .element(page.getByTestId('workbench-anchor').nth(2))
        .toHaveAttribute('data-reading', 'yes')
    })

    // asked and answered everywhere: the next verdict opens clean
    await page.getByTestId('act-approve').click()
    await expect.element(page.getByTestId('act-approve')).toBeVisible()
    expect(page.getByTestId('decision-caution').elements()).toHaveLength(0)
  })
})

describe('sending, under a thumb', () => {
  it('opens the act as a sheet, and sends only on a full slide', async () => {
    const restore = asThumb()
    try {
      await page.viewport(390, 844)
      const decided = vi.fn(() =>
        Effect.succeed({ review: { ...review, state: 'completed', outcome: 'approved' } }),
      )
      await open({ decideReview: decided })
      await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()

      // a decision is an act with its own panel: the tap opens it and sends
      // nothing
      await page.getByRole('button', { name: /^通过/ }).click()
      await expect.element(page.getByRole('dialog')).toBeVisible()
      expect(page.getByTestId('decision-staged').elements()).toHaveLength(0)

      // a tap on the slider is not a send, and neither is half a carry
      const slider = page.getByTestId('slide-confirm')
      await expect.element(slider).toBeVisible()
      const handle = document.querySelector('[data-slide-handle]')!
      const track = slider.element().getBoundingClientRect()
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: track.left + 20 }),
      )
      handle.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 1,
          clientX: track.left + track.width * 0.4,
        }),
      )
      handle.dispatchEvent(
        new PointerEvent('pointerup', {
          bubbles: true,
          pointerId: 1,
          clientX: track.left + track.width * 0.4,
        }),
      )
      await new Promise((done) => setTimeout(done, 250))
      expect(page.getByTestId('decision-staged').elements()).toHaveLength(0)

      // carried all the way across, the act goes out
      handle.dispatchEvent(
        new PointerEvent('pointerdown', { bubbles: true, pointerId: 2, clientX: track.left + 20 }),
      )
      handle.dispatchEvent(
        new PointerEvent('pointermove', {
          bubbles: true,
          pointerId: 2,
          clientX: track.right + 40,
        }),
      )
      handle.dispatchEvent(
        new PointerEvent('pointerup', { bubbles: true, pointerId: 2, clientX: track.right + 40 }),
      )
      await vi.waitFor(() => expect(page.getByTestId('decision-staged').elements()).toHaveLength(1))
      await expect
        .element(page.getByTestId('decision-staged'))
        .toHaveAttribute('data-decision', 'approve')
    } finally {
      restore()
    }
  })
})

describe('the version picker', () => {
  const revision = (no: number, id: string) => ({
    id,
    revisionNo: no,
    payload: {},
    formConfig: {},
    note: null,
    createdAt: `2026-08-21T0${no}:00:00.000Z`,
  })

  // The picker is a list somebody chooses from with the keyboard beside the
  // rest of the workbench: the digits pick and the same chord that confirms a
  // decision confirms this. The judged version is not one of them, so the
  // digits count what can be chosen rather than what is drawn.
  it('picks a version by digit and confirms with the decision chord', async () => {
    const history = {
      revisions: [revision(1, 'rev-1'), revision(2, 'rev-2'), revision(3, 'rev-3')],
      events: [],
      rounds: [],
    }
    // the round judges the newest version, which is the shape the picker is
    // drawn for: everything under it is something to read against
    await open({
      getEntryHistory: () => Effect.succeed(history),
      getReviewInstance: () =>
        Effect.succeed({ review: { ...review, revision: { ...review.revision, revisionNo: 3 } } }),
    })
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()

    await userEvent.keyboard('{Shift>}D{/Shift}')
    const rows = () => [...document.querySelectorAll('[data-testid="version-row"]')]
    await expect.poll(() => rows().length).toBe(3)
    // newest first, and the one under judgement stands out of the running
    expect(rows().map((row) => row.getAttribute('data-version'))).toEqual(['3', '2', '1'])
    expect(rows()[0]?.getAttribute('data-standing')).toBe('judged')

    const comparing = () =>
      rows()
        .find((row) => row.getAttribute('data-standing') === 'comparing')
        ?.getAttribute('data-version')
    // the sheet opens on whatever the screen behind it was already reading,
    // which is the version below the judged one - so the first press has to
    // move it somewhere else, or a dead shortcut would pass this
    expect(comparing()).toBe('2')
    // 2 is the second version that can be chosen, not the second drawn
    await userEvent.keyboard('2')
    await expect.poll(comparing).toBe('1')
    await userEvent.keyboard('1')
    await expect.poll(comparing).toBe('2')

    // and the chord that confirms a decision confirms this one
    await userEvent.keyboard('{Meta>}{Enter}{/Meta}')
    await expect.poll(() => rows().length).toBe(0)
  })

  // The versions could not be read: said inside the sheet, under its own
  // title, with another try only where one could bring them.
  it.each([
    ['ASSESSMENT_ENTRY_NOT_FOUND', 'missing', false],
    ['SERVICE_UNAVAILABLE', 'unavailable', true],
  ] as const)('says a %s reading of the versions inside the sheet', async (code, state, retry) => {
    await open({
      getEntryHistory: () => Effect.fail(apiError(code)),
      getReviewInstance: () =>
        Effect.succeed({ review: { ...review, revision: { ...review.revision, revisionNo: 3 } } }),
    })
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    await userEvent.keyboard('{Shift>}D{/Shift}')
    const sheet = page.getByRole('dialog')
    const failure = sheet.element().querySelector('[data-slot="resource-state"]')
    await expect.poll(() => failure?.getAttribute('data-state') ?? null).toBe(state)
    // under the sheet's own title
    expect(failure?.querySelector('h3')).not.toBeNull()
    expect(failure?.querySelector('h2')).toBeNull()
    expect(failure?.querySelectorAll('button')).toHaveLength(retry ? 1 : 0)
  })
})

describe('a queue longer than one page', () => {
  const LATER_ID = '99999999-9999-4999-8999-999999999998'
  // the api serves the queue oldest first, a page at a time; the second page
  // holds a submission the first fifty never mention
  const paged = (seen: (string | undefined)[]) => (input: { query: { cursor?: string } }) => {
    seen.push(input.query.cursor)
    return Effect.succeed(
      input.query.cursor === undefined
        ? { items: [inboxRow()], nextCursor: 'second-page', handledToday: 0 }
        : {
            items: [
              inboxRow({ instanceId: LATER_ID, participantName: '赵六', businessNo: '2023019999' }),
            ],
            nextCursor: null,
            handledToday: 0,
          },
    )
  }
  const stubs = (seen: (string | undefined)[]) => ({
    app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
    assessment: {
      getBatch: () => Effect.succeed({ batch: batch() }),
      listReviewInbox: paged(seen),
      listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
    },
  })

  it('counts, and finds, what only the second page carries', async () => {
    await page.viewport(1280, 800)
    const seen: (string | undefined)[] = []
    await renderScreen({
      client: fakeClient(stubs(seen)),
      routes: [
        { path: '/assessment/batches/:batchId/reviews', element: <ReviewInboxPage /> },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews?q=2023019999`,
    })

    await expect.element(page.getByTestId('review-stats')).toHaveAttribute('data-pending', '2')
    // the search runs over the whole queue, so the later filer is found
    await expect.element(page.getByText('赵六').first()).toBeVisible()
    expect(seen).toContain('second-page')
  })

  // The rail stands on every page of the round, so its count is the one the
  // server keeps, not the queue walked a page at a time every half minute.
  it('badges the rail with the queue\u2019s own count, without walking the queue', async () => {
    const seen: (string | undefined)[] = []
    const base = stubs(seen)
    await renderScreen({
      client: fakeClient({
        ...base,
        assessment: {
          ...base.assessment,
          getMyOverview: () =>
            Effect.succeed({
              participant: null,
              reviewer: {
                pendingCount: 2,
                answeredAskCount: 0,
                queueGroups: [{ name: '学业', count: 2 }],
                answeredAsks: [],
              },
            }),
        },
      }),
      routes: [
        {
          path: '/assessment/batches/:batchId/reviews',
          element: <QueueBadge context={{ navigationId: 'assessment/batch-reviews/rail' }} />,
        },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews`,
    })

    await expect.element(page.getByTestId('queue-badge')).toHaveAttribute('data-count', '2')
    expect(seen).toEqual([])
  })

  // Read for the first time and failed, the queue says why where it would
  // stand, on a card of its own under the page's title; another try is
  // offered where one could bring a different answer, and brings the queue.
  it('says a queue that could not be read where it would stand', async () => {
    await page.viewport(1280, 800)
    let reachable = false
    const seen: (string | undefined)[] = []
    const base = stubs(seen)
    const listed = paged(seen)
    await renderScreen({
      client: fakeClient({
        ...base,
        assessment: {
          ...base.assessment,
          listReviewInbox: (input: { query: { cursor?: string } }) =>
            reachable ? listed(input) : Effect.fail(apiError('SERVICE_UNAVAILABLE')),
        },
      }),
      routes: [
        { path: '/assessment/batches/:batchId/reviews', element: <ReviewInboxPage /> },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews`,
    })
    const failure = page
      .getByResourceState()
      .filter({ has: page.getByRole('heading', { level: 2 }) })
    await expect.element(failure).toBeVisible()
    const seat = failure.element()
    expect(seat.getAttribute('data-state')).toBe('unavailable')
    // standing on the page's ground, not a hole in it
    expect(getComputedStyle(seat).boxShadow).not.toBe('none')
    reachable = true
    await failure.getByRole('button', { name: /重试/ }).click()
    await expect.element(page.getByTestId('review-stats')).toHaveAttribute('data-pending', '2')
  })

  it('offers no other try for a queue whose batch has gone', async () => {
    await page.viewport(1280, 800)
    const seen: (string | undefined)[] = []
    const base = stubs(seen)
    await renderScreen({
      client: fakeClient({
        ...base,
        assessment: {
          ...base.assessment,
          listReviewInbox: () => Effect.fail(apiError('ASSESSMENT_BATCH_NOT_FOUND')),
        },
      }),
      routes: [
        { path: '/assessment/batches/:batchId/reviews', element: <ReviewInboxPage /> },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews`,
    })
    const state = () => document.querySelector('[data-slot="resource-state"]')
    await expect.poll(() => state()?.getAttribute('data-state') ?? null).toBe('missing')
    expect(state()?.querySelectorAll('button')).toHaveLength(0)
  })

  it('keeps the queue it showed when a later read of it fails', async () => {
    await page.viewport(1280, 800)
    let reachable = true
    let refused = 0
    const seen: (string | undefined)[] = []
    const base = stubs(seen)
    const listed = paged(seen)
    await renderScreen({
      client: fakeClient({
        ...base,
        assessment: {
          ...base.assessment,
          listReviewInbox: (input: { query: { cursor?: string } }) =>
            reachable
              ? listed(input)
              : Effect.sync(() => {
                  refused += 1
                }).pipe(Effect.andThen(Effect.fail(apiError('ASSESSMENT_BATCH_NOT_FOUND')))),
        },
      }),
      routes: [
        { path: '/assessment/batches/:batchId/reviews', element: <ReviewInboxPage /> },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews`,
    })
    await expect.element(page.getByTestId('review-stats')).toHaveAttribute('data-pending', '2')

    // read again in the background, and this time the read fails
    reachable = false
    window.dispatchEvent(new Event('visibilitychange'))
    await vi.waitFor(() => expect(refused).toBeGreaterThan(0))
    await new Promise((settle) => setTimeout(settle, 300))

    // the queue it had stands; the page is not swapped for an error
    await expect.element(page.getByTestId('review-stats')).toHaveAttribute('data-pending', '2')
  })
})

// The queue a page at a time: by question the questions stand in a list
// beside one question's filings, ten to a page, the page in the address; a
// run started from a page still walks the whole question, and the way back
// from the workbench finds the queue where it was left.
describe('the queue, a page at a time', () => {
  const OTHER_ITEM = '66666666-6666-4666-8666-666666666666'
  const rowId = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`
  /** a question with `count` filings, arriving a minute apart from `from` */
  const filings = (count: number, from: number, over: Record<string, unknown> = {}) =>
    Array.from({ length: count }, (_, index) =>
      inboxRow({
        instanceId: rowId(from + index),
        participantName: `参评人${String(from + index)}`,
        businessNo: `20230${String(from + index).padStart(5, '0')}`,
        submittedAt: new Date(Date.UTC(2026, 2, 3, 0, from + index)).toISOString(),
        ...over,
      }),
    )
  // the api serves the queue oldest first: the long question arrived first
  const both = () => [
    ...filings(23, 0),
    ...filings(2, 100, { itemId: OTHER_ITEM, itemTitle: '志愿服务时长' }),
  ]
  const inboxOf = (items: readonly Record<string, unknown>[]) => ({
    items,
    nextCursor: null,
    handledToday: 4,
    judging: true,
  })
  const withBench = (items: readonly Record<string, unknown>[], search = '') =>
    renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
        assessment: {
          getBatch: () => Effect.succeed({ batch: batch() }),
          listReviewInbox: () => Effect.succeed(inboxOf(items)),
          listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
          getReviewInstance: () => Effect.succeed({ review }),
          getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
        },
      }),
      routes: [
        { path: '/assessment/batches/:batchId/reviews', element: <ReviewInboxPage /> },
        {
          path: '/assessment/batches/:batchId/reviews/:instanceId',
          element: (
            <div style={{ display: 'flex', height: '100dvh', flexDirection: 'column' }}>
              <ReviewInstancePage />
            </div>
          ),
        },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews${search}`,
    })
  const masters = () => page.getByTestId('queue-master-row')
  const rows = () => page.getByTestId('inbox-row')

  afterEach(() => window.sessionStorage.clear())

  it('lists the questions beside one question’s filings, ten to a page', async () => {
    await page.viewport(1440, 900)
    await queue(inboxOf(both()))
    // every question with work, oldest first, and how much each holds
    await expect.element(masters().first()).toHaveAttribute('data-key', ITEM_ID)
    expect(
      masters()
        .elements()
        .map((row) => row.getAttribute('data-count')),
    ).toEqual(['23', '2'])
    // at a desk the question that has waited longest is open without a press
    await expect.element(page.getByTestId('queue-pane')).toHaveAttribute('data-key', ITEM_ID)
    await expect.element(masters().first()).toHaveAttribute('data-selected', 'true')
    expect(rows().elements()).toHaveLength(10)
    const pager = page.getByTestId('review-queue-pager')
    await expect.element(pager).toHaveAttribute('data-pages', '3')

    await pager.getByRole('button', { name: '3' }).click()
    await expect.element(rows().first()).toHaveAttribute('data-instance', rowId(20))
    expect(rows().elements()).toHaveLength(3)
    expect(addressNow()).toContain('page=3')

    // another question starts from its own first page, and one page needs no strip
    await masters().nth(1).click()
    await expect.element(page.getByTestId('queue-pane')).toHaveAttribute('data-key', OTHER_ITEM)
    expect(rows().elements()).toHaveLength(2)
    expect(addressNow()).not.toContain('page=')
    expect(page.getByTestId('review-queue-pager').elements()).toHaveLength(0)
  })

  // How much is waiting and how much moved today is about the whole queue,
  // so it is said once, in the band, not beside the filters of one view.
  it('says the whole queue’s standing in the band, whichever view is open', async () => {
    await page.viewport(1440, 900)
    await queue(inboxOf(both()), '?view=person')
    const stats = page.getByTestId('batch-band').getByTestId('review-stats')
    await expect.element(stats).toHaveAttribute('data-pending', '25')
    await expect.element(stats).toHaveAttribute('data-today', '4')
  })

  // Every row of the queue is waiting; a word saying so on each of them was
  // a column of noise. Only a round that is not simply waiting is marked.
  it('marks only the rounds that are more than waiting', async () => {
    await page.viewport(1440, 900)
    await queue(
      inboxOf([
        ...filings(1, 0),
        ...filings(1, 1, { route: 'escalation' }),
        ...filings(1, 2, { roundNo: 2 }),
      ]),
    )
    await expect.element(rows().first()).toBeVisible()
    const marks = rows()
      .elements()
      .map((row) => row.querySelector('[data-testid="inbox-row-mark"]')?.getAttribute('data-mark'))
    expect(marks).toEqual([undefined, 'escalated', 'round'])
  })

  it('walks the whole question from a page of it, and comes back to that page', async () => {
    await page.viewport(1440, 900)
    await withBench(both(), '?page=2')
    await expect.element(page.getByTestId('review-queue-pager')).toHaveAttribute('data-page', '2')

    // a row on the second page opens the run over the whole question
    await rows().first().click()
    await expect.element(page.getByTestId('run-position')).toHaveAttribute('data-total', '23')
    await expect.element(page.getByTestId('run-position')).toHaveAttribute('data-at', '11')
    // the place is the one count on the bar, and the queue it opens lists
    // what the place counts: the whole question, none of it dealt with yet
    expect(page.getByTestId('queue-key').element().textContent).not.toMatch(/\d/)
    await page.getByTestId('queue-key').click()
    await expect.element(page.getByTestId('queue-sheet')).toBeVisible()
    expect(page.getByTestId('queue-row').elements()).toHaveLength(23)
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('[data-testid="queue-sheet"]')).toBeNull()

    // and the way back finds the queue on the page it was left on
    await page.getByTestId('queue-back').click()
    await expect.element(page.getByTestId('review-queue-pager')).toHaveAttribute('data-page', '2')
    await expect.element(page.getByTestId('queue-pane')).toHaveAttribute('data-key', ITEM_ID)
  })

  // The band's key is for somebody who only wants to get through what is
  // waiting: the whole queue, from its oldest filing.
  it('starts the whole queue from its oldest filing from the band', async () => {
    await page.viewport(1440, 900)
    await withBench(both(), `?item=${OTHER_ITEM}`)
    await page.getByTestId('review-start').click()
    await expect.element(page.getByTestId('run-position')).toHaveAttribute('data-total', '25')
    await expect.element(page.getByTestId('run-position')).toHaveAttribute('data-at', '1')
  })

  // Narrower than a desk the list and a question's filings are one screen
  // after the other: the list first, the filings a step in, and back.
  it('steps into a question and back out on a phone', async () => {
    await page.viewport(390, 844)
    await queue(inboxOf(both()))
    await expect.element(masters().first()).toBeVisible()
    expect(rows().elements()).toHaveLength(0)

    await masters().nth(1).click()
    await expect.element(page.getByTestId('queue-pane')).toHaveAttribute('data-key', OTHER_ITEM)
    expect(rows().elements()).toHaveLength(2)

    await page.getByTestId('queue-pane-back').click()
    await expect.element(masters().first()).toBeVisible()
    expect(page.getByTestId('queue-pane').elements()).toHaveLength(0)
  })

  it('lays the whole queue out by time, twenty to a page', async () => {
    await page.viewport(1440, 900)
    await queue(inboxOf(both()), '?view=time')
    await expect.element(rows().first()).toHaveAttribute('data-instance', rowId(0))
    expect(page.getByTestId('queue-master-row').elements()).toHaveLength(0)
    expect(rows().elements()).toHaveLength(20)
    await expect.element(page.getByTestId('review-queue-pager')).toHaveAttribute('data-total', '25')
  })
})

// The reviewer judges somebody placed somewhere, and the header says where
// from the unit's own end; the whole chain, from the school down, is a press
// away - beside the pointer on a desk, from the foot on a phone.
describe('where the person being judged stands', () => {
  const chain = () => [...document.querySelectorAll('[data-testid="unit-chain"] li')]

  it('names the unit in the header and opens the whole chain on a press', async () => {
    await page.viewport(1440, 900)
    await open()
    const unit = page.getByTestId('review-unit')
    await expect.element(unit).toBeVisible()
    // the line leaves off the root the whole round shares
    await expect
      .element(unit.getByTestId('unit-path'))
      .toHaveAttribute('data-steps', String(review.unitPath.length - 1))
    await unit.getByTestId('unit-chain-open').click()
    await expect.element(page.getByTestId('unit-chain')).toBeVisible()
    expect(chain().map((level) => level.textContent)).toEqual(review.unitPath)
    expect(chain().at(-1)!.getAttribute('aria-current')).toBe('true')
    await userEvent.keyboard('{Escape}')
    await expect.element(page.getByTestId('unit-chain')).not.toBeInTheDocument()
  })

  // On a phone the header has no room beside the name for a unit: it takes a
  // line of its own, and the unit itself - the last step - is said whole,
  // while nothing on the name's line runs under the key to the queue.
  for (const width of [360, 390]) {
    for (const name of ['周予安', '阿卜杜热合曼·买买提江·艾力']) {
      it(`gives the unit a line of its own at ${String(width)}, clear of the queue key (${name})`, async () => {
        await page.viewport(width, 844)
        await open({
          getReviewInstance: () => Effect.succeed({ review: { ...review, participantName: name } }),
        })
        const unit = page.getByTestId('review-unit')
        await expect.element(unit).toBeVisible()
        const path = unit.getByTestId('unit-path').element()
        const last = path.querySelector(`[data-path-step="${String(review.unitPath.length - 2)}"]`)!
        const box = last.getBoundingClientRect()
        const line = path.getBoundingClientRect()
        // on the line that shows, and all of it
        expect(box.width).toBeGreaterThan(0)
        expect(box.top).toBeLessThan(line.bottom - 1)
        const words = last.lastElementChild as HTMLElement
        expect(words.scrollWidth).toBeLessThanOrEqual(words.clientWidth)
        // a line of its own: under the name, not beside it
        const heading = page.getByRole('heading', { level: 2, name }).element()
        expect(box.top).toBeGreaterThanOrEqual(heading.getBoundingClientRect().bottom - 1)
        // and nothing of the person runs under the key to the queue
        const key = page.getByTestId('queue-key').element().getBoundingClientRect()
        const number = heading.nextElementSibling!
        expect(number.textContent).toBe(review.businessNo)
        for (const part of [heading, number, last]) {
          expect(part.getBoundingClientRect().right).toBeLessThanOrEqual(key.left)
        }
      })
    }
  }

  // A unit deleted from the organization since the round froze the lineage
  // comes back unnamed. It is said to be gone, once for a run of them, and
  // never with the mark the line puts in front of the levels it left off.
  it('says a unit that has gone as gone, never as a level left off', async () => {
    await page.viewport(1440, 900)
    await open({
      getReviewInstance: () =>
        Effect.succeed({
          review: { ...review, unitName: null, unitPath: ['示例大学', null, null] },
        }),
    })
    const unit = page.getByTestId('review-unit')
    await expect.element(unit).toHaveAttribute('data-gone', '2')
    const path = unit.getByTestId('unit-path')
    // one level, the one that went, and nothing folded in front of it
    await expect.element(path).toHaveAttribute('data-steps', '1')
    await expect.element(path).toHaveAttribute('data-clipped', 'false')
    const said = [...path.element().querySelectorAll('[data-path-step]')].map((step) =>
      step.textContent?.replace('/', '').trim(),
    )
    expect(said).not.toContain(UNNAMED)
    expect(said.every((one) => one !== '')).toBe(true)
    // the whole chain keeps the root and says the rest is gone
    await unit.getByTestId('unit-chain-open').click()
    await expect.element(page.getByTestId('unit-chain')).toBeVisible()
    expect(chain().map((level) => level.textContent)).toEqual(['示例大学', said[0]])
    await userEvent.keyboard('{Escape}')
  })

  it('keeps the unit in reach on a phone, and raises the chain from the foot', async () => {
    await page.viewport(390, 844)
    await open()
    const unit = page.getByTestId('review-unit')
    await expect.element(unit).toBeVisible()
    await unit.getByTestId('unit-chain-open').click()
    const sheet = page.getByTestId('unit-chain')
    await expect.element(sheet).toHaveAttribute('data-side', 'bottom')
    expect(chain().map((level) => level.textContent)).toEqual(review.unitPath)
  })
})
