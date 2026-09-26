import ParticipantResultsPage from '../src/client/result/ParticipantResultsPage.tsx'
import { lazy } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect, Stream } from 'effect'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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
  /** the width the shell leaves the page, where a test stands in for the shell */
  width?: number,
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
  /** what this browser already keeps */
  storage: Record<string, string> = {},
) =>
  renderScreen({
    locale,
    storage,
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
    routes: [
      {
        path: '/assessment/batches/:batchId/results',
        element:
          width === undefined ? (
            <ParticipantResultsPage />
          ) : (
            <div style={{ width }}>
              <ParticipantResultsPage />
            </div>
          ),
      },
    ],
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

  it('offers to ask again where asking again may answer, and nowhere else', async () => {
    const single = vi.fn((request: Request) =>
      Effect.succeed({
        scores: idsOf(request).map((participantId) => ({
          participantId,
          state: 'scored' as const,
          total: '71.00',
          reason: null,
        })),
      }),
    )
    const why = ['scoring-unavailable', 'timed-out', 'account-too-large'] as const
    await open({
      listParticipantScores: (request: Request) => {
        const ids = idsOf(request)
        if (ids.length === 1) return single(request)
        return Effect.succeed({
          scores: ids.map((participantId, index) => ({
            participantId,
            state: 'unavailable' as const,
            total: null,
            reason: why[index % 3]!,
          })),
        })
      },
    })
    const score = (n: number) => page.getByTestId('participant-score').nth(n - 1)
    await expect.element(score(1)).toHaveAttribute('data-score-reason', 'scoring-unavailable')
    await expect.element(score(2)).toHaveAttribute('data-score-reason', 'timed-out')
    await expect.element(score(3)).toHaveAttribute('data-score-reason', 'account-too-large')
    // past the ceiling, asking again would say the same
    expect(score(3).getByTestId('participant-score-again').elements()).toHaveLength(0)

    await score(2).getByRole('button', { name: '重新计算参评人2的当前总分' }).click()
    await expect.element(score(2)).toHaveAttribute('data-score', '71.00')
    expect(idsOf(single.mock.calls[0]![0])).toEqual([id(2)])
    expect(addressNow()).not.toContain('participant=')
  })

  // The way to ask again is what the total's cell is for when the scoring
  // service is down, so it has to be inside the cell in either language,
  // on a laptop beside the unit tree and on a tablet under it - and the
  // page says once, above the rows, why none of them has a total.
  it.each([
    [1280, 'zh-CN'],
    [1280, 'en-US'],
    [834, 'zh-CN'],
    [834, 'en-US'],
  ] as const)(
    'keeps the way to ask again inside the total at %i wide in %s',
    async (width, locale) => {
      await page.viewport(width, 800)
      try {
        const single = vi.fn((request: Request) =>
          Effect.succeed({
            scores: idsOf(request).map((participantId) => ({
              participantId,
              state: 'scored' as const,
              total: '71.00',
              reason: null,
            })),
          }),
        )
        await open(
          {
            listParticipantScores: (request: Request) => {
              const ids = idsOf(request)
              if (ids.length === 1) return single(request)
              // the service down: the first row says so, the rest are deferred
              return Effect.succeed({
                scores: ids.map((participantId, index) =>
                  index === 0
                    ? {
                        participantId,
                        state: 'unavailable' as const,
                        total: null,
                        reason: 'scoring-unavailable' as const,
                      }
                    : { participantId, state: 'deferred' as const, total: null, reason: null },
                ),
              })
            },
          },
          undefined,
          // what the shell leaves the page: the rail and the margins on a
          // laptop, the margins alone on a tablet, where the rail folds away
          width === 1280 ? 1280 - 224 - 48 : 834 - 48,
          locale,
        )
        const score = page.getByTestId('participant-score').first()
        await expect.element(score).toHaveAttribute('data-score-reason', 'scoring-unavailable')
        const cell = score.element().parentElement!.getBoundingClientRect()
        const again = score.getByTestId('participant-score-again')
        const button = again.element().getBoundingClientRect()
        expect(button.width).toBeGreaterThan(0)
        expect(button.left).toBeGreaterThanOrEqual(cell.left - 0.5)
        expect(button.right).toBeLessThanOrEqual(cell.right + 0.5)
        expect(button.top).toBeGreaterThanOrEqual(cell.top - 0.5)
        expect(button.bottom).toBeLessThanOrEqual(cell.bottom + 0.5)
        await expect
          .element(page.getByTestId('roster-scores-failed'))
          .toHaveAttribute('data-cause', 'scoring-unavailable')

        await again.click()
        await expect.element(score).toHaveAttribute('data-score', '71.00')
        expect(idsOf(single.mock.calls[0]![0])).toEqual([id(1)])
      } finally {
        await page.viewport(1280, 800)
      }
    },
  )

  it('asks for the whole page again when the scoring service was down', async () => {
    let down = true
    const asked = vi.fn((request: Request) =>
      Effect.succeed({
        scores: idsOf(request).map((participantId, index) =>
          !down
            ? { participantId, state: 'scored' as const, total: '80.00', reason: null }
            : index === 0
              ? {
                  participantId,
                  state: 'unavailable' as const,
                  total: null,
                  reason: 'scoring-unavailable' as const,
                }
              : { participantId, state: 'deferred' as const, total: null, reason: null },
        ),
      }),
    )
    await open({ listParticipantScores: asked })
    const notice = page.getByTestId('roster-scores-failed')
    await expect.element(notice).toHaveAttribute('data-cause', 'scoring-unavailable')
    down = false
    await notice.getByRole('button', { name: '重试' }).click()
    await expect.element(notice).not.toBeInTheDocument()
    // every row of the page, not one at a time
    await expect
      .element(page.getByTestId('participant-score').nth(19))
      .toHaveAttribute('data-score', '80.00')
    expect(idsOf(asked.mock.calls.at(-1)![0])).toHaveLength(20)
  })

  it('says why the page has no totals, and asks for them again', async () => {
    let down = true
    const asked = vi.fn((request: Request) =>
      down
        ? Effect.fail(apiError('ASSESSMENT_SCORING_UNAVAILABLE'))
        : Effect.succeed({
            scores: idsOf(request).map((participantId) => ({
              participantId,
              state: 'scored' as const,
              total: '80.00',
              reason: null,
            })),
          }),
    )
    await open({ listParticipantScores: asked })
    const notice = page.getByTestId('roster-scores-failed')
    await expect.element(notice).toHaveAttribute('data-cause', 'request')
    // every row can still ask about its own person
    await expect
      .element(page.getByTestId('participant-score').first())
      .toHaveAttribute('data-score-state', 'deferred')
    down = false
    await notice.getByRole('button', { name: '重试' }).click()
    await expect.element(notice).not.toBeInTheDocument()
    await expect
      .element(page.getByTestId('participant-score').first())
      .toHaveAttribute('data-score', '80.00')
  })

  // A total asked for alone stands where the page's own answer defers that
  // person: the page knows nothing newer about them. After a change that may
  // have moved totals, that one person is asked about alone again, rather
  // than dropped back to a button the reader has to press once more.
  const liveChange = () => {
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const watchBatch = () =>
      Effect.succeed(
        Stream.concat(
          Stream.fromEffect(
            Effect.promise(() => gate).pipe(Effect.as({ kind: 'entries-changed' as const })),
          ),
          Stream.never,
        ),
      )
    return { watchBatch, release: () => release() }
  }
  /** every state the first row's total has been drawn in, as it happens */
  const statesOf = (score: Element) => {
    const cell = score.parentElement!
    const seen: string[] = []
    const watch = new MutationObserver(() => {
      const now = cell
        .querySelector('[data-testid="participant-score"]')
        ?.getAttribute('data-score-state')
      if (now !== null && now !== undefined && seen.at(-1) !== now) seen.push(now)
    })
    watch.observe(cell, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-score-state'],
    })
    return { seen, stop: () => watch.disconnect() }
  }

  it('keeps a total asked for alone where the page defers the person, and asks again after a change', async () => {
    const change = liveChange()
    const pages = vi.fn((request: Request) =>
      Effect.succeed({
        scores: idsOf(request).map((participantId, index) =>
          index === 0
            ? { participantId, state: 'deferred' as const, total: null, reason: null }
            : { participantId, state: 'scored' as const, total: '80.00', reason: null },
        ),
      }),
    )
    const totals = ['66.00', '67.50']
    const single = vi.fn((request: Request) =>
      Effect.succeed({
        scores: idsOf(request).map((participantId) => ({
          participantId,
          state: 'scored' as const,
          total: totals[Math.min(single.mock.calls.length - 1, totals.length - 1)]!,
          reason: null,
        })),
      }),
    )
    await open({
      watchBatch: change.watchBatch,
      listParticipantScores: (request: Request) =>
        idsOf(request).length === 1 ? single(request) : pages(request),
    })
    const first = page.getByTestId('participant-score').first()
    await page.getByRole('button', { name: '计算参评人1的当前总分' }).click()
    await expect.element(first).toHaveAttribute('data-score', '66.00')
    const paged = pages.mock.calls.length
    const states = statesOf(first.element())

    change.release()
    await expect.poll(() => pages.mock.calls.length, { timeout: 5_000 }).toBeGreaterThan(paged)
    // the page deferred this person again, so they are asked about alone
    // once more, and their total stays up the whole time
    await expect.element(first).toHaveAttribute('data-score', '67.50')
    expect(single).toHaveBeenCalledTimes(2)
    states.stop()
    expect(states.seen).not.toContain('deferred')
    expect(states.seen).not.toContain('pending')
  })

  it('lets the page’s newer total stand over one asked for alone', async () => {
    const change = liveChange()
    let reached = false
    const pages = vi.fn((request: Request) =>
      Effect.succeed({
        scores: idsOf(request).map((participantId, index) =>
          index === 0 && !reached
            ? { participantId, state: 'deferred' as const, total: null, reason: null }
            : { participantId, state: 'scored' as const, total: '70.00', reason: null },
        ),
      }),
    )
    const single = vi.fn((request: Request) =>
      Effect.succeed({
        scores: idsOf(request).map((participantId) => ({
          participantId,
          state: 'scored' as const,
          total: '66.00',
          reason: null,
        })),
      }),
    )
    await open({
      watchBatch: change.watchBatch,
      listParticipantScores: (request: Request) =>
        idsOf(request).length === 1 ? single(request) : pages(request),
    })
    const first = page.getByTestId('participant-score').first()
    await page.getByRole('button', { name: '计算参评人1的当前总分' }).click()
    await expect.element(first).toHaveAttribute('data-score', '66.00')

    reached = true
    change.release()
    // the page reached this person this time: its answer is the newer one,
    // and nobody is asked about alone
    await expect.element(first).toHaveAttribute('data-score', '70.00')
    expect(single).toHaveBeenCalledTimes(1)
  })

  // Every connection opens with a sync, which means "read everything again".
  // The first one finds totals the page has only just asked for; a later one
  // follows a reconnect, and whatever moved while the stream was down moved
  // the totals as well as the rows.
  it('reads the totals again after a reconnect, but not when the page first connects', async () => {
    let reconnect = () => {}
    const second = new Promise<void>((resolve) => {
      reconnect = resolve
    })
    const watchBatch = () =>
      Effect.succeed(
        Stream.concat(
          Stream.make({ kind: 'sync' as const }),
          Stream.concat(
            Stream.fromEffect(
              Effect.promise(() => second).pipe(Effect.as({ kind: 'sync' as const })),
            ),
            Stream.never,
          ),
        ),
      )
    const rows = vi.fn((request: Request) => pageOf(request))
    const pages = vi.fn((request: Request) =>
      Effect.succeed({
        scores: idsOf(request).map((participantId) => ({
          participantId,
          state: 'scored' as const,
          total: '80.00',
          reason: null,
        })),
      }),
    )
    await open({ watchBatch, listParticipantAccounts: rows, listParticipantScores: pages })
    await expect
      .element(page.getByTestId('participant-score').first())
      .toHaveAttribute('data-score', '80.00')
    // the first sync, once its burst has settled: the rows are read again,
    // the totals are not
    await expect.poll(() => rows.mock.calls.length, { timeout: 5_000 }).toBeGreaterThan(1)
    expect(pages).toHaveBeenCalledTimes(1)

    reconnect()
    await expect.poll(() => pages.mock.calls.length, { timeout: 5_000 }).toBe(2)
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

  it('reads the unit tree through this page’s door, over the standing the list shows', async () => {
    const asked = vi.fn((_request: Request) =>
      Effect.succeed({
        // the class is not one this reader may name
        units: [{ id: COLLEGE, name: '软件学院', parentId: null }],
        userTypes: [],
      }),
    )
    await open({ listRosterUnits: asked })
    await expect.element(rows().first()).toBeVisible()
    expect(asked.mock.calls.at(-1)![0].query).toEqual({ reading: 'accounts', status: 'all' })
    // a unit that cannot be named keeps its place on the path
    await expect
      .element(page.getByTestId('participant-unit').first())
      .toHaveAttribute('data-unknown', '1')

    await page.getByRole('combobox', { name: '参评状态' }).click()
    await page.getByRole('option', { name: '已移出' }).click()
    await expect
      .poll(() => asked.mock.calls.at(-1)![0].query)
      .toEqual({ reading: 'accounts', status: 'excluded' })
  })

  // The tree is read over the standing the list shows, so a unit chosen
  // under one standing can fall out of it under another. The list still
  // answers the question asked - that unit, that standing - so the page says
  // which unit it is narrowed to and offers to drop it, since the tree no
  // longer can.
  const OTHER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa09'
  const unitsByStanding = (request: Request) =>
    Effect.succeed({
      units:
        request.query?.['status'] === 'excluded'
          ? [{ id: OTHER, name: '数学学院', parentId: null }]
          : [
              { id: COLLEGE, name: '软件学院', parentId: null },
              { id: CLASS_A, name: '软件 2301 班', parentId: COLLEGE },
            ],
      userTypes: [],
    })

  it('keeps a unit the tree no longer holds as the narrowing, and offers to drop it', async () => {
    await page.viewport(1280, 800)
    const asked = vi.fn((request: Request) => pageOf(request))
    await open({ listParticipantAccounts: asked, listRosterUnits: unitsByStanding })
    await page.getByRole('button', { name: '软件学院', exact: true }).click()
    await expect.poll(() => asked.mock.calls.at(-1)![0].query?.['orgNodeIds']).toEqual([COLLEGE])
    expect(page.getByTestId('roster-unit-off-tree').elements()).toHaveLength(0)

    await page.getByRole('combobox', { name: '参评状态' }).click()
    await page.getByRole('option', { name: '已移出' }).click()
    const line = page.getByTestId('roster-unit-off-tree')
    await expect.element(line).toHaveAttribute('data-unit', COLLEGE)
    // said by the name it had, and still what the list is narrowed by
    await expect.element(line).toMatchTextContent('软件学院')
    expect(asked.mock.calls.at(-1)![0].query?.['orgNodeIds']).toEqual([COLLEGE])
    expect(asked.mock.calls.at(-1)![0].query?.['status']).toBe('excluded')

    await line.getByRole('button', { name: '清除单位筛选' }).click()
    await expect.element(line).not.toBeInTheDocument()
    expect(addressNow()).not.toContain('list-unit=')
    await expect.poll(() => asked.mock.calls.at(-1)![0].query?.['orgNodeIds']).toBeUndefined()
  })

  it('names the unit on the folded switch even once the tree no longer holds it', async () => {
    await page.viewport(1180, 820)
    try {
      await open(
        { listRosterUnits: unitsByStanding },
        `/assessment/batches/${BATCH_ID}/results?list-unit=${COLLEGE}`,
        1180 - 224 - 17,
      )
      const line = page.getByTestId('roster-unit-switch')
      await expect.element(line).toMatchTextContent('软件学院')
      await page.getByRole('combobox', { name: '参评状态' }).click()
      await page.getByRole('option', { name: '已移出' }).click()
      await expect.element(line).toHaveAttribute('data-off-tree', 'true')
      await expect.element(line).toHaveAttribute('data-unit', COLLEGE)
      await expect.element(line).toMatchTextContent('软件学院')
      await expect
        .element(page.getByTestId('roster-unit-off-tree'))
        .toHaveAttribute('data-unit', COLLEGE)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('keeps a name readable beside the unit tree at a laptop’s width', async () => {
    await page.viewport(1280, 800)
    const busy = {
      inReview: 12,
      toSupplement: 3,
      reconsidering: 2,
      toRevise: 1,
      blocked: 1,
    }
    // what the rail (224) and the page's margins (48) leave of a 1280 window
    await open(
      {
        listParticipantAccounts: (request: Request) =>
          pageOf(request, [person(1, { displayName: '欧阳明月', filings: busy }), person(2)]),
      },
      undefined,
      1280 - 224 - 48,
    )
    // the tree stands beside the list at this width
    await expect.element(page.getByRole('button', { name: '软件学院', exact: true })).toBeVisible()
    const who = page.getByTestId('participant-who').first()
    await expect.element(who).toBeVisible()
    // the name keeps room to be read, whatever the counts beside it take
    expect(who.element().getBoundingClientRect().width).toBeGreaterThanOrEqual(144)
    for (const row of rows().elements()) {
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth + 1)
    }
  })

  // What each person waits on has to be readable where it stands: in the
  // longer English words, and with the unit tree dragged as wide as a wider
  // window allowed and remembered here.
  it.each([
    ['en-US', null],
    ['en-US', '480'],
    ['zh-CN', '480'],
  ] as const)(
    'keeps every count inside its column at a laptop’s width in %s (tree stored at %s)',
    async (locale, stored) => {
      await page.viewport(1280, 800)
      try {
        const busy = {
          inReview: 12,
          toSupplement: 13,
          reconsidering: 12,
          toRevise: 11,
          blocked: 10,
        }
        await open(
          {
            listParticipantAccounts: (request: Request) =>
              pageOf(request, [person(1, { filings: busy }), person(2)]),
          },
          undefined,
          // the column the rail leaves, less a scrollbar's gutter where the
          // system draws one; the page keeps its own margins inside it
          1280 - 224 - 17,
          locale,
          stored === null ? {} : { 'qualy:assessment-roster-tree': stored },
        )
        // the tree stands beside the list at this width
        await expect
          .element(page.getByRole('button', { name: '软件学院', exact: true }))
          .toBeVisible()
        const filings = page.getByTestId('participant-filings').first()
        await expect.element(filings).toHaveAttribute('data-reconsidering', '12')
        const cell = filings.element().parentElement!.getBoundingClientRect()
        const counts = Array.from(filings.element().children)
        expect(counts).toHaveLength(5)
        for (const count of counts) {
          const box = count.getBoundingClientRect()
          expect(box.left).toBeGreaterThanOrEqual(cell.left - 0.5)
          expect(box.right).toBeLessThanOrEqual(cell.right + 0.5)
          expect(count.scrollWidth).toBeLessThanOrEqual(count.clientWidth + 1)
        }
        // and the name keeps its room beside them
        expect(
          page.getByTestId('participant-who').first().element().getBoundingClientRect().width,
        ).toBeGreaterThanOrEqual(144)
      } finally {
        await page.viewport(1280, 800)
      }
    },
  )

  it('folds the unit tree above the list once the table would not fit beside it', async () => {
    await page.viewport(1180, 820)
    try {
      await open({}, undefined, 1180 - 224 - 48)
      await expect.element(page.getByTestId('roster-unit-switch')).toBeVisible()
      expect(page.getByTestId('split-handle').elements()).toHaveLength(0)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('stacks a row on a phone as a name over its facts, with nothing on a line of its own', async () => {
    await page.viewport(390, 844)
    try {
      await open({
        listParticipantAccounts: (request: Request) =>
          pageOf(request, [
            person(1, {
              status: 'excluded',
              excludedAt: '2026-03-02T00:00:00.000Z',
              filings: { ...NONE, inReview: 1 },
            }),
            person(2),
          ]),
      })
      const first = rows().first()
      await expect.element(first).toHaveAttribute('data-participant-status', 'excluded')
      // taken off the roster is said beside the name, on its line
      const name = first.getByTestId('participant-name').element().getBoundingClientRect()
      const mark = first.getByTestId('participant-excluded').element().getBoundingClientRect()
      expect(Math.abs(mark.top + mark.height / 2 - (name.top + name.height / 2))).toBeLessThan(4)
      // and nothing of the row falls to a line under its facts: a part on a
      // line of its own would end a whole line lower, not a pixel or two
      const row = first.element()
      const facts = first.getByTestId('participant-filings').element().getBoundingClientRect()
      const lead = first.getByTestId('participant-who').element().getBoundingClientRect()
      const floor = Math.max(facts.bottom, lead.bottom)
      for (const part of Array.from(row.children)) {
        expect(part.getBoundingClientRect().bottom).toBeLessThanOrEqual(floor + 4)
      }
    } finally {
      await page.viewport(1280, 800)
    }
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

  it('finds a unit to import from by searching or by its kind', async () => {
    await open({
      listScopeOptions: () =>
        Effect.succeed({
          nodes: [
            { id: COLLEGE, name: '软件学院', parentId: null, depth: 0, orgTypeId: 'college' },
            { id: CLASS_A, name: '软件 2301 班', parentId: COLLEGE, depth: 1, orgTypeId: 'c' },
          ],
          orgTypes: [
            { id: 'c', name: '班级' },
            { id: 'college', name: '学院' },
          ],
        }),
    })
    await page.getByRole('button', { name: '从组织导入' }).click()
    const units = page.getByTestId('import-units')
    await expect.element(units.getByRole('checkbox', { name: /软件学院/ })).toBeVisible()

    // by kind: the classes alone, as a list
    await units.getByRole('combobox', { name: '组织类型' }).click()
    await page.getByRole('option', { name: '班级' }).click()
    await expect.element(units.getByRole('checkbox', { name: /软件 2301 班/ })).toBeVisible()
    expect(units.getByRole('checkbox', { name: /软件学院/ }).elements()).toHaveLength(0)

    // by name, over every kind again
    await units.getByRole('combobox', { name: '组织类型' }).click()
    await page.getByRole('option', { name: '全部类型' }).click()
    await userEvent.fill(units.getByPlaceholder('搜索组织名称'), '学院')
    await expect.element(units.getByRole('checkbox', { name: /软件学院/ })).toBeVisible()
    expect(units.getByRole('checkbox', { name: /2301/ }).elements()).toHaveLength(0)
    // and what is ticked in the list is what the import asks for
    await units.getByRole('checkbox', { name: /软件学院/ }).click()
    await expect.element(units.getByTestId('chosen-units')).toBeVisible()
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

// The roster is a page people work down, so the room it has goes to the
// people: the waiting column is as wide as what it says, a unit is named
// from its own end, and the tree beside the list folds away on request.
describe('the room the roster gives its rows', () => {
  const SCHOOL = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa10'
  const GRADE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa11'
  const MAJOR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa12'
  const DEEP = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa13'
  const deepUnits = () =>
    Effect.succeed({
      units: [
        { id: SCHOOL, name: '示例大学', parentId: null },
        { id: COLLEGE, name: '计算机与软件学院', parentId: SCHOOL },
        { id: GRADE, name: '2023级', parentId: COLLEGE },
        { id: MAJOR, name: '计算机科学与技术', parentId: GRADE },
        { id: DEEP, name: '计算机科学与技术2023级1班', parentId: MAJOR },
      ],
      userTypes: [],
    })
  const deep = (n: number, over: Record<string, unknown> = {}) =>
    person(n, {
      anchorLineage: [DEEP, MAJOR, GRADE, COLLEGE, SCHOOL].map((nodeId) => ({
        nodeId,
        nodeTypeId: 'unit',
      })),
      ...over,
    })
  /** the waiting cell's own width, which is its column's */
  const waitingWidth = () =>
    page.getByTestId('participant-filings').first().element().parentElement!.getBoundingClientRect()
      .width
  /**
   * How far the waiting column starts past the end of the widest thing the
   * person's column says on the page: a name with its marks, or a unit path.
   */
  const bandBeforeWaiting = () => {
    let said = 0
    for (const row of rows().elements()) {
      // the name and the marks beside it, each as wide as its words
      const line = row.querySelector('[data-testid="participant-name"]')!.parentElement!
      for (const part of line.children) said = Math.max(said, part.getBoundingClientRect().right)
      const steps = [...row.querySelectorAll('[data-path-step]')]
      for (const step of steps) said = Math.max(said, step.getBoundingClientRect().right)
    }
    const waiting = page
      .getByTestId('participant-filings')
      .first()
      .element()
      .parentElement!.getBoundingClientRect().left
    return waiting - said
  }

  it('says nothing waits with a dash a reader can hear, right after the names', async () => {
    await open({
      listRosterUnits: deepUnits,
      listParticipantAccounts: (request: Request) => pageOf(request, [deep(1), deep(2)]),
    })
    const quiet = page.getByTestId('participant-filings').first()
    await expect.element(quiet).toHaveAttribute('data-waiting', 'none')
    // the dash is drawn for the eye; a reader hears words in its place
    const dash = quiet.element().querySelector('[aria-hidden="true"]')!
    expect(dash).not.toBeNull()
    expect((quiet.element().textContent ?? '').replace(dash.textContent ?? '', '').trim()).not.toBe(
      '',
    )
    // the dashes stand just past the names and their units, not across a
    // band of nothing the person's column kept for itself
    await expect.poll(bandBeforeWaiting).toBeLessThanOrEqual(32)
    expect(bandBeforeWaiting()).toBeGreaterThanOrEqual(0)
  })

  it('widens the waiting column to at least the page’s longest answer', async () => {
    await open({
      listParticipantAccounts: (request: Request) =>
        pageOf(request, [
          person(1, { filings: { ...NONE, inReview: 2, toSupplement: 1 } }),
          person(2),
        ]),
    })
    const busy = page.getByTestId('participant-filings').first()
    await expect.element(busy).toHaveAttribute('data-waiting', 'some')
    const counts = Array.from(busy.element().children).map((one) => one.getBoundingClientRect())
    // the counts stand on one line, inside their cell
    expect(new Set(counts.map((one) => Math.round(one.top))).size).toBe(1)
    const cell = busy.element().parentElement!.getBoundingClientRect()
    expect(counts.at(-1)!.right).toBeLessThanOrEqual(cell.right + 0.5)
    expect(waitingWidth()).toBeGreaterThan(60)
  })

  // A wide window's room goes to what waits on each person, beside their
  // name, rather than to a band between the name and it: the person's
  // column is as wide as what the page's rows say in it.
  it('gives a wide window’s room to what waits, not to a band after the names', async () => {
    await page.viewport(1920, 1000)
    try {
      await open({
        listRosterUnits: deepUnits,
        listParticipantAccounts: (request: Request) =>
          pageOf(request, [
            deep(1),
            deep(2, { filings: { ...NONE, reconsidering: 1, inReview: 3, toRevise: 1 } }),
          ]),
      })
      const busy = page.getByTestId('participant-filings').nth(1)
      await expect.element(busy).toHaveAttribute('data-waiting', 'some')
      await expect.poll(bandBeforeWaiting).toBeLessThanOrEqual(32)
      // every count stands on one line when there is room for it
      const tops = Array.from(busy.element().children).map((one) =>
        Math.round(one.getBoundingClientRect().top),
      )
      expect(tops).toHaveLength(3)
      expect(new Set(tops).size).toBe(1)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('names a row’s unit from its own end, folding the parents that do not fit', async () => {
    await open(
      {
        listRosterUnits: deepUnits,
        listParticipantAccounts: (request: Request) => pageOf(request, [deep(1)]),
      },
      undefined,
      1280 - 224 - 17,
    )
    const unit = page.getByTestId('participant-unit').first()
    await expect
      .element(unit)
      .toHaveAttribute(
        'title',
        '计算机与软件学院 / 2023级 / 计算机科学与技术 / 计算机科学与技术2023级1班',
      )
    const path = unit.getByTestId('unit-path')
    await expect.element(path).toHaveAttribute('data-clipped', 'true')
    // the class is on the line; the college, first on the path, is what gave way
    const line = path.element().getBoundingClientRect()
    const onLine = (index: number) => {
      const step = path.element().querySelector(`[data-path-step="${index}"]`)!
      const box = step.getBoundingClientRect()
      return box.top < line.bottom - 1 && box.bottom > line.top + 1
    }
    expect(onLine(3)).toBe(true)
    expect(onLine(0)).toBe(false)
  })

  it('folds the unit tree away on request, and remembers that it did', async () => {
    await open()
    const tree = page.getByRole('button', { name: '软件学院', exact: true })
    await expect.element(tree).toBeVisible()
    const beside = page.getByTestId('roster').element().getBoundingClientRect().width
    await page.getByRole('button', { name: '收起组织树' }).click()
    await expect.element(tree).not.toBeInTheDocument()
    // the list takes the room the tree gave up
    await expect
      .poll(() => page.getByTestId('roster').element().getBoundingClientRect().width)
      .toBeGreaterThan(beside + 150)
    const fold = page.getByTestId('roster-tree-toggle')
    await expect.element(fold).toHaveAttribute('data-open', 'false')
    await expect.element(fold).toHaveAttribute('aria-expanded', 'false')
    expect(localStorage.getItem('qualy:assessment-roster-tree-open')).toBe('0')
  })

  it('comes back to a folded tree folded, with the unit said in its place', async () => {
    await open(
      {},
      `/assessment/batches/${BATCH_ID}/results?list-unit=${COLLEGE}`,
      undefined,
      'zh-CN',
      { 'qualy:assessment-roster-tree-open': '0' },
    )
    await expect
      .element(page.getByTestId('roster-tree-toggle'))
      .toHaveAttribute('data-unit', COLLEGE)
    expect(page.getByRole('button', { name: '软件学院', exact: true }).elements()).toHaveLength(0)
    await page.getByTestId('roster-tree-toggle').click()
    await expect.element(page.getByRole('button', { name: '软件学院', exact: true })).toBeVisible()
  })

  it('keeps each total against the row’s end, beside its menu', async () => {
    await open()
    const score = page.getByTestId('participant-score').first()
    await expect.element(score).toHaveAttribute('data-score', '80.00')
    // the total's seat, then the cell it stands in
    const cell = score.element().parentElement!.parentElement!
    expect(
      cell.getBoundingClientRect().right - score.element().getBoundingClientRect().right,
    ).toBeLessThan(2)
  })

  it('draws no count and no pages over a roster with nobody on it', async () => {
    await open({ listParticipantAccounts: (request: Request) => pageOf(request, []) })
    await expect.element(page.getByTestId('roster')).toBeVisible()
    expect(page.getByTestId('roster-total').elements()).toHaveLength(0)
    expect(page.getByTestId('roster-pager').elements()).toHaveLength(0)
  })

  it('leaves a phone row with nothing waiting without an empty fact', async () => {
    await page.viewport(390, 844)
    try {
      await open({
        listParticipantAccounts: (request: Request) =>
          pageOf(request, [person(1, { filings: { ...NONE, inReview: 1 } }), person(2)]),
      })
      await expect.element(rows().nth(1)).toBeVisible()
      expect(rows().nth(1).getByTestId('participant-filings').elements()).toHaveLength(0)
      await expect
        .element(rows().first().getByTestId('participant-filings'))
        .toHaveAttribute('data-waiting', 'some')
    } finally {
      await page.viewport(1280, 800)
    }
  })
})
