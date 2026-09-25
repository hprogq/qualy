import AdministrativeRecordsPage from '../src/client/record/AdministrativeRecordsPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { lazy } from 'react'
import { Effect } from 'effect'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

const PeoplePickerView = lazy(() => import('@qualy/plugin-auth/client/iam/PeoplePickerView'))

// The registrar making a determination while they file the fact.
//
// A field the determination stands for is asked once, as the determination:
// the office is not asked for the material and then for its judgment of the
// same material. Switching to another question starts a clean sheet, because
// one contract's drafts must never leak into the next. Whatever the screen
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
  capabilities: { personal: false, review: false, record: true, manage: false, redetermine: false },
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
    entryChannels: ['administrative'],
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
        previewRecordDetermination: () =>
          Effect.succeed({ issues: [], amount: '6.00', refusal: null }),
        // eslint-disable-next-line typescript/no-unnecessary-type-assertion -- the stub is typed as the endpoint it stands in for
        getRecognitionContract: ((request: { params: { itemId: string } }) =>
          Effect.succeed({
            contract: contractOf(request?.params?.itemId === ITEM_B ? REVISION_B : REVISION_A),
          })) as never,
        ...stubs,
      },
    }),
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

/**
 * Choosing the question, which is now a choice and a step.
 *
 * Picking one selects it; the footer's "next" is what enters the form. From
 * inside the form the way back to the choice is the footer's "back", which
 * is also what discards the sheet.
 */
