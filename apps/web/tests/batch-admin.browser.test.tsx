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

// What a service test cannot see: that a plan can be built with no template
// at all, that the two template kinds stay in their own pickers and both stay
// optional, that the stage panel offers only the permissions a stage may
// govern, that an engine refusal reaches the administrator as a sentence, and
// that each organizational drift gets the one action that answers it.

type BatchDto = ApiResult<typeof assessmentApi, 'assessment', 'getBatch'>['batch']
type PhaseDto = ApiResult<typeof assessmentApi, 'assessment', 'getPhases'>['phases'][number]

/** what a screen sends: params in the path, payload in the body */
interface Request {
  params?: Record<string, string>
  payload?: Record<string, unknown>
  query?: Record<string, string>
}

type Clients = ClientOf<typeof assessmentApi>
type Stubs = Partial<Record<keyof Clients['assessment'], (...args: never[]) => unknown>>

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const TIMELINE_ID = '22222222-2222-4222-8222-222222222222'
const PRESET_ID = '88888888-8888-4888-8888-888888888888'
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
  participantCount: 12,
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

// one template of each kind: the pickers must keep them apart, which this
// stub verifies by construction - ask without a kind and you would see both
const templates = (request: Request) =>
  Effect.succeed({
    items:
      request.query?.kind === 'phase'
        ? [
            {
              id: PRESET_ID,
              name: '填报阶段预设',
              kind: 'phase' as const,
              version: 1,
              phases: [
                {
                  phaseKey: 'entry',
                  displayName: '正式填报',
                  entryTrigger: 'manual' as const,
                  plannedEntryAt: null,
                  entryOffset: null,
                  estimatedEntryAt: null,
                  permissionProfile: ['assessment.entry.create', 'assessment.entry.submit'],
                  itemScope: [],
                  participantScope: [],
                },
              ],
            },
          ]
        : [
            {
              id: TIMELINE_ID,
              name: '常规四阶段',
              kind: 'timeline' as const,
              version: 1,
              phases: [],
            },
          ],
    nextCursor: null,
  })

const assessmentStubs = (over: Stubs = {}): Stubs => ({
  listBatches: () => Effect.succeed({ items: [batch()], nextCursor: null, total: 1 }),
  getBatch: () => Effect.succeed({ batch: batch() }),
  getPhases: () => Effect.succeed({ phases: [] }),
  listTemplates: templates,
  listScopeOptions: () =>
    Effect.succeed({
      nodes: [{ id: NODE_ID, name: '软件学院', path: 'r.se', depth: 1, orgTypeId: NODE_ID }],
    }),
  createBatch: () => Effect.succeed({ batch: batch() }),
  listUserTypeOptions: () =>
    Effect.succeed({ userTypes: [{ id: USER_ID, code: 'student', name: '学生' }] }),
  listParticipants: () => Effect.succeed({ items: [], nextCursor: null }),
  getRosterDiff: () => Effect.succeed({ diff: emptyDiff }),
  ...over,
})

const screen = (over: Stubs = {}, route = `/assessment/batches?batch=${BATCH_ID}`) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      assessment: assessmentStubs(over),
    }),
    children: <BatchAdminPage />,
    route,
  })

