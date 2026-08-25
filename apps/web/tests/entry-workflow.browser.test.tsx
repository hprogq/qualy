import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import type { ApiResult, ClientOf } from '@qualy/web-runtime/api'
import type { assessmentApi } from '@qualy/plugin-assessment/client/api'
import { components } from 'virtual:qualy/plugins'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// The entry workflow as a person drives it: filing a claim on a question,
// following what a reviewer did to it, judging one from the queue, and
// reading one's own standing. Every case runs the real screens over a
// stubbed wire and asserts by role and label, the way a person would look.

const MyEntriesPage = (await components['assessment/MyEntriesPage']!()).default
const BatchOverviewPage = (await components['assessment/BatchOverviewPage']!()).default
const ReviewInboxPage = (await components['assessment/ReviewInboxPage']!()).default
const ReviewInstancePage = (await components['assessment/ReviewInstancePage']!()).default
const MyResultPage = (await components['assessment/MyResultPage']!()).default

type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']
type ItemDto = ApiResult<typeof assessmentApi, 'assessment', 'listItems'>['items'][number]
type EntryDto = ApiResult<typeof assessmentApi, 'assessment', 'listMyEntries'>['entries'][number]

type Clients = ClientOf<typeof assessmentApi>
type Stubs = Partial<Record<keyof Clients['assessment'], (...args: never[]) => unknown>>

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444'
const INSTANCE_ID = '55555555-5555-4555-8555-555555555555'
const REVISION_ID = '66666666-6666-4666-8666-666666666666'
const GROUP_ID = '77777777-7777-4777-8777-777777777777'
const REQUEST_ID = '88888888-8888-4888-8888-888888888888'
const ITEM2_ID = '99999999-8888-4888-8888-888888888888'
const ITEM3_ID = '99999999-7777-4777-8777-777777777777'

// whatever a case did to the window, the next one starts on the phone
afterEach(() => page.viewport(414, 896))

/**
 * The instance of a hook the user can actually see. A testid may render in
 * several seats (a desktop header row, a mobile empty state) with CSS
 * choosing one per viewport; clicking "the first in the DOM" clicks a
 * hidden one on a phone.
 */
async function clickVisible(testId: string) {
  await expect.element(page.getByTestId(testId).first()).toBeInTheDocument()
  await vi.waitFor(() => {
    const el = page
      .getByTestId(testId)
      .elements()
      .find((candidate) => (candidate as HTMLElement).checkVisibility())
    expect(el).toBeDefined()
  })
  const el = page
    .getByTestId(testId)
    .elements()
    .find((candidate) => (candidate as HTMLElement).checkVisibility())!
  await userEvent.click(el)
}

const PAGES = [
  { id: 'assessment/batch-my-entries', path: '/assessment/batches/:batchId/my-entries' },
  { id: 'assessment/batch-overview', path: '/assessment/batches/:batchId' },
  { id: 'assessment/batch-reviews', path: '/assessment/batches/:batchId/reviews' },
  {
    id: 'assessment/review-instance',
    path: '/assessment/batches/:batchId/reviews/:instanceId',
  },
  { id: 'assessment/batch-my-result', path: '/assessment/batches/:batchId/my-result' },
].map((entry) => ({ ...entry, component: entry.id, layout: 'admin' }))

const batch = (): BatchDto => ({
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

const item = (over: Partial<ItemDto> = {}): ItemDto => ({
  id: ITEM_ID,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title: '退役复学',
  scoreGroupId: GROUP_ID,
  maxEntries: 1,
  sortOrder: 0,
  status: 'active',
  voidReason: null,
  currentRevision: {
    id: REVISION_ID,
    revisionNo: 1,
    entrySource: 'student',
    formConfig: {
      fields: [{ key: 'summary', type: 'text', label: '事项说明', required: true }],
    },
    scoringConfig: {},
    reviewPolicy: {},
    displayConfig: null,
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  createdAt: '2026-03-01T00:00:00.000Z',
  ...over,
})

const entry = (over: Partial<EntryDto> = {}): EntryDto => ({
  id: ENTRY_ID,
  batchId: BATCH_ID,
  itemId: ITEM_ID,
  participantId: PARTICIPANT_ID,
  status: 'draft',
  source: 'self',
  currentRevision: {
    id: REVISION_ID,
    revisionNo: 1,
    itemRevisionId: REVISION_ID,
    payload: { summary: '2024 年入伍，2026 年退役复学' },
    note: null,
    source: 'self',
    actorId: PARTICIPANT_ID,
    subjectId: PARTICIPANT_ID,
    attachments: [],
    createdAt: '2026-03-02T00:00:00.000Z',
  },
  currentReviewInstanceId: null,
  createdAt: '2026-03-02T00:00:00.000Z',
  supplement: null,
  refusal: null,
  capabilities: {
    edit: { state: 'available' as const, reason: null },
    submit: { state: 'available' as const, reason: null },
    withdraw: { state: 'hidden' as const, reason: null },
    appeal: { state: 'hidden' as const, reason: null },
    abandon: { state: 'available' as const, reason: null },
  },
  ...over,
})

/** the reads every batch screen makes before it draws anything */
const ambient = {
  getBatch: () => Effect.succeed({ batch: batch() }),
  // the result page reads the filings for its counts; empty unless a case
  // says otherwise
  listMyEntries: () =>
    Effect.succeed({
      participantId: PARTICIPANT_ID,
      entries: [],
      nextCursor: null,
      attention: { unreadItemIds: [] },
    }),
  // the queue's other half; empty unless a case says otherwise
  listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
  getEntryHistory: () => Effect.succeed({ entry: entry(), revisions: [], events: [], rounds: [] }),
  listScoreGroups: () =>
    Effect.succeed({
      groups: [
        {
          id: GROUP_ID,
          parentGroupId: null,
          name: '文体活动',
          cap: '10.00',
          floor: null,
          sortOrder: 0,
          itemCount: 1,
        },
      ],
      version: 1,
      capabilities: { canManage: false },
    }),
  getMyResult: () =>
    Effect.succeed({
      mode: 'provisional' as const,
      total: '0.00',
      groups: [],
      lines: [],
    }),
}

const screen = (stubs: Stubs, route: string, elements: { path: string; element: unknown }[]) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: { ...ambient, ...stubs },
    }),
    routes: elements as never,
    route,
  })

