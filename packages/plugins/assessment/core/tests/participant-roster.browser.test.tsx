import ParticipantResultsPage from '../src/client/result/ParticipantResultsPage.tsx'
import { lazy } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The roster as the results page walks it: by page number, narrowed and
// ordered by the server, each row saying what that person's claims wait on
// and what they currently have, and the unit tree and the roster's own doors
// drawn from this round's endpoints - so a reader who may run or re-determine
// the round but not browse the directory is not handed a blank column and a
// dialog that can see nobody.

const OrgNodePickerView = lazy(() => import('@qualy/plugin-auth/client/iam/OrgNodePickerView'))
const PeoplePickerView = lazy(() => import('@qualy/plugin-auth/client/iam/PeoplePickerView'))

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const COLLEGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'
const CLASS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02'
const TYPE = '99999999-9999-4999-8999-999999999999'

const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, '0')}`

const NONE = { inReview: 0, toSupplement: 0, reconsidering: 0, toRevise: 0, blocked: 0 }

const person = (n: number, over: Record<string, unknown> = {}) => ({
  id: id(n),
  userId: `33333333-3333-4333-8333-${String(n).padStart(12, '0')}`,
  displayName: `参评人${n}`,
  businessNo: `2023${String(n).padStart(4, '0')}`,
  userTypeId: TYPE,
  anchorNodeId: CLASS_A,
  anchorPath: 'root.a.a1',
  anchorLineage: [
    { nodeId: CLASS_A, nodeTypeId: 'class' },
    { nodeId: COLLEGE, nodeTypeId: 'college' },
  ],
  status: 'active' as const,
  includedAt: '2026-02-02T00:00:00.000Z',
  excludedAt: null,
  placement: 'current' as const,
  filings: NONE,
  ...over,
})

const batch = (over: Record<string, unknown> = {}) => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: false, manage: true, redetermine: false },
  participantCount: 45,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
  ...over,
})

interface Request {
  params?: Record<string, string>
  payload?: Record<string, unknown>
  query?: Record<string, unknown>
}

/** forty-five people, twenty to a page, as the server pages them */
const EVERYONE = Array.from({ length: 45 }, (_, index) => person(index + 1))

const pageOf = (request: Request, people = EVERYONE) => {
  const size = Number(request.query?.['limit'] ?? 20)
  const last = Math.max(1, Math.ceil(people.length / size))
  const at = Math.min(Number(request.query?.['page'] ?? 1), last)
  return Effect.succeed({
    items: people.slice((at - 1) * size, at * size),
    total: people.length,
    page: at,
    pageSize: size,
  })
}

const idsOf = (request: Request) => [request.query?.['participantIds'] ?? []].flat() as string[]

const PAGES = [
  { id: 'assessment/batch-results', path: '/assessment/batches/:batchId/results', layout: 'admin' },
]

const open = (
  stubs: Record<string, unknown> = {},
  route = `/assessment/batches/${BATCH_ID}/results`,
) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: PAGES,
            // the drawings belong to iam and arrive through the surfaces it
            // contributes to, as in the application: the ones a screen fills
            // with its own population, which ask for no permission
            slots: {
              'iam/org-node-picker-view': [{ id: 'auth/org-node-picker-view', order: 0 }],
              'iam/people-picker-view': [{ id: 'auth/people-picker-view', order: 0 }],
            },
          }),
      },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listParticipantAccounts: (request: Request) => pageOf(request),
        listParticipantScores: (request: Request) =>
          Effect.succeed({
            scores: idsOf(request).map((participantId) => ({
              participantId,
              state: 'scored' as const,
              total: '80.00',
              reason: null,
            })),
          }),
        listRosterUnits: () =>
          Effect.succeed({
            units: [
              { id: COLLEGE, name: '软件学院', parentId: null },
              { id: CLASS_A, name: '软件 2301 班', parentId: COLLEGE },
            ],
          }),
        listParticipantPlacements: () =>
          Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
        listScopeOptions: () =>
          Effect.succeed({
            nodes: [
              { id: COLLEGE, name: '软件学院', parentId: null, depth: 0, orgTypeId: 'college' },
              { id: CLASS_A, name: '软件 2301 班', parentId: COLLEGE, depth: 1, orgTypeId: 'c' },
            ],
          }),
        listUserTypeOptions: () =>
          Effect.succeed({ userTypes: [{ id: TYPE, code: 'student', name: '学生' }] }),
        listParticipantCandidates: () =>
          Effect.succeed({ items: [], total: 0, page: 1, pageSize: 20 }),
        previewImport: () => Effect.succeed({ candidates: 0 }),
        getParticipant: (request: Request) =>
          Effect.succeed({
            participant: EVERYONE.find((one) => one.id === request.params?.['participantId']),
          }),
        getParticipantResult: () =>
          Effect.succeed({ mode: 'provisional', total: '80.00', groups: [], lines: [] }),
        listParticipantEntries: () =>
          Effect.succeed({ participantId: id(1), entries: [], nextCursor: null }),
        listItems: () => Effect.succeed({ items: [], version: 1 }),
        listScoreGroups: () => Effect.succeed({ groups: [], version: 1 }),
        // an open account starts on its claims, which mark what waits on this reader
        listReviewInbox: () =>
          Effect.succeed({ items: [], nextCursor: null, handledToday: 0, judging: false }),
        ...stubs,
      },
    }),
    routes: [{ path: '/assessment/batches/:batchId/results', element: <ParticipantResultsPage /> }],
    route,
    registry: {
      slots: {
        'iam/org-node-picker-view': { 'auth/org-node-picker-view': OrgNodePickerView },
        'iam/people-picker-view': { 'auth/people-picker-view': PeoplePickerView },
      },
    },
  })

const rows = () => page.getByTestId('participant-row')

describe('the roster on the results page', () => {
  it('walks the roster by page number and keeps the page in the address', async () => {
    const asked = vi.fn((request: Request) => pageOf(request))
    await open({ listParticipantAccounts: asked })

    await expect.element(rows().first()).toHaveAttribute('data-participant', id(1))
    expect(rows().elements()).toHaveLength(20)
    const pager = page.getByTestId('roster-pager')
    await expect.element(pager).toHaveAttribute('data-total', '45')
    await expect.element(pager).toHaveAttribute('data-pages', '3')

    await pager.getByRole('button', { name: '3' }).click()
    await expect.element(rows().first()).toHaveAttribute('data-participant', id(41))
    expect(rows().elements()).toHaveLength(5)
    expect(addressNow()).toContain('list-page=3')
    expect(asked.mock.calls.at(-1)![0].query?.['page']).toBe('3')
  })

  it('shows the rows first, then each total, and asks about one person the page did not reach', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const single = vi.fn((request: Request) =>
      Effect.succeed({
        scores: idsOf(request).map((participantId) => ({
          participantId,
          state: 'scored' as const,
          total: '66.50',
          reason: null,
        })),
      }),
    )
    await open({
      listParticipantScores: (request: Request) => {
        const ids = idsOf(request)
        if (ids.length === 1) return single(request)
        return Effect.promise(() => held).pipe(
          Effect.as({
            scores: ids.map((participantId, index) =>
              index === 0
                ? { participantId, state: 'scored' as const, total: '92.00', reason: null }
                : index === 1
                  ? {
                      participantId,
                      state: 'unavailable' as const,
                      total: null,
                      reason: 'account-too-large' as const,
                    }
                  : { participantId, state: 'deferred' as const, total: null, reason: null },
            ),
          }),
        )
      },
    })

    // the rows are up while their totals are still being worked out
    await expect.element(rows().first()).toBeVisible()
    const score = (n: number) => page.getByTestId('participant-score').nth(n - 1)
    await expect.element(score(1)).toHaveAttribute('data-score-state', 'pending')
    release!()
    await expect.element(score(1)).toHaveAttribute('data-score-state', 'scored')
    await expect.element(score(1)).toHaveAttribute('data-score', '92.00')
    await expect.element(score(2)).toHaveAttribute('data-score-state', 'unavailable')
    await expect.element(score(2)).toHaveAttribute('data-score-reason', 'account-too-large')
    await expect.element(score(3)).toHaveAttribute('data-score-state', 'deferred')

    await page.getByRole('button', { name: '计算参评人3的当前总分' }).click()
    await expect.element(score(3)).toHaveAttribute('data-score', '66.50')
    expect(idsOf(single.mock.calls[0]![0])).toEqual([id(3)])
    // pressing a total's button is not opening the person
    expect(addressNow()).not.toContain('participant=')
  })

  it('says what each person’s claims are waiting on', async () => {
    await open({
      listParticipantAccounts: (request: Request) =>
        pageOf(request, [
          person(1, {
            filings: { inReview: 2, toSupplement: 1, reconsidering: 0, toRevise: 0, blocked: 1 },
          }),
          person(2),
        ]),
    })
    const filings = page.getByTestId('participant-filings')
    await expect.element(filings.first()).toHaveAttribute('data-in-review', '2')
    await expect.element(filings.first()).toHaveAttribute('data-to-supplement', '1')
    await expect.element(filings.first()).toHaveAttribute('data-blocked', '1')
    await expect.element(filings.nth(1)).toHaveAttribute('data-in-review', '0')
    // and where they stand, by the round's own record of it
    await expect
      .element(page.getByTestId('participant-unit').first())
      .toHaveAttribute('title', '软件 2301 班')
  })

  it('narrows and orders the list through the server, and starts again at page one', async () => {
    const asked = vi.fn((request: Request) => pageOf(request))
    await open(
      { listParticipantAccounts: asked },
      `/assessment/batches/${BATCH_ID}/results?list-page=2`,
    )
    await expect.element(rows().first()).toHaveAttribute('data-participant', id(21))

    await userEvent.fill(page.getByRole('searchbox', { name: '按姓名或学工号搜索' }), '参评人4')
    await expect.poll(() => asked.mock.calls.at(-1)![0].query?.['q']).toBe('参评人4')
    expect(asked.mock.calls.at(-1)![0].query?.['page']).toBe('1')

    await page.getByRole('combobox', { name: '待处理事项' }).click()
    await page.getByRole('option', { name: '待补充材料' }).click()
    await expect.poll(() => asked.mock.calls.at(-1)![0].query?.['attention']).toBe('toSupplement')
    // or anybody with something waiting at all, whatever it is
    await page.getByRole('combobox', { name: '待处理事项' }).click()
    await page.getByRole('option', { name: '有待处理' }).click()
    await expect.poll(() => asked.mock.calls.at(-1)![0].query?.['attention']).toBe('any')
    expect(addressNow()).toContain('list-waiting=any')

    await page.getByRole('combobox', { name: '排序方式' }).click()
    await page.getByRole('option', { name: '按姓名' }).click()
    await expect.poll(() => asked.mock.calls.at(-1)![0].query?.['sort']).toBe('name')
    expect(addressNow()).toContain('list-sort=name')
  })

  it('draws the unit tree from the round’s own units, and narrows the list to one', async () => {
    const asked = vi.fn((request: Request) => pageOf(request))
    await page.viewport(1280, 800)
    await open({ listParticipantAccounts: asked })

    const unit = page.getByRole('button', { name: '软件学院', exact: true })
    await expect.element(unit).toBeVisible()
    await unit.click()
    await expect.poll(() => asked.mock.calls.at(-1)![0].query?.['orgNodeIds']).toEqual([COLLEGE])
    expect(asked.mock.calls.at(-1)![0].query?.['orgScope']).toBe('subtree')
    expect(addressNow()).toContain(`list-unit=${COLLEGE}`)
  })

  it('folds the unit tree behind one line on a phone, and says which unit is chosen', async () => {
    const asked = vi.fn((request: Request) => pageOf(request))
    await page.viewport(390, 844)
    try {
      await open({ listParticipantAccounts: asked })
      const line = page.getByTestId('roster-unit-switch')
      await expect.element(line).toBeVisible()
      await line.click()
      const sheet = page.getByTestId('roster-unit-sheet')
      await sheet.getByRole('button', { name: '软件学院', exact: true }).click()
      await expect.poll(() => asked.mock.calls.at(-1)![0].query?.['orgNodeIds']).toEqual([COLLEGE])
      await page.getByRole('button', { name: '关闭' }).click()
      await expect
        .element(page.getByTestId('roster-unit-switch'))
        .toHaveAttribute('data-unit', COLLEGE)
      // a row on a phone still carries its total
      await expect
        .element(page.getByTestId('participant-score').first())
        .toHaveAttribute('data-score-state', 'scored')
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('offers none of the roster’s doors to a reader who only re-determines', async () => {
    await open({
      getBatch: () =>
        Effect.succeed({
          batch: batch({
            manageable: false,
            capabilities: {
              personal: false,
              review: false,
              record: false,
              manage: false,
              redetermine: true,
            },
          }),
        }),
    })
    await expect.element(rows().first()).toBeVisible()
    expect(page.getByRole('button', { name: '从组织导入' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '添加人员' }).elements()).toHaveLength(0)
    expect(page.getByTestId('participant-actions').elements()).toHaveLength(0)
  })

  it('imports from the units the reader manages, read from this domain', async () => {
    const preview = vi.fn((request: Request) =>
      Effect.succeed({ candidates: [request.query?.['orgNodeIds'] ?? []].flat().length * 7 }),
    )
    await open({ previewImport: preview })
    await page.getByRole('button', { name: '从组织导入' }).click()

    const units = page.getByTestId('import-units')
    await units.getByRole('checkbox', { name: '软件学院' }).click()
    await page.getByRole('checkbox', { name: '学生' }).click()
    const count = page.getByTestId('import-candidates')
    await expect.element(count).toHaveAttribute('data-count', '7')
    const asked = preview.mock.calls.at(-1)![0].query!
    expect([asked['orgNodeIds']].flat()).toEqual([COLLEGE])
    expect([asked['userTypeIds']].flat()).toEqual([TYPE])
  })

  it('adds people from the round’s own candidates, and not somebody already on it', async () => {
    const added = vi.fn((_request: Request) => Effect.succeed({ added: 1, skipped: 0 }))
    await open({
      listParticipantCandidates: () =>
        Effect.succeed({
          items: [
            {
              userId: 'u-on',
              displayName: '已在名单',
              businessNo: '1',
              userTypeName: '学生',
              roster: 'active',
            },
            {
              userId: 'u-new',
              displayName: '新同学',
              businessNo: '2',
              userTypeName: '学生',
              roster: null,
            },
          ],
          total: 2,
          page: 1,
          pageSize: 20,
        }),
      addParticipants: added,
    })
    await page.getByRole('button', { name: '添加人员' }).click()
    await expect.element(page.getByRole('checkbox', { name: '已在名单' })).toBeDisabled()
    await page.getByRole('checkbox', { name: '新同学' }).click()
    await page.getByRole('button', { name: '添加 1 人' }).click()
    await expect.poll(() => added.mock.calls.length).toBe(1)
    expect(added.mock.calls[0]![0].payload).toEqual({ userIds: ['u-new'] })
  })

  it('walks from one person to the next across a page, and back lands on their page', async () => {
    await open({}, `/assessment/batches/${BATCH_ID}/results?participant=${id(20)}`)
    const strip = page.getByTestId('roster-neighbors')
    await expect.element(strip).toHaveAttribute('data-position', '20')
    await expect.element(strip).toHaveAttribute('data-total', '45')

    await strip.getByRole('button', { name: '下一位' }).click()
    await expect.poll(() => addressNow()).toContain(`participant=${id(21)}`)
    expect(addressNow()).toContain('list-page=2')
    await expect
      .element(page.getByTestId('roster-neighbors'))
      .toHaveAttribute('data-position', '21')

    await page.getByTestId('roster-neighbors').getByRole('button', { name: '上一位' }).click()
    await expect.poll(() => addressNow()).toContain(`participant=${id(20)}`)
    expect(addressNow()).not.toContain('list-page=2')
  })
})
