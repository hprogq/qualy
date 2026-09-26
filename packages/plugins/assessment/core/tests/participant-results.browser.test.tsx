import ParticipantResultsPage from '../src/client/result/ParticipantResultsPage.tsx'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
import { Route, Routes } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import zhCN from '../src/client/locales/zh-CN.ts'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The staff account, as somebody uses it: find a person, read why their
// total is what it is, follow a number back to the filing that earned it,
// and send that filing back for revision.
//
// What a service test cannot see is all of it: that opening a person is a
// level down inside one page rather than a journey to another, that the
// address remembers who is open so a reload lands there, that the browser's
// own back button is the way out, and that a number is a way in to the claim
// behind it.

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222'
const OTHER_ID = '33333333-3333-4333-8333-333333333333'
const ITEM_ID = '44444444-4444-4444-8444-444444444444'
const ENTRY_ID = '55555555-5555-4555-8555-555555555555'
const GROUP_ID = '66666666-6666-4666-8666-666666666666'
const REVISION_ID = '77777777-7777-4777-8777-777777777777'

const batch = {
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: false, manage: true, redetermine: false },
  participantCount: 2,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
}

const participant = (over: Record<string, unknown> = {}) => ({
  id: PARTICIPANT_ID,
  userId: '88888888-8888-4888-8888-888888888888',
  displayName: '郭航旗',
  businessNo: '2023123456',
  userTypeId: '99999999-9999-4999-8999-999999999999',
  anchorNodeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  anchorPath: 'root.a.a1',
  anchorLineage: [],
  status: 'active' as const,
  includedAt: '2026-02-02T00:00:00.000Z',
  excludedAt: null,
  placement: 'current' as const,
  ...over,
})

const item = {
  id: ITEM_ID,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title: 'CET-6',
  scoreGroupId: GROUP_ID,
  sortOrder: 0,
  status: 'active',
  maxEntries: 1,
  currentRevision: {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    revisionNo: 1,
    entryChannels: ['participant'],
    formConfig: { files: {} },
    scoringConfig: null,
    reviewPolicy: null,
    createdAt: '2026-02-03T00:00:00.000Z',
  },
}

const entry = (over: Record<string, unknown> = {}) => ({
  id: ENTRY_ID,
  batchId: BATCH_ID,
  itemId: ITEM_ID,
  participantId: PARTICIPANT_ID,
  status: 'approved',
  source: 'self',
  currentRevision: {
    id: REVISION_ID,
    revisionNo: 1,
    itemRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    payload: {},
    note: null,
    source: 'self',
    actorId: '88888888-8888-4888-8888-888888888888',
    subjectId: '88888888-8888-4888-8888-888888888888',
    attachments: [],
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  currentReviewInstanceId: null,
  supplement: null,
  refusal: null,
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  capabilities: {
    edit: { state: 'hidden', reason: null },
    submit: { state: 'hidden', reason: null },
    withdraw: { state: 'hidden', reason: null },
    abandon: { state: 'hidden', reason: null },
    appeal: { state: 'hidden', reason: null },
    answerSupplement: { state: 'hidden', reason: null },
  },
  ...over,
})

const account = {
  mode: 'provisional' as const,
  total: '1.00',
  groups: [
    {
      groupId: GROUP_ID,
      parentGroupId: null,
      depth: 0,
      name: '语言能力',
      itemsTotal: '1.00',
      childrenTotal: '0.00',
      raw: '1.00',
      final: '1.00',
      cap: '5.00',
      floor: null,
    },
  ],
  lines: [
    {
      lineId: `itm:${ITEM_ID}`,
      kind: 'entry' as const,
      label: 'CET-6',
      value: '1.00',
      itemId: ITEM_ID,
      provenance: { entryId: ENTRY_ID, entryRevisionId: REVISION_ID },
    },
  ],
}

/** one page of the roster as the results page reads it: nobody waiting on anything */
const rosterPage = (rows: readonly ReturnType<typeof participant>[]) =>
  Effect.succeed({
    items: rows.map((row) => ({
      ...row,
      filings: { inReview: 0, toSupplement: 0, reconsidering: 0, toRevise: 0, blocked: 0 },
    })),
    total: rows.length,
    page: 1,
    pageSize: 20,
  })

const PAGES = [
  { id: 'assessment/batch-results', path: '/assessment/batches/:batchId/results', layout: 'admin' },
]

interface Request {
  params?: Record<string, string>
  payload?: Record<string, unknown>
  query?: Record<string, string>
}

const screen = (
  over: Record<string, unknown> = {},
  route = `/assessment/batches/${BATCH_ID}/results`,
) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessment: {
        getBatch: () => Effect.succeed({ batch }),
        // the roster's own doors: this page adds people to the round now
        previewImport: () => Effect.succeed({ candidates: 0 }),
        importParticipants: () => Effect.succeed({ added: 0 }),
        addParticipants: () => Effect.succeed({ added: 0, skipped: 0 }),
        setParticipantStatus: () => Effect.succeed({ ok: true }),
        listParticipantPlacements: () =>
          Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
        listParticipantAccounts: () =>
          rosterPage([participant(), participant({ id: OTHER_ID, displayName: '王君惠' })]),
        listParticipantScores: (request: { query?: { participantIds?: string | string[] } }) =>
          Effect.succeed({
            scores: [request.query?.participantIds ?? []].flat().map((participantId) => ({
              participantId,
              state: 'scored' as const,
              total: '1.00',
              reason: null,
            })),
          }),
        // what the add and import dialogs read, from this domain
        listScopeOptions: () => Effect.succeed({ nodes: [] }),
        listParticipantCandidates: () =>
          Effect.succeed({ items: [], total: 0, page: 1, pageSize: 20 }),
        getParticipant: (request: Request) =>
          Effect.succeed({ participant: participant({ id: request.params?.['participantId'] }) }),
        getParticipantResult: () => Effect.succeed(account),
        // where the person stands, named for the heading over their account
        listRosterUnits: () =>
          Effect.succeed({
            units: [
              { id: 'n1', name: '软件学院', parentId: null },
              { id: 'n2', name: '软件2301班', parentId: 'n1' },
            ],
          }),
        // the reader's own review queue, which marks what waits on them
        listReviewInbox: () =>
          Effect.succeed({ items: [], nextCursor: null, handledToday: 0, judging: true }),
        listUserTypeOptions: () =>
          Effect.succeed({
            userTypes: [
              { id: '99999999-9999-4999-8999-999999999999', code: 'student', name: '学生' },
            ],
          }),
        listParticipantEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              {
                entry: entry(),
                recognition: {
                  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                  source: 'review' as const,
                  entryRevisionId: REVISION_ID,
                  values: { 'dddddddd-dddd-4ddd-8ddd-dddddddddddd': '省级' },
                  createdAt: Date.parse('2026-03-02T00:00:00.000Z'),
                  createdByName: '王老师',
                  byPanel: false,
                },
              },
            ],
            nextCursor: null,
          }),
        listItems: () => Effect.succeed({ items: [item], version: 1 }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: [
              {
                id: GROUP_ID,
                parentGroupId: null,
                name: '语言能力',
                cap: '5.00',
                floor: null,
                sortOrder: 0,
                itemCount: 1,
              },
            ],
            version: 1,
          }),
        getRecognitionContract: () =>
          Effect.succeed({
            contract: {
              itemRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              fields: [
                {
                  id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
                  schema: { type: 'string', title: '等级' },
                },
              ],
              defaults: [],
            },
          }),
        getEntryHistory: () =>
          Effect.succeed({ entryId: ENTRY_ID, revisions: [], rounds: [], events: [] }),
        ...over,
      },
    }),
    routes: [{ path: '/assessment/batches/:batchId/results', element: <ParticipantResultsPage /> }],
    route,
  })

