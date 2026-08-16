import { lazy, type ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { ApiResult, ClientOf } from '@qualy/web-runtime/api'
import type { assessmentApi } from '@qualy/plugin-assessment/client/api'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// loaded through the registry the host actually uses, so a screen that lost
// its key would fail here rather than at runtime
const BatchListPage = (await components['assessment/BatchListPage']!()).default
const BatchPhasesPage = (await components['assessment/BatchPhasesPage']!()).default
const BatchParticipantsPage = (await components['assessment/BatchParticipantsPage']!()).default
const BatchAccessPage = (await components['assessment/BatchAccessPage']!()).default
const BatchOverviewPage = (await components['assessment/BatchOverviewPage']!()).default
const BatchSettingsPage = (await components['assessment/BatchSettingsPage']!()).default
// the picker iam contributes, held the way the registry holds one
const PeopleImportPicker = lazy(components['auth/PeopleImportPicker']!)
// the bar the workspace shell puts above its rail: which batch is open, where
// it stands, and what can be done to it. Mounted here the way the shell
// mounts it, because half of what these cases drive lives in it.
const BatchContextBar = (await components['assessment/BatchContextBar']!()).default

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
const SOURCE_ID = '99999999-9999-4999-8999-999999999999'
const ASSIGNMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const ROLE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const batch = (over: Partial<BatchDto> = {}): BatchDto => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: false, manage: true },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'draft',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  ...over,
})

const phase = (over: Partial<PhaseDto> & { id: string; phaseKey: string }): PhaseDto => ({
  ordinal: 0,
  displayName: over.phaseKey,
  description: '',
  entryNote: '',
  plannedEntryAt: null,
  actualEntryAt: null,
  permissionProfile: [],
  itemScope: [],
  participantScope: [],
  sourceTemplateId: null,
  sourceTemplateVersion: null,
  ...over,
})

/** one accepted assignment, as the access page reads it */
const source = (over: Record<string, unknown> = {}) => ({
  sourceId: SOURCE_ID,
  assignmentId: ASSIGNMENT_ID,
  roleId: ROLE_ID,
  roleName: '学院审核员',
  origin: 'inherited' as const,
  orgNodeId: NODE_ID,
  coverage: 'subtree' as const,
  accepted: ['assessment.review.process'],
  current: ['assessment.review.process'],
  active: true,
  ...over,
})

const subject = (over: Record<string, unknown> = {}) => ({
  userId: USER_ID,
  displayName: '王审核',
  businessNo: 'T0001',
  sources: [source()],
  denied: [],
  effective: ['assessment.review.process'],
  manageable: true,
  ...over,
})

const emptyPlan = { newSources: [], widened: [], lapsed: [] }

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
                  displayName: '正式填报' as const,
                  description: '',
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

/** a row as the list receives it: the batch, plus its derived timeline */
const listRow = (over: Partial<BatchDto> = {}, timeline: unknown[] = []) => ({
  ...batch(over),
  timeline,
})

const assessmentStubs = (over: Stubs = {}): Stubs => ({
  listBatches: () =>
    Effect.succeed({
      items: [listRow()],
      nextCursor: null,
      total: 1,
      capabilities: { create: true },
    }),
  getBatch: () => Effect.succeed({ batch: batch() }),
  getPhases: () => Effect.succeed({ phases: [] }),
  getTimeline: () => Effect.succeed({ timeline: [] }),
  listTemplates: templates,
  listScopeOptions: () =>
    Effect.succeed({
      nodes: [{ id: NODE_ID, name: '软件学院', path: 'r.se', depth: 1, orgTypeId: NODE_ID }],
    }),
  createBatch: () => Effect.succeed({ batch: batch() }),
  listUserTypeOptions: () =>
    Effect.succeed({ userTypes: [{ id: USER_ID, code: 'student', name: '学生' }] }),
  listParticipants: () => Effect.succeed({ items: [], nextCursor: null }),
  previewImport: () => Effect.succeed({ candidates: 0 }),
  staffOptions: () => Effect.succeed({ nodes: [], roles: [] }),
  listAccess: () => Effect.succeed({ staff: [subject()] }),
  previewAccessSync: () => Effect.succeed(emptyPlan),
  ...over,
})

