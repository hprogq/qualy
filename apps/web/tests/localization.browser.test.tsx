import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// The one suite whose subject IS the copy.
//
// Everywhere else a business assertion reaches for a hook or a value, so a
// rewrite of the interface's words leaves it alone; here the words are what
// is under test, and a change to them is meant to fail. Kept deliberately
// small: a plural that has to agree, an interpolation that has to land, a
// second voice that has to be the reader's own, and the same screen in the
// other locale - the shapes that break silently rather than the whole
// catalog, which its own completeness gate already holds.

const MyResultPage = (await components['assessment/MyResultPage']!()).default
const MyEntriesPage = (await components['assessment/MyEntriesPage']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444'
const GROUP_ID = '77777777-7777-4777-8777-777777777777'
const REVISION_ID = '66666666-6666-4666-8666-666666666666'

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
  title: '退役复学',
  scoreGroupId: GROUP_ID,
  maxEntries: 3,
  sortOrder: 0,
  status: 'active',
  voidReason: null,
  currentRevision: {
    id: REVISION_ID,
    revisionNo: 1,
    entrySource: 'student',
    formConfig: { fields: [{ key: 'summary', type: 'text', label: '事项说明', required: true }] },
    scoringConfig: {},
    reviewPolicy: {},
    displayConfig: null,
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  createdAt: '2026-03-01T00:00:00.000Z',
})

const entry = () => ({
  id: ENTRY_ID,
  batchId: BATCH_ID,
  itemId: ITEM_ID,
  participantId: PARTICIPANT_ID,
  status: 'in_review',
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
    edit: { state: 'hidden', reason: null },
    submit: { state: 'hidden', reason: null },
    withdraw: { state: 'hidden', reason: null },
    appeal: { state: 'hidden', reason: null },
    abandon: { state: 'hidden', reason: null },
  },
})

const ambient = {
  getBatch: () => Effect.succeed({ batch: batch() }),
  listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: false } }),
  listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
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
  getMyResult: () => Effect.succeed({ mode: 'provisional', total: '0.00', groups: [], lines: [] }),
  getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
}

const screen = (
  stubs: Record<string, unknown>,
  element: React.ReactNode,
  path: string,
  route: string,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      assessment: { ...ambient, ...stubs },
    } as never),
    routes: [{ path, element }] as never,
    route,
    locale,
  })

describe('the words themselves', () => {
  it('agrees the plural and lands the numbers it is given', async () => {
    screen(
      {
        listMyEntries: () =>
          Effect.succeed({ participantId: PARTICIPANT_ID, entries: [entry()], nextCursor: null }),
        getMyResult: () =>
          Effect.succeed({
            mode: 'provisional',
            total: '3.00',
            groups: [
              {
                groupId: GROUP_ID,
                parentGroupId: null,
                depth: 0,
                name: '文体活动',
                itemsTotal: '3.00',
                childrenTotal: '0',
                raw: '3.00',
                final: '3.00',
                cap: '10.00',
                floor: null,
              },
            ],
            lines: [],
          }),
      },
      <MyResultPage />,
      '/assessment/batches/:batchId/my-result',
      `/assessment/batches/${BATCH_ID}/my-result`,
    )

    // the round's full marks: one number, interpolated into one sentence.
    // An interpolation that silently drops its value reads as a sentence
    // with a hole in it, which no hook-based assertion would ever notice.
    await expect.element(page.getByText('本批次满分 10.00')).toBeVisible()
  })

  it('speaks the reader’s own acts to them, and names everybody else', async () => {
    screen(
      {
        listMyEntries: () =>
          Effect.succeed({ participantId: PARTICIPANT_ID, entries: [entry()], nextCursor: null }),
        getEntryHistory: () =>
          Effect.succeed({
            entry: entry(),
            revisions: [entry().currentRevision],
            events: [],
            rounds: [
              {
                id: '55555555-5555-4555-8555-555555555555',
                roundNo: 1,
                state: 'active',
                outcome: null,
                revisionId: REVISION_ID,
                submittedAt: '2026-03-03T00:00:00.000Z',
                completedAt: null,
                events: [
                  {
                    kind: 'submitted',
                    actorId: PARTICIPANT_ID,
                    comment: null,
                    suggestedPayload: null,
                    at: '2026-03-03T00:00:00.000Z',
                  },
                  {
                    kind: 'approved',
                    actorId: null,
                    actorName: '王老师',
                    comment: null,
                    suggestedPayload: null,
                    at: '2026-03-04T00:00:00.000Z',
                  },
                ],
                supplements: [],
              },
            ],
          }),
      },
      <MyEntriesPage />,
      '/assessment/batches/:batchId/my-entries',
      `/assessment/batches/${BATCH_ID}/my-entries`,
    )

    await page.getByRole('button', { name: /2024 年入伍/ }).click()
    await page.getByRole('button', { name: /审核记录/ }).click()

    // one's own account speaks to its reader; a reviewer keeps their name in
    // every reading. Both halves are copy, and both are the subject here -
    // the submission names the version it carried, and the version node
    // states its outcome rather than reading as its object.
    await expect.element(page.getByText('你提交了第 1 版材料，发起审核')).toBeVisible()
    await expect.element(page.getByText('你填写了申报，生成第 1 版材料')).toBeVisible()
    await expect.element(page.getByText(/王老师/)).toBeVisible()
  })

  it('renders the same screen in the other locale', async () => {
    screen(
      {
        listMyEntries: () =>
          Effect.succeed({ participantId: PARTICIPANT_ID, entries: [], nextCursor: null }),
      },
      <MyResultPage />,
      '/assessment/batches/:batchId/my-result',
      `/assessment/batches/${BATCH_ID}/my-result`,
      'en-US',
    )

    // the english default reaches the screen, which is what proves the
    // catalog is a layer rather than the source of the words
    await expect.element(page.getByText('My score')).toBeVisible()
    expect(page.getByText('我的成绩').elements()).toHaveLength(0)
  })
})
