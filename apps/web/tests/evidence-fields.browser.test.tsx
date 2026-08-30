import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
import '../src/app.css'

// The typed evidence fields, from a student's keyboard to the wire.
//
// The payload is typed: an integer files as a number, a decimal as the
// string the platform grammar admits, a choice as its stable value while
// the screen shows the administrator's words. And a draft that will not
// materialize holds the door shut - for an optional field especially,
// because "invalid" quietly read as "left blank" is how a typo submits as
// an omission.

const MyEntriesPage = (await components['assessment/MyEntriesPage']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const GROUP_ID = '66666666-6666-4666-8666-666666666666'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const REVISION_ID = '77777777-7777-4777-8777-777777777777'
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444'

const PAGES = [
  { id: 'assessment/batch-my-entries', path: '/assessment/batches/:batchId/my-entries' },
].map((entry) => ({ ...entry, component: entry.id, layout: 'admin' }))

const batch = () => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: false,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: true, review: false, record: false, manage: false },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 1,
  currentPhaseId: null,
  currentPhaseName: '填报期',
  createdAt: '2026-02-01T00:00:00.000Z',
})

const item = () => ({
  id: ITEM_ID,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title: '学科竞赛获奖',
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
      fields: [
        {
          key: 'level',
          type: 'choice',
          label: '赛事级别',
          required: true,
          options: [
            { value: 'national', label: '国家级' },
            { value: 'provincial', label: '省部级' },
          ],
        },
        { key: 'placing', type: 'integer', label: '获奖序位', required: true, min: 1, max: 10 },
        { key: 'hours', type: 'decimal', label: '训练时长', maxScale: 2 },
      ],
    },
    scoringConfig: {},
    reviewPolicy: {},
    displayConfig: null,
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  createdAt: '2026-03-01T00:00:00.000Z',
})

const open = (stubs: Record<string, unknown>) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [],
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
        listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: [
              {
                id: GROUP_ID,
                parentGroupId: null,
                name: '学业加分',
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
          Effect.succeed({ mode: 'provisional' as const, total: '0.00', groups: [], lines: [] }),
        ...stubs,
      },
    } as never),
    routes: [
      { path: '/assessment/batches/:batchId/my-entries', element: <MyEntriesPage /> },
    ] as never,
    route: `/assessment/batches/${BATCH_ID}/my-entries`,
  })

const startFiling = async () => {
  await expect.element(page.getByRole('heading', { name: '学科竞赛获奖' })).toBeVisible()
  const opener = document.querySelector('[data-testid="file-claim"]') as HTMLElement
  const { userEvent } = await import('vitest/browser')
  await vi.waitFor(() => {
    if ((document.querySelector('[data-testid="file-claim"]') as HTMLElement | null) === null)
      throw new Error('not yet')
  })
  await userEvent.click(opener ?? document.querySelector('[data-testid="file-claim"]')!)
  await expect.element(page.getByRole('dialog')).toBeVisible()
}

describe('filing typed evidence', () => {
  it('files the choice as its value, the integer as a number, the decimal as its spelling', async () => {
    const created = vi.fn((request: { payload: Record<string, unknown> }) =>
      Effect.succeed({
        entry: {
          id: '33333333-3333-4333-8333-333333333333',
          batchId: BATCH_ID,
          itemId: ITEM_ID,
          participantId: PARTICIPANT_ID,
          status: 'draft',
          source: 'self',
          currentRevision: {
            id: REVISION_ID,
            revisionNo: 1,
            itemRevisionId: REVISION_ID,
            payload: request.payload['payload'],
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
        },
      }),
    )
    open({ createEntry: created as never })
    await startFiling()
    const { userEvent } = await import('vitest/browser')
    // the screen offers the words; the wire carries the value
    await userEvent.selectOptions(page.getByLabelText('赛事级别').element(), '省部级')
    await userEvent.fill(page.getByLabelText('获奖序位').element(), '2')
    await userEvent.fill(page.getByLabelText('训练时长').element(), '3.50')
    await page.getByRole('button', { name: '存为草稿' }).click()
    await vi.waitFor(() => expect(created).toHaveBeenCalledOnce())
    expect(created.mock.calls[0]![0].payload).toMatchObject({
      payload: { level: 'provincial', placing: 2, hours: '3.50' },
    })
  })

  it('holds the doors shut over a half-typed number, even an optional one', async () => {
    const created = vi.fn(() => Effect.succeed({ entry: {} }))
    open({ createEntry: created as never })
    await startFiling()
    const { userEvent } = await import('vitest/browser')
    await userEvent.selectOptions(page.getByLabelText('赛事级别').element(), '国家级')
    await userEvent.fill(page.getByLabelText('获奖序位').element(), '2')
    // the optional decimal holds a draft no schema admits: the door must
    // shut rather than let the typo file as "left blank"
    await userEvent.fill(page.getByLabelText('训练时长').element(), '1.')
    await expect.element(page.getByRole('button', { name: '存为草稿' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: '保存并提交审核' })).toBeDisabled()
    // finished, the doors open; emptied, the field is honestly omitted
    await userEvent.fill(page.getByLabelText('训练时长').element(), '1.5')
    await expect.element(page.getByRole('button', { name: '存为草稿' })).not.toBeDisabled()
    await userEvent.fill(page.getByLabelText('训练时长').element(), '')
    await expect.element(page.getByRole('button', { name: '存为草稿' })).not.toBeDisabled()
    expect(created).not.toHaveBeenCalled()
  })

  it('keeps a dangling minus out of the payload while it is being typed', async () => {
    const created = vi.fn((request: { payload: Record<string, unknown> }) =>
      Effect.fail({ _tag: 'never' as const, request }),
    )
    open({ createEntry: created as never })
    await startFiling()
    const { userEvent } = await import('vitest/browser')
    const placing = page.getByLabelText('获奖序位')
    await userEvent.fill(placing.element(), '-')
    // mid-edit is a draft, not a filing; the field reports itself instead
    await expect.element(placing).toHaveAttribute('aria-invalid', 'true')
    await expect.element(page.getByRole('button', { name: '存为草稿' })).toBeDisabled()
    await userEvent.fill(placing.element(), '2')
    await expect.element(page.getByRole('button', { name: '存为草稿' })).not.toBeDisabled()
  })
})
