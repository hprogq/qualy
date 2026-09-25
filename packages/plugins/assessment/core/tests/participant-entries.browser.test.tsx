import ParticipantResultsPage from '../src/client/result/ParticipantResultsPage.tsx'
import { ParticipantResultDetail } from '../src/client/result/ParticipantResultDetail.tsx'
import { BatchScreen } from '../src/client/batch/BatchScreen.tsx'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// One person's account read by staff, in the same workspace the person files
// in: who they are and where they stand at the top, their claims question
// by question underneath, and the staff reader's own keys where the owner's
// would be - never a way to file or submit on somebody's behalf.

afterEach(() => page.viewport(1280, 800))

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_ID = '22222222-2222-4222-8222-222222222222'
const GROUP_ID = '66666666-6666-4666-8666-666666666666'
const OWN_ITEM = '44444444-4444-4444-8444-444444444441'
const RECORDED_ITEM = '44444444-4444-4444-8444-444444444442'
const entryId = (n: number) => `55555555-5555-4555-8555-5555555555${String(n).padStart(2, '0')}`

const batch = (capabilities: Record<string, boolean> = {}) => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: {
    personal: false,
    review: false,
    record: false,
    manage: true,
    redetermine: false,
    ...capabilities,
  },
  participantCount: 2,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 0,
  currentPhaseId: null,
  currentPhaseName: null,
  createdAt: '2026-02-01T00:00:00.000Z',
})

const participant = (over: Record<string, unknown> = {}) => ({
  id: PARTICIPANT_ID,
  userId: '88888888-8888-4888-8888-888888888888',
  displayName: '郭航旗',
  businessNo: '2023123456',
  userTypeId: 'type-student',
  anchorNodeId: 'n2',
  anchorPath: 'n1.n2',
  anchorLineage: [
    { nodeId: 'n1', nodeTypeId: 'college' },
    { nodeId: 'n2', nodeTypeId: 'class' },
  ],
  status: 'active' as const,
  includedAt: '2026-02-02T00:00:00.000Z',
  excludedAt: null,
  placement: 'current' as const,
  ...over,
})