const chooseItem = async (title: string) => {
  const { userEvent } = await import('vitest/browser')
  const back = document.querySelector('[data-testid="record-step-back"]')
  if (back !== null) {
    await userEvent.click(back)
    await waitForItems()
  }
  const choice = [...document.querySelectorAll('[data-testid="record-item-choice"]')].find((one) =>
    (one.textContent ?? '').includes(title),
  )
  if (!choice) throw new Error(`${title} is not offered`)
  await userEvent.click(choice)
  await userEvent.click(page.getByRole('button', { name: '下一步' }).element())
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

/**
 * The determination's own choice, which is the product's select rather than
 * a native one: what it stands at is on the trigger, and setting it is the
 * press that opens the list plus the option named there.
 */
const recognitionChoice = (parameter: string) => {
  const trigger = () =>
    document.querySelector<HTMLElement>(
      `[data-testid="record-recognition"] [data-parameter="${parameter}"] [data-slot="select-trigger"]`,
    )
  return {
    trigger,
    /** what it stands at, read as the words on the trigger */
    said: () => trigger()?.textContent ?? '',
    pick: async (label: string) => {
      const { userEvent } = await import('vitest/browser')
      await userEvent.click(trigger()!)
      await vi.waitFor(() => {
        const found = [...document.querySelectorAll('[role="option"]')].find(
          (one) => (one.textContent ?? '') === label,
        )
        if (!found) throw new Error(`${label} is not offered yet`)
      })
      await userEvent.click(
        [...document.querySelectorAll('[role="option"]')].find(
          (one) => (one.textContent ?? '') === label,
        )!,
      )
    },
  }
}

describe('recording with a determination', () => {
  it('asks the office once: the bound field stays off the form, and the determination is what travels', async () => {
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
    await open({ previewAdministrativeRecord: created })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    await choosePerson('周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    // the material the determination stands for is not a second question
    expect(page.getByLabelText('申报级别', { exact: false }).elements()).toHaveLength(0)
    const recognition = recognitionChoice('rec-level')
    await recognition.pick('国家级')
    await userEvent.fill(page.getByLabelText('认定理由').element(), '校运会秩序册第 3 页')
    await userEvent.click(page.getByTestId('record-step-next').element())
    await vi.waitFor(() => {
      if (created.mock.calls.length === 0) throw new Error('not asked yet')
    })
    const sent = created.mock.calls[0]![0].payload as {
      payload?: Record<string, unknown>
      recognition?: { values?: Record<string, unknown> }
    }
    // the determination travels; the filing side of it is the server's to write
    expect(sent.recognition?.values).toEqual({ 'rec-level': 'national' })
    expect(Object.hasOwn(sent.payload ?? {}, 'claimed-level-slot')).toBe(false)
  })

  it('carries a prototype-named recognition like any other id', async () => {
    // a recognition id is an opaque wire string, and `__proto__` is a legal
    // one: it rides the filing as an own key - never as a mutation of some
    // object's prototype
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
    await open({
      previewAdministrativeRecord: created,
      getRecognitionContract: () =>
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
        }),
    })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    await choosePerson('周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    const recognition = recognitionChoice('__proto__')
    await recognition.pick('国家级')
    await userEvent.fill(page.getByLabelText('认定理由').element(), '校运会秩序册第 3 页')
    await userEvent.click(page.getByTestId('record-step-next').element())
    await vi.waitFor(() => {
      if (created.mock.calls.length === 0) throw new Error('not asked yet')
    })
    const sent = created.mock.calls[0]![0].payload as {
      recognition?: { values?: Record<string, unknown> }
    }
    const values = sent.recognition?.values ?? {}
    expect(Object.hasOwn(values, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(values, '__proto__')?.value).toBe('national')
  })

  // A value the judge will not take - a date outside the material window, an
  // option the contract no longer has - is said beside the determination
  // while it can still be changed, and holds the forward key: the act would
  // only be refused for it on the last press, for everybody at once.
  it('holds the way forward while the judge refuses a determination value', async () => {
    const created = vi.fn(() => Effect.succeed({}))
    await open({
      previewAdministrativeRecord: created,
      previewRecordDetermination: () =>
        Effect.succeed({
          issues: [{ recognitionId: 'rec-level', reason: 'out-of-material-range' }],
          amount: null,
          refusal: null,
        }),
    })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    await choosePerson('周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    await recognitionChoice('rec-level').pick('国家级')
    await userEvent.fill(page.getByLabelText('认定理由').element(), '校运会秩序册第 3 页')
    await expect.element(page.getByTestId('record-score')).toHaveAttribute('data-preview', 'issues')
    await expect.element(page.getByTestId('record-step-next')).toBeDisabled()
    expect(created).not.toHaveBeenCalled()
  })

  it('keeps the one finding while the people it is about change', async () => {
    // One finding settled on many: adding somebody to the list does not
    // make the material somebody else's, so the sheet stands. What does not
    // stand is the checked list - a different set is a different list, and
    // the forward key has to earn it again.
    await open({})
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    await choosePerson('周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    const recognition = recognitionChoice('rec-level')
    await recognition.pick('省部级')
    await choosePerson('林晚舟')
    await vi.waitFor(() => {
      if (!recognition.said().includes('省部级'))
        throw new Error('the finding was thrown away with the list')
    })
    // and the reader is still on the step that holds it, not looking at a
    // confirmation of a set that has since moved
    await expect.element(page.getByTestId('record-steps')).toHaveAttribute('data-at', '1')
  })

  it('starts a clean sheet after a successful filing', async () => {
    const created = vi.fn(() => Effect.succeed({ operationId: 'op1', recordedCount: 1 }))
    await open({
      previewAdministrativeRecord: () =>
        Effect.succeed({
          item: { id: ITEM_A, title: '竞赛获奖登记', revisionId: REVISION_A },
          requestedCount: 1,
          eligibleCount: 1,
          blocked: [],
          targetFingerprint: 'fp',
        }),
      recordAdministrativeBatch: created,
    })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    await choosePerson('周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    const recognition = recognitionChoice('rec-level')
    await recognition.pick('省部级')
    await userEvent.fill(page.getByLabelText('认定理由').element(), '校运会秩序册第 3 页')
    await userEvent.click(page.getByTestId('record-step-next').element())
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-submit"]') === null)
        throw new Error('not checked yet')
    })
    await userEvent.click(page.getByTestId('record-submit').element())
    await vi.waitFor(() => {
      if (created.mock.calls.length === 0) throw new Error('not filed yet')
    })
    // The filing is done, so the errand is: it closes onto the book behind
    // it. What was typed for it dies with it - opening it again, even for
    // the same question and the same people, starts from the first step
    // with nothing carried over.
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="manual-record"]') !== null)
        throw new Error('the errand is still standing')
    })
    // the band's own action; the empty book below offers the same errand
    await userEvent.click(page.getByRole('button', { name: '统一认定' }).first().element())
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    await vi.waitFor(() => {
      // the chosen-people line is rendered only while somebody is chosen,
      // so its absence is the fact - not the words it would have carried
      if (page.getByTestId('record-targets-said').elements().length > 0) {
        throw new Error('targets still chosen')
      }
      if (recognition.said().includes('省部级'))
        throw new Error('determination survived the filing')
    })
  })

  it('waits for a file still uploading before checking who it reaches', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const base = item(ITEM_A, REVISION_A, '竞赛获奖登记')
    const withProof = {
      ...base,
      currentRevision: {
        ...base.currentRevision,
        formConfig: {
          fields: [
            ...base.currentRevision.formConfig.fields,
            {
              id: 'proof',
              key: 'proof',
              type: 'attachment',
              label: '证明材料',
              maxCount: 2,
              accept: ['application/pdf'],
            },
          ],
        },
      },
    }
    const checked = vi.fn(() => Effect.succeed({}))
    await open({
      listItems: () => Effect.succeed({ items: [withProof], capabilities: { canManage: false } }),
      // the ticket is held until the test lets go; then the round says no
      prepareAttachmentUpload: () =>
        Effect.flatMap(
          Effect.promise(() => held),
          () => Effect.fail(apiError('ASSESSMENT_ENTRY_ACTION_REFUSED', { reason: 'other' })),
        ),
      previewAdministrativeRecord: checked,
    })
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    const { userEvent } = await import('vitest/browser')
    await choosePerson('周予安')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    await recognitionChoice('rec-level').pick('国家级')
    await userEvent.fill(page.getByLabelText('认定理由').element(), '校运会秩序册第 3 页')
    const next = page.getByTestId('record-step-next')
    await expect.element(next).toBeEnabled()

    await userEvent.upload(
      document.querySelector<HTMLInputElement>('input[type="file"]')!,
      new File(['%PDF'], 'certificate.pdf', { type: 'application/pdf' }),
    )
    await expect.element(next).toBeDisabled()
    release!()
    await expect.element(next).toBeEnabled()
    expect(checked).not.toHaveBeenCalled()
  })

  it('starts a clean sheet on another question', async () => {
    await open({})
    await waitForItems()
    await chooseItem('竞赛获奖登记')
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="record-recognition"]') === null)
        throw new Error('no recognition section yet')
    })
    const recognition = recognitionChoice('rec-level')
    await recognition.pick('国家级')
    // switching questions is a new contract: the touched draft dies with
    // the old one instead of leaking into it
    await chooseItem('荣誉称号登记')
    await vi.waitFor(() => {
      if (recognition.said().includes('国家级')) throw new Error('old draft still standing')
    })
  })
})
