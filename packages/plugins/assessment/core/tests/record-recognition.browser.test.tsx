import AdministrativeRecordsPage from '../src/client/record/AdministrativeRecordsPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { lazy } from 'react'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

const PeoplePickerView = lazy(() => import('@qualy/plugin-auth/client/iam/PeoplePickerView'))

// The registrar making a determination while they file the fact.
//
// The defaults follow the material until a field is touched - after that
// the value is the registrar's judgment and the form stops second-guessing
// it - and switching to another question starts a clean sheet, because one
// contract's drafts must never leak into the next. Whatever the screen
// shows, the submission is explicit: the wire carries the values the
// registrar confirmed.

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ITEM_A = '22222222-2222-4222-8222-222222222222'
const ITEM_B = '88888888-8888-4888-8888-888888888888'
const REVISION_A = '77777777-7777-4777-8777-777777777777'
const REVISION_B = '99999999-9999-4999-8999-999999999999'
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444'
const PARTICIPANT_B = '44444444-4444-4444-8444-444444444445'

const PAGES = [{ id: 'assessment/batch-record', path: '/assessment/batches/:batchId/record' }].map(
  (entry) => ({ ...entry, layout: 'admin' }),
)

const batch = () => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: false,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: true, manage: false },
  participantCount: 12,
  materialRange: { start: '2026-03-01', end: '2026-09-01' },
  timezone: 'Asia/Shanghai',
  status: 'active',
  configRevision: 1,
  currentPhaseId: null,
  currentPhaseName: '填报期',
  createdAt: '2026-02-01T00:00:00.000Z',
})

const item = (id: string, revisionId: string, title: string) => ({
  id,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title,
  scoreGroupId: '66666666-6666-4666-8666-666666666666',
  maxEntries: null,
  sortOrder: 0,
  status: 'active',
  voidReason: null,
  currentRevision: {
    id: revisionId,
    revisionNo: 1,
    entrySource: 'administrative',
    formConfig: {
      fields: [
        {
          id: 'claimed-level',
          key: 'claimed-level-slot',
          type: 'choice',
          label: '申报级别',
          required: true,
          options: [
            { value: 'national', label: '国家级' },
            { value: 'provincial', label: '省部级' },
          ],
        },
      ],
    },
    scoringConfig: {},
    reviewPolicy: {},
    displayConfig: null,
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  createdAt: '2026-03-01T00:00:00.000Z',
})

const contractOf = (itemRevisionId: string) => ({
  itemRevisionId,
  fields: [
    {
      id: 'rec-level',
      schema: {
        type: 'string',
        enum: ['national', 'provincial'],
        'x-qualy-enumLabels': { national: '国家级', provincial: '省部级' },
        title: '认定赛事级别',
      },
    },
  ],
  defaults: [
    {
      recognitionId: 'rec-level',
      payloadKey: 'claimed-level-slot',
      assignment: { kind: 'direct' as const },
    },
  ],
})

const open = (stubs: Record<string, unknown>) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: PAGES,
            // the picker's drawing belongs to iam and arrives through the
            // surface it contributes to, exactly as in the application
            slots: {
              'iam/people-picker-view': [{ id: 'auth/people-picker-view', order: 0 }],
            },
          }),
      },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listItems: () =>
          Effect.succeed({
            items: [
              item(ITEM_A, REVISION_A, '竞赛获奖登记'),
              item(ITEM_B, REVISION_B, '荣誉称号登记'),
            ],
            capabilities: { canManage: false },
          }),
        listParticipants: () =>
          Effect.succeed({
            items: [
              {
                id: PARTICIPANT_ID,
                userId: '55555555-5555-4555-8555-555555555555',
                displayName: '周予安',
                businessNo: null,
                userTypeId: 'ut',
                anchorNodeId: 'node',
                anchorPath: 'a',
                status: 'active',
              },
              {
                id: PARTICIPANT_B,
                userId: '55555555-5555-4555-8555-555555555556',
                displayName: '林晚舟',
                businessNo: null,
                userTypeId: 'ut',
                anchorNodeId: 'node',
                anchorPath: 'b',
                status: 'active',
              },
            ],
            nextCursor: null,
          }),
        listRosterUnits: () =>
          Effect.succeed({ units: [{ id: 'node', name: '一班', parentId: null }] }),
        listScoreGroups: () => Effect.succeed({ groups: [], version: 1 }),
        listAdministrativeEntries: () => Effect.succeed({ entries: [], nextCursor: null }),
        getRecognitionContract: ((request: { params: { itemId: string } }) =>
          Effect.succeed({
            contract: contractOf(request?.params?.itemId === ITEM_B ? REVISION_B : REVISION_A),
          })) as never,
        ...stubs,
      },
    } as never),
    routes: [
      { path: '/assessment/batches/:batchId/record', element: <AdministrativeRecordsPage /> },
    ] as never,
    route: `/assessment/batches/${BATCH_ID}/record?mode=manual`,
    registry: {
      slots: { 'iam/people-picker-view': { 'auth/people-picker-view': PeoplePickerView } },
    },
  })