describe('the batch list', () => {
  it('searches by name, filters by status and reads the next page', async () => {
    const seen: Request[] = []
    const listBatches = vi.fn((request: Request) => {
      seen.push(request)
      const cursor = request.query?.['cursor']
      if (cursor === 'next-page') {
        return Effect.succeed({
          items: [batch({ id: 'second', name: '2025 秋季综测' })],
          nextCursor: null,
          total: 21,
        })
      }
      return Effect.succeed({ items: [batch()], nextCursor: 'next-page', total: 21 })
    })
    screen({ listBatches }, '/assessment/batches')

    // the first page knows where it sits in the whole
    await expect.element(page.getByText('2026 春季综测')).toBeVisible()
    await expect.element(page.getByText('第 1 / 2 页', { exact: false })).toBeVisible()

    await page.getByRole('button', { name: '下一页' }).click()
    // the second page replaces the first, reached by the cursor it handed out
    await expect.element(page.getByText('2025 秋季综测')).toBeVisible()
    expect(seen.at(-1)?.query).toMatchObject({ cursor: 'next-page' })
    await expect.element(page.getByText('第 2 / 2 页', { exact: false })).toBeVisible()

    // and going back is the cursor already held, not a re-count
    await page.getByRole('button', { name: '上一页' }).click()
    await expect.element(page.getByText('2026 春季综测')).toBeVisible()

    // a status choice and a typed name reach the server as query parameters,
    // and the chosen filter is the one that looks chosen
    await page.getByRole('radio', { name: '草稿' }).click()
    await expect.element(page.getByRole('radio', { name: '草稿' })).toBeChecked()
    await vi.waitFor(() => expect(seen.at(-1)?.query).toMatchObject({ status: 'draft' }))
    await page.getByRole('textbox', { name: '搜索批次名称' }).fill('春季')
    await vi.waitFor(() => expect(seen.at(-1)?.query).toMatchObject({ q: '春季' }), {
      timeout: 3000,
    })
  })

  it('tells an empty result apart from an empty list', async () => {
    screen(
      { listBatches: () => Effect.succeed({ items: [], nextCursor: null, total: 0 }) },
      '/assessment/batches',
    )
    // nothing has been created yet: the answer is to create one
    await expect.element(page.getByText('暂无测评批次。')).toBeVisible()

    await page.getByRole('textbox', { name: '搜索批次名称' }).fill('不存在的名字')
    // now the same emptiness means the filter matched nothing
    await expect.element(page.getByText('未找到匹配的批次')).toBeVisible()
    await page.getByRole('button', { name: '清除筛选' }).click()
    await expect.element(page.getByText('暂无测评批次。')).toBeVisible()
  })

  it('opens a batch from the table and comes back', async () => {
    screen({}, '/assessment/batches')
    await expect.element(page.getByRole('heading', { name: '测评批次' })).toBeVisible()

    await page.getByRole('button', { name: '2026 春季综测' }).click()
    await expect.element(page.getByRole('heading', { name: '2026 春季综测' })).toBeVisible()

    await page.getByRole('button', { name: '全部批次' }).click()
    await expect.element(page.getByRole('heading', { name: '测评批次' })).toBeVisible()
  })
})

describe('creating a batch', () => {
  it('walks two steps and picks units in place', async () => {
    const createBatch = vi.fn((_request: Request) =>
      Effect.succeed({ batch: { ...batch(), id: 'created' } }),
    )
    screen({ createBatch }, '/assessment/batches')

    await page.getByRole('button', { name: '新建批次' }).click()
    const dialog = page.getByRole('dialog')

    // the second step is out of reach until the first one is answered
    await expect.element(dialog.getByRole('button', { name: '下一步' })).toBeDisabled()
    await dialog.getByRole('textbox', { name: '名称' }).fill('2026 秋季综测')
    // the calendar names a day by its whole date, so the day is matched inside it
    await dialog.getByRole('button', { name: '材料时间范围' }).click()
    await page.getByRole('button', { name: /月10日/ }).first().click()
    await page.getByRole('button', { name: /月20日/ }).first().click()
    await dialog.getByRole('button', { name: '下一步' }).click()

    // the units are chosen right here, not in a dialog stacked on this one
    await expect.element(dialog.getByRole('checkbox', { name: '软件学院' })).toBeVisible()
    await dialog.getByRole('checkbox', { name: '软件学院' }).click()
    await dialog.getByRole('checkbox', { name: '学生' }).click()
    await dialog.getByRole('button', { name: '创建批次' }).click()

    await vi.waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1))
    const sent = createBatch.mock.calls[0]![0].payload!
    expect(sent['name']).toBe('2026 秋季综测')
    expect(sent['scopeNodeIds']).toEqual([NODE_ID])
    expect(sent['userTypeIds']).toEqual([USER_ID])
  })
})

