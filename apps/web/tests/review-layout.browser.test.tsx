import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect, Stream } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
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
  it('pages the parts on a phone and opens on the filing', async () => {
    page.viewport(390, 844)
    open()
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
    page.viewport(1024, 900)
    open({ getReviewInstance: () => Effect.succeed({ review: withHistory() }) })
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
    const card = grounds.closest('[class*="rounded-xl"]') as HTMLElement
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1)
  })
})

describe('the round moving on mid-thought', () => {
  it('keeps the workbench up, says what happened, and offers the way on', async () => {
    page.viewport(1440, 900)
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
    open({ getReviewInstance: detail as never, watchBatch: wake as never })

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

describe('the escalation environment', () => {
  it('wears the caution band, names the steps, and hands the judge every earlier opinion', async () => {
    page.viewport(1440, 900)
    open({ getReviewInstance: () => Effect.succeed({ review: onLadder() }) })
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
      page.viewport(390, 844)
      open()
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
      await expect.element(page.getByText('该题未配置复核流程')).toBeVisible()
    } finally {
      restore()
    }
  })

  it('keeps the routing pair compact and the verdict pair full-width on a phone', async () => {
    page.viewport(390, 844)
    open()
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
})

describe('the pager knows what must not be missed', () => {
  it('lifts the escalation over the pager, dots the flow face, and guards the verdict', async () => {
    page.viewport(390, 844)
    open({ getReviewInstance: () => Effect.succeed({ review: onLadder() }) })
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
      page.viewport(390, 844)
      const decided = vi.fn(() =>
        Effect.succeed({ review: { ...review, state: 'completed', outcome: 'approved' } }),
      )
      open({ decideReview: decided as never })
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