// the batch pages as the manifest carries them: a link between them resolves
// through this, the same way it does in the running application
const PAGES = [
  { id: 'assessment/batches', path: '/assessment/batches' },
  { id: 'assessment/batch', path: '/assessment/batches/:batchId' },
  { id: 'assessment/batch-phases', path: '/assessment/batches/:batchId/phases' },
  { id: 'assessment/batch-participants', path: '/assessment/batches/:batchId/participants' },
  { id: 'assessment/batch-access', path: '/assessment/batches/:batchId/access' },
  { id: 'assessment/batch-settings', path: '/assessment/batches/:batchId/settings' },
].map((page) => ({ ...page, component: page.id, layout: 'admin' }))

/** a section of the batch, inside the chrome the workspace shell gives it */
const workspace = (element: ReactNode) => (
  <>
    <BatchContextBar />
    {element}
  </>
)

const screen = (over: Stubs = {}, route = `/assessment/batches/${BATCH_ID}/phases`) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: assessmentStubs(over),
    }),
    routes: [
      { path: '/assessment/batches', element: <BatchListPage /> },
      { path: '/assessment/batches/:batchId', element: workspace(<BatchOverviewPage />) },
      { path: '/assessment/batches/:batchId/phases', element: workspace(<BatchPhasesPage />) },
      {
        path: '/assessment/batches/:batchId/participants',
        element: workspace(<BatchParticipantsPage />),
      },
      { path: '/assessment/batches/:batchId/access', element: workspace(<BatchAccessPage />) },
      { path: '/assessment/batches/:batchId/settings', element: workspace(<BatchSettingsPage />) },
    ],
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
          items: [listRow({ id: 'second', name: '2025 秋季综测' })],
          nextCursor: null,
          total: 21,
          capabilities: { create: true },
        })
      }
      return Effect.succeed({
        items: [listRow()],
        nextCursor: 'next-page',
        total: 21,
        capabilities: { create: true },
      })
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

  it('offers neither creation nor drafts to somebody who administers nothing', async () => {
    screen(
      {
        listBatches: () =>
          Effect.succeed({
            items: [listRow({ status: 'active', currentPhaseId: ENTRY_PHASE_ID })],
            nextCursor: null,
            total: 1,
            capabilities: { create: false },
          }),
      },
      '/assessment/batches',
    )

    await expect.element(page.getByText('2026 春季综测')).toBeVisible()
    // the rounds they take part in are still theirs to read
    expect(await page.getByRole('button', { name: '新建批次' }).elements()).toHaveLength(0)
    // and a filter that could only ever answer with an empty page is not offered
    expect(await page.getByRole('radio', { name: '草稿' }).elements()).toHaveLength(0)
  })

  it('tells an empty result apart from an empty list', async () => {
    screen(
      {
        listBatches: () =>
          Effect.succeed({ items: [], nextCursor: null, total: 0, capabilities: { create: true } }),
      },
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

    await page.getByRole('link', { name: '2026 春季综测' }).click()
    // the batch says which one it is in the bar above its rail, not in a
    // heading the section would have to repeat
    await expect.element(page.getByText('2026 春季综测')).toBeVisible()

    await page.getByRole('link', { name: '返回批次列表' }).click()
    await expect.element(page.getByRole('heading', { name: '测评批次' })).toBeVisible()
  })
})

// The bar's countdown, which is arithmetic nothing else covers: two units at
// a time, and the smaller one dropped when it is empty.

const HOUR = 3600_000
const at = (ms: number) => new Date(Date.now() + ms).toISOString()
/** a round in its filing stage, with the next one due in so long */
const running = (untilNext: number) => [
  {
    phaseId: ENTRY_PHASE_ID,
    displayName: '正式填报',
    description: '',
    entryNote: '',
    status: 'current' as const,
    entry: { kind: 'entered' as const, at: at(-HOUR) },
  },
  {
    phaseId: REVIEW_PHASE_ID,
    displayName: '审核',
    description: '',
    entryNote: '',
    status: 'future' as const,
    entry: { kind: 'planned' as const, at: at(untilNext) },
  },
]

