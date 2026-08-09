import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { ApiResult, ClientOf } from '@qualy/web-runtime/api'
import type { assessmentApi } from '@qualy/plugin-assessment/client/api'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// loaded through the registry the host actually uses, so a screen that lost
// its key would fail here rather than at runtime
const BatchAdminPage = (await components['assessment/BatchAdminPage']!()).default

// What a service test cannot see: whether the phase editor offers only the
// permissions a phase may govern, whether a template can be applied to a
// draft, whether an engine refusal reaches the administrator as a sentence
// about the right phase, and whether the roster panel offers each drift class
// the one action that answers it.

type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']
type PhaseDto = ApiResult<typeof assessmentApi, 'assessment', 'getPhases'>['phases'][number]
/** what a screen sends: params in the path, payload in the body */
interface PlanRequest {
  params?: Record<string, string>
  payload?: Record<string, unknown>
}

type Clients = ClientOf<typeof assessmentApi>
type Stubs = Partial<Record<keyof Clients['assessment'], (...args: never[]) => unknown>>

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const TEMPLATE_ID = '22222222-2222-4222-8222-222222222222'
const ENTRY_PHASE_ID = '33333333-3333-4333-8333-333333333333'
const REVIEW_PHASE_ID = '44444444-4444-4444-8444-444444444444'
const NODE_ID = '55555555-5555-4555-8555-555555555555'
const USER_ID = '66666666-6666-4666-8666-666666666666'
const PARTICIPANT_ID = '77777777-7777-4777-8777-777777777777'

const batch = (over: Partial<BatchDto> = {}): BatchDto => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  scopeNodeIds: [NODE_ID],
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'draft',
  configRevision: 0,
  anchorAutoSync: false,
  currentPhaseId: null,
  userTypeIds: [],
  createdAt: '2026-02-01T00:00:00.000Z',
  ...over,
})

const phase = (over: Partial<PhaseDto> & { id: string; phaseKey: string }): PhaseDto => ({
  ordinal: 0,
  displayName: over.phaseKey,
  entryTrigger: 'manual',
  plannedEntryAt: null,
  actualEntryAt: null,
  entryOffset: null,
  estimatedEntryAt: null,
  opensPublicationId: null,
  permissionProfile: [],
  itemScope: [],
  participantScope: [],
  sourceTemplateId: null,
  sourceTemplateVersion: null,
  ...over,
})

const emptyDiff = {
  newArrivals: [],
  departed: [],
  anchorChanged: [],
  userTypeChanged: [],
  scopeIntegrity: [],
}

const assessmentStubs = (over: Stubs = {}): Stubs => ({
  listBatches: () => Effect.succeed({ items: [batch()], nextCursor: null }),
  getBatch: () => Effect.succeed({ batch: batch() }),
  getPhases: () => Effect.succeed({ phases: [] }),
  listTemplates: () =>
    Effect.succeed({
      items: [{ id: TEMPLATE_ID, name: '默认阶段模板', version: 1, phases: [] }],
      nextCursor: null,
    }),
  listScopeOptions: () =>
    Effect.succeed({
      nodes: [{ id: NODE_ID, name: '软件学院', path: 'r.se', depth: 1, orgTypeId: NODE_ID }],
    }),
  listUserTypeOptions: () =>
    Effect.succeed({ userTypes: [{ id: USER_ID, code: 'student', name: '学生' }] }),
  listParticipants: () => Effect.succeed({ items: [], nextCursor: null }),
  getRosterDiff: () => Effect.succeed({ diff: emptyDiff }),
  ...over,
})

const screen = (over: Stubs = {}) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      assessment: assessmentStubs(over),
    }),
    children: <BatchAdminPage />,
    route: `/assessment/batches?batch=${BATCH_ID}`,
  })