/** the questions this office settles arrive as a list to read, not a select */
const waitForItems = () =>
  vi.waitFor(() => {
    if (document.querySelector('[data-testid="record-item-choice"]') === null) {
      throw new Error('items not loaded yet')
    }
  })

const chooseItem = async (title: string) => {
  const { userEvent } = await import('vitest/browser')
  // already on a question: the way to another one is the named change
  // button on its card, which is what discards the draft
  const change = document.querySelector('[data-testid="record-item-change"]')
  if (change !== null) {
    await userEvent.click(change)
    await waitForItems()
  }
  const choice = [...document.querySelectorAll('[data-testid="record-item-choice"]')].find((one) =>
    (one.textContent ?? '').includes(title),
  )
  if (!choice) throw new Error(`${title} is not offered`)
  await userEvent.click(choice)
}

/**
 * Naming who a finding is about.
 *
 * One dialog, the shared picker view inside it, and the confirmation that
 * closes it - the same three presses a person makes. The population it
 * offers is this round's roster, not the directory.
 */
const choosePerson = async (name: string) => {
  const { userEvent } = await import('vitest/browser')
  await userEvent.click(page.getByRole('button', { name: '选择参评人员' }).element())
  await vi.waitFor(() => {
    const found = [...document.querySelectorAll('[data-testid="people-picker-row"]')].find((row) =>
      (row.textContent ?? '').includes(name),
    )
    if (!found) throw new Error(`${name} is not offered yet`)
  })
  const row = [...document.querySelectorAll('[data-testid="people-picker-row"]')].find((one) =>
    (one.textContent ?? '').includes(name),
  )!
  await userEvent.click(row.querySelector('button, input')!)
  await userEvent.click(
    [...document.querySelectorAll('button')].find((one) =>
      (one.textContent ?? '').includes('已选择'),
    )!,
  )
}