describe('the overview desk', () => {
  it('lists what needs a hand, and its key lands on the claim', async () => {
    page.viewport(1280, 800)
    screen(
      {
        getTimeline: () => Effect.succeed({ timeline: [] }),
        // the key lands on the my-entries page, which reads the paper
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        getMyOverview: () =>
          Effect.succeed({
            participant: {
              unreadItemIds: [ITEM_ID],
              actions: [
                {
                  kind: 'supplement' as const,
                  entryId: ENTRY_ID,
                  itemId: ITEM_ID,
                  itemTitle: '退役复学',
                  at: '2026-03-03T10:00:00.000Z',
                  who: '示例辅导员',
                  summary: '请补充现场照片',
                },
              ],
            },
            reviewer: {
              pendingCount: 3,
              answeredAskCount: 1,
              queueGroups: [{ name: '文体活动', count: 3 }],
              answeredAsks: [{ who: '王小明', itemTitle: '志愿服务' }],
            },
          }),
        listMyActivity: () =>
          Effect.succeed({
            items: [
              {
                id: REQUEST_ID,
                perspective: 'participant' as const,
                kind: 'supplement-requested' as const,
                entryId: ENTRY_ID,
                itemId: ITEM_ID,
                itemTitle: '退役复学',
                subjectName: null,
                instanceId: null,
                actorName: '示例辅导员',
                reason: null,
                comment: '请补充现场照片',
                summary: [
                  { label: '事项说明', value: '2024 年入伍，2026 年退役复学' },
                  { label: '退役时间', value: '2026-06-30' },
                ],
                at: '2026-03-03T10:00:00.000Z',
              },
              {
                id: ENTRY_ID,
                perspective: 'reviewer' as const,
                kind: 'review-approved' as const,
                entryId: ENTRY_ID,
                itemId: ITEM_ID,
                itemTitle: '志愿服务',
                subjectName: '王小明',
                instanceId: INSTANCE_ID,
                actorName: null,
                reason: null,
                comment: null,
                summary: [],
                at: '2026-03-02T09:00:00.000Z',
              },
            ],
            nextCursor: null,
          }),
      },
      `/assessment/batches/${BATCH_ID}`,
      [
        { path: '/assessment/batches/:batchId', element: <BatchOverviewPage /> },
        { path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> },
      ],
    )

    // the ask stands as a card with the asker's words, and the reviewer
    // standing adds its own rows to the same desk
    const actions = page.getByTestId('overview-actions')
    await expect.element(actions).toBeVisible()
    expect(actions.element().querySelector('[data-action="supplement"]')).not.toBeNull()
    expect(
      actions.element().querySelector('[data-action="review-pending"]')?.getAttribute('data-count'),
    ).toBe('3')
    expect(
      actions
        .element()
        .querySelector('[data-action="review-answered"]')
        ?.getAttribute('data-count'),
    ).toBe('1')
    await expect.element(page.getByText('请补充现场照片').first()).toBeVisible()
    // one merged feed, each row wearing which standing it spoke to
    await expect.element(page.getByTestId('overview-activity')).toBeVisible()
    const feed = page.getByTestId('overview-activity').element()
    expect(feed.querySelector('[data-perspective="participant"]')).not.toBeNull()
    expect(feed.querySelector('[data-perspective="reviewer"]')?.getAttribute('data-kind')).toBe(
      'review-approved',
    )
    // the unread question's newest row wears the dot
    expect(feed.querySelector('[data-unread]')?.getAttribute('data-kind')).toBe(
      'supplement-requested',
    )
    // the row says which claim it is, in the shared identity line
    await expect.element(page.getByText(/2024 年入伍/).first()).toBeVisible()

    // its key walks straight onto the claim: question open, drawer up
    await page.getByRole('button', { name: '去补充' }).click()
    await vi.waitFor(() => {
      expect(addressNow()).toContain(`open=${ITEM_ID}`)
      expect(addressNow()).toContain(`detail=${ENTRY_ID}`)
      page.viewport(414, 896)
    })
  })
})

