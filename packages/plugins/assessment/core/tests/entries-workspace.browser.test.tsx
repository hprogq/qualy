import MyEntriesPage from '../src/client/entry/MyEntriesPage.tsx'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The entries workspace as a reader moves through it: the structure down
// one side, one question or section opened beside it, and the claims under
// that question read a page at a time. Every width has its own shape - three
// columns at a desk, two on a tablet with the requirements in a sheet, and
// on a phone the structure first and one question after it - so each case
// names the window it is about.

afterEach(() => page.viewport(1280, 800))

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444'
const ROOT = '70000000-7777-4777-8777-777777777770'
const BAND_A = '70000000-7777-4777-8777-777777777771'
const BAND_B = '70000000-7777-4777-8777-777777777772'
const SUB_B = '70000000-7777-4777-8777-777777777773'
const DEEP_B = '70000000-7777-4777-8777-777777777774'
const itemId = (n: number) => `20000000-2222-4222-8222-2222222222${String(n).padStart(2, '0')}`
const TAIL = itemId(9)
const GPA = itemId(10)
const FITNESS = itemId(11)
const PENALTY = itemId(12)
const entryId = (n: number) => `e0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const question = (
  n: number,
  title: string,
  group: string,
  over: Record<string, unknown> = {},
  revision: Record<string, unknown> = {},
) => ({
  id: itemId(n),
  batchId: BATCH_ID,
  itemType: 'evidence' as const,
  title,
  scoreGroupId: group,
  maxEntries: 3,
  sortOrder: n,
  status: 'active' as const,
  voidReason: null,
  currentRevision: {
    id: `30000000-3333-4333-8333-3333333333${String(n).padStart(2, '0')}`,
    revisionNo: 1,
    entryChannels: ['participant'] as const,
    formConfig: { fields: [{ key: 'summary', type: 'text', label: '事项说明', required: true }] },
    scoringConfig: { calculator: { config: { value: '1.00' } } },
    reviewPolicy: { normal: { stages: [{ id: 's1', label: '班委初审' }] } },
    displayConfig: { description: '按学校规定提交材料' },
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...revision,
  },
  createdAt: '2026-03-01T00:00:00.000Z',
  ...over,
})

/** a question the office records, scored by one figure the record carries */
const recorded = (n: number, title: string, fields: readonly unknown[]) =>
  question(
    n,
    title,
    BAND_B,
    { itemType: 'evidence', maxEntries: 1 },
    {
      entryChannels: ['administrative'],
      formConfig: { fields },
      scoringConfig: {},
      reviewPolicy: null,
    },
  )

const hidden = { state: 'hidden' as const, reason: null }

const claim = (
  n: number,
  item: string,
  status: 'draft' | 'in_review' | 'needs_revision' | 'approved' | 'rejected' | 'voided',
  over: Record<string, unknown> = {},
) => ({
  id: entryId(n),
  batchId: BATCH_ID,
  itemId: item,
  participantId: PARTICIPANT_ID,
  status,
  source: 'self' as const,
  currentRevision: {
    id: `50000000-5555-4555-8555-5555555555${String(n).padStart(2, '0')}`,
    revisionNo: 1,
    itemRevisionId: 'r',
    payload: { summary: `活动 ${String(n)} 号` },
    note: null,
    source: 'self',
    actorId: PARTICIPANT_ID,
    subjectId: PARTICIPANT_ID,
    attachments: [],
    // older claims first, so "latest first" puts the highest number on top
    createdAt: new Date(Date.UTC(2026, 3, 1, 0, n)).toISOString(),
  },
  currentReviewInstanceId: null,
  createdAt: new Date(Date.UTC(2026, 3, 1, 0, n)).toISOString(),
  supplement: null,
  refusal: null,
  openRound: null,
  recognition: null,
  capabilities: { edit: hidden, submit: hidden, withdraw: hidden, appeal: hidden, abandon: hidden },
  ...over,
})

const group = (id: string, parentGroupId: string | null, name: string, sortOrder: number) => ({
  id,
  parentGroupId,
  name,
  cap: id === DEEP_B ? null : '20.00',
  floor: null,
  sortOrder,
  itemCount: 0,
})

const workspace = ({
  route,
  items = [
    ...Array.from({ length: 8 }, (_, i) => question(i + 1, `品德题目 ${String(i + 1)}`, BAND_A)),
    question(9, '学科竞赛获奖', DEEP_B, { maxEntries: null }),
  ],
  entries = [],
  lines = [],
}: {
  route: string
  items?: readonly unknown[]
  entries?: readonly unknown[]
  lines?: readonly unknown[]
}) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: [
              {
                id: 'assessment/batch-my-entries',
                path: '/assessment/batches/:batchId/my-entries',
                layout: 'admin',
              },
            ],
          }),
      },
      assessment: {
        getBatch: () =>
          Effect.succeed({
            batch: {
              id: BATCH_ID,
              name: '2026 春季综测',
              descriptionMd: null,
              manageable: false,
              reviewReasons: { reject: [], escalate: [] },
              capabilities: {
                personal: true,
                review: false,
                record: false,
                manage: false,
                redetermine: false,
              },
              participantCount: 12,
              materialRange: { start: '2026-03-01', end: '2026-09-01' },
              timezone: 'Asia/Shanghai',
              status: 'active',
              configRevision: 1,
              currentPhaseId: null,
              currentPhaseName: '填报期',
              createdAt: '2026-02-01T00:00:00.000Z',
            },
          }),
        listItems: () => Effect.succeed({ items, capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries,
            nextCursor: null,
            attention: { unreadItemIds: [] },
          }),
        listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: [
              group(ROOT, null, '综合素质测评', 0),
              group(BAND_A, ROOT, '品德行为表现', 0),
              group(BAND_B, ROOT, '学业发展', 1),
              group(SUB_B, BAND_B, '学科竞赛', 0),
              group(DEEP_B, SUB_B, '竞赛奖项', 0),
            ],
            version: 1,
            capabilities: { canManage: false },
          }),
        getMyResult: () =>
          Effect.succeed({ mode: 'provisional', total: '0.00', groups: [], lines }),
        getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
      },
    }),
    route,
    routes: [
      {
        path: '/assessment/batches/:batchId/my-entries',
        // the shell the page is built for: a window-high frame whose main
        // column scrolls, not a document that grows
        element: (
          <div
            style={{
              display: 'flex',
              height: '100dvh',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <main
              style={{
                display: 'flex',
                minHeight: 0,
                flex: '1 1 0%',
                flexDirection: 'column',
                overflowY: 'auto',
              }}
            >
              <MyEntriesPage />
            </main>
          </div>
        ),
      },
    ] as never,
  })

const base = `/assessment/batches/${BATCH_ID}/my-entries`
const shape = () =>
  document.querySelector('[data-testid="entries-workspace"]')?.getAttribute('data-screen')
const openItem = () =>
  document.querySelector('[data-testid="item-pane"]')?.getAttribute('data-item') ?? null
const rows = () => [...document.querySelectorAll('[data-testid="claim-row"]')]

describe('finding a question', () => {
  it('lands on the question the address names, and marks it in the structure', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${TAIL}` })
    await expect.element(page.getByRole('heading', { name: '学科竞赛获奖' })).toBeVisible()
    expect(openItem()).toBe(TAIL)
    expect(document.querySelector(`[data-rail-row="${TAIL}"]`)?.getAttribute('aria-current')).toBe(
      'true',
    )
    // four levels deep, every section above it is a way back up
    const crumbs = page.getByRole('list', { name: '所在位置' })
    await expect.element(crumbs.getByRole('button', { name: /学业发展/ })).toBeVisible()
    await expect.element(crumbs.getByRole('button', { name: /竞赛奖项/ })).toBeVisible()
  })

  it('lands a desk without an address on the first question', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: base })
    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    expect(openItem()).toBe(itemId(1))
  })

  it('stands in three columns at a desk; a tablet brings the requirements up in a sheet', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${itemId(2)}` })
    const aside = page.getByRole('complementary', { name: '填报要求' })
    await expect.element(aside).toBeVisible()
    await expect.element(aside.getByTestId('item-requirements')).toBeVisible()
    expect(page.getByTestId('requirements-key').elements()).toHaveLength(0)

    await page.viewport(834, 1112)
    await expect
      .poll(() =>
        document.querySelector('[data-testid="entries-workspace"]')?.getAttribute('data-mode'),
      )
      .toBe('tablet')
    expect(page.getByRole('complementary', { name: '填报要求' }).elements()).toHaveLength(0)
    await page.getByTestId('requirements-key').click()
    const sheet = page.getByRole('dialog')
    await expect.element(sheet.getByTestId('item-requirements')).toBeVisible()
    // the question's own words on how to file travel with it
    await expect.element(sheet.getByText('按学校规定提交材料')).toBeVisible()
  })

  it('walks a phone from the structure into one question and back', async () => {
    await page.viewport(390, 844)
    await workspace({ route: base })
    await expect.poll(shape).toBe('structure')
    await page.getByRole('button', { name: /学科竞赛获奖/ }).click()
    await expect.poll(() => addressNow()).toContain(`open=${TAIL}`)
    await expect.poll(shape).toBe('item')
    await expect.element(page.getByRole('heading', { name: '学科竞赛获奖' })).toBeVisible()

    // the neighbours are one press away, and the structure one press back
    await page.getByRole('button', { name: '上一项' }).click()
    await expect.poll(() => addressNow()).toContain(`open=${itemId(8)}`)
    await page.getByRole('button', { name: /评分结构/ }).click()
    await expect.poll(() => addressNow()).not.toContain('open=')
    await expect.poll(shape).toBe('structure')
  })

  it('steps to the neighbouring question from the foot of the pane', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${itemId(8)}` })
    const steps = page.getByRole('navigation', { name: '相邻项目' })
    await steps.getByRole('button', { name: /学科竞赛获奖/ }).click()
    await expect.poll(() => addressNow()).toContain(`open=${TAIL}`)
    await expect.poll(openItem).toBe(TAIL)
  })

  it('opens a section on its own, and a question from there', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: base })
    // the section's own row in the structure, not its fold key beside it
    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    await userEvent.click(document.querySelector(`[data-rail-row="${BAND_A}"]`)!)
    await expect
      .poll(() => document.querySelector('[data-testid="group-pane"]')?.getAttribute('data-group'))
      .toBe(BAND_A)
    // a section has no requirements of its own to stand beside it
    expect(page.getByRole('complementary', { name: '填报要求' }).elements()).toHaveLength(0)
    await userEvent.click(document.querySelector(`[data-group-item="${itemId(3)}"]`)!)
    await expect.poll(openItem).toBe(itemId(3))
  })

  it('narrows the structure to what waits on the reader', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: base,
      entries: [
        claim(1, itemId(2), 'needs_revision'),
        claim(2, itemId(5), 'draft'),
        claim(3, TAIL, 'in_review'),
      ],
    })
    const todo = page.getByTestId('rail-todo')
    await expect.element(todo).toHaveAttribute('data-count', '2')
    await todo.click()
    await expect
      .poll(() =>
        [...document.querySelectorAll('[data-rail-row][data-kind="item"]')].map((row) =>
          row.getAttribute('data-rail-row'),
        ),
      )
      .toEqual([itemId(2), itemId(5)])
  })
})

