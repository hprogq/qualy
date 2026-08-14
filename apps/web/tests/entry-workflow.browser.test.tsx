import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { ApiResult, ClientOf } from '@qualy/web-runtime/api'
import type { assessmentApi } from '@qualy/plugin-assessment/client/api'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// The entry workflow as a person drives it: filing a claim on a question,
// following what a reviewer did to it, judging one from the queue, and
// reading one's own standing. Every case runs the real screens over a
// stubbed wire and asserts by role and label, the way a person would look.

const MyEntriesPage = (await components['assessment/MyEntriesPage']!()).default
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

const PAGES = [
  { id: 'assessment/batch-my-entries', path: '/assessment/batches/:batchId/my-entries' },
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
  capabilities: { canEdit: true, canSubmit: true, canWithdraw: false },
  ...over,
})

/** the reads every batch screen makes before it draws anything */
const ambient = {
  getBatch: () => Effect.succeed({ batch: batch() }),
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

describe('filing a claim', () => {
  it('creates a draft through the composed form, then submits it', async () => {
    const created = vi.fn((request: { payload: Record<string, unknown> }) =>
      Effect.succeed({ entry: entry() }),
    )
    const submitted = vi.fn(() =>
      Effect.succeed({
        entry: entry({
          status: 'in_review',
          capabilities: { canEdit: false, canSubmit: false, canWithdraw: true },
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
    await page.getByRole('button', { name: '去申报' }).click()
    await page.getByLabelText('事项说明').fill('2024 年入伍，2026 年退役复学')
    await page.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce())
    expect(created.mock.calls[0]![0].payload).toMatchObject({
      itemId: ITEM_ID,
      participantId: PARTICIPANT_ID,
      payload: { summary: '2024 年入伍，2026 年退役复学' },
    })

    await page.getByRole('button', { name: '提交' }).click()
    await vi.waitFor(() => expect(submitted).toHaveBeenCalledOnce())
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
                capabilities: { canEdit: true, canSubmit: true, canWithdraw: false },
              }),
            ],
            nextCursor: null,
          }),
        getEntryHistory: () =>
          Effect.succeed({
            entry: entry({ status: 'rejected' }),
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
              },
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}/my-entries`,
      [{ path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> }],
    )

    await page.getByRole('button', { name: '查看经过' }).click()
    await expect.element(page.getByText('证明日期与填报不符，请核对。')).toBeVisible()
    await expect.element(page.getByText('审核人的修改建议')).toBeVisible()
    await expect.element(page.getByText('仅供参考。请自行修改后重新提交。')).toBeVisible()
    // advice is read, never applied: nothing offers to copy it in
    expect(page.getByRole('button', { name: '套用' }).elements()).toHaveLength(0)
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
      mode: 'normal' as const,
      stageIndex: 0,
      normalTerminal: 0,
      stages: [
        {
          index: 0,
          nodeName: '软件2023级2班',
          roleNames: ['审核员'],
          reviewers: ['张老师'],
          skipped: null,
        },
      ],
      decisions: ['approve', 'reject', 'comment'],
    },
    events: [
      {
        kind: 'submitted',
        actorId: PARTICIPANT_ID,
        actorName: '张三',
        comment: null,
        suggestedPayload: null,
        at: '2026-03-03T00:00:00.000Z',
      },
    ],
    capabilities: { canDecide: true },
  }

  it('walks from the queue to one submission and approves it', async () => {
    const decided = vi.fn(() =>
      Effect.succeed({ review: { ...review, state: 'completed' as const, outcome: 'approved' } }),
    )
    screen(
      {
        listReviewInbox: () =>
          Effect.succeed({
            items: [
              {
                instanceId: INSTANCE_ID,
                entryId: ENTRY_ID,
                batchId: BATCH_ID,
                batchName: '2026 春季综测',
                itemId: ITEM_ID,
                itemTitle: '退役复学',
                participantName: '张三',
                roundNo: 1,
                submittedAt: '2026-03-03T00:00:00.000Z',
              },
              {
                instanceId: '88888888-8888-4888-8888-888888888888',
                entryId: ENTRY_ID,
                batchId: '99999999-9999-4999-8999-999999999999',
                batchName: '别的批次',
                itemId: ITEM_ID,
                itemTitle: '不该出现',
                participantName: '李四',
                roundNo: 1,
                submittedAt: '2026-03-03T00:00:00.000Z',
              },
            ],
            nextCursor: null,
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
    await expect.element(page.getByText('退役复学')).toBeVisible()
    expect(page.getByText('不该出现').elements()).toHaveLength(0)

    await page.getByRole('button', { name: '去处理' }).click()
    await expect.element(page.getByText('入伍经历与退役时间')).toBeVisible()
    await page.getByRole('button', { name: '通过' }).click()
    await vi.waitFor(() => expect(decided).toHaveBeenCalledOnce())
    expect((decided.mock.calls[0] as unknown[])[0]).toMatchObject({
      payload: { decision: 'approve' },
    })
  })

  it('refuses to send back without a word for the student', async () => {
    const decided = vi.fn(() =>
      Effect.succeed({ review: { ...review, state: 'completed' as const, outcome: 'rejected' } }),
    )
    screen(
      {
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

    await page.getByRole('button', { name: '退回', exact: true }).click()
    const confirm = page.getByRole('dialog').getByRole('button', { name: '退回', exact: true })
    await expect.element(confirm).toBeDisabled()
    await page.getByLabelText('给学生的说明').fill('证明日期与填报不符，请核对。')
    await expect.element(confirm).toBeEnabled()
    await confirm.click()
    await vi.waitFor(() => expect(decided).toHaveBeenCalledOnce())
    expect((decided.mock.calls[0] as unknown[])[0]).toMatchObject({
      payload: { decision: 'reject', comment: '证明日期与填报不符，请核对。' },
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
                name: '文体',
                itemsTotal: '3.00',
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

    // amounts render without their bookkeeping zeros
    await expect.element(page.getByText('2', { exact: true })).toBeVisible()
    await expect.element(page.getByText('实时预览')).toBeVisible()
    await expect.element(page.getByText('3', { exact: true })).toBeVisible()
    await expect.element(page.getByText('分组限额')).toBeVisible()
    await expect.element(page.getByText('-1', { exact: true })).toBeVisible()
  })
})