describe('the countdown', () => {
  it('says two units, and drops the smaller one when it is empty', async () => {
    // two units is what a bar with room says; the phone case is below
    await page.viewport(1280, 800)
    screen(
      {
        getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
        getTimeline: () => Effect.succeed({ timeline: running(27 * HOUR + 30 * 60_000) }),
      },
      `/assessment/batches/${BATCH_ID}/phases`,
    )
    // a day and change reads as days and hours, never down to the minute
    await expect.element(page.getByText('剩余 1 天 3 小时')).toBeVisible()
  })

  it('says the larger unit alone when nothing is left under it', async () => {
    await page.viewport(1280, 800)
    screen(
      {
        getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
        // a shade over three hours: exactly three would be two and
        // fifty-nine by the time the component reads the clock
        getTimeline: () => Effect.succeed({ timeline: running(3 * HOUR + 30_000) }),
      },
      `/assessment/batches/${BATCH_ID}/phases`,
    )
    await expect.element(page.getByText('剩余 3 小时')).toBeVisible()
  })

  it('names the stage in the clock once the bar is too narrow to show it', async () => {
    await page.viewport(390, 844)
    screen(
      {
        getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
        getTimeline: () => Effect.succeed({ timeline: running(39 * 60_000 + 13_000) }),
      },
      `/assessment/batches/${BATCH_ID}/phases`,
    )
    // one unit, and whose clock it is: the stage's name has gone from the
    // bar, so a bare number would read as the batch's own countdown
    await expect.element(page.getByText('阶段余 39 分')).toBeVisible()
    await page.viewport(1280, 800)
  })
})