describe('the stage plan', () => {
  it('builds a stage from nothing - no template required anywhere', async () => {
    const putPhases = vi.fn((_request: Request) => Effect.succeed({ phases: [], warnings: [] }))
    screen({ putPhases })

    // the empty plan offers both roads and demands neither
    await expect
      .element(page.getByText('暂无阶段。可套用时间线模板，或手动添加阶段。'))
      .toBeVisible()

    await page.getByRole('button', { name: '添加阶段' }).click()
    await page.getByLabelText('阶段名称').fill('正式填报')
    await page.getByRole('button', { name: '保存' }).click()

    await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
    const sent = putPhases.mock.calls[0]![0]
    expect(sent.params).toMatchObject({ batchId: BATCH_ID })
    const plan = sent.payload!['phases'] as readonly Record<string, unknown>[]
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ displayName: '正式填报', entryTrigger: 'manual' })
  })

  it('offers only the permissions a stage may govern', async () => {
    screen({
      getPhases: () =>
        Effect.succeed({
          phases: [phase({ id: ENTRY_PHASE_ID, phaseKey: 'entry', displayName: '正式填报' })],
        }),
    })

    await page.getByRole('button', { name: '编辑' }).click()
    const panel = page.getByRole('dialog')
    // what a stage opens is the panel's third step
    await panel.getByRole('button', { name: '开放操作' }).click()

    // the gate's own registry, and nothing else: a stage can open submitting
    // an entry...
    await expect.element(panel.getByRole('checkbox', { name: '提交审核' })).toBeVisible()
    await expect.element(panel.getByRole('checkbox', { name: '审核提交的内容' })).toBeVisible()
    // ...but signing in, managing the organization or managing the batch
    // itself are not things a stage governs, so they cannot be listed here
    for (const absent of ['登录', '管理组织架构', '管理测评批次', '查看角色']) {
      await expect.element(panel.getByRole('checkbox', { name: absent })).not.toBeInTheDocument()
    }
    // exactly the eleven gated codes, which is the whole of the registry
    expect(panel.getByRole('checkbox').elements()).toHaveLength(11)
  })

  it('fills one stage from a stage preset, as a starting point only', async () => {
    const putPhases = vi.fn((_request: Request) => Effect.succeed({ phases: [], warnings: [] }))
    screen({ putPhases })

    await page.getByRole('button', { name: '添加阶段' }).click()
    const panel = page.getByRole('dialog')

    // the preset picker sees stage presets and nothing else
    await panel.getByLabelText('用预设填充这个阶段').selectOptions('填报阶段预设')
    await panel.getByRole('button', { name: '填入' }).click()

    // it filled the name, and the actions it carried are ticked a step later
    await expect.element(panel.getByLabelText('阶段名称')).toHaveValue('正式填报')
    await panel.getByRole('button', { name: '开放操作' }).click()
    await expect.element(panel.getByRole('checkbox', { name: '提交审核' })).toBeChecked()
    await expect.element(panel.getByRole('checkbox', { name: '查看排名' })).not.toBeChecked()

    await panel.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
    const plan = putPhases.mock.calls[0]![0].payload!['phases'] as readonly Record<
      string,
      unknown
    >[]
    expect(plan[0]).toMatchObject({
      displayName: '正式填报',
      permissionProfile: ['assessment.entry.create', 'assessment.entry.submit'],
    })
  })

  it('applies a timeline by id, server-side, only while a draft', async () => {
    const putPhases = vi.fn((_request: Request) => Effect.succeed({ phases: [], warnings: [] }))
    screen({ putPhases })

    await page.getByRole('button', { name: '从时间线开始' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabelText('时间线').selectOptions('常规四阶段')
    await dialog.getByRole('button', { name: '从时间线开始' }).click()

    await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
    // the screen names the timeline and lets the server copy it, so the
    // provenance the plan records is the server's to write
    expect(putPhases.mock.calls[0]![0]).toMatchObject({
      params: { batchId: BATCH_ID },
      payload: { fromTemplateId: TIMELINE_ID },
    })
  })

  it('does not offer timelines once the batch is running', async () => {
    screen({
      getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
      getPhases: () =>
        Effect.succeed({
          phases: [phase({ id: ENTRY_PHASE_ID, phaseKey: 'entry', displayName: '正式填报' })],
        }),
    })
    // applying one replaces a plan people already live in, so the road is
    // closed entirely rather than refused on submit
    await expect.element(page.getByText('正式填报')).toBeVisible()
    await expect.element(page.getByRole('button', { name: '从时间线开始' })).not.toBeInTheDocument()
    // adding a single stage stays possible
    await expect.element(page.getByRole('button', { name: '添加阶段' })).toBeVisible()
  })

  it('says what was refused, as a sentence in the panel', async () => {
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

    await page.getByRole('button', { name: '编辑' }).nth(1).click()
    await page.getByRole('dialog').getByRole('button', { name: '保存' }).click()
    await expect
      .element(
        page.getByText(
          '前面还有阶段没定下日期，它后面的阶段承诺不了具体时间；改用“上一阶段开始后第几天”。',
          { exact: false },
        ),
      )
      .toBeVisible()
  })

  it('starting a scheduled stage early demands a written reason', async () => {
    const advancePhase = vi.fn((_request: Request) =>
      Effect.succeed({ phases: [], effective: null }),
    )
    screen({
      getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
      listBatches: () =>
        Effect.succeed({ items: [batch({ status: 'active' })], nextCursor: null, total: 1 }),
      advancePhase,
      getPhases: () =>
        Effect.succeed({
          phases: [
            phase({
              id: ENTRY_PHASE_ID,
              phaseKey: 'entry',
              displayName: '正式填报',
              entryTrigger: 'scheduled',
              plannedEntryAt: '2027-09-05T16:00:00.000Z',
            }),
          ],
        }),
    })

    await page.getByRole('button', { name: '提前开始' }).click()
    const dialog = page.getByRole('dialog')
    // no reason, no way forward
    await expect.element(dialog.getByRole('button', { name: '提前开始' })).toBeDisabled()
    await dialog.getByLabelText('理由').fill('评审组要求提前')
    await dialog.getByRole('button', { name: '提前开始' }).click()

    await vi.waitFor(() => expect(advancePhase).toHaveBeenCalledTimes(1))
    expect(advancePhase.mock.calls[0]![0]).toMatchObject({
      payload: { to: ENTRY_PHASE_ID, force: true, reason: '评审组要求提前' },
    })
  })
})