describe('filing a claim', () => {
  it('creates a draft through the composed form, then submits it', async () => {
    const created = vi.fn((request: { payload: Record<string, unknown> }) =>
      Effect.succeed({ entry: entry() }),
    )
    const submitted = vi.fn(() =>
      Effect.succeed({
        entry: entry({
          status: 'in_review',
          capabilities: {
            edit: { state: 'hidden' as const, reason: null },
            submit: { state: 'hidden' as const, reason: null },
            withdraw: { state: 'available' as const, reason: null },
            appeal: { state: 'hidden' as const, reason: null },
            abandon: { state: 'hidden' as const, reason: null },
          },
        }),
      }),
    )
    let filed = false
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: filed ? [entry()] : [],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
        createEntry: ((request: { payload: Record<string, unknown> }) => {
          filed = true
          return created(request)
        }) as never,
        setEntryStatus: submitted as never,
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()
    await clickVisible('file-claim')
    await page.getByLabelText('事项说明').fill('2024 年入伍，2026 年退役复学')
    // keeping it is one press and handing it on is another, so a claim can be
    // written down before anybody is asked to look at it
    await page.getByRole('button', { name: '存为草稿' }).click()
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce())
    expect(created.mock.calls[0]![0].payload).toMatchObject({
      itemId: ITEM_ID,
      participantId: PARTICIPANT_ID,
      payload: { summary: '2024 年入伍，2026 年退役复学' },
    })

    // Let the filing dialog finish leaving before the next modal opens. Two
    // modal layers trading places is the radix pointer-events leak the ui
    // package now guards against; this test is about the workflow, and on a
    // slow runner the overlap turned it into a 15s retry loop instead.
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull(),
    )

    // handing it on happens where the whole claim is on screen: the drawer,
    // opened from the claim's own row on the paper. The press is scoped to
    // the drawer: an unscoped 提交 also matches the row's own status chip,
    // which sits under the drawer's overlay - on a slow runner the click
    // aimed there and retried against the overlay until it timed out.
    await page.getByRole('button', { name: /2024 年入伍/ }).click()
    const drawer = page.getByRole('dialog')
    await expect.element(drawer).toBeVisible()
    await drawer.getByRole('button', { name: '提交审核' }).click()

    // handing it on is asked for out loud: the press opens the question and
    // sends nothing, so a mis-aimed click costs a second press and not a
    // round of review
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    expect(submitted).not.toHaveBeenCalled()
    await page.getByTestId('confirm-accept').click()
    await vi.waitFor(() => expect(submitted).toHaveBeenCalledOnce())
  })

  it('offers keeping the claim from inside the question that hands it on', async () => {
    const created = vi.fn(() => Effect.succeed({ entry: entry() }))
    const submitted = vi.fn(() => Effect.succeed({ entry: entry({ status: 'in_review' }) }))
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        createEntry: created as never,
        setEntryStatus: submitted as never,
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()
    await clickVisible('file-claim')
    await page.getByLabelText('事项说明').fill('2024 年入伍，2026 年退役复学')

    // The press writes the claim down and hands it on, so the question it
    // opens carries three answers, not two: the writing happens either way,
    // and only the handing on is in doubt. Nothing has been written yet at
    // the moment the question appears.
    await page.getByRole('button', { name: '保存并提交审核' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    expect(created).not.toHaveBeenCalled()
    await expect.element(page.getByTestId('confirm-dismiss')).toBeVisible()
    await expect.element(page.getByTestId('confirm-other')).toBeVisible()

    // the lesser answer keeps the claim and asks nobody to look at it
    await page.getByTestId('confirm-other').click()
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce())
    expect(submitted).not.toHaveBeenCalled()
  })

  it('writes the claim down and hands it on in the one press', async () => {
    const created = vi.fn(() => Effect.succeed({ entry: entry() }))
    const submitted = vi.fn(() => Effect.succeed({ entry: entry({ status: 'in_review' }) }))
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        createEntry: created as never,
        setEntryStatus: submitted as never,
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()
    await clickVisible('file-claim')
    await page.getByLabelText('事项说明').fill('2024 年入伍，2026 年退役复学')
    await page.getByRole('button', { name: '保存并提交审核' }).click()
    await page.getByTestId('confirm-accept').click()

    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(submitted).toHaveBeenCalledOnce())
  })

  it('turns an oversized file away at the picker instead of at the save', async () => {
    const prepared = vi.fn(() => Effect.succeed({}))
    // the same question, with a file field the administrator capped
    const withFiles = item({
      currentRevision: {
        ...item().currentRevision!,
        formConfig: {
          fields: [
            { id: 'summary', key: 'summary', type: 'text', label: '事项说明', required: true },
            {
              id: 'proof',
              key: 'proof',
              type: 'attachment',
              label: '证明材料',
              maxCount: 2,
              maxFileBytes: 1024,
              accept: ['application/pdf'],
            },
          ],
        },
      },
    })
    screen(
      {
        listItems: () => Effect.succeed({ items: [withFiles], capabilities: { canManage: false } }),
        prepareAttachmentUpload: prepared as never,
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()
    await clickVisible('file-claim')

    // two kilobytes into a field that keeps one: the round has already said
    // no, so nothing is asked of the server and nothing joins the answer
    const inside = '[data-slot="dialog-content"] '
    await expect.poll(() => document.querySelectorAll(`${inside}input[type="file"]`).length).toBe(1)
    const tooBig = new File(['x'.repeat(2048)], 'certificate.pdf', { type: 'application/pdf' })
    await userEvent.upload(
      document.querySelector<HTMLInputElement>(`${inside}input[type="file"]`)!,
      tooBig,
    )

    await expect
      .poll(() =>
        [...document.querySelectorAll(`${inside}[data-turned-away]`)].map((one) =>
          one.getAttribute('data-turned-away'),
        ),
      )
      .toEqual(['too-large'])
    expect(prepared).not.toHaveBeenCalled()
  })

  it('says the question moved without taking away what was written', async () => {
    const moved = '99999999-9999-4999-8999-999999999999'
    // the administrator's change is discovered by the save being refused;
    // every read after that brings the question as it now stands
    let changed = false
    const conflict = () => {
      changed = true
      return Effect.fail(
        Object.assign(new Error('ASSESSMENT_ITEM_REVISION_CONFLICT'), {
          _tag: 'ASSESSMENT_ITEM_REVISION_CONFLICT',
          itemId: ITEM_ID,
          currentRevisionId: moved,
        }),
      )
    }
    const asked = item({
      currentRevision: {
        ...item().currentRevision!,
        id: moved,
        revisionNo: 2,
        formConfig: {
          fields: [
            { id: 'summary', key: 'summary', type: 'text', label: '事项说明', required: true },
            { id: 'level', key: 'level', type: 'text', label: '获奖级别' },
          ],
        },
      },
    })
    screen(
      {
        listItems: () =>
          Effect.succeed({ items: [changed ? asked : item()], capabilities: { canManage: false } }),
        createEntry: conflict as never,
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()
    await clickVisible('file-claim')
    const said = '2024 年入伍，2026 年退役复学'
    await page.getByLabelText('事项说明').fill(said)
    await page.getByRole('button', { name: '存为草稿' }).click()

    // the refusal lands where the work is: the dialog stays, the answer
    // stays in the field, both ways out are shut until it has been read -
    // and the form itself does not move while somebody is answering it
    await expect.element(page.getByTestId('rules-changed')).toBeVisible()
    await expect.element(page.getByLabelText('事项说明')).toHaveValue(said)
    await expect.element(page.getByRole('button', { name: '存为草稿' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: '保存并提交审核' })).toBeDisabled()
    expect(page.getByLabelText('获奖级别').elements()).toHaveLength(0)

    // the new question arrives when it is asked for, carrying the answers it
    // still asks for in the same way
    await page.getByRole('button', { name: '查看最新要求' }).click()
    await expect.element(page.getByLabelText('获奖级别')).toBeVisible()
    await expect.element(page.getByLabelText('事项说明')).toHaveValue(said)
    await expect.element(page.getByRole('button', { name: '存为草稿' })).toBeEnabled()
    expect(page.getByTestId('rules-changed').elements()).toHaveLength(0)
  })

  it('asks the server again on the refresh key', async () => {
    // the refresh key is a desk affordance; the phone flow refreshes live
    await page.viewport(1280, 800)
    const listed = vi.fn(() =>
      Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
    )
    screen({ listItems: listed as never }, `/assessment/batches/${BATCH_ID}/my-entries`, [
      { path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> },
    ])
    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()

    // however many reads mounting took, the press adds one more of each
    const before = listed.mock.calls.length
    await page.getByRole('button', { name: '刷新' }).click()
    await vi.waitFor(() => expect(listed.mock.calls.length).toBeGreaterThan(before))
  })

  it('wears the dot only until its owner looks', async () => {
    // wide, so the structure rail stands beside the paper instead of
    // folding into the phone's drawer
    page.viewport(1280, 800)
    const looked = vi.fn(() => Effect.succeed({ ok: true as const }))
    // two questions, with the news on the SECOND: the reader lands settled
    // on the first, so the dwell-marking never touches the dot until they
    // actually go to it
    // three questions with the news on the MIDDLE one: the spy calls the
    // last band "being read" on a short page, so the edges are the noisy
    // seats and the middle is where a dot can sit still
    const second = item({ id: ITEM2_ID, title: '献血加分', sortOrder: 1 })
    const third = item({ id: ITEM3_ID, title: '志愿服务', sortOrder: 2 })
    screen(
      {
        listItems: () =>
          Effect.succeed({ items: [item(), second, third], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [],
            nextCursor: null,
            attention: { unreadItemIds: [ITEM2_ID] },
          }),
        markMyEntryRead: looked as never,
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()
    // The dot means one thing: an unseen change - the row's word carries
    // the status separately. Presence, not visibility: this suite runs
    // without the stylesheet, where a 7px dot has no box to be visible in.
    await expect.poll(() => page.getByTestId('unread-dot').elements().length).toBe(1)
    expect(page.getByTestId('unread-dot').element().getAttribute('aria-label')).toBe('有未读变化')

    // opening the question is a look: the server hears it once, the dot goes
    // stylesheet-less, both breakpoint variants of the rail are in the
    // tree; either row opens the same question
    await page
      .getByRole('button', { name: /献血加分/ })
      .first()
      .click()
    await vi.waitFor(() => expect(looked).toHaveBeenCalledOnce())
    await expect.poll(() => page.getByTestId('unread-dot').elements().length).toBe(0)
    page.viewport(414, 896)
  })

  it('shows the whole account, with the reviewer’s advice read-only', async () => {
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              entry({
                status: 'rejected',
                capabilities: {
                  edit: { state: 'available' as const, reason: null },
                  submit: { state: 'available' as const, reason: null },
                  withdraw: { state: 'hidden' as const, reason: null },
                  appeal: { state: 'hidden' as const, reason: null },
                  abandon: { state: 'hidden' as const, reason: null },
                },
              }),
            ],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
        getEntryHistory: () =>
          Effect.succeed({
            entry: entry({ status: 'rejected' }),
            events: [],
            revisions: [
              {
                id: REVISION_ID,
                revisionNo: 1,
                itemRevisionId: REVISION_ID,
                payload: { summary: '入伍经历' },
                note: null,
                source: 'self',
                actorId: PARTICIPANT_ID,
                subjectId: PARTICIPANT_ID,
                attachments: [],
                createdAt: '2026-03-02T00:00:00.000Z',
              },
            ],
            rounds: [
              {
                id: INSTANCE_ID,
                roundNo: 1,
                state: 'completed',
                outcome: 'rejected',
                revisionId: REVISION_ID,
                origin: 'initial',
                supersedesInstanceId: null,
                appealedInstanceId: null,
                submittedAt: '2026-03-03T00:00:00.000Z',
                completedAt: '2026-03-04T00:00:00.000Z',
                events: [
                  {
                    kind: 'submitted',
                    actorId: PARTICIPANT_ID,
                    comment: null,
                    suggestedPayload: null,
                    at: '2026-03-03T00:00:00.000Z',
                  },
                  {
                    kind: 'rejected',
                    actorId: null,
                    comment: '证明日期与填报不符，请核对。',
                    suggestedPayload: { summary: '建议补充退役日期' },
                    at: '2026-03-04T00:00:00.000Z',
                  },
                ],
                supplements: [],
              },
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await page.getByRole('button', { name: /2024 年入伍/ }).click()
    await page.getByRole('button', { name: /审核记录/ }).click()
    // the reviewer's own words, which the fixture supplied
    await expect.element(page.getByText('证明日期与填报不符，请核对。')).toBeVisible()
    // the account holds the version, the decision, and the advice - three
    // kinds of node, whatever each of them is phrased as
    const kinds = page
      .getByTestId('trail-node')
      .elements()
      .map((node) => node.getAttribute('data-kind'))
    expect(kinds).toContain('version')
    expect(kinds).toContain('act')
    expect(kinds).toContain('suggestion')
    // advice is read, never applied: nothing offers to copy it in
    expect(page.getByRole('button', { name: '套用' }).elements()).toHaveLength(0)
  })

  it('shows the question\u2019s routes by step name, and never who holds them', async () => {
    screen(
      {
        listItems: () =>
          Effect.succeed({
            items: [
              item({
                currentRevision: {
                  ...item().currentRevision!,
                  reviewPolicy: {
                    normal: {
                      stages: [
                        { id: 'n1', label: '班委初审', selector: {}, quorum: { type: 'any' } },
                        { id: 'n2', label: '专业复审', selector: {}, quorum: { type: 'any' } },
                      ],
                    },
                    escalation: {
                      stages: [
                        { id: 'd1', label: '年级合议', selector: {}, quorum: { type: 'all' } },
                        { id: 'd2', selector: {}, quorum: { type: 'any' } },
                      ],
                    },
                  },
                },
              }),
            ],
            capabilities: { canManage: false },
          }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    const block = page.getByTestId('question-chain')
    await expect.element(block).toBeVisible()
    // step names the administrator gave, joined as a route; the unnamed
    // step falls back to its number - and nothing names a level or a role
    await expect.element(block.getByText('班委初审 → 专业复审')).toBeVisible()
    await expect.element(block.getByText(/年级合议 → 第 2 个审核环节/)).toBeVisible()
  })

  it('tells each round as its own section, its end and beginning said out loud', async () => {
    const ROUND_4 = '88888888-8888-4888-8888-888888888884'
    const ROUND_5 = '88888888-8888-4888-8888-888888888885'
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              entry({
                status: 'in_review',
                capabilities: {
                  edit: { state: 'hidden' as const, reason: null },
                  submit: { state: 'hidden' as const, reason: null },
                  withdraw: { state: 'available' as const, reason: null },
                  appeal: { state: 'hidden' as const, reason: null },
                  abandon: { state: 'hidden' as const, reason: null },
                },
              }),
            ],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
        getEntryHistory: () =>
          Effect.succeed({
            entry: entry({ status: 'in_review' }),
            events: [],
            revisions: [
              {
                id: REVISION_ID,
                revisionNo: 1,
                itemRevisionId: REVISION_ID,
                payload: { summary: '入伍经历' },
                note: null,
                source: 'self',
                actorId: PARTICIPANT_ID,
                subjectId: PARTICIPANT_ID,
                attachments: [],
                createdAt: '2026-08-20T14:06:00.000Z',
              },
            ],
            rounds: [
              {
                id: ROUND_4,
                roundNo: 1,
                state: 'completed',
                outcome: 'superseded',
                revisionId: REVISION_ID,
                origin: 'initial',
                supersedesInstanceId: null,
                appealedInstanceId: null,
                submittedAt: '2026-08-20T14:06:18.000Z',
                completedAt: '2026-08-20T15:49:37.000Z',
                events: [
                  {
                    kind: 'submitted',
                    actorId: PARTICIPANT_ID,
                    actorName: null,
                    reason: null,
                    comment: null,
                    suggestedPayload: null,
                    at: '2026-08-20T14:06:18.000Z',
                  },
                  {
                    kind: 'rerouted',
                    actorId: null,
                    actorName: null,
                    reason: null,
                    comment: '改流程',
                    suggestedPayload: null,
                    at: '2026-08-20T15:49:37.000Z',
                  },
                ],
                supplements: [],
              },
              {
                id: ROUND_5,
                roundNo: 2,
                state: 'active',
                outcome: null,
                revisionId: REVISION_ID,
                origin: 'reroute',
                supersedesInstanceId: ROUND_4,
                appealedInstanceId: null,
                // the same instant the old round ended: the very tie that
                // used to draw round 4 above round 5
                submittedAt: '2026-08-20T15:49:37.000Z',
                completedAt: null,
                events: [],
                supplements: [],
              },
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await page.getByRole('button', { name: /2024 年入伍/ }).click()
    await page.getByRole('button', { name: /审核记录/ }).click()
    await expect.element(page.getByTestId('trail-round').first()).toBeVisible()

    // rounds are sections, newest first - and the same-instant tie between
    // the round a re-route ended and the one it opened goes to the newer
    const sections = page.getByTestId('trail-round').elements()
    expect(sections.map((one) => one.getAttribute('data-round-no'))).toEqual(['2', '1'])
    expect(sections.map((one) => one.getAttribute('data-standing'))).toEqual(['ongoing', 'ended'])

    // the new round opens with the handover, marked as this round beginning
    const opener = sections[0]!.querySelector('[data-testid="trail-node"]')
    expect(opener?.getAttribute('data-kind')).toBe('transition')
    expect(opener?.querySelector('[data-testid="round-mark"]')?.getAttribute('data-mark')).toBe(
      'started',
    )

    // the old round's top says it ended; its foot says how it began
    const oldNodes = [...sections[1]!.querySelectorAll('[data-testid="trail-node"]')]
    expect(
      oldNodes[0]?.querySelector('[data-testid="round-mark"]')?.getAttribute('data-mark'),
    ).toBe('ended')
    expect(
      oldNodes[oldNodes.length - 1]
        ?.querySelector('[data-testid="round-mark"]')
        ?.getAttribute('data-mark'),
    ).toBe('started')
  })

  it('puts the reviewer’s request on the claim, and both halves of it in the account', async () => {
    const asked = {
      requestId: REQUEST_ID,
      instanceId: INSTANCE_ID,
      requestNo: 1,
      instructions: '献血证只拍到正面，请补充盖章那一面。',
      requirements: [
        { key: 'f1', label: '献血证盖章面', kind: 'file' as const, required: true },
        { key: 'f2', label: '机构全称', kind: 'text' as const, required: true },
      ],
      requestedByName: '王敏',
      requestedAt: '2026-03-05T00:00:00.000Z',
    }
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              entry({
                status: 'in_review',
                currentReviewInstanceId: INSTANCE_ID,
                supplement: asked,
                capabilities: {
                  edit: { state: 'hidden' as const, reason: null },
                  submit: { state: 'hidden' as const, reason: null },
                  withdraw: { state: 'hidden' as const, reason: null },
                  appeal: { state: 'hidden' as const, reason: null },
                  abandon: { state: 'hidden' as const, reason: null },
                },
              }),
            ],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
        getEntryHistory: () =>
          Effect.succeed({
            entry: entry({ status: 'in_review' }),
            events: [],
            revisions: [
              {
                id: REVISION_ID,
                revisionNo: 1,
                itemRevisionId: REVISION_ID,
                payload: { summary: '入伍经历' },
                note: null,
                source: 'self',
                actorId: PARTICIPANT_ID,
                subjectId: PARTICIPANT_ID,
                attachments: [],
                createdAt: '2026-03-02T00:00:00.000Z',
              },
            ],
            rounds: [
              {
                id: INSTANCE_ID,
                roundNo: 1,
                state: 'active',
                outcome: null,
                revisionId: REVISION_ID,
                submittedAt: '2026-03-03T00:00:00.000Z',
                completedAt: null,
                events: [],
                supplements: [
                  {
                    id: REQUEST_ID,
                    requestNo: 1,
                    status: 'answered',
                    instructions: asked.instructions,
                    requirements: asked.requirements,
                    requestedBy: PARTICIPANT_ID,
                    requestedByName: '王敏',
                    requestedAt: asked.requestedAt,
                    answeredAt: '2026-03-06T00:00:00.000Z',
                    cancelledAt: null,
                    response: {
                      payload: { f2: '市中心血站城东采血点' },
                      attachments: [],
                      respondedAt: '2026-03-06T00:00:00.000Z',
                    },
                  },
                ],
              },
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    // the status the row wears is the one that is waiting on the reader
    await expect
      .element(page.getByTestId('entry-standing').first())
      .toHaveAttribute('data-entry-standing', 'awaiting_supplement')

    // the ask itself, in the reviewer's own words with every piece named,
    // waits in the drawer behind the claim's own row
    await page.getByRole('button', { name: /2024 年入伍/ }).click()
    await expect.element(page.getByTestId('supplement-ask')).toBeVisible()
    await expect
      .element(page.getByText('献血证只拍到正面，请补充盖章那一面。').first())
      .toBeVisible()
    await expect.element(page.getByText('献血证盖章面').first()).toBeVisible()

    // and the account carries the ask and the answer as two moments
    await page.getByRole('button', { name: /审核记录/ }).click()
    const kinds = async () => {
      await expect.element(page.getByTestId('trail-node').first()).toBeVisible()
      return page
        .getByTestId('trail-node')
        .elements()
        .map((node) => node.getAttribute('data-kind'))
    }
    expect(await kinds()).toEqual(expect.arrayContaining(['ask', 'answer', 'version']))
    // what was actually supplied, in the words the fixture gave it
    await expect.element(page.getByText('市中心血站城东采血点')).toBeVisible()
  })

  it('keeps every layer in the address, and takes it back out on close', async () => {
    // the layered addresses belong to the desk's two-pane layout
    await page.viewport(1280, 800)
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [entry({ status: 'rejected' })],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    // choosing a question is going somewhere: the address says which one,
    // so a reload lands back on it and a link carries it to somebody else
    await page.getByRole('button', { name: /^退役复学/ }).click()
    await vi.waitFor(() => expect(addressNow()).toContain(`open=${ITEM_ID}`))

    // and so are the two layers over it - state in a component survives
    // neither a reload nor the phone's back key
    await page.getByRole('button', { name: /2024 年入伍/ }).click()
    await vi.waitFor(() => expect(addressNow()).toContain(`detail=${ENTRY_ID}`))

    // closing takes the parameter out rather than leaving it empty: a spent
    // parameter left behind would open the layer again on the next reload,
    // and the layer underneath keeps its own
    await page.getByRole('button', { name: /关闭|Close/ }).click()
    // the layer leaves with its exit transition; give the address the same
    // patience the rest of the suite gives animations
    await vi.waitFor(() => expect(addressNow()).not.toContain('detail='), { timeout: 5000 })
    expect(addressNow()).toContain(`open=${ITEM_ID}`)

    await page.getByRole('button', { name: /2024 年入伍/ }).click()
    await page.getByRole('button', { name: '修改' }).click()
    await vi.waitFor(() => expect(addressNow()).toContain(`entry=${ENTRY_ID}`))
    await page.getByRole('button', { name: 'Close' }).click()
    await vi.waitFor(() => expect(addressNow()).not.toContain('entry='))
    expect(addressNow()).toContain(`open=${ITEM_ID}`)
  })

  it('opens the form for the question that was clicked, wherever the address was', async () => {
    // the regression: opening a question AND starting a claim is one click
    // but two address layers, and two separate writes raced on the router's
    // snapshot - the second dropped the first, and with a group in ?open=
    // the dialog never opened at all
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries?open=${GROUP_ID}`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await clickVisible('file-claim')
    // both layers landed in one write: the question and the fresh claim
    await vi.waitFor(() => expect(addressNow()).toContain(`open=${ITEM_ID}`))
    expect(addressNow()).toContain('entry=new')
    // and the form is the clicked question's own
    await expect.element(page.getByLabelText('事项说明')).toBeVisible()
  })

  it('says the places are used up where the way in stood', async () => {
    screen(
      {
        listItems: () =>
          Effect.succeed({
            items: [
              item({
                maxEntries: 1,
                currentRevision: {
                  ...item().currentRevision!,
                  formConfig: {
                    fields: [
                      { key: 'summary', type: 'text', label: '事项说明', required: true },
                      { key: 'proof', type: 'attachment', label: '证明材料', maxCount: 2 },
                    ],
                  },
                },
              }),
            ],
            capabilities: { canManage: false },
          }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              entry({
                status: 'approved',
                currentRevision: {
                  ...entry().currentRevision!,
                  payload: {
                    summary: '2024 年入伍，2026 年退役复学',
                    proof: ['88888888-8888-4888-8888-888888888888'],
                  },
                },
                capabilities: {
                  edit: { state: 'hidden' as const, reason: null },
                  submit: { state: 'hidden' as const, reason: null },
                  withdraw: { state: 'hidden' as const, reason: null },
                  appeal: { state: 'available' as const, reason: null },
                  abandon: { state: 'hidden' as const, reason: null },
                },
              }),
            ],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
        listAttachmentDescriptors: () =>
          Effect.succeed({
            attachments: [
              {
                id: '88888888-8888-4888-8888-888888888888',
                filename: '退役证明.pdf',
                declaredMime: 'application/pdf',
                size: '204800',
                status: 'bound',
                delivery: { kind: 'content' as const },
              },
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    // the paper says the places are used, in a badge where the button stood
    // no way in left on this question
    expect(page.getByTestId('file-claim').elements()).toHaveLength(0)
    // the row counts the files; the files themselves are in the drawer
    await expect.element(page.getByTestId('claim-row').first()).toHaveAttribute('data-files', '1')
  })
})

describe('judging a submission', () => {
  const review = {
    id: INSTANCE_ID,
    state: 'active' as const,
    outcome: null,
    roundNo: 1,
    entryId: ENTRY_ID,
    batchId: BATCH_ID,
    itemId: ITEM_ID,
    itemTitle: '退役复学',
    participantName: '张三',
    businessNo: '2023011042',
    unitName: '软件2023级2班',
    submittedAt: '2026-03-03T00:00:00.000Z',
    completedAt: null,
    revision: {
      revisionNo: 1,
      payload: { summary: '入伍经历与退役时间' },
      note: null,
      attachments: [],
    },
    form: {
      itemType: 'evidence',
      formConfig: { fields: [{ key: 'summary', type: 'text', label: '事项说明' }] },
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
        each: '2.00',
        maxEntries: 1,
        groupName: '文体',
        groupCap: '10.00',
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
      },
      siblings: [
        {
          entryId: ENTRY_ID,
          values: [{ label: '事项说明', value: '入伍经历与退役时间' }],
          status: 'in_review',
          current: true,
        },
      ],
      previous: null,
    },
    events: [
      {
        kind: 'submitted',
        actorId: PARTICIPANT_ID,
        actorName: '张三',
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

  const inboxRow = (over: Partial<Record<string, unknown>> = {}) => ({
    instanceId: INSTANCE_ID,
    entryId: ENTRY_ID,
    batchId: BATCH_ID,
    batchName: '2026 春季综测',
    itemId: ITEM_ID,
    itemTitle: '退役复学',
    participantName: '张三',
    businessNo: '2023011042',
    unitId: null,
    unitName: '软件2023级2班',
    roundNo: 1,
    route: 'normal' as const,
    values: [{ label: '事项说明', value: '入伍经历与退役时间' }],
    attachmentCount: 0,
    submittedAt: '2026-03-03T00:00:00.000Z',
    ...over,
  })

  it('walks from the queue to one submission and approves it', async () => {
    const decided = vi.fn(() =>
      Effect.succeed({ review: { ...review, state: 'completed' as const, outcome: 'approved' } }),
    )
    screen(
      {
        listReviewInbox: () =>
          Effect.succeed({
            items: [
              inboxRow(),
              inboxRow({
                instanceId: '88888888-8888-4888-8888-888888888888',
                batchId: '99999999-9999-4999-8999-999999999999',
                batchName: '别的批次',
                itemTitle: '不该出现',
                participantName: '李四',
              }),
            ],
            nextCursor: null,
            handledToday: 0,
          }),
        getReviewInstance: () => Effect.succeed({ review }),
        decideReview: decided as never,
      },
      `/assessment/batches/${BATCH_ID}/reviews`,
      [
        { path: '/assessment/batches/:batchId/reviews', element: <ReviewInboxPage /> },
        {
          path: '/assessment/batches/:batchId/reviews/:instanceId',
          element: <ReviewInstancePage />,
        },
      ],
    )

    // the queue shows this batch's work and nobody else's
    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()
    expect(page.getByText('不该出现').elements()).toHaveLength(0)

    // the row itself opens the workbench; the filed answer stands under its
    // own label in the reading pane
    await page.getByRole('button', { name: /张三/ }).click()
    await expect.element(page.getByText('入伍经历与退役时间').first()).toBeVisible()
    // choosing is not submitting: 通过 opens the act's own panel, where the
    // opinion is optional, and only the panel's confirm stages anything -
    // then for five seconds the pill offers the way back
    await page.getByRole('button', { name: /^通过/ }).click()
    expect(decided).not.toHaveBeenCalled()
    await page.getByRole('dialog').getByRole('button', { name: /^通过/ }).click()
    await expect
      .element(page.getByTestId('decision-staged'))
      .toHaveAttribute('data-decision', 'approve')
    expect(decided).not.toHaveBeenCalled()
    // the run had one submission, so the closing screen is already up
    await expect.element(page.getByTestId('run-done')).toHaveAttribute('data-handled', '1')
    await vi.waitFor(() => expect(decided).toHaveBeenCalledOnce(), { timeout: 8000 })
    expect((decided.mock.calls[0] as unknown[])[0]).toMatchObject({
      payload: { decision: 'approve' },
    })
  })

  it('sends one decision per press, however it was pressed', async () => {
    const decided = vi.fn(() =>
      Effect.succeed({ review: { ...review, state: 'completed' as const, outcome: 'rejected' } }),
    )
    screen(
      {
        listReviewInbox: () =>
          Effect.succeed({ items: [inboxRow()], nextCursor: null, handledToday: 0 }),
        getReviewInstance: () => Effect.succeed({ review }),
        decideReview: decided as never,
      },
      `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
      [
        {
          path: '/assessment/batches/:batchId/reviews/:instanceId',
          element: <ReviewInstancePage />,
        },
      ],
    )

    // ⌘↵ inside the dialog belongs to the dialog: the page listens for the
    // same chord, and both answering it staged a decision and then told the
    // reviewer to choose one
    await page.getByRole('button', { name: /退回/ }).click()
    // the word this dialog refuses to go without says so before it is asked
    // for, and says it to a reader and not only to the eye
    await expect.element(page.getByLabelText('审核意见')).toHaveAttribute('aria-required')
    await page.getByLabelText('审核意见').fill('证书缺少落款。')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /确认退回/ })
      .click()
    expect(page.getByText('先选择一个决定。').elements()).toHaveLength(0)

    // and the window sends it exactly once, however many times React runs
    // the state updaters around it
    await vi.waitFor(() => expect(decided).toHaveBeenCalledOnce(), { timeout: 8000 })
    await new Promise((settle) => setTimeout(settle, 600))
    expect(decided).toHaveBeenCalledOnce()
  })

  it('refuses to send back without a word for the student', async () => {
    const decided = vi.fn(() =>
      Effect.succeed({ review: { ...review, state: 'completed' as const, outcome: 'rejected' } }),
    )
    screen(
      {
        listReviewInbox: () =>
          Effect.succeed({ items: [inboxRow()], nextCursor: null, handledToday: 0 }),
        getReviewInstance: () => Effect.succeed({ review }),
        decideReview: decided as never,
      },
      `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
      [
        {
          path: '/assessment/batches/:batchId/reviews/:instanceId',
          element: <ReviewInstancePage />,
        },
      ],
    )

    await page.getByRole('button', { name: /退回/ }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: /确认退回/ })
    await expect.element(confirm).toBeDisabled()
    await page.getByLabelText('审核意见').fill('证明日期与填报不符，请核对。')
    await expect.element(confirm).toBeEnabled()
    await confirm.click()
    await vi.waitFor(() => expect(decided).toHaveBeenCalledOnce(), { timeout: 8000 })
    expect((decided.mock.calls[0] as unknown[])[0]).toMatchObject({
      payload: { decision: 'reject', comment: '证明日期与填报不符，请核对。' },
    })
  })

  it('builds a supplement ask from the keyboard alone', async () => {
    screen(
      {
        listReviewInbox: () =>
          Effect.succeed({ items: [inboxRow()], nextCursor: null, handledToday: 0 }),
        getReviewInstance: () => Effect.succeed({ review }),
      },
      `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
      [
        {
          path: '/assessment/batches/:batchId/reviews/:instanceId',
          element: <ReviewInstancePage />,
        },
      ],
    )

    await page.getByTestId('act-supplement').click()
    const panel = page.getByRole('dialog')
    await expect.element(panel).toBeVisible()

    // one requirement row to start with; ⌥T asks for a written answer and
    // hands the cursor to the new row's name
    await vi.waitFor(() => expect(document.querySelectorAll('[data-piece-slot]')).toHaveLength(1))
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'KeyT', altKey: true, bubbles: true }),
    )
    await vi.waitFor(() => expect(document.querySelectorAll('[data-piece-slot]')).toHaveLength(2))
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('data-piece-slot')).toBe('2'),
    )

    // ⌥1 walks back to the first row's name without the mouse
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { code: 'Digit1', altKey: true, bubbles: true }),
    )
    await vi.waitFor(() =>
      expect(document.activeElement?.getAttribute('data-piece-slot')).toBe('1'),
    )
  })

  it('picks a reason by its digit, shows it picked, and sends its words', async () => {
    const decided = vi.fn(() =>
      Effect.succeed({ review: { ...review, state: 'completed' as const, outcome: 'rejected' } }),
    )
    screen(
      {
        getBatch: () =>
          Effect.succeed({
            batch: {
              ...batch(),
              reviewReasons: { reject: ['材料不清晰', '与已有申报重复'], escalate: [] },
            },
          }),
        listReviewInbox: () =>
          Effect.succeed({ items: [inboxRow()], nextCursor: null, handledToday: 0 }),
        getReviewInstance: () => Effect.succeed({ review }),
        decideReview: decided as never,
      },
      `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
      [
        {
          path: '/assessment/batches/:batchId/reviews/:instanceId',
          element: <ReviewInstancePage />,
        },
      ],
    )

    await page.getByRole('button', { name: /退回/ }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: /确认退回/ })
    await expect.element(page.getByRole('dialog').getByText('材料不清晰')).toBeVisible()

    // the focus rests on the dialog, not on the first option: a ring there
    // reads as "this one is chosen" when nothing is
    expect(document.activeElement?.closest('[data-slot="toggle-group"]')).toBeNull()

    // the second reason answers to its digit, and the pick is worn solid
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: '2', code: 'Digit2', bubbles: true }),
    )
    await vi.waitFor(() => {
      const picked = document.querySelector('[data-state="on"]')
      expect(picked?.textContent).toContain('与已有申报重复')
      expect(picked?.querySelector('svg')).not.toBeNull()
    })
    // the pick hands the cursor to the words: digits first, sentence next
    expect(document.activeElement?.tagName).toBe('TEXTAREA')

    // a reason alone does not send: the written word is still required
    await expect.element(confirm).toBeDisabled()
    await page.getByLabelText('审核意见').fill('与三月的献血申报是同一件事。')
    await confirm.click()
    await vi.waitFor(() => expect(decided).toHaveBeenCalledOnce(), { timeout: 8000 })
    expect((decided.mock.calls[0] as unknown[])[0]).toMatchObject({
      payload: {
        decision: 'reject',
        reason: '与已有申报重复',
        comment: '与三月的献血申报是同一件事。',
      },
    })
  })
})

describe('reading one’s standing', () => {
  it('shows the total, each group, and why a line does not count', async () => {
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        getMyResult: () =>
          Effect.succeed({
            mode: 'provisional' as const,
            total: '2.00',
            groups: [
              {
                groupId: GROUP_ID,
                parentGroupId: null,
                depth: 0,
                name: '文体',
                itemsTotal: '3.00',
                childrenTotal: '0',
                raw: '3.00',
                final: '2.00',
                cap: '2.00',
                floor: null,
              },
            ],
            lines: [
              {
                lineId: `entry:${ENTRY_ID}`,
                kind: 'entry' as const,
                label: '退役复学',
                value: '3.00',
                itemId: ITEM_ID,
              },
              {
                lineId: `grp:${GROUP_ID}:cap`,
                kind: 'group-adjustment' as const,
                label: '文体',
                value: '-1.00',
              },
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-result`,
      [{ path: '/assessment/batches/:batchId/my-result', element: <MyResultPage /> }],
    )

    // the ledger speaks with two decimals throughout
    await expect.element(page.getByText('2.00', { exact: true }).first()).toBeVisible()
    await expect
      .element(page.getByTestId('result-mode'))
      .toHaveAttribute('data-mode', 'provisional')
    await expect.element(page.getByText('3.00', { exact: true }).first()).toBeVisible()
    // the limit is one line, worded from the group's own figures
    await expect.element(page.getByTestId('group-adjustment')).toBeVisible()
    await expect.element(page.getByText('-1.00', { exact: true })).toBeVisible()
  })
})

describe('the phase gate on the paper', () => {
  const shut = { state: 'blocked' as const, reason: 'phase-closed' }
  const openGate = { state: 'available' as const, reason: null }
  const withdrawable = () =>
    entry({
      status: 'in_review',
      capabilities: {
        edit: { state: 'hidden' as const, reason: null },
        submit: { state: 'hidden' as const, reason: null },
        withdraw: { state: 'available' as const, reason: null },
        appeal: { state: 'hidden' as const, reason: null },
        abandon: { state: 'hidden' as const, reason: null },
      },
    })

  it('renders a shut create as a disabled control, not a trap', async () => {
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [],
            filing: [{ itemId: ITEM_ID, create: shut, submit: shut }],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()
    const button = page.getByTestId('file-claim').first()
    await expect.element(button).toBeDisabled()
    await expect.element(button).toHaveAttribute('data-gate', 'blocked')
  })

  it('shuts the handing-on half of the dialog while drafts stay open', async () => {
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [],
            filing: [{ itemId: ITEM_ID, create: openGate, submit: shut }],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await expect.element(page.getByRole('heading', { name: '退役复学' })).toBeVisible()
    await clickVisible('file-claim')
    const handOn = page.getByTestId('save-and-submit')
    await expect.element(handOn).toBeDisabled()
    await expect.element(handOn).toHaveAttribute('data-gate', 'blocked')
    await expect.element(page.getByRole('button', { name: '保存为草稿' })).toBeEnabled()
  })

  it('asks the one-way withdraw in the destructive register', async () => {
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [withdrawable()],
            filing: [{ itemId: ITEM_ID, create: shut, submit: shut }],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await page.getByRole('button', { name: /2024 年入伍/ }).click()
    const drawer = page.getByRole('dialog')
    await expect.element(drawer).toBeVisible()
    await drawer.getByRole('button', { name: '撤回提交' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    await expect
      .element(page.getByTestId('confirm-accept'))
      .toHaveAttribute('data-tone', 'destructive')
  })

  it('keeps the ordinary withdraw in the ordinary register', async () => {
    screen(
      {
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [withdrawable()],
            filing: [{ itemId: ITEM_ID, create: openGate, submit: openGate }],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await page.getByRole('button', { name: /2024 年入伍/ }).click()
    const drawer = page.getByRole('dialog')
    await expect.element(drawer).toBeVisible()
    await drawer.getByRole('button', { name: '撤回提交' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    await expect.element(page.getByTestId('confirm-accept')).toHaveAttribute('data-tone', 'default')
  })
})