describe('the batch overview', () => {
  it('says where the round is, and opens the whole flow on request', async () => {
    await page.viewport(1280, 800)
    screen(
      {
        getBatch: () =>
          Effect.succeed({ batch: batch({ status: 'active', currentPhaseId: ENTRY_PHASE_ID }) }),
        getTimeline: () => Effect.succeed({ timeline: running(30 * HOUR) }),
      },
      `/assessment/batches/${BATCH_ID}`,
    )

    // the context bar answers "why can I do this now": the stage in hand and
    // when it gives way, said without a label in front of it
    await expect.element(page.getByText('正式填报').first()).toBeVisible()

    // and the flow itself is one click away wherever the reader is
    await page.getByRole('button', { name: '查看完整流程' }).click()
    const panel = page.getByRole('dialog')
    await expect.element(panel.getByText('测评流程')).toBeVisible()
    await expect.element(panel.getByText('审核')).toBeVisible()
    // read-only: no word of how the plan is arranged
    expect(await panel.getByText('未排期').elements()).toHaveLength(0)
  })

  it('folds the stages the round has left behind, and opens them on a click', async () => {
    await page.viewport(1280, 800)
    const past = (name: string, hoursAgo: number) => ({
      phaseId: name,
      displayName: name,
      description: '',
      entryNote: '',
      status: 'ended' as const,
      entry: { kind: 'entered' as const, at: at(-hoursAgo * HOUR) },
    })
    screen(
      {
        getBatch: () =>
          Effect.succeed({ batch: batch({ status: 'active', currentPhaseId: ENTRY_PHASE_ID }) }),
        getTimeline: () =>
          Effect.succeed({
            timeline: [
              past('预填报期', 96),
              past('资格核对', 72),
              past('材料补交', 48),
              past('初审', 24),
              ...running(30 * HOUR),
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}`,
    )

    // the rail opens on where the round is, not on where it started; the
    // strip beside it is the phone's copy and keeps every stage
    await expect.element(page.getByText('展开前面 3 个阶段')).toBeVisible()
    await page.getByText('展开前面 3 个阶段').click()
    expect(await page.getByText('展开前面 3 个阶段').elements()).toHaveLength(0)
    await expect.element(page.getByRole('heading', { name: '预填报期' }).first()).toBeVisible()
  })

  it('says what a stage with no time is waiting for', async () => {
    await page.viewport(1280, 800)
    screen(
      {
        getBatch: () =>
          Effect.succeed({ batch: batch({ status: 'active', currentPhaseId: ENTRY_PHASE_ID }) }),
        getTimeline: () =>
          Effect.succeed({
            timeline: [
              ...running(30 * HOUR),
              {
                phaseId: 'appeal',
                displayName: '申诉期',
                description: '',
                entryNote: '待学院审批名单后确定',
                status: 'future' as const,
                entry: { kind: 'pending' as const, at: null },
              },
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}`,
    )

    // the stage says its time is still to be decided, and why
    await expect.element(page.getByText('时间待定').first()).toBeVisible()
    await expect.element(page.getByText('待学院审批名单后确定').first()).toBeVisible()
  })
})

describe('the batch lifecycle', () => {
  it('offers to delete a draft, and never says the word activate', async () => {
    const deleteBatch = vi.fn((_request: Request) => Effect.succeed({ deleted: true }))
    // the lifecycle lives on the settings page, not above every section
    screen({ deleteBatch }, `/assessment/batches/${BATCH_ID}/settings`)

    // a draft has run nothing, so removing it loses only the setup
    await expect.element(page.getByText('草稿')).toBeVisible()
    expect(await page.getByRole('button', { name: '激活' }).elements()).toHaveLength(0)
    await page.getByRole('button', { name: '删除批次' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除批次' }).click()
    await vi.waitFor(() => expect(deleteBatch).toHaveBeenCalledTimes(1))
    expect(deleteBatch.mock.calls[0]![0]).toMatchObject({ params: { batchId: BATCH_ID } })
  })

  it('saves the batch it is looking at, and sends only what it holds', async () => {
    const updateBatch = vi.fn((_request: Request) => Effect.succeed({ batch: batch() }))
    screen({ updateBatch }, `/assessment/batches/${BATCH_ID}/settings`)

    // nothing to save until something differs from what was read
    await expect.element(page.getByRole('button', { name: '保存' })).toBeDisabled()
    await page.getByRole('textbox', { name: '名称' }).fill('2026 春季综测（改）')
    await page.getByRole('textbox', { name: '备注' }).fill('先行试点')
    await page.getByRole('button', { name: '保存' }).click()

    await vi.waitFor(() => expect(updateBatch).toHaveBeenCalledTimes(1))
    expect(updateBatch.mock.calls[0]![0]).toMatchObject({
      params: { batchId: BATCH_ID },
      payload: { name: '2026 春季综测（改）', descriptionMd: '先行试点' },
    })
  })

  it('says a scheduled batch has not begun, rather than calling it under way', async () => {
    screen({
      getBatch: () => Effect.succeed({ batch: batch({ status: 'active', currentPhaseId: null }) }),
    })
    await expect.element(page.getByText('待开始')).toBeVisible()
  })

  it('reopens an archived batch into a stage, and insists on a reason', async () => {
    const setBatchStatus = vi.fn((_request: Request) =>
      Effect.succeed({ batch: batch({ status: 'active' }) }),
    )
    screen(
      {
        getBatch: () =>
          Effect.succeed({ batch: batch({ status: 'archived', currentPhaseId: ENTRY_PHASE_ID }) }),
        setBatchStatus,
      },
      `/assessment/batches/${BATCH_ID}/settings`,
    )

    await page.getByRole('button', { name: '重新开启' }).click()
    const dialog = page.getByRole('dialog')
    // neither half of it is optional: without both, reopening stays shut
    await expect.element(dialog.getByRole('button', { name: '重新开启' })).toBeDisabled()
    await dialog.getByLabelText('开启事由').fill('发现部分材料漏报')
    await dialog.getByLabelText('要开启的阶段').fill('补充填报期')
    await dialog.getByRole('button', { name: '重新开启' }).click()

    await vi.waitFor(() => expect(setBatchStatus).toHaveBeenCalledTimes(1))
    expect(setBatchStatus.mock.calls[0]![0]).toMatchObject({
      payload: {
        status: 'active',
        reason: '发现部分材料漏报',
        phase: { displayName: '补充填报期' },
        plannedEntryAt: null,
      },
    })
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
    await page
      .getByRole('button', { name: /月10日/ })
      .first()
      .click()
    await page
      .getByRole('button', { name: /月20日/ })
      .first()
      .click()
    await dialog.getByRole('button', { name: '下一步' }).click()

    // the units are chosen right here, not in a dialog stacked on this one
    await expect.element(dialog.getByRole('checkbox', { name: '软件学院' })).toBeVisible()
    await dialog.getByRole('checkbox', { name: '软件学院' }).click()
    await dialog.getByRole('checkbox', { name: '学生' }).click()
    await dialog.getByRole('button', { name: '创建批次' }).click()

    await vi.waitFor(() => expect(createBatch).toHaveBeenCalledTimes(1))
    const sent = createBatch.mock.calls[0]![0].payload!
    expect(sent['name']).toBe('2026 秋季综测')
    // the units and types are the import's parameters, not a scope the batch
    // will carry afterwards
    expect(sent['import']).toEqual({ orgNodeIds: [NODE_ID], userTypeIds: [USER_ID] })
  })
})

describe('the stage plan', () => {
  const twoPhases = (over: { planned?: string | null; entered?: string | null } = {}) => ({
    phases: [
      phase({
        id: ENTRY_PHASE_ID,
        phaseKey: 'entry',
        displayName: '正式填报',
        ...(over.entered !== undefined ? { actualEntryAt: over.entered } : {}),
        ...(over.planned !== undefined ? { plannedEntryAt: over.planned } : {}),
      }),
      phase({ id: REVIEW_PHASE_ID, phaseKey: 'review', ordinal: 1, displayName: '审核整理' }),
    ],
  })

  it('builds a stage from nothing, and sends structure without any time', async () => {
    const putPhases = vi.fn((_request: Request) => Effect.succeed({ phases: [], warnings: [] }))
    screen({ putPhases })

    await expect.element(page.getByText('暂无阶段。可从模板添加，或手动新增。')).toBeVisible()

    await page.getByRole('button', { name: '新增阶段', exact: true }).click()
    // a phase is named where a name has room to be read
    await page.getByRole('button', { name: '编辑详情' }).click()
    const details = page.getByRole('dialog')
    await details.getByLabelText('阶段名称').fill('正式填报')
    await details.getByRole('button', { name: '完成' }).click()
    expect(putPhases).not.toHaveBeenCalled()
    await page.getByRole('button', { name: '保存' }).click()

    await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
    const sent = putPhases.mock.calls[0]![0]
    expect(sent.params).toMatchObject({ batchId: BATCH_ID })
    const plan = sent.payload!['phases'] as readonly Record<string, unknown>[]
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ displayName: '正式填报', description: '' })
    // a plan write says what the phases are, never when they happen
    expect(plan[0]).not.toHaveProperty('plannedEntryAt')
  })

  it('offers a time to one stage at a time, from the top down', async () => {
    const schedulePhase = vi.fn((_request: Request) => Effect.succeed({ phases: [] }))
    screen({ schedulePhase, getPhases: () => Effect.succeed(twoPhases()) })

    // the first unscheduled stage is the only one that can take a time
    await expect.element(page.getByRole('button', { name: '去排期' })).toBeVisible()
    expect(page.getByRole('button', { name: '去排期' }).elements()).toHaveLength(1)
    await expect.element(page.getByText('请先为上一阶段排期')).toBeVisible()
  })

  it('withdraws a time from the last stage that has one', async () => {
    const schedulePhase = vi.fn((_request: Request) => Effect.succeed({ phases: [] }))
    screen({
      schedulePhase,
      getPhases: () => Effect.succeed(twoPhases({ planned: '2027-09-05T16:00:00.000Z' })),
    })

    await page.getByRole('button', { name: '取消排期' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '取消排期' }).click()

    await vi.waitFor(() => expect(schedulePhase).toHaveBeenCalledTimes(1))
    expect(schedulePhase.mock.calls[0]![0]).toMatchObject({
      params: { batchId: BATCH_ID, phaseId: ENTRY_PHASE_ID },
      payload: { plannedEntryAt: null },
    })
  })

  it('enters the stage at the front of the queue on the spot', async () => {
    const advancePhase = vi.fn((_request: Request) => Effect.succeed({ phases: [] }))
    screen({
      advancePhase,
      getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
      listBatches: () =>
        Effect.succeed({ items: [listRow({ status: 'active' })], nextCursor: null, total: 1 }),
      getPhases: () => Effect.succeed(twoPhases()),
    })

    // starting now lives with scheduling: they are the same decision
    await page.getByRole('button', { name: '去排期' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('radio', { name: /立即开始/ }).click()
    await dialog.getByRole('button', { name: '立即开始' }).click()

    await vi.waitFor(() => expect(advancePhase).toHaveBeenCalledTimes(1))
    expect(advancePhase.mock.calls[0]![0]).toMatchObject({
      payload: { to: ENTRY_PHASE_ID },
    })
  })

  it('offers only the permissions a stage may govern', async () => {
    screen({ getPhases: () => Effect.succeed(twoPhases()) })

    await page.getByRole('button', { name: '编辑详情' }).first().click()
    const panel = page.getByRole('dialog')

    // the gate's own registry, and nothing else
    await expect.element(panel.getByRole('checkbox', { name: '提交审核' })).toBeVisible()
    await expect.element(panel.getByRole('checkbox', { name: '审核提交的内容' })).toBeVisible()
    // its own switch: an appeal window opens reviewing without opening escalations
    await expect.element(panel.getByRole('checkbox', { name: '提请复核' })).toBeVisible()
    for (const absent of ['登录', '管理组织架构', '管理测评批次', '查看角色']) {
      await expect.element(panel.getByRole('checkbox', { name: absent })).not.toBeInTheDocument()
    }
    expect(panel.getByRole('checkbox').elements()).toHaveLength(12)
  })

  it('fills one stage from a stage preset, as a starting point only', async () => {
    const putPhases = vi.fn((_request: Request) => Effect.succeed({ phases: [], warnings: [] }))
    screen({ putPhases, getPhases: () => Effect.succeed(twoPhases()) })

    await page.getByRole('button', { name: '编辑详情' }).first().click()
    const panel = page.getByRole('dialog')
    await panel.getByLabelText('应用时间线模板').selectOptions('填报阶段预设')
    await panel.getByRole('button', { name: '填入' }).click()
    await expect.element(panel.getByRole('checkbox', { name: '提交审核' })).toBeChecked()
    await expect.element(panel.getByRole('checkbox', { name: '查看排名' })).not.toBeChecked()
    await panel.getByRole('button', { name: '完成' }).click()

    await page.getByRole('button', { name: '保存' }).click()
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

  it('adds a timeline template to the end, server-side', async () => {
    const putPhases = vi.fn((_request: Request) => Effect.succeed({ phases: [], warnings: [] }))
    screen({ putPhases, getPhases: () => Effect.succeed(twoPhases()) })

    await page.getByRole('button', { name: '编辑阶段' }).click()
    await page.getByRole('button', { name: '从模板添加' }).click()
    const dialog = page.getByRole('dialog')
    await dialog.getByLabelText('时间线').selectOptions('常规四阶段')
    await dialog.getByRole('button', { name: '从模板添加' }).click()

    await vi.waitFor(() => expect(putPhases).toHaveBeenCalledTimes(1))
    // the server copies the template, so the provenance it records is its own
    expect(putPhases.mock.calls[0]![0]).toMatchObject({
      params: { batchId: BATCH_ID },
      payload: { fromTemplateId: TIMELINE_ID },
    })
  })

  it('says what was refused, next to the stage it names', async () => {
    screen({
      getPhases: () => Effect.succeed(twoPhases()),
      putPhases: () =>
        Effect.fail(
          Object.assign(new Error('ASSESSMENT_PLAN_INVALID'), {
            _tag: 'ASSESSMENT_PLAN_INVALID',
            refusals: [{ reason: 'scheduled-phase-immutable', phaseId: REVIEW_PHASE_ID }],
          }),
        ),
    })

    await page.getByRole('button', { name: '编辑详情' }).nth(1).click()
    const panel = page.getByRole('dialog')
    await panel.getByLabelText('阶段名称').fill('审核整理期')
    await panel.getByRole('button', { name: '完成' }).click()
    await page.getByRole('button', { name: '保存' }).click()
    await expect.element(page.getByText('已排期的阶段不能移动或删除。')).toBeVisible()
  })
})

describe('the participants tab', () => {
  it('offers a draft the same two ways in that a running batch has', async () => {
    screen({}, `/assessment/batches/${BATCH_ID}/participants`)
    // the roster exists from the moment the batch does, so a draft is a list
    // to check and add to rather than a screen waiting for a scope
    await expect.element(page.getByRole('button', { name: '从组织导入' })).toBeVisible()
  })

  it('imports from the organization only after saying how many that is', async () => {
    const importParticipants = vi.fn((_request: Request) => Effect.succeed({ added: 3 }))
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: PAGES,
              // the picker belongs to iam and arrives through the surface it
              // contributes to, exactly as it does in the running application
              slots: {
                'iam/people-import-picker': [
                  { id: 'auth/people-import-picker', component: 'auth/PeopleImportPicker' },
                ],
              },
            }),
        },
        identity: {
          getUserOptions: () =>
            Effect.succeed({
              truncated: false,
              nodes: [
                {
                  orgNodeId: NODE_ID,
                  name: '软件学院',
                  parentId: null,
                  depth: 1,
                  orgTypeId: NODE_ID,
                  manageable: true,
                },
              ],
              orgTypes: [{ id: NODE_ID, name: '院系' }],
              userTypes: [{ id: USER_ID, code: 'student', name: '学生', placementPolicy: null }],
            }),
        },
        assessment: assessmentStubs({
          getBatch: () => Effect.succeed({ batch: batch({ status: 'active' }) }),
          previewImport: () => Effect.succeed({ candidates: 3 }),
          importParticipants,
        }),
      }),
      routes: [
        {
          path: '/assessment/batches/:batchId/participants',
          element: workspace(<BatchParticipantsPage />),
        },
      ],
      route: `/assessment/batches/${BATCH_ID}/participants`,
      registry: { 'auth/PeopleImportPicker': PeopleImportPicker },
    })

    await page.getByRole('button', { name: '从组织导入' }).click()
    // nothing can be imported until something is chosen
    await expect.element(page.getByText('请选择组织单位与人员类型。')).toBeVisible()
    await expect.element(page.getByText('从这些单位取人')).toBeVisible()
    // every unit says what kind of thing it is, and the same kinds are what
    // the filter offers: that is how somebody picks the right one out of a
    // tree of similar names
    // the kind filter is there, and every unit says which kind it is
    await expect.element(page.getByText('全部类型')).toBeVisible()
    await expect.element(page.getByText('院系')).toBeVisible()

    // ticking a unit, and untucking it again: a selection that cannot be
    // taken back is a trap, and this one was
    const unit = page.getByRole('checkbox', { name: '软件学院' })
    await unit.click()
    await expect.element(unit).toBeChecked()
    await unit.click()
    await expect.element(unit).not.toBeChecked()
    await unit.click()
    await page.getByRole('checkbox', { name: '学生' }).click()

    // and the number is said before the button will do anything
    await expect.element(page.getByText('将新增 3 人')).toBeVisible()
    await page.getByRole('button', { name: '导入' }).click()
    await vi.waitFor(() => expect(importParticipants).toHaveBeenCalledTimes(1))
    expect(importParticipants.mock.calls[0]![0]).toMatchObject({
      payload: { orgNodeIds: [NODE_ID], userTypeIds: [USER_ID] },
    })
  })
})