describe('the participants tab', () => {
  it('says the list does not exist yet while the batch is a draft', async () => {
    screen()
    await page.getByRole('tab', { name: '参评人员' }).click()
    await expect
      .element(page.getByText('参评名单将在批次激活时按所选单位与人员类型生成。'))
      .toBeVisible()
  })

  it('offers each organizational change the action that answers it', async () => {
    const include = vi.fn((_request: Request) =>
      Effect.succeed({ participant: {}, activeElsewhere: [], chainPreview: [] }),
    )
    const applyAnchor = vi.fn((_request: Request) =>
      Effect.succeed({ participant: {}, chainPreview: [] }),
    )
    screen({
      getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
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

    await page.getByRole('tab', { name: '参评人员' }).click()

    // an arrival is a question, and the answer carries the warning that
    // matters: they are already counted somewhere else
    await expect.element(page.getByText('已在参加：英语学院综测')).toBeVisible()
    await page.getByRole('button', { name: '加入本批次' }).click()
    await vi.waitFor(() => expect(include).toHaveBeenCalledTimes(1))
    expect(include.mock.calls[0]![0]).toMatchObject({ payload: { userId: USER_ID } })

    // a move inside the covered units is answered by refreezing the snapshot
    await page.getByRole('button', { name: '应用变动' }).click()
    await vi.waitFor(() => expect(applyAnchor).toHaveBeenCalledTimes(1))
    expect(applyAnchor.mock.calls[0]![0]).toMatchObject({
      params: { participantId: PARTICIPANT_ID },
    })
  })
})