describe('reading one question’s claims', () => {
  // forty-five claims under one question: some refused, some in review
  const lot = Array.from({ length: 45 }, (_, i) =>
    claim(i + 1, TAIL, i < 5 ? 'rejected' : i < 15 ? 'in_review' : 'approved'),
  )

  it('lists a long question a page at a time', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${TAIL}`, entries: lot })
    await expect.poll(() => rows().length).toBe(20)
    // latest first: the newest claim heads the list
    expect(rows()[0]!.getAttribute('data-entry')).toBe(entryId(45))
    await page.getByRole('button', { name: /再显示/ }).click()
    await expect.poll(() => rows().length).toBe(40)
    await page.getByRole('button', { name: /再显示/ }).click()
    await expect.poll(() => rows().length).toBe(45)
    expect(page.getByTestId('entries-more').elements()).toHaveLength(0)
    // and the other way round, oldest first
    await page.getByTestId('entries-sort').click()
    await expect.poll(() => rows()[0]!.getAttribute('data-entry')).toBe(entryId(1))
  })

  it('filters the claims by where they stand, and finds one by what it says', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${TAIL}`, entries: lot })
    const refused = () => document.querySelector('[data-chip="rejected"]')
    await expect.poll(() => refused()?.getAttribute('data-count')).toBe('5')
    await userEvent.click(refused()!)
    await expect.poll(() => rows().length).toBe(5)
    expect(new Set(rows().map((row) => row.getAttribute('data-standing')))).toEqual(
      new Set(['rejected']),
    )

    await userEvent.click(document.querySelector('[data-chip="all"]')!)
    await page.getByRole('searchbox', { name: '搜索' }).fill('活动 27 号')
    await expect
      .poll(() => rows().map((row) => row.getAttribute('data-entry')))
      .toEqual([entryId(27)])
    await page.getByRole('searchbox', { name: '搜索' }).fill('没有这样的申报')
    await expect.element(page.getByTestId('entries-no-match')).toBeVisible()
    await page.getByRole('button', { name: '清除筛选' }).click()
    await expect.poll(() => rows().length).toBe(20)
  })

  it('carries what a reviewer said on the row, and what the claim counts for', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      entries: [
        claim(1, itemId(1), 'needs_revision', {
          refusal: {
            kind: 'returned',
            reason: null,
            comment: '证书扫描件不清晰',
            suggestedPayload: null,
            actorName: null,
            at: '2026-04-02T00:00:00.000Z',
          },
        }),
        claim(2, itemId(1), 'in_review', {
          supplement: {
            requestId: 'q1',
            instanceId: 'i1',
            requestNo: 1,
            instructions: '请补充时长截图',
            requirements: [],
            requestedByName: null,
            requestedAt: '2026-04-03T00:00:00.000Z',
          },
        }),
        claim(3, itemId(1), 'approved'),
      ],
      lines: [
        {
          lineId: `entry:${entryId(3)}`,
          kind: 'entry',
          label: '品德题目 1',
          value: '1.0000',
          itemId: itemId(1),
          provenance: { entryId: entryId(3) },
        },
      ],
    })
    await expect.poll(() => rows().length).toBe(3)
    const row = (n: number) => document.querySelector(`[data-entry="${entryId(n)}"]`)!
    expect(row(1).querySelector('[data-note="return"]')?.textContent).toContain('证书扫描件不清晰')
    expect(row(2).querySelector('[data-note="ask"]')?.textContent).toContain('请补充时长截图')
    expect(row(3).querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('1.00')
    // a claim still out with its reviewers would count its question's worth
    expect(row(2).querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('1.00')
  })

  it('says a figure once where it is also the amount it came to', async () => {
    await page.viewport(1440, 900)
    const record = (n: number, item: string, payload: Record<string, unknown>) =>
      claim(n, item, 'approved', {
        source: 'record',
        currentRevision: { ...claim(n, item, 'approved').currentRevision, payload },
      })
    const line = (n: number, item: string, value: string) => ({
      lineId: `entry:${entryId(n)}`,
      kind: 'entry',
      label: '',
      value,
      itemId: item,
      provenance: { entryId: entryId(n) },
    })
    await workspace({
      route: `${base}?open=${GPA}`,
      items: [
        question(1, '品德题目 1', BAND_A),
        recorded(10, '学业基础分', [{ key: 'gpa', type: 'decimal', label: '课程加权平均分' }]),
        recorded(11, '体测加分', [{ key: 'bonus', type: 'decimal', label: '体质测试加分' }]),
        recorded(12, '违纪扣分', [
          { key: 'kind', type: 'text', label: '处分类型' },
          { key: 'points', type: 'decimal', label: '扣分' },
        ]),
      ],
      entries: [
        record(1, GPA, { gpa: '95.02' }),
        record(2, FITNESS, { bonus: '2.00' }),
        record(3, PENALTY, { kind: '校级通报批评', points: '-2' }),
      ],
      lines: [line(1, GPA, '9.5000'), line(2, FITNESS, '2.0000'), line(3, PENALTY, '-2.0000')],
    })
    const only = () => rows()[0]!
    // a figure that differs from what it came to keeps its name beside it
    await expect.poll(() => only().getAttribute('data-entry')).toBe(entryId(1))
    expect(only().textContent).toContain('课程加权平均分')
    expect(only().textContent).toContain('95.02')
    expect(only().querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('9.50')

    // one that equals it is said once, in the amount; the field names the row
    await userEvent.click(document.querySelector(`[data-rail-row="${FITNESS}"]`)!)
    await expect.poll(() => only().getAttribute('data-entry')).toBe(entryId(2))
    expect(only().textContent).toContain('体质测试加分')
    expect(only().textContent).not.toContain('2.00体')
    expect(only().querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('2.00')

    // a deduction keeps its words and says its figure once, as a deduction
    await userEvent.click(document.querySelector(`[data-rail-row="${PENALTY}"]`)!)
    await expect.poll(() => only().getAttribute('data-entry')).toBe(entryId(3))
    expect(only().textContent).toContain('校级通报批评')
    expect(only().querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('−2.00')
  })

  it('keeps a withdrawn question on the structure, and what was filed under it readable', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: `${base}?open=${itemId(4)}`,
      items: [
        question(1, '品德题目 1', BAND_A),
        question(4, '学生干部任职（旧）', BAND_A, {
          status: 'voided',
          voidReason: '已并入优秀学生干部',
        }),
      ],
      entries: [claim(1, itemId(4), 'approved')],
    })
    await expect
      .poll(() =>
        document.querySelector(`[data-rail-row="${itemId(4)}"]`)?.getAttribute('data-tag'),
      )
      .toBe('voided')
    await expect.element(page.getByTestId('item-badge')).toBeVisible()
    await expect.poll(() => rows().length).toBe(1)
    // no longer counted, and nothing new to file
    expect(rows()[0]!.querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('')
    expect(page.getByTestId('file-claim').elements()).toHaveLength(0)
    await expect.element(page.getByText('已并入优秀学生干部')).toBeVisible()
  })
})
