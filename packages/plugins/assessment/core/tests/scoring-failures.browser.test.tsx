import ReviewInstancePage from '../src/client/review/ReviewInstancePage.tsx'
import MyResultPage from '../src/client/result/MyResultPage.tsx'
import ItemSettingsPage from '../src/client/items/ItemSettingsPage.tsx'
import { lazy } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// What a person sees when the arithmetic will not, or cannot, score.
//
// Three screens meet the same three answers. A reviewer whose last word the
// rule refuses reads the rule's own sentence and keeps what they typed; a
// student whose account cannot be computed sees that, and no total; an
// administrator whose new rule re-prices what stands is told how many, and
// told that a rule refusing what stands has no way through.

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_ID = '33333333-3333-4333-8333-333333333333'
const INSTANCE_ID = '55555555-5555-4555-8555-555555555555'
const PARTICIPANT_ID = '66666666-6666-4666-8666-666666666666'

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

const review = () => ({
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
    payload: { name: '中国机器人大赛', 'claimed-level': 'provincial' },
    note: null,
    attachments: [],
  },
  form: {
    itemType: 'evidence',
    formConfig: {
      fields: [
        { key: 'name', type: 'text', label: '竞赛名称' },
        {
          key: 'claimed-level',
          type: 'choice',
          label: '申报级别',
          options: [
            { value: 'national', label: '国家级' },
            { value: 'provincial', label: '省部级' },
          ],
        },
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
  context: null,
  events: [],
  supplements: [],
  actions: {
    approve: { state: 'available' as const, reason: null },
    reject: { state: 'available' as const, reason: null },
    escalate: { state: 'blocked' as const, reason: 'no-route' },
    supplement: { state: 'available' as const, reason: null },
    // a normal-route round: a rejection here goes back to whoever filed
    rejectionReturns: true,
  },
  recognitionForm: {
    fields: [
      {
        id: 'rec-ordinal',
        schema: { type: 'integer', minimum: 1, maximum: 10, title: '认定获奖序位' },
      },
    ],
    seed: {},
    locked: null,
  },
  capabilities: { canDecide: true, canCancelSupplement: false, canAnswerSupplement: false },
})

const PAGES = [
  { id: 'assessment/batch-my-entries', path: '/assessment/batches/:batchId/my-entries' },
  { id: 'assessment/batch-overview', path: '/assessment/batches/:batchId' },
  { id: 'assessment/batch-reviews', path: '/assessment/batches/:batchId/reviews' },
  { id: 'assessment/review-instance', path: '/assessment/batches/:batchId/reviews/:instanceId' },
  { id: 'assessment/batch-my-result', path: '/assessment/batches/:batchId/my-result' },
].map((entry) => ({ ...entry, layout: 'admin' }))

afterEach(() => page.viewport(1280, 800))

describe('a last word the rule sends back', () => {
  it("reads the rule's own sentence, keeps the workbench, and keeps what was typed", async () => {
    const decided = vi.fn(() =>
      Effect.fail(
        apiError('ASSESSMENT_DETERMINATION_REFUSED', {
          itemId: ITEM_ID,
          reason: '省级项目仅认定前十名',
        }),
      ),
    )
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
        assessment: {
          getBatch: () => Effect.succeed({ batch: batch() }),
          getReviewInstance: () => Effect.succeed({ review: review() }),
          getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
          // the round is still the reviewer's to decide, so it stays in the
          // queue: a refusal is not a decision
          listReviewInbox: () =>
            Effect.succeed({
              items: [
                {
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
                  route: 'normal',
                  values: [{ label: '竞赛名称', value: '中国机器人大赛', files: null }],
                  attachmentCount: 0,
                  submittedAt: '2026-03-03T00:00:00.000Z',
                },
              ],
              nextCursor: null,
              handledToday: 0,
            }),
          decideReview: decided,
          previewDetermination: () => Effect.succeed({ issues: [], amount: '4.00', refusal: null }),
        },
      }),
      routes: [
        {
          path: '/assessment/batches/:batchId/reviews/:instanceId',
          element: (
            <div style={{ display: 'flex', height: '100dvh', flexDirection: 'column' }}>
              <ReviewInstancePage />
            </div>
          ),
        },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/reviews/${INSTANCE_ID}`,
    })
    await expect.element(page.getByText('中国机器人大赛').first()).toBeVisible()
    await page.getByRole('button', { name: /^通过/ }).click()
    await expect.element(page.getByRole('dialog')).toBeVisible()
    const ordinalInput = () =>
      document.querySelector(
        '[data-testid="recognition-form"] [data-parameter="rec-ordinal"] input',
      ) as HTMLInputElement
    await vi.waitFor(() => expect(ordinalInput()).not.toBeNull())
    await page.elementLocator(ordinalInput()).fill('9')
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /^通过/ })
      .click()
    // through the undo window, to the refusal
    await vi.waitFor(() => expect(decided).toHaveBeenCalled(), { timeout: 8_000 })

    // the rule's sentence is business data the reviewer has to read
    await expect.element(page.getByText('省级项目仅认定前十名', { exact: false })).toBeVisible()
    // the workbench stands, with the act still on offer
    await expect.element(page.getByRole('button', { name: /^通过/ })).toBeVisible()
    // and the determination comes back as typed
    await page.getByRole('button', { name: /^通过/ }).click()
    await vi.waitFor(() => expect(ordinalInput()?.value).toBe('9'))
  }, 30_000)
})

describe('an account the arithmetic cannot compute', () => {
  it('shows no total, only the way to ask again', async () => {
    let down = true
    const result = vi.fn(() =>
      down
        ? Effect.fail(apiError('ASSESSMENT_SCORING_UNAVAILABLE'))
        : Effect.succeed({ mode: 'provisional' as const, total: '3.00', groups: [], lines: [] }),
    )
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
        assessment: {
          getBatch: () => Effect.succeed({ batch: batch() }),
          listItems: () => Effect.succeed({ items: [], capabilities: { canManage: false } }),
          listMyEntries: () =>
            Effect.succeed({
              participantId: PARTICIPANT_ID,
              entries: [],
              nextCursor: null,
              attention: { unreadItemIds: [] },
            }),
          getMyResult: result,
        },
      }),
      routes: [
        { path: '/assessment/batches/:batchId/my-result', element: <MyResultPage /> },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/my-result`,
    })
    await expect.element(page.getByTestId('result-unavailable')).toBeVisible()
    // nothing pretends to be a score
    expect(document.querySelector('[data-testid="result-total"]')).toBeNull()
    const asked = result.mock.calls.length
    down = false
    await page.getByRole('button', { name: '重新计算' }).click()
    await vi.waitFor(() => expect(result.mock.calls.length).toBeGreaterThan(asked))
    await expect.element(page.getByTestId('result-unavailable')).not.toBeInTheDocument()
    await expect.element(page.getByTestId('result-total')).toBeVisible()
  }, 30_000)
})