describe('recording with a determination', () => {
  it('follows the material until the registrar has judged, then submits their word', async () => {
    const created = vi.fn((request: { payload: Record<string, unknown> }) =>
      Effect.fail({
        _tag: 'ASSESSMENT_ENTRY_ACTION_REFUSED',
        action: 'create',
        reason: 'x',
        request,
      }),
    )
    open({ createEntry: created as never })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    const { userEvent } = await import('vitest/browser')
    // the evidence choice seeds the determination
    await userEvent.selectOptions(
      page.getByLabelText('申报级别', { exact: false }).element(),
      '国家级',
    )
    const recognition = () =>
      document.querySelector(
        '[data-testid="record-recognition"] [data-parameter="rec-level"] select',
      ) as HTMLSelectElement
    await vi.waitFor(() => {
      if (recognition().value !== 'national') throw new Error('seed not followed yet')
    })
    // material changes, untouched determination follows
    await userEvent.selectOptions(
      page.getByLabelText('申报级别', { exact: false }).element(),
      '省部级',
    )
    await vi.waitFor(() => {
      if (recognition().value !== 'provincial') throw new Error('still following')
    })
    // the registrar judges otherwise; the material moving again must not
    // overwrite their word
    await userEvent.selectOptions(recognition(), 'national')
    await userEvent.selectOptions(
      page.getByLabelText('申报级别', { exact: false }).element(),
      '国家级',
    )
    await userEvent.selectOptions(
      page.getByLabelText('申报级别', { exact: false }).element(),
      '省部级',
    )
    expect(recognition().value).toBe('national')
  })

  it('carries a prototype-named recognition like any other id', async () => {
    // a recognition id is an opaque wire string, and `__proto__` is a legal
    // one: the seed follows the material into it and it rides the filing as
    // an own key - never as a mutation of some object's prototype
    const created = vi.fn((request: { payload: Record<string, unknown> }) =>
      Effect.succeed({
        item: { id: ITEM_A, title: '竞赛获奖登记', revisionId: REVISION_A },
        requestedCount: 1,
        eligibleCount: 1,
        blocked: [],
        targetFingerprint: 'fp',
        request,
      }),
    )
    open({
      previewAdministrativeRecord: created as never,
      getRecognitionContract: (() =>
        Effect.succeed({
          contract: {
            itemRevisionId: REVISION_A,
            fields: [
              {
                id: '__proto__',
                schema: {
                  type: 'string',
                  enum: ['national', 'provincial'],
                  'x-qualy-enumLabels': { national: '国家级', provincial: '省部级' },
                  title: '认定赛事级别',
                },
              },
            ],
            defaults: [
              {
                recognitionId: '__proto__',
                payloadKey: 'claimed-level-slot',
                assignment: { kind: 'direct' as const },
              },
            ],
          },
        })) as never,
    })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    await choosePerson('周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    await userEvent.selectOptions(
      page.getByLabelText('申报级别', { exact: false }).element(),
      '国家级',
    )
    const recognition = () =>
      document.querySelector('[data-testid="record-recognition"] select') as HTMLSelectElement
    await vi.waitFor(() => {
      if (recognition().value !== 'national') throw new Error('seed not followed yet')
    })
    await userEvent.fill(page.getByLabelText('认定依据').element(), '校运会秩序册第 3 页')
    await userEvent.click(page.getByTestId('record-check').element())
    await vi.waitFor(() => {
      if (created.mock.calls.length === 0) throw new Error('not asked yet')
    })
    const sent = created.mock.calls[0]![0]!.payload as {
      recognition?: { values?: Record<string, unknown> }
    }
    const values = sent.recognition?.values ?? {}
    expect(Object.hasOwn(values, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(values, '__proto__')?.value).toBe('national')
  })

  it('starts a clean sheet on another person', async () => {
    // half a record written about one student must never be filable
    // against the next one picked from the roster
    open({})
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    await choosePerson('周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    await userEvent.selectOptions(
      page.getByLabelText('申报级别', { exact: false }).element(),
      '国家级',
    )
    const recognition = () =>
      document.querySelector(
        '[data-testid="record-recognition"] [data-parameter="rec-level"] select',
      ) as HTMLSelectElement
    await userEvent.selectOptions(recognition(), 'provincial')
    // a different subject: evidence and determination both start over
    await choosePerson('林晚舟')
    await vi.waitFor(() => {
      const evidence = page
        .getByLabelText('申报级别', { exact: false })
        .element() as HTMLSelectElement
      if (evidence.value !== '' || recognition().value !== '')
        throw new Error('the previous person\u2019s sheet is still standing')
    })
  })

  it('starts a clean sheet after a successful filing', async () => {
    const created = vi.fn(() => Effect.succeed({ operationId: 'op1', recordedCount: 1 }))
    open({
      previewAdministrativeRecord: (() =>
        Effect.succeed({
          item: { id: ITEM_A, title: '竞赛获奖登记', revisionId: REVISION_A },
          requestedCount: 1,
          eligibleCount: 1,
          blocked: [],
          targetFingerprint: 'fp',
        })) as never,
      recordAdministrativeBatch: created as never,
    })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    await choosePerson('周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    await userEvent.selectOptions(
      page.getByLabelText('申报级别', { exact: false }).element(),
      '国家级',
    )
    const recognition = () =>
      document.querySelector(
        '[data-testid="record-recognition"] [data-parameter="rec-level"] select',
      ) as HTMLSelectElement
    await userEvent.selectOptions(recognition(), 'provincial')
    await userEvent.fill(page.getByLabelText('认定依据').element(), '校运会秩序册第 3 页')
    await userEvent.click(page.getByTestId('record-check').element())
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-submit"]') === null)
        throw new Error('not checked yet')
    })
    await userEvent.click(page.getByTestId('record-submit').element())
    await vi.waitFor(() => {
      if (created.mock.calls.length === 0) throw new Error('not filed yet')
    })
    // the filing is done; what was typed for it dies with it - the next
    // record, even for the same question and people, starts from nothing
    await vi.waitFor(() => {
      const who = page.getByTestId('record-targets').element()
      if ((who.textContent ?? '').includes('已选择')) throw new Error('targets still chosen')
      const evidence = page
        .getByLabelText('申报级别', { exact: false })
        .element() as HTMLSelectElement
      if (evidence.value !== '') throw new Error('evidence survived the filing')
      if (recognition().value !== '') throw new Error('determination survived the filing')
    })
  })

  it('starts a clean sheet on another question', async () => {
    open({})
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    const { userEvent } = await import('vitest/browser')
    const recognition = () =>
      document.querySelector(
        '[data-testid="record-recognition"] [data-parameter="rec-level"] select',
      ) as HTMLSelectElement
    await userEvent.selectOptions(recognition(), 'national')
    // switching questions is a new contract: the touched draft dies with
    // the old one instead of leaking into it
    await chooseItem('荣誉称号登记')
    await vi.waitFor(() => {
      if (recognition().value !== '') throw new Error('old draft still standing')
    })
  })
})