describe('the participant results screen', () => {
  it('gives the unit tree the window from where it stands to the bottom', async () => {
    await page.viewport(1280, 800)
    try {
      await screen()
      await expect.element(page.getByText('郭航旗')).toBeVisible()
      const seat = page.getByTestId('sticky-fill')
      await expect.element(seat).toHaveAttribute('data-filling', 'true')
      // the tree beside a list reaches the foot of the window, not the end of its rows
      await expect
        .poll(() => window.innerHeight - seat.element().getBoundingClientRect().bottom)
        .toBeLessThan(40)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('offers a move the organization made, and syncs only what it showed', async () => {
    const decided = vi.fn((_request: Request) => Effect.succeed({ synced: 1, kept: 0 }))
    const moved = {
      participantId: PARTICIPANT_ID,
      displayName: '郭航旗',
      businessNo: '2023123456',
      standing: 'changed' as const,
      unavailable: null,
      changes: ['placement'],
      frozen: {
        units: [
          { id: 'n1', name: '软件学院' },
          { id: 'n2', name: '软件2301班' },
        ],
        userType: { id: 't1', name: '学生' },
      },
      current: {
        units: [
          { id: 'n1', name: '软件学院' },
          { id: 'n3', name: '软件2302班' },
        ],
        userType: { id: 't1', name: '学生' },
      },
      currentBeyondReach: false,
      canSync: true,
      observedFingerprint: 'f'.repeat(64),
    }
    await screen({
      listParticipantAccounts: () =>
        rosterPage([
          participant({ placement: 'changed' }),
          participant({ id: OTHER_ID, displayName: '王君惠' }),
        ]),
      listParticipantPlacements: () =>
        Effect.succeed({ items: [moved], nextCursor: null, changedTotal: 1, unavailableTotal: 0 }),
      reconcileParticipantPlacements: decided,
    })
    // the roster marks who moved, and only them
    await expect
      .element(page.getByTestId('placement-mark'))
      .toHaveAttribute('data-placement', 'changed')
    expect(page.getByTestId('placement-mark').elements()).toHaveLength(1)
    const notice = page.getByTestId('placement-notice')
    await expect.element(notice).toHaveAttribute('data-changed', '1')

    await notice.getByRole('button').click()
    const row = page.getByTestId('placement-difference')
    await expect.element(row).toHaveAttribute('data-changes', 'placement')
    await expect.element(row.getByText('软件学院 / 软件2302班')).toBeVisible()
    await row.getByRole('button', { name: '同步' }).click()
    await expect.poll(() => decided.mock.calls.length).toBe(1)
    // the decision names what was shown, never where to put them
    expect(decided.mock.calls[0]![0].payload).toEqual({
      decisions: [
        { participantId: PARTICIPANT_ID, observedFingerprint: 'f'.repeat(64), decision: 'sync' },
      ],
    })
  })

  it('opens a person into the same page, and the address says who', async () => {
    await screen()
    await expect.element(page.getByText('郭航旗')).toBeVisible()
    await expect.element(page.getByText('王君惠')).toBeVisible()

    await page.getByTestId('participant-row').first().click()
    // that person's claims, in the page the list was in, and their total a tab away
    await expect.element(page.getByTestId('entries-workspace')).toBeVisible()
    await page.getByTestId('participant-tab-score').click()
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    // the address says who is open, which is what makes a reload and a
    // shared link land here; the router is in memory, so this is the address
    expect(addressNow()).toContain(`participant=${PARTICIPANT_ID}`)
  })

  it('makes its entrance once, not again on the way back from a person', async () => {
    await screen()
    const first = page.getByTestId('participant-row').first()
    await expect.element(first).toBeVisible()
    // the list arrives with the screen's own entrance
    expect(document.querySelector('[data-arrival="still"]')).toBeNull()
    await first.click()
    await expect.poll(() => addressNow()).toContain('participant=')
    await page.getByRole('button', { name: '返回参评名单' }).click()
    await expect.poll(() => addressNow()).not.toContain('participant=')
    await expect.element(page.getByTestId('participant-row').first()).toBeVisible()
    // coming back is a move inside the screen, which says so on its own
    expect(document.querySelector('[data-arrival="still"]')).not.toBeNull()
  })

  it('restores an open account from the address alone', async () => {
    await screen(
      {},
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=score`,
    )
    // no press: a reload or a shared link lands on the person
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    await expect.element(page.getByText('2023123456')).toBeVisible()
  })

  it('follows a scored line back to the claim that earned it', async () => {
    await screen()
    await page.getByTestId('participant-row').first().click()
    await page.getByTestId('participant-tab-score').click()
    await expect.element(page.getByTestId('result-total')).toBeVisible()
    await page.getByTestId('ledger-line').click()
    // the claim opens over its question on the claims half, and the address
    // remembers all three
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(addressNow()).toContain(`entry=${ENTRY_ID}`)
    expect(addressNow()).toContain(`open=${ITEM_ID}`)
    expect(addressNow()).not.toContain('view=')
    // what the round determined, which the owner's own page never showed
    await expect.element(page.getByText('省级')).toBeVisible()
    await expect.element(page.getByText('王老师', { exact: false })).toBeVisible()
  })

  it('sends a claim back for revision, with a reason', async () => {
    const interveneOnEntry = vi.fn((_request: Request) =>
      Effect.succeed({ entry: entry({ status: 'needs_revision' }) }),
    )
    await screen(
      { interveneOnEntry },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await page.getByRole('button', { name: '退回修改' }).click()
    await userEvent.fill(page.getByRole('textbox'), '证书与本人不符')
    // the dialog commits in the act's own words, not "save"
    await page.getByRole('button', { name: '退回修改' }).last().click()
    expect(interveneOnEntry).toHaveBeenCalledTimes(1)
    const sent = interveneOnEntry.mock.calls[0]![0]
    expect(sent.params?.['entryId']).toBe(ENTRY_ID)
    expect(sent.payload).toEqual({ kind: 'return-for-revision', reason: '证书与本人不符' })
  })

  it('says why a send-back was refused, in the refusal’s own words', async () => {
    const interveneOnEntry = vi.fn((_request: Request) =>
      Effect.fail(
        apiError('ASSESSMENT_ENTRY_ACTION_REFUSED', {
          action: 'return',
          reason: 'entry-not-returnable',
        }),
      ),
    )
    await screen(
      { interveneOnEntry },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await page.getByRole('button', { name: '退回修改' }).click()
    await userEvent.fill(page.getByRole('textbox'), '证书与本人不符')
    await page.getByRole('button', { name: '退回修改' }).last().click()
    await vi.waitFor(() => expect(interveneOnEntry).toHaveBeenCalledTimes(1))
    // which sentence, by its catalog entry: the general one tells nobody
    // whether to wait or to do something else
    await expect
      .poll(() => document.querySelector('[data-sonner-toast]')?.textContent ?? '')
      .toContain(zhCN['assessment/entry/refuse-not-returnable'])
  })

  it('offers no correction in an archived round', async () => {
    await screen(
      { getBatch: () => Effect.succeed({ batch: { ...batch, status: 'archived' } }) },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(page.getByRole('button', { name: '退回修改' }).elements()).toHaveLength(0)
  })

  it('reads an archived round as closed on the score half too', async () => {
    await screen(
      { getBatch: () => Effect.succeed({ batch: { ...batch, status: 'archived' } }) },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=score`,
    )
    await expect
      .element(page.getByTestId('result-moving'))
      .toHaveAttribute('data-closed', 'archived')
  })

  it('sends back only a claim under review or approved', async () => {
    await screen(
      {
        listParticipantEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [{ entry: entry({ status: 'rejected' }), recognition: null }],
            nextCursor: null,
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(page.getByRole('button', { name: '退回修改' }).elements()).toHaveLength(0)
  })

  // The two corrections of a concluded claim (ruling of 2026-09-25) are
  // the server's to offer: this reader re-determines, and the claim's own
  // appeal is still running, which the dialog says before it is confirmed.
  const correctable = (corrections: {
    reopen: { state: string; reason: string | null }
    redetermine: { state: string; reason: string | null }
  }) => ({
    listParticipantEntries: () =>
      Effect.succeed({
        participantId: PARTICIPANT_ID,
        entries: [
          {
            entry: entry({ openRound: { origin: 'appeal' } }),
            corrections,
            recognition: {
              id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
              source: 'review' as const,
              entryRevisionId: REVISION_ID,
              values: { 'dddddddd-dddd-4ddd-8ddd-dddddddddddd': '省级' },
              createdAt: Date.parse('2026-03-02T00:00:00.000Z'),
              createdByName: '王老师',
            },
          },
        ],
        nextCursor: null,
      }),
  })

  it('re-determines a concluded claim, warning that the running appeal ends', async () => {
    const redetermineEntry = vi.fn((_request: Request) =>
      Effect.succeed({
        redetermination: { kind: 'approval-revoked', status: 'rejected', endedRound: true },
      }),
    )
    await screen(
      {
        ...correctable({
          reopen: { state: 'blocked', reason: 'review-already-open' },
          redetermine: { state: 'available', reason: null },
        }),
        redetermineEntry,
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('staff-reopen')).toHaveAttribute('data-offer', 'blocked')
    await page.getByTestId('staff-redetermine').click()
    await expect.element(page.getByTestId('redetermine-ends-round')).toBeVisible()
    await page.getByRole('radio', { name: '不通过' }).click()
    await expect
      .element(page.getByTestId('redetermine-form'))
      .toHaveAttribute('data-decision', 'reject')
    await userEvent.fill(page.getByRole('textbox'), '证书与本人不符')
    await page.getByRole('dialog').getByRole('button', { name: '重新认定' }).click()
    await vi.waitFor(() => expect(redetermineEntry).toHaveBeenCalledTimes(1))
    const sent = redetermineEntry.mock.calls[0]![0]
    expect(sent.params?.['entryId']).toBe(ENTRY_ID)
    expect(sent.payload).toEqual({ decision: 'reject', reason: '证书与本人不符' })
  })

  // A question with no escalation workflow cannot be re-examined. The shut
  // key says so, and points on to re-determining only for a reader who can
  // re-determine now: the two are separate powers, and a hint towards an act
  // the reader cannot see is not a way on.
  it.each([
    ['available', 'assessment/staff/reopen-no-route'],
    ['hidden', 'assessment/staff/reopen-no-route-only'],
  ] as const)(
    'says why re-examining is shut, and points on only where it can (re-determine %s)',
    async (state, sentence) => {
      await screen(
        correctable({
          reopen: { state: 'blocked', reason: 'no-appeal-route' },
          redetermine: { state, reason: null },
        }),
        `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
      )
      await expect
        .element(page.getByTestId('staff-reopen'))
        .toHaveAttribute('data-offer', 'blocked')
      // the key is disabled, so what answers the pointer is what holds it
      await userEvent.hover(page.getByTestId('staff-reopen').element().parentElement!)
      await expect.element(page.getByRole('tooltip')).toBeVisible()
      await expect.poll(() => page.getByRole('tooltip').element().textContent).toBe(zhCN[sentence])
    },
  )

  it('offers neither correction where the server offers none', async () => {
    await screen(
      correctable({
        reopen: { state: 'hidden', reason: null },
        redetermine: { state: 'hidden', reason: null },
      }),
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(page.getByTestId('staff-reopen').elements()).toHaveLength(0)
    expect(page.getByTestId('staff-redetermine').elements()).toHaveLength(0)
  })

  // Re-determining reads the accounts it covers (ruling of 2026-09-25 #33):
  // such a reader opens a person and re-determines there, without any of
  // the roster's own doors.
  it('opens the results to a reader who re-determines, with none of the roster’s doors', async () => {
    const reader = {
      ...batch,
      manageable: false,
      capabilities: { ...batch.capabilities, manage: false, redetermine: true },
    }
    const redetermineEntry = vi.fn((_request: Request) =>
      Effect.succeed({
        redetermination: { kind: 'approval-revoked', status: 'rejected', endedRound: false },
      }),
    )
    const placements = vi.fn(() =>
      Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
    )
    await screen({
      getBatch: () => Effect.succeed({ batch: reader }),
      listParticipantPlacements: placements,
      ...correctable({
        reopen: { state: 'hidden', reason: null },
        redetermine: { state: 'available', reason: null },
      }),
      redetermineEntry,
    })
    await expect.element(page.getByText('郭航旗')).toBeVisible()
    // adding people is the roster's door, and this reader holds none of it
    expect(page.getByRole('button', { name: '添加人员' }).elements()).toHaveLength(0)
    expect(placements).not.toHaveBeenCalled()
    await page.getByTestId('participant-row').first().click()
    await page.getByTestId('participant-tab-score').click()
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    // the claim behind the number, and the correction this reader may make
    await page.getByTestId('ledger-line').click()
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    await page.getByTestId('staff-redetermine').click()
    await page.getByRole('radio', { name: '不通过' }).click()
    await userEvent.fill(page.getByRole('textbox'), '证书与本人不符')
    await page.getByRole('dialog').getByRole('button', { name: '重新认定' }).click()
    await vi.waitFor(() => expect(redetermineEntry).toHaveBeenCalledTimes(1))
  })

  // the hand-back is the server's to offer: an approved claim whose owner
  // cannot take it up again now is shown held, with the reason, rather than
  // lit and then refused (ruling of 2026-09-25 #13)
  it('holds the hand-back where the server says its owner could not refile', async () => {
    const interveneOnEntry = vi.fn((_request: Request) => Effect.succeed({ entry: entry() }))
    await screen(
      {
        ...correctable({
          returnForRevision: { state: 'blocked', reason: 'owner-cannot-refile' },
          reopen: { state: 'hidden', reason: null },
          redetermine: { state: 'hidden', reason: null },
        } as never),
        interveneOnEntry,
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    const key = page.getByTestId('staff-return')
    await expect.element(key).toHaveAttribute('data-offer', 'blocked')
    await expect.element(key).toBeDisabled()
    expect(interveneOnEntry).not.toHaveBeenCalled()
  })

  // a record the office revoked stays on the account at zero, marked as
  // revoked rather than drawn like a refusal or a plain zero (ruling #25)
  it('marks a revoked record apart from a refused claim on the account', async () => {
    const revokedEntry = '12121212-1212-4121-8121-121212121212'
    await screen(
      {
        getParticipantResult: () =>
          Effect.succeed({
            ...account,
            lines: [
              ...account.lines,
              {
                lineId: `entry:${revokedEntry}`,
                kind: 'excluded-evidence' as const,
                label: 'CET-6',
                value: '0.00',
                itemId: ITEM_ID,
                revoked: true,
                provenance: { entryId: revokedEntry },
              },
              {
                lineId: `entry:${OTHER_ID}`,
                kind: 'excluded-evidence' as const,
                label: 'CET-6',
                value: '0.00',
                itemId: ITEM_ID,
                provenance: { entryId: OTHER_ID },
              },
            ],
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=score`,
    )
    await expect.element(page.getByTestId('result-total')).toHaveTextContent('1.00')
    const excluded = () =>
      [...document.querySelectorAll('[data-line-kind="excluded-evidence"]')].map((row) => [
        row.getAttribute('data-entry'),
        row.getAttribute('data-revoked'),
      ])
    await vi.waitFor(() => expect(excluded()).toHaveLength(2))
    expect(excluded()).toEqual([
      [revokedEntry, 'true'],
      [OTHER_ID, null],
    ])
  })

  it('re-examines a concluded claim through the escalation workflow, with a reason', async () => {
    const reopenEntry = vi.fn((_request: Request) => Effect.fail(apiError('BAD', {})))
    await screen(
      {
        ...correctable({
          reopen: { state: 'available', reason: null },
          redetermine: { state: 'hidden', reason: null },
        }),
        reopenEntry,
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await page.getByTestId('staff-reopen').click()
    await userEvent.fill(page.getByRole('textbox'), '抽查发现证书存疑')
    await page.getByRole('dialog').getByRole('button', { name: '复查' }).click()
    await vi.waitFor(() => expect(reopenEntry).toHaveBeenCalledTimes(1))
    expect(reopenEntry.mock.calls[0]![0].payload).toEqual({ reason: '抽查发现证书存疑' })
  })

  const recorded = {
    listParticipantEntries: () =>
      Effect.succeed({
        participantId: PARTICIPANT_ID,
        entries: [{ entry: entry({ status: 'approved', source: 'record' }), recognition: null }],
        nextCursor: null,
      }),
  }

  it('does not offer to withdraw a record to a reader who could not have made it', async () => {
    await screen(
      recorded,
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByTestId('entry-recognition')).toBeVisible()
    expect(page.getByRole('button', { name: '撤销认定' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '退回修改' }).elements()).toHaveLength(0)
  })

  it('offers to withdraw a record to a reader who holds the record power', async () => {
    await screen(
      {
        ...recorded,
        getBatch: () =>
          Effect.succeed({
            batch: { ...batch, capabilities: { ...batch.capabilities, record: true } },
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect.element(page.getByRole('button', { name: '撤销认定' })).toBeVisible()
  })

  it('writes when a claim came back in the language the page is read in', async () => {
    const at = '2026-03-02T07:05:00.000Z'
    await screen(
      {
        listParticipantEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              {
                entry: entry({
                  status: 'needs_revision',
                  refusal: {
                    kind: 'returned',
                    reason: null,
                    comment: null,
                    suggestedPayload: null,
                    actorName: '王老师',
                    at,
                  },
                }),
                recognition: null,
              },
            ],
            nextCursor: null,
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    // the browser itself reports en-US; the page is read in zh-CN
    await expect.element(page.getByTestId('refusal-when')).toHaveTextContent(
      new Intl.DateTimeFormat('zh-CN', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(new Date(at)),
    )
  })

  it('never hands the band over to an empty heading', async () => {
    // the band becomes the person the moment one is chosen, so a banner that
    // waited for the name would leave the heading blank for the length of a
    // request - the page visibly losing its title and getting it back
    await screen({
      getParticipant: () => Effect.never as never,
    })
    await page.getByTestId('participant-row').first().click()
    // the section's own heading is gone and something stands in its place,
    // with the way back already usable
    await expect.element(page.getByRole('button', { name: '返回参评名单' })).toBeVisible()
  })

  it('says a determination a review panel made is the panel’s', async () => {
    await screen(
      {
        listParticipantEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [
              {
                entry: entry(),
                recognition: {
                  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
                  source: 'review' as const,
                  entryRevisionId: REVISION_ID,
                  values: { 'dddddddd-dddd-4ddd-8ddd-dddddddddddd': '省级' },
                  createdAt: Date.parse('2026-03-02T00:00:00.000Z'),
                  createdByName: null,
                  byPanel: true,
                },
              },
            ],
            nextCursor: null,
          }),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    await expect
      .element(page.getByTestId('entry-recognition'))
      .toHaveAttribute('data-by-panel', 'true')
  })

  it('names a determination by the words the question uses, never by its id', async () => {
    await screen(
      {},
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=entries&entry=${ENTRY_ID}`,
    )
    const card = page.getByTestId('entry-recognition')
    // The card is drawn as soon as the entry is, and the words come from the
    // question's contract, which is a second request: read once, the card
    // can still be only its heading, which is how this failed on a slower
    // runner. So wait for the words, then look for what must be absent.
    // toMatchTextContent, not toHaveTextContent: in vitest 5 the latter is an
    // exact comparison of the whole text (docs/notes/vitest.md).
    // the question's own word for the field, and the value under it
    await expect.element(card).toMatchTextContent('等级')
    await expect.element(card).toMatchTextContent('省级')
    // the opaque address the contract stores it under is nobody's to read
    expect(card.element().textContent ?? '').not.toContain('dddddddd')
  })

  it('says so where the name would be when the person cannot be read', async () => {
    await screen(
      { getParticipant: () => Effect.fail(apiError('ASSESSMENT_PARTICIPANT_NOT_FOUND')) },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}`,
    )
    await expect.element(page.getByTestId('participant-unreadable')).toBeVisible()
    // and the way back to the list stands beside it
    await expect.element(page.getByRole('button', { name: '返回参评名单' })).toBeVisible()
  })

  it('says a score cannot be read rather than showing an old one', async () => {
    await screen(
      {
        getParticipantResult: () =>
          Effect.fail({ _tag: 'ASSESSMENT_SCORING_UNAVAILABLE' } as never),
      },
      `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}&view=score`,
    )
    await expect.element(page.getByTestId('result-unavailable')).toBeVisible()
  })
})

// Opened, a person stands beside their account rather than above it: in the
// column the round's rail gives up for them while the window has one, and
// in a head over the work where it has not - folded on a phone. Where they
// stand is said from the unit's own end, with the whole chain a press away.
describe('one account beside its person', () => {
  const SCHOOL = 'n0'
  const lineage = [
    { nodeId: 'n2', nodeTypeId: 'class' },
    { nodeId: 'n1', nodeTypeId: 'college' },
    { nodeId: SCHOOL, nodeTypeId: 'school' },
  ]
  const text = (value: string) => ({ kind: 'literal' as const, value })
  const rail = [
    {
      id: 'assessment/batch-results/rail',
      label: text('参评名单'),
      target: {
        kind: 'page',
        pageId: 'assessment/batch-results',
        path: '/assessment/batches/:batchId/results',
      },
      order: 10,
    },
  ]
  const shelled = (
    route: string,
    locale: 'zh-CN' | 'en-US' = 'zh-CN',
    stubs: Record<string, unknown> = {},
  ) =>
    renderScreen({
      locale,
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: PAGES,
              collections: {
                'app-shell/navigation-groups': [],
                'app-shell/navigation-primary': [],
                'workspace-shell/navigation': rail,
              },
            }),
        },
        assessment: {
          getBatch: () => Effect.succeed({ batch }),
          listParticipantAccounts: () =>
            rosterPage([
              participant({ anchorLineage: lineage }),
              participant({ id: OTHER_ID, displayName: '王君惠' }),
            ]),
          listParticipantScores: () => Effect.succeed({ scores: [] }),
          // the list's own doors, which the way back lands among
          listScopeOptions: () => Effect.succeed({ nodes: [] }),
          listParticipantCandidates: () =>
            Effect.succeed({ items: [], total: 0, page: 1, pageSize: 20 }),
          previewImport: () => Effect.succeed({ candidates: 0 }),
          listParticipantPlacements: () =>
            Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
          getParticipant: () =>
            Effect.succeed({ participant: participant({ anchorLineage: lineage }) }),
          getParticipantResult: () => Effect.succeed(account),
          listRosterUnits: () =>
            Effect.succeed({
              units: [
                { id: SCHOOL, name: '示例大学', parentId: null },
                { id: 'n1', name: '软件学院', parentId: SCHOOL },
                { id: 'n2', name: '软件2301班', parentId: 'n1' },
              ],
            }),
          listUserTypeOptions: () =>
            Effect.succeed({
              userTypes: [
                { id: '99999999-9999-4999-8999-999999999999', code: 'student', name: '学生' },
              ],
            }),
          listReviewInbox: () =>
            Effect.succeed({ items: [], nextCursor: null, handledToday: 0, judging: false }),
          listParticipantEntries: () =>
            Effect.succeed({ participantId: PARTICIPANT_ID, entries: [], nextCursor: null }),
          listItems: () => Effect.succeed({ items: [item], version: 1 }),
          listScoreGroups: () => Effect.succeed({ groups: [], version: 1 }),
          ...stubs,
        },
      }),
      route,
      children: (
        <Routes>
          <Route element={<WorkspaceShell />}>
            <Route
              path="/assessment/batches/:batchId/results"
              element={<ParticipantResultsPage />}
            />
          </Route>
        </Routes>
      ),
    })
  const open = `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}`

  it('stands the person in the rail’s column, and gives the rail back on the way out', async () => {
    await page.viewport(1280, 800)
    await shelled(open)
    const column = page.getByTestId('workspace-rail')
    await expect.element(column).toHaveAttribute('data-lent', 'true')
    const panel = column.getByTestId('participant-panel')
    await expect.element(panel.getByRole('heading', { level: 1 })).toHaveTextContent('郭航旗')
    // the halves of the account are the column's entries now, not a row
    // over the work, and there is no head over it at all
    await expect
      .element(panel.getByTestId('participant-tab-entries'))
      .toHaveAttribute('aria-current', 'true')
    await expect
      .element(page.getByTestId('participant-account'))
      .toHaveAttribute('data-beside', 'true')
    expect(page.getByTestId('participant-head').elements()).toHaveLength(0)
    expect(column.getByRole('link', { name: '参评名单' }).elements()).toHaveLength(0)
    // the score half carries the total beside its name
    await expect.element(panel.getByTestId('participant-total')).toHaveTextContent('1.00')

    await panel.getByRole('button', { name: '返回参评名单' }).click()
    await expect.poll(() => addressNow()).not.toContain('participant=')
    await expect.element(column).not.toHaveAttribute('data-lent')
    await expect.element(column.getByRole('link', { name: '参评名单' })).toBeVisible()
  })

  it('names the column after the person and says whose work the main part is', async () => {
    await page.viewport(1280, 800)
    await shelled(open)
    // a landmark found by the person it is about
    const column = page.getByRole('complementary', { name: '郭航旗' })
    await expect.element(column).toBeVisible()
    // the main part of the page carries a heading of its own that names them
    const main = page.getByRole('main')
    await expect
      .element(main.getByRole('heading', { level: 2, name: /郭航旗/ }))
      .toBeInTheDocument()
    // the way back is called by the words it shows, so saying them presses it
    const back = column.getByRole('button', { name: '返回参评名单' })
    const shown = back.element().textContent?.trim() ?? ''
    expect(shown).not.toBe('')
    expect(back.element().getAttribute('aria-label') ?? shown).toContain(shown)
  })

  it('says where they stand from its own end in the column, in either language', async () => {
    await page.viewport(1280, 800)
    const units = [
      { id: SCHOOL, name: '示例大学', parentId: null },
      { id: 'n1', name: '计算机与软件学院', parentId: SCHOOL },
      { id: 'n2', name: '计算机科学与技术2023级1班', parentId: 'n1' },
    ]
    for (const locale of ['en-US', 'zh-CN'] as const) {
      const { unmount } = await shelled(open, locale, {
        listRosterUnits: () => Effect.succeed({ units }),
      })
      const panel = page.getByTestId('participant-panel')
      await expect.element(panel).toBeVisible()
      const unitFact = () => panel.element().querySelector('[data-fact="unit"]')
      await expect.poll(() => unitFact()?.getAttribute('data-path')).toContain('2023级1班')
      const fact = unitFact()
      // the class, all of it, however long the name over it is
      const path = fact!.querySelector('[data-testid="unit-path"]')!
      const last = path.querySelector('[data-path-step="1"]')!
      const words = last.lastElementChild as HTMLElement
      const line = path.getBoundingClientRect()
      expect(last.getBoundingClientRect().top).toBeLessThan(line.bottom - 1)
      expect(words.scrollWidth).toBeLessThanOrEqual(words.clientWidth)
      // named over it, not beside it
      const name = fact!.previousElementSibling!
      expect(name.tagName).toBe('DT')
      expect(name.getBoundingClientRect().bottom).toBeLessThanOrEqual(line.top + 1)
      await unmount()
    }
  })

  it('sets what stands in for the claims in from the column and the window’s edge', async () => {
    await page.viewport(1280, 800)
    const cases = [
      {
        state: 'failed',
        stubs: { listItems: () => Effect.fail(apiError('ASSESSMENT_BATCH_NOT_FOUND')) },
      },
      // a round whose paper has no questions yet
      {
        state: 'ready',
        stubs: { listItems: () => Effect.succeed({ items: [], version: 1 }) },
      },
    ] as const
    for (const { state, stubs } of cases) {
      const { unmount } = await shelled(open, 'zh-CN', stubs)
      const seat = page.getByTestId('participant-entries')
      await expect.element(seat).toHaveAttribute('data-state', state)
      const main = page.getByRole('main').element().getBoundingClientRect()
      const drawn = seat.element().firstElementChild!.getBoundingClientRect()
      expect(drawn.width).toBeGreaterThan(0)
      expect(drawn.left - main.left).toBeGreaterThanOrEqual(16)
      expect(main.right - drawn.right).toBeGreaterThanOrEqual(16)
      expect(drawn.top - main.top).toBeGreaterThanOrEqual(16)
      await unmount()
    }
  })

  // While it loads, the outline of the workspace runs to the same edges the
  // workspace will, so nothing shifts when the claims arrive.
  it('draws the claims’ outline edge to edge while they load, as the workspace sits', async () => {
    await page.viewport(1280, 800)
    await shelled(open, 'zh-CN', { listParticipantEntries: () => Effect.never })
    const seat = page.getByTestId('participant-entries')
    await expect.element(seat).toHaveAttribute('data-state', 'loading')
    const outline = page.getByTestId('workspace-skeleton')
    await expect.element(outline).toHaveAttribute('data-viewer', 'staff')
    const box = seat.element().getBoundingClientRect()
    const drawn = outline.element().getBoundingClientRect()
    expect(Math.round(drawn.left)).toBe(Math.round(box.left))
    expect(Math.round(drawn.right)).toBe(Math.round(box.right))
    expect(Math.round(drawn.top)).toBe(Math.round(box.top))
  })

  it('counts the claims only once they are read', async () => {
    await page.viewport(1280, 800)
    await shelled(open, 'zh-CN', { listParticipantEntries: () => Effect.never })
    const half = page.getByTestId('participant-panel').getByTestId('participant-tab-entries')
    await expect.element(half).toBeVisible()
    await expect.element(half).toHaveAttribute('data-count', '')
    expect(half.element().textContent).not.toMatch(/\d/)
    // the head a narrower window draws says the same
    await page.viewport(834, 1112)
    const tab = page.getByTestId('participant-head').getByTestId('participant-tab-entries')
    await expect.element(tab).toHaveAttribute('data-count', '')
    await page.viewport(1280, 800)
  })

  it('stands the account in the middle of a wide window, not against the column', async () => {
    await page.viewport(1920, 1000)
    try {
      await shelled(`${open}&view=score`)
      const ledger = page.getByTestId('result-ledger')
      await expect.element(ledger).toBeVisible()
      const main = page.getByRole('main').element().getBoundingClientRect()
      const drawn = ledger.element().getBoundingClientRect()
      const before = drawn.left - main.left
      const after = main.right - drawn.right
      // room to spare on both sides, and the same on each
      expect(before).toBeGreaterThan(100)
      expect(Math.abs(before - after)).toBeLessThanOrEqual(2)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('opens the whole chain of where they stand, from the school down', async () => {
    await page.viewport(1280, 800)
    await shelled(open)
    const fact = page.getByTestId('participant-panel').getByTestId('unit-chain-open')
    await expect.element(fact).toBeVisible()
    await fact.click()
    const chain = page.getByTestId('unit-chain')
    await expect.element(chain).toBeVisible()
    const levels = [...chain.element().querySelectorAll('li')]
    expect(levels.map((level) => level.textContent)).toEqual(['示例大学', '软件学院', '软件2301班'])
    expect(levels.at(-1)!.getAttribute('aria-current')).toBe('true')
    await userEvent.keyboard('{Escape}')
  })

  it('stands the person over the work where the window lends no column', async () => {
    await page.viewport(834, 1112)
    try {
      await shelled(open)
      await expect.element(page.getByTestId('participant-head')).toBeVisible()
      await expect
        .element(page.getByTestId('participant-account'))
        .toHaveAttribute('data-beside', 'false')
      expect(page.getByTestId('participant-panel').elements()).toHaveLength(0)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  // Over the work the facts share a line, a rule between each two. When they
  // wrap, the fact that starts the next line has nothing before it, so no
  // rule stands in front of it; and where they stand is said whole where
  // the line has room for it.
  it('never starts a line of facts with a rule, and says the unit whole where it fits', async () => {
    await page.viewport(834, 1112)
    try {
      await shelled(open, 'zh-CN', {
        listRosterUnits: () =>
          Effect.succeed({
            units: [
              { id: SCHOOL, name: '示例大学', parentId: null },
              { id: 'n1', name: '计算机与软件学院', parentId: SCHOOL },
              { id: 'n2', name: '计算机科学与技术2023级1班', parentId: 'n1' },
            ],
          }),
        listUserTypeOptions: () =>
          Effect.succeed({
            userTypes: [
              {
                id: '99999999-9999-4999-8999-999999999999',
                code: 'student',
                name: '全日制本科生（含第二学士学位）与交换生',
              },
            ],
          }),
      })
      const head = page.getByTestId('participant-head')
      await expect.element(head).toBeVisible()
      await expect.poll(() => head.element().querySelector('[data-fact="kind"]')).not.toBeNull()
      const facts = [...head.element().querySelectorAll('[data-fact]')]
      const clip = facts[0]!.parentElement!.parentElement!.getBoundingClientRect()
      const tops = new Set(facts.map((fact) => Math.round(fact.getBoundingClientRect().top)))
      // the facts do not all fit on one line here
      expect(tops.size).toBeGreaterThan(1)
      for (const fact of facts) {
        const rule = fact.firstElementChild!.getBoundingClientRect()
        if (rule.right <= clip.left + 0.5) continue
        // a rule that shows stands after another fact on its line
        const before = fact.previousElementSibling
        expect(before).not.toBeNull()
        expect(
          Math.abs(before!.getBoundingClientRect().top - fact.getBoundingClientRect().top),
        ).toBeLessThan(2)
      }
      await expect.element(head.getByTestId('unit-path')).toHaveAttribute('data-clipped', 'false')
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('folds the facts behind the name on a phone, and brings them out on a press', async () => {
    await page.viewport(390, 844)
    try {
      await shelled(open)
      const head = page.getByTestId('participant-head')
      await expect.element(head).toBeVisible()
      await expect.element(head.getByRole('heading', { level: 1 })).toHaveTextContent('郭航旗')
      // the number and where they stand stay; the rest waits behind the fold
      await expect.poll(() => document.querySelector('[data-fact="number"]')).not.toBeNull()
      expect(document.querySelector('[data-fact="kind"]')).toBeNull()
      expect(head.getByTestId('participant-standing').elements()).toHaveLength(0)
      const fold = head.getByTestId('participant-fold')
      await expect.element(fold).toHaveAttribute('aria-expanded', 'false')
      await fold.click()
      await expect.element(fold).toHaveAttribute('aria-expanded', 'true')
      await expect.poll(() => document.querySelector('[data-fact="kind"]')).not.toBeNull()
      await expect.element(head.getByTestId('participant-standing')).toBeVisible()
    } finally {
      await page.viewport(1280, 800)
    }
  })
})