describe('a rule that re-prices what stands', () => {
  const ORG_TYPE_ID = '33333333-3333-4333-8333-333333333333'
  const ROLE_ID = '44444444-4444-4444-8444-444444444444'
  const PAPER_ID = '77777777-7777-4777-8777-777777777777'
  const REVISION_ID = '88888888-8888-4888-8888-888888888888'

  const adminBatch = () => ({ ...batch(), manageable: true, status: 'draft' })
  const paper = {
    id: PAPER_ID,
    parentGroupId: null,
    name: '综合素质测评',
    cap: null,
    floor: null,
    sortOrder: 0,
    itemCount: 1,
  }
  /** a saved question whose rule is a fixed amount, with a finished review step */
  const item = () => ({
    id: ITEM_ID,
    batchId: BATCH_ID,
    itemType: 'evidence',
    title: '学生干部任职',
    scoreGroupId: PAPER_ID,
    maxEntries: 5,
    sortOrder: 0,
    status: 'active',
    voidReason: null,
    currentRevision: {
      id: REVISION_ID,
      revisionNo: 1,
      entryChannels: ['participant'],
      formConfig: {
        files: {},
        fields: [{ id: 'claimed-level', key: 'claimed-level', label: '获奖级别', type: 'text' }],
      },
      scoringConfig: {
        calculator: { ref: 'fixed@1', config: { value: '2.00' } },
        aggregator: { ref: 'max@1', config: {} },
      },
      reviewPolicy: {
        normal: {
          stages: [
            {
              label: '班委初审',
              selector: { kind: 'roleAt', nodeTypeId: ORG_TYPE_ID, roleIds: [ROLE_ID] },
              quorum: { type: 'any' },
            },
          ],
        },
        escalation: { stages: [] },
      },
      displayConfig: {},
      createdAt: '2026-02-01T00:00:00.000Z',
    },
  })
  const scoring = (over: {
    amountChanged?: number
    refused?: number
    baselineFailed?: number
    derived?: {
      comparable: boolean
      amountChanged: boolean
      refused: boolean
      executionFailed: boolean
      baselineFailed: boolean
    } | null
  }) => ({
    changed: true,
    approved: {
      total: 128,
      comparable: 128 - (over.refused ?? 0) - (over.baselineFailed ?? 0),
      amountChanged: over.amountChanged ?? 0,
      refused: over.refused ?? 0,
      executionFailed: 0,
      baselineFailed: over.baselineFailed ?? 0,
    },
    derived: over.derived ?? null,
  })
  const decisionRequired = (amountChanged: number, baselineFailed = 0) =>
    apiError('ASSESSMENT_ITEM_CHANGE_DECISION_REQUIRED', {
      currentRevisionId: REVISION_ID,
      impactToken: 'token-1',
      form: {
        changed: false,
        inReview: { total: 0, incompatible: 0 },
        approved: { total: 128, incompatible: 0 },
      },
      review: {
        changed: false,
        open: 0,
        blocked: 0,
        sameStageMappable: 0,
        stageRemoved: 0,
        pastChanged: 0,
      },
      scoring: scoring({ amountChanged, baselineFailed }),
    })

  const openEditor = async (
    updateItem: (call: { payload: Record<string, unknown> }) => unknown,
  ) => {
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [
                { id: 'assessment/batch-items', path: '/assessment/batches/:batchId/items' },
              ].map((entry) => ({ ...entry, layout: 'admin' })),
              collections: {
                'assessment/calculator-authoring-options': [
                  {
                    id: 'assessment/fixed-calculator',
                    ref: 'fixed@1',
                    label: {
                      kind: 'message',
                      id: 'assessment/items/calculator-fixed',
                      defaultMessage: 'Fixed',
                    },
                    order: 10,
                  },
                ],
              },
              slots: {
                'assessment/calculator-editor': [
                  { id: 'assessment/fixed-calculator-editor', order: 10 },
                ],
              },
            }),
        },
        assessment: {
          getBatch: () => Effect.succeed({ batch: adminBatch() }),
          listScoreGroups: () =>
            Effect.succeed({ groups: [paper], version: 1, capabilities: { canManage: true } }),
          listItems: () => Effect.succeed({ items: [item()], capabilities: { canManage: true } }),
          itemOptions: () =>
            Effect.succeed({
              orgTypes: [{ id: ORG_TYPE_ID, code: 'class', name: '班级' }],
              roles: [{ id: ROLE_ID, name: '审核员' }],
            }),
          reviewAlerts: () => Effect.succeed({ groups: [] }),
          reviewCoverage: () => Effect.succeed({ nodes: [] }),
          previewScoring: () =>
            Effect.succeed({
              calculator: { ref: 'fixed@1', contractHash: 'contract-1' },
              inputSchema: {
                type: 'object',
                properties: {},
                required: [],
                additionalProperties: false,
              },
              outputSchema: { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2 },
              bindableFields: [],
            }),
          updateItem,
        },
      }),
      routes: [
        { path: '/assessment/batches/:batchId/items', element: <ItemSettingsPage /> },
      ] as never,
      registry: {
        slots: {
          'assessment/calculator-editor': {
            'assessment/fixed-calculator-editor': lazy(
              () => (() => import('../src/client/items/FixedCalculatorEditor.tsx'))() as never,
            ),
          },
        },
      },
      route: `/assessment/batches/${BATCH_ID}/items?question=${ITEM_ID}`,
    })
  }

  const retitleAndSave = async () => {
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职(改名)')
    await page.getByRole('button', { name: '保存', exact: false }).click()
  }

  it('tells how many amounts change, and takes the token alone as the answer', async () => {
    const sent: Record<string, unknown>[] = []
    await openEditor((call) => {
      sent.push(call.payload)
      return sent.length === 1
        ? Effect.fail(decisionRequired(47))
        : Effect.succeed({ item: item() })
    })
    await retitleAndSave()
    const section = page.getByTestId('impact-scoring')
    await expect.element(section).toBeVisible()
    await expect.element(section).toHaveAttribute('data-approved', '128')
    await expect.element(section).toHaveAttribute('data-amount-changed', '47')
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: false }).click()
    await vi.waitFor(() => expect(sent).toHaveLength(2))
    // nothing to choose: the acknowledgement is the token, and only the token
    expect(sent[1]?.['effects']).toEqual({ impactToken: 'token-1' })
  }, 30_000)

  it('says what the rule in force already cannot score, and still lets it be replaced', async () => {
    const sent: Record<string, unknown>[] = []
    await openEditor((call) => {
      sent.push(call.payload)
      return sent.length === 1
        ? Effect.fail(decisionRequired(0, 3))
        : Effect.succeed({ item: item() })
    })
    await retitleAndSave()
    const section = page.getByTestId('impact-scoring')
    await expect.element(section).toBeVisible()
    await expect.element(section).toHaveAttribute('data-baseline-failed', '3')
    // and the way forward is open: replacing the rule is the repair
    await expect.element(page.getByTestId('impact-scoring-stuck')).toBeVisible()
    await page.getByRole('dialog').getByRole('button', { name: '保存', exact: false }).click()
    await vi.waitFor(() => expect(sent).toHaveLength(2))
  }, 30_000)

  it('offers no way through when the rule cannot take what stands', async () => {
    const sent: Record<string, unknown>[] = []
    await openEditor((call) => {
      sent.push(call.payload)
      return Effect.fail(
        apiError('ASSESSMENT_ITEM_SCORING_INCOMPATIBLE', {
          itemId: ITEM_ID,
          approved: { total: 128, refused: 4, executionFailed: 3 },
          derived: null,
        }),
      )
    })
    await retitleAndSave()
    // a refusal, said where the save was made; no dialog asks anything
    await expect.element(page.getByRole('alert').first()).toBeVisible()
    expect(document.querySelector('[data-testid="impact-scoring"]')).toBeNull()
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
  }, 30_000)
})