// What this round accepted, which is not what the organization currently says.
//
// The difference is the whole point of the page, and it is a difference no
// service test can show: one half waits for a decision and one half has
// already happened, and they must not look alike on screen.

const accessScreen = (over: Stubs = {}) => screen(over, `/assessment/batches/${BATCH_ID}/access`)

describe('who may work on a batch', () => {
  it('withholds one capability for this round without touching the role', async () => {
    const setAccessDeny = vi.fn((_request: Request) =>
      Effect.succeed({
        staff: [
          subject({
            denied: ['assessment.review.process'],
            effective: [],
          }),
        ],
      }),
    )
    accessScreen({
      listAccess: () =>
        Effect.succeed({
          staff: [
            subject({
              sources: [
                source({
                  accepted: ['assessment.review.process', 'assessment.ranking.view'],
                  current: ['assessment.review.process', 'assessment.ranking.view'],
                }),
              ],
              effective: ['assessment.review.process', 'assessment.ranking.view'],
            }),
          ],
        }),
      setAccessDeny,
    })

    await expect.element(page.getByText('王审核')).toBeVisible()
    await expect.element(page.getByText('组织授权')).toBeVisible()

    await page.getByRole('button', { name: '调整' }).click()
    // the dialog offers exactly what this batch holds, by name
    const box = page.getByRole('checkbox', { name: '审核提交的内容' })
    await expect.element(box).toBeChecked()
    await box.click()

    // unticking is not the decision; confirming is
    expect(setAccessDeny).not.toHaveBeenCalled()
    await page.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(setAccessDeny).toHaveBeenCalledTimes(1))
    expect(setAccessDeny.mock.calls[0]![0]).toMatchObject({
      params: { userId: USER_ID, permission: 'assessment.review.process' },
      payload: { denied: true },
    })
  })

  it('offers nothing on the reader\u2019s own row', async () => {
    accessScreen({
      listAccess: () =>
        Effect.succeed({
          staff: [
            subject({ displayName: '别人' }),
            subject({
              userId: PARTICIPANT_ID,
              displayName: '我自己',
              manageable: false,
              sources: [source({ sourceId: PARTICIPANT_ID, origin: 'explicit' })],
            }),
          ],
        }),
    })

    await expect.element(page.getByText('我自己')).toBeVisible()
    // one adjust button for the other person, and none for themselves - an
    // administrator who can withdraw their own authority can lock themselves
    // out of the batch they are responsible for
    expect(page.getByRole('button', { name: '调整' }).elements()).toHaveLength(1)
    expect(page.getByRole('button', { name: '移出本批次' }).elements()).toHaveLength(0)
  })

  it('merges only what was ticked, and never offers to approve a withdrawal', async () => {
    const applyAccessSync = vi.fn((_request: Request) => Effect.succeed({ merged: 1 }))
    accessScreen({
      previewAccessSync: () =>
        Effect.succeed({
          items: [
            {
              id: ASSIGNMENT_ID,
              kind: 'new' as const,
              userId: USER_ID,
              displayName: '新来的老师',
              businessNo: 'T0002',
              roleName: '学院审核员',
              permissions: ['assessment.review.process', 'assessment.ranking.view'],
            },
            {
              id: SOURCE_ID,
              kind: 'lapsed' as const,
              userId: PARTICIPANT_ID,
              displayName: '离任的老师',
              businessNo: null,
              roleName: '学院审核员',
              permissions: ['assessment.ranking.view'],
            },
          ],
          nextCursor: null,
          pendingTotal: 1,
          lapsedTotal: 1,
        }),
      applyAccessSync,
    })

    // the page opens on one line and one action, not on the list
    await expect.element(page.getByText('组织侧权限发生变动', { exact: false })).toBeVisible()
    expect(page.getByText('新来的老师').elements()).toHaveLength(0)

    await page.getByRole('button', { name: '查看变更' }).click()
    await expect.element(page.getByText('新来的老师')).toBeVisible()
    // a withdrawal is stated, and carries no checkbox to approve it
    await expect.element(page.getByText('离任的老师')).toBeVisible()
    expect(page.getByRole('checkbox').elements()).toHaveLength(2)

    // and nothing is taken until something is ticked
    await page.getByRole('checkbox', { name: '审核提交的内容' }).click()
    await page.getByRole('button', { name: '接受变更' }).click()
    await vi.waitFor(() => expect(applyAccessSync).toHaveBeenCalledTimes(1))
    expect(applyAccessSync.mock.calls[0]![0]).toMatchObject({
      payload: {
        accept: [{ kind: 'new', id: ASSIGNMENT_ID, permissions: ['assessment.review.process'] }],
      },
    })
  })

  it('only offers to remove somebody this round brought in, and asks first', async () => {
    const removeStaff = vi.fn((_request: Request) => Effect.succeed({ staff: [] }))
    accessScreen({
      listAccess: () =>
        Effect.succeed({
          staff: [
            subject({ displayName: '组织来的', sources: [source()] }),
            subject({
              userId: PARTICIPANT_ID,
              displayName: '临时来的',
              sources: [source({ sourceId: PARTICIPANT_ID, origin: 'explicit' })],
            }),
          ],
        }),
      removeStaff,
    })

    await expect.element(page.getByText('本批次临时')).toBeVisible()
    // one control, on the row this batch is responsible for
    const remove = page.getByRole('button', { name: '移出本批次' })
    await expect.element(remove).toBeVisible()
    await remove.click()

    // and it is a question before it is an action
    await expect.element(page.getByText('将 临时来的 移出本批次？')).toBeVisible()
    await page.getByRole('alertdialog').getByRole('button', { name: '移出本批次' }).click()
    await vi.waitFor(() => expect(removeStaff).toHaveBeenCalledTimes(1))
    expect(removeStaff.mock.calls[0]![0]).toMatchObject({ params: { sourceId: PARTICIPANT_ID } })
  })
})