describe('the phase timeline editor', () => {
  it('offers only the permissions a phase may govern', async () => {
    screen({
      getPhases: () =>
        Effect.succeed({
          phases: [phase({ id: ENTRY_PHASE_ID, phaseKey: 'entry', displayName: '正式填报' })],
        }),
    })
    // scoped to the phase row: the batch form has checkboxes of its own, and
    // the claim here is about what THIS editor may offer
    const row = page.getByRole('listitem', { name: '正式填报' })

    // the gate's own registry, and nothing else: a phase can open submitting
    // an entry...
    await expect.element(row.getByRole('checkbox', { name: '提交申报' })).toBeVisible()
    await expect.element(row.getByRole('checkbox', { name: '处理审核' })).toBeVisible()
    // ...but signing in, managing the organization or managing the batch
    // itself are not things a phase governs, so they cannot be listed here
    for (const absent of ['登录', '管理组织架构', '管理测评批次', '查看角色']) {
      await expect.element(row.getByRole('checkbox', { name: absent })).not.toBeInTheDocument()
    }
    // exactly the eleven gated codes, which is the whole of PHASE_GATED
    expect(row.getByRole('checkbox').elements()).toHaveLength(11)
  })

  it('applies a template to a draft, by id, server-side', async () => {
    const putPhases = vi.fn((_request: PlanRequest) => Effect.succeed({ phases: [], warnings: [] }))
    screen({ putPhases })

    await page.getByRole('combobox').selectOptions('默认阶段模板')
    await page.getByRole('button', { name: '套用模板' }).click()
    await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
    // the screen names the template and lets the server copy it, so the
    // provenance the plan records is the server's to write
    expect(putPhases.mock.calls[0]![0]).toMatchObject({
      params: { batchId: BATCH_ID },
      payload: { fromTemplateId: TEMPLATE_ID },
    })
  })

  it('refuses to apply a template to an active batch', async () => {
    // applying one replaces a plan people already live in, so the control is
    // closed rather than the request refused
    screen({
      getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
      listBatches: () => Effect.succeed({ items: [batch({ status: 'active' })], nextCursor: null }),
    })
    await expect.element(page.getByRole('button', { name: '套用模板' })).toBeDisabled()
  })

  it('says what the engine refused, about the phase it refused it for', async () => {
    screen({
      getPhases: () =>
        Effect.succeed({
          phases: [
            phase({ id: ENTRY_PHASE_ID, phaseKey: 'entry', displayName: '正式填报' }),
            phase({
              id: REVIEW_PHASE_ID,
              phaseKey: 'review',
              ordinal: 1,
              displayName: '审核整理',
              entryTrigger: 'scheduled',
            }),
          ],
        }),
      putPhases: () =>
        Effect.fail(
          Object.assign(new Error('ASSESSMENT_PLAN_INVALID'), {
            _tag: 'ASSESSMENT_PLAN_INVALID',
            refusals: [
              { reason: 'hard-plan-beyond-event-boundary', phaseId: REVIEW_PHASE_ID, index: 1 },
            ],
          }),
        ),
    })

    await page.getByRole('button', { name: '保存' }).click()
    // the sentence, in the reader's language, inside the row it belongs to
    await expect
      .element(page.getByText('固定日期不能排在等待事件的阶段之后，改用偏移时长。'))
      .toBeVisible()
  })

  it('edits the time shape a phase actually has', async () => {
    screen({
      getPhases: () =>
        Effect.succeed({
          phases: [
            // a scheduled phase carries a date...
            phase({
              id: ENTRY_PHASE_ID,
              phaseKey: 'entry',
              displayName: '正式填报',
              entryTrigger: 'scheduled',
              plannedEntryAt: '2026-09-05T16:00:00.000Z',
            }),
            // ...one measured from an event carries a duration instead
            phase({
              id: REVIEW_PHASE_ID,
              phaseKey: 'appeal',
              ordinal: 1,
              displayName: '申诉',
              entryTrigger: 'scheduled',
              entryOffset: { days: 3 },
            }),
          ],
        }),
    })

    await expect.element(page.getByLabelText('计划开始时间')).toBeVisible()
    await expect.element(page.getByLabelText('在上一阶段之后')).toHaveValue(3)
  })
})

describe('the roster panel', () => {
  it('offers each drift class the action that answers it', async () => {
    const include = vi.fn((_request: PlanRequest) =>
      Effect.succeed({ participant: {}, activeElsewhere: [], chainPreview: [] }),
    )
    const applyAnchor = vi.fn((_request: PlanRequest) =>
      Effect.succeed({ participant: {}, chainPreview: [] }),
    )
    screen({
      getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
      listBatches: () => Effect.succeed({ items: [batch({ status: 'active' })], nextCursor: null }),
      includeParticipant: include,
      applyParticipantAnchor: applyAnchor,
      getRosterDiff: () =>
        Effect.succeed({
          diff: {
            ...emptyDiff,
            newArrivals: [
              {
                userId: USER_ID,
                displayName: '转入生',
                businessNo: '2401',
                userTypeId: USER_ID,
                nodeId: NODE_ID,
                nodePath: 'r.se.c1',
                activeElsewhere: [{ batchId: 'other', name: '英语学院综测' }],
              },
            ],
            anchorChanged: [
              {
                participantId: PARTICIPANT_ID,
                userId: USER_ID,
                displayName: '换班生',
                from: { nodeId: NODE_ID, path: 'r.se.c1' },
                to: { nodeId: NODE_ID, path: 'r.se.c2' },
              },
            ],
          },
        }),
    })

    // an arrival is a question, and the answer carries the warning that
    // matters: they are already counted somewhere else
    await expect.element(page.getByText('同时参加：英语学院综测')).toBeVisible()
    await page.getByRole('button', { name: '纳入花名册' }).click()
    await vi.waitFor(() => expect(include).toHaveBeenCalledTimes(1))
    expect(include.mock.calls[0]![0]).toMatchObject({ payload: { userId: USER_ID } })

    // a move inside the scope is answered by refreezing the snapshot
    await page.getByRole('button', { name: '应用新位置' }).click()
    await vi.waitFor(() => expect(applyAnchor).toHaveBeenCalledTimes(1))
    expect(applyAnchor.mock.calls[0]![0]).toMatchObject({
      params: { participantId: PARTICIPANT_ID },
    })
  })

  it('says the roster does not exist yet while the batch is a draft', async () => {
    screen()
    await expect.element(page.getByText('花名册在批次激活时生成。')).toBeVisible()
  })
})