const question = (id: string, title: string, channels: readonly string[], sortOrder: number) => ({
  id,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title,
  scoreGroupId: GROUP_ID,
  sortOrder,
  status: 'active',
  maxEntries: 3,
  voidReason: null,
  currentRevision: {
    id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb${String(sortOrder)}`,
    revisionNo: 1,
    entryChannels: channels,
    formConfig: { fields: [{ key: 'summary', type: 'text', label: '事项说明' }] },
    scoringConfig: null,
    reviewPolicy: null,
    displayConfig: null,
    reason: null,
    createdAt: '2026-02-03T00:00:00.000Z',
  },
  createdAt: '2026-02-03T00:00:00.000Z',
})

const hidden = { state: 'hidden' as const, reason: null }

const claim = (n: number, item: string, status: string, over: Record<string, unknown> = {}) => ({
  entry: {
    id: entryId(n),
    batchId: BATCH_ID,
    itemId: item,
    participantId: PARTICIPANT_ID,
    status,
    source: 'self',
    currentRevision: {
      id: `77777777-7777-4777-8777-7777777777${String(n).padStart(2, '0')}`,
      revisionNo: 1,
      itemRevisionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
      payload: { summary: `事项 ${String(n)}` },
      note: null,
      source: 'self',
      actorId: '88888888-8888-4888-8888-888888888888',
      subjectId: '88888888-8888-4888-8888-888888888888',
      attachments: [],
      createdAt: new Date(Date.UTC(2026, 2, 1, 0, n)).toISOString(),
    },
    currentReviewInstanceId: null,
    supplement: null,
    refusal: null,
    openRound: null,
    recognition: null,
    createdAt: new Date(Date.UTC(2026, 2, 1, 0, n)).toISOString(),
    capabilities: {
      edit: hidden,
      submit: hidden,
      withdraw: hidden,
      abandon: hidden,
      appeal: hidden,
    },
    ...over,
  },
  recognition: null,
  corrections: { returnForRevision: hidden, reopen: hidden, redetermine: hidden },
})

const screen = ({
  route,
  element = <ParticipantResultsPage />,
  capabilities,
  queue = [],
  claims = [
    claim(1, OWN_ITEM, 'approved'),
    claim(2, OWN_ITEM, 'in_review'),
    claim(3, RECORDED_ITEM, 'voided', { source: 'record' }),
    claim(4, RECORDED_ITEM, 'approved', { source: 'record' }),
  ],
  who = participant(),
}: {
  route: string
  element?: ReactNode
  capabilities?: Record<string, boolean>
  claims?: readonly unknown[]
  /** the reader's own review queue in the round */
  queue?: readonly unknown[]
  who?: unknown
}) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: [
              {
                id: 'assessment/batch-results',
                path: '/assessment/batches/:batchId/results',
                layout: 'admin',
              },
              {
                id: 'assessment/batch-record',
                path: '/assessment/batches/:batchId/record',
                layout: 'admin',
              },
              {
                id: 'assessment/review-instance',
                path: '/assessment/batches/:batchId/reviews/:instanceId',
                layout: 'admin',
              },
            ],
          }),
      },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch(capabilities) }),
        listParticipants: () => Effect.succeed({ items: [who], nextCursor: null }),
        listParticipantPlacements: () =>
          Effect.succeed({ items: [], nextCursor: null, changedTotal: 0, unavailableTotal: 0 }),
        getParticipant: () => Effect.succeed({ participant: who }),
        getParticipantResult: () =>
          Effect.succeed({
            mode: 'provisional' as const,
            total: '3.00',
            groups: [
              {
                groupId: GROUP_ID,
                parentGroupId: null,
                depth: 0,
                name: '学业发展',
                itemsTotal: '3.00',
                childrenTotal: '0.00',
                raw: '3.00',
                final: '3.00',
                cap: '10.00',
                floor: null,
              },
            ],
            lines: [],
          }),
        listParticipantEntries: () =>
          Effect.succeed({ participantId: PARTICIPANT_ID, entries: claims, nextCursor: null }),
        listItems: () =>
          Effect.succeed({
            items: [
              question(OWN_ITEM, '科研成果', ['participant'], 1),
              question(RECORDED_ITEM, '体测加分', ['administrative'], 2),
            ],
            version: 1,
          }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: [
              {
                id: GROUP_ID,
                parentGroupId: null,
                name: '学业发展',
                cap: '10.00',
                floor: null,
                sortOrder: 0,
                itemCount: 2,
              },
            ],
            version: 1,
          }),
        listRosterUnits: () =>
          Effect.succeed({
            units: [
              { id: 'n1', name: '软件学院', parentId: null },
              { id: 'n2', name: '软件2301班', parentId: 'n1' },
            ],
          }),
        listUserTypeOptions: () =>
          Effect.succeed({ userTypes: [{ id: 'type-student', code: 'student', name: '学生' }] }),
        getRecognitionContract: () => Effect.succeed({ contract: null }),
        listReviewInbox: () =>
          Effect.succeed({ items: queue, nextCursor: null, handledToday: 0, judging: true }),
        getEntryHistory: () => Effect.succeed({ revisions: [], rounds: [], events: [] }),
      },
    }),
    routes: [{ path: '/assessment/batches/:batchId/results', element }],
    route,
  })

const base = `/assessment/batches/${BATCH_ID}/results?participant=${PARTICIPANT_ID}`
const rows = () => [...document.querySelectorAll('[data-testid="claim-row"]')]

describe('reading somebody’s entries', () => {
  it('says who the person is and where they stand, above their account', async () => {
    await screen({ route: base, who: participant({ placement: 'changed' }) })
    await expect.element(page.getByText('郭航旗')).toBeVisible()
    const fact = (key: string) =>
      document.querySelector(`[data-fact="${key}"]`)?.textContent?.trim() ?? ''
    await expect.poll(() => fact('unit')).toBe('软件学院 / 软件2301班')
    await expect.poll(() => fact('kind')).toBe('学生')
    expect(fact('number')).toBe('2023123456')
    await expect
      .element(page.getByTestId('participant-roster'))
      .toHaveAttribute('data-status', 'active')
    // the organization has them somewhere else now: said, not acted on
    await expect
      .element(page.getByTestId('participant-placement'))
      .toHaveAttribute('data-placement', 'changed')
  })

  it('reads the claims in the workspace the person files in, with no way to file', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries` })
    await expect.element(page.getByTestId('entries-workspace')).toBeVisible()
    await expect.poll(() => rows().length).toBe(2)
    expect(page.getByTestId('file-claim').elements()).toHaveLength(0)
    // the account's own figures at the head, as the staff reader counts them
    await expect
      .poll(() => document.querySelector('[data-stat="in_review"]')?.getAttribute('data-count'))
      .toBe('1')
    expect(document.querySelector('[data-stat="approved"]')?.getAttribute('data-count')).toBe('2')
    // what is still moving narrows the structure to the question it is on
    await expect.element(page.getByTestId('rail-todo')).toHaveAttribute('data-count', '1')
  })

  it('keeps a withdrawn record under a filter of its own', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries&open=${RECORDED_ITEM}` })
    await expect.poll(() => rows().length).toBe(1)
    const voided = () => document.querySelector('[data-chip="voided"]')
    await expect.poll(() => voided()?.getAttribute('data-count')).toBe('1')
    await userEvent.click(voided()!)
    await expect
      .poll(() => rows().map((row) => row.getAttribute('data-entry')))
      .toEqual([entryId(3)])
    expect(rows()[0]!.getAttribute('data-standing')).toBe('voided')
  })

  it('reads a question left with only a withdrawn record as empty, the record a filter away', async () => {
    await page.viewport(1440, 900)
    await screen({
      route: `${base}&view=entries&open=${RECORDED_ITEM}`,
      claims: [claim(3, RECORDED_ITEM, 'voided', { source: 'record' })],
    })
    await expect.element(page.getByTestId('entries-tray')).toBeVisible()
    expect(page.getByTestId('entries-no-match').elements()).toHaveLength(0)
    await userEvent.click(document.querySelector('[data-chip="voided"]')!)
    await expect
      .poll(() => rows().map((row) => row.getAttribute('data-entry')))
      .toEqual([entryId(3)])
  })

  // What waits on this reader is the server's queue, never a guess from the
  // claim's state: one of the two claims in review is theirs to decide.
  it('marks what waits on the reader’s own decision, with the way to it', async () => {
    await page.viewport(1440, 900)
    const INSTANCE = '99999999-9999-4999-8999-999999999991'
    await screen({
      route: `${base}&view=entries&open=${OWN_ITEM}`,
      capabilities: { review: true },
      claims: [claim(1, OWN_ITEM, 'in_review'), claim(2, OWN_ITEM, 'in_review')],
      queue: [
        {
          instanceId: INSTANCE,
          entryId: entryId(2),
          batchId: BATCH_ID,
          batchName: '2026 春季综测',
          itemId: OWN_ITEM,
          itemTitle: '科研成果',
          participantName: '郭航旗',
          businessNo: '2023123456',
          unitId: null,
          unitName: null,
          roundNo: 1,
          route: 'normal',
          values: [],
          attachmentCount: 0,
          submittedAt: '2026-03-01T00:00:00.000Z',
        },
      ],
    })
    await expect.element(page.getByTestId('awaiting-me')).toHaveAttribute('data-count', '1')
    await expect
      .poll(() =>
        rows()
          .filter((row) => row.hasAttribute('data-awaiting-me'))
          .map((row) => row.getAttribute('data-entry')),
      )
      .toEqual([entryId(2)])
    expect(
      page.getByTestId('awaiting-me').getByRole('link').element().getAttribute('href'),
    ).toContain(INSTANCE)
  })

  it('reads no queue for a reader who does not review in the round', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries&open=${OWN_ITEM}` })
    await expect.poll(() => rows().length).toBe(2)
    expect(page.getByTestId('awaiting-me').elements()).toHaveLength(0)
  })

  it('offers the office’s own record only where the reader holds that power', async () => {
    await page.viewport(1440, 900)
    await screen({
      route: `${base}&view=entries&open=${RECORDED_ITEM}`,
      capabilities: { record: true },
    })
    const record = page.getByTestId('staff-record')
    await expect.element(record).toBeVisible()
    expect(record.element().getAttribute('href')).toContain('mode=manual')
  })

  it('does not offer a record to a reader without that power', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries&open=${RECORDED_ITEM}` })
    await expect.poll(() => rows().length).toBe(1)
    expect(page.getByTestId('staff-record').elements()).toHaveLength(0)
  })

  it('lands a claim followed from the account on its own question', async () => {
    await page.viewport(1440, 900)
    await screen({ route: `${base}&view=entries&entry=${entryId(4)}` })
    // the question the claim was filed under is written into the address,
    // so closing the drawer leaves the reader there
    await expect.poll(() => addressNow()).toContain(`open=${RECORDED_ITEM}`)
    await expect
      .poll(() => document.querySelector('[data-testid="item-pane"]')?.getAttribute('data-item'))
      .toBe(RECORDED_ITEM)
    await expect.element(page.getByRole('dialog')).toBeVisible()
  })

  it('walks a phone from the structure into one question', async () => {
    await page.viewport(390, 844)
    await screen({ route: `${base}&view=entries` })
    await expect
      .poll(() =>
        document.querySelector('[data-testid="entries-workspace"]')?.getAttribute('data-screen'),
      )
      .toBe('structure')
    await page.getByRole('button', { name: /科研成果/ }).click()
    await expect.poll(() => addressNow()).toContain(`open=${OWN_ITEM}`)
    await expect.poll(() => rows().length).toBe(2)
  })

  // The list knows who comes before and after, in the order and under the
  // filters the reader left it in; the account only offers the way there.
  it('steps to the people either side of this one, where the list says who they are', async () => {
    await page.viewport(1440, 900)
    const went = vi.fn()
    await screen({
      route: `/assessment/batches/${BATCH_ID}/results`,
      element: (
        <BatchScreen title="参评人员" banner="open">
          {(batch) => (
            <ParticipantResultDetail
              batchId={batch.id}
              participantId={PARTICIPANT_ID}
              manageable
              writable
              mayRecord={false}
              view="score"
              entryId=""
              neighbours={{
                previous: null,
                next: { id: 'next-person', name: '王君惠' },
                onGo: went,
              }}
              onView={() => undefined}
              onEntry={() => undefined}
              onFollow={() => undefined}
              onBack={() => undefined}
            />
          )}
        </BatchScreen>
      ),
    })
    await expect.element(page.getByTestId('participant-previous')).toBeDisabled()
    await page.getByRole('button', { name: /王君惠/ }).click()
    expect(went).toHaveBeenCalledWith('next-person')
  })
})
