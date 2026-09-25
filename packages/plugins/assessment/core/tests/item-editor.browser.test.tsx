import ItemSettingsPage from '../src/client/items/ItemSettingsPage.tsx'
import { lazy } from 'react'
import { useNavigate } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The question editor as its author works it: handling chosen in the open,
// the arithmetic's parameters fed from fixed values or determinations, a
// determination linked to the form field that starts it, and a list of
// what is still unfinished that the save button walks through before it
// ever sends anything.

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PAPER_ID = '22222222-2222-4222-8222-222222222222'
const ORG_TYPE_ID = '33333333-3333-4333-8333-333333333333'
const ROLE_ID = '44444444-4444-4444-8444-444444444444'
const SECTION_ID = '55555555-5555-4555-8555-555555555555'
const ITEM_ID = '66666666-6666-4666-8666-666666666666'
const REVISION_ID = '77777777-7777-4777-8777-777777777777'
const FORMULA_VERSION_ID = '01920000-0000-7000-8000-0000000000f1'
const RECOGNITION_ID = '01920000-0000-7000-8000-0000000000f2'

const PAGES = [{ id: 'assessment/batch-items', path: '/assessment/batches/:batchId/items' }].map(
  (entry) => ({ ...entry, layout: 'admin' }),
)

const batch = () => ({
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
})

const paper = {
  id: PAPER_ID,
  parentGroupId: null,
  name: '综合素质测评',
  cap: null,
  floor: null,
  sortOrder: 0,
  itemCount: 0,
}

/** a saved question scored by a fixed amount, with one finished review step */
const officerItem = () => ({
  id: ITEM_ID,
  batchId: BATCH_ID,
  itemType: 'evidence',
  title: '学生干部任职',
  scoreGroupId: SECTION_ID,
  maxEntries: 5,
  sortOrder: 0,
  status: 'active',
  voidReason: null,
  currentRevision: {
    id: REVISION_ID,
    revisionNo: 1,
    entryChannels: ['participant'],
    formConfig: {
      files: {},
      fields: [{ id: 'claimed-level', key: 'claimed-level', label: '获奖级别', type: 'text' }],
    },
    scoringConfig: {
      calculator: { ref: 'fixed@1', config: { value: '2.00' } },
      aggregator: { ref: 'max@1', config: {} },
    },
    reviewPolicy: {
      normal: {
        stages: [
          {
            id: 's-first',
            label: '班委初审',
            selector: { kind: 'roleAt', nodeTypeId: ORG_TYPE_ID, roleIds: [ROLE_ID] },
            quorum: { type: 'any' },
          },
        ],
      },
      escalation: { stages: [] },
    },
    displayConfig: {},
    reason: null,
    createdAt: '2026-02-01T00:00:00.000Z',
  },
  createdAt: '2026-02-01T00:00:00.000Z',
})

/** the same question with the escalation step a staff record's appeals are heard on */
const officerWithAppeals = () => {
  const officer = officerItem()
  return {
    ...officer,
    currentRevision: {
      ...officer.currentRevision,
      reviewPolicy: {
        ...officer.currentRevision.reviewPolicy,
        escalation: {
          stages: [
            {
              id: 's-appeal',
              label: '学院复核',
              selector: { kind: 'roleAt', nodeTypeId: ORG_TYPE_ID, roleIds: [ROLE_ID] },
              quorum: { type: 'any' },
            },
          ],
        },
      },
    },
  }
}

/** the decimal the formula's parameter takes */
const GRADE = {
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': 1,
  'x-qualy-minimum': '60',
  'x-qualy-maximum': '100',
}

const LEVEL = {
  type: 'string',
  enum: ['school', 'city', 'province'],
  'x-qualy-enumLabels': { school: '校级', city: '市级', province: '省级' },
}

/** a saved question scored by a published formula: one graded determination, seeded by a field */
const formulaItem = (
  over: {
    defaultFromFieldId?: string | null
    bindings?: Record<string, unknown>
    reviewPolicy?: unknown
    entryChannels?: string[]
  } = {},
) => ({
  ...officerItem(),
  title: '竞赛获奖',
  currentRevision: {
    ...officerItem().currentRevision,
    ...(over.entryChannels === undefined ? {} : { entryChannels: over.entryChannels }),
    ...(over.reviewPolicy === undefined ? {} : { reviewPolicy: over.reviewPolicy }),
    scoringConfig: {
      version: 2,
      calculator: { ref: 'formula@1', config: { versionId: FORMULA_VERSION_ID } },
      aggregator: { ref: 'max@1', config: {} },
      recognitions: {
        [RECOGNITION_ID]: {
          label: '认定级别',
          refinement: { ...GRADE },
          defaultFromFieldId:
            over.defaultFromFieldId === undefined ? 'claimed-level' : over.defaultFromFieldId,
        },
      },
      bindings: {
        level: { kind: 'recognition', recognitionId: RECOGNITION_ID },
        ...over.bindings,
      },
    },
  },
})

const CALCULATOR_SURFACES = {
  collections: {
    'assessment/calculator-authoring-options': [
      {
        id: 'assessment/fixed-calculator',
        ref: 'fixed@1',
        label: {
          kind: 'message',
          id: 'assessment/items/calculator-fixed',
          defaultMessage: 'Fixed',
        },
        order: 10,
      },
    ],
  },
  slots: {
    'assessment/calculator-editor': [{ id: 'assessment/fixed-calculator-editor', order: 10 }],
  },
}

/** as the formula plugin contributes it: its editor confirms the choice itself */
const BOTH_CALCULATORS_CONFIRMING = {
  collections: {
    'assessment/calculator-authoring-options': [
      ...CALCULATOR_SURFACES.collections['assessment/calculator-authoring-options'],
      {
        id: 'assessment-formula/calculator',
        ref: 'formula@1',
        label: {
          kind: 'message',
          id: 'assessment-formula/binding/calculator',
          defaultMessage: 'A published formula',
        },
        order: 20,
        confirms: 'itself',
      },
    ],
  },
  slots: {
    'assessment/calculator-editor': [
      ...CALCULATOR_SURFACES.slots['assessment/calculator-editor'],
      { id: 'assessment-formula/calculator-editor', order: 20 },
    ],
  },
}

const BOTH_CALCULATORS = {
  collections: {
    'assessment/calculator-authoring-options': [
      ...CALCULATOR_SURFACES.collections['assessment/calculator-authoring-options'],
      {
        id: 'assessment-formula/calculator',
        ref: 'formula@1',
        label: {
          kind: 'message',
          id: 'assessment-formula/binding/calculator',
          defaultMessage: 'A published formula',
        },
        order: 20,
      },
    ],
  },
  slots: {
    'assessment/calculator-editor': [
      ...CALCULATOR_SURFACES.slots['assessment/calculator-editor'],
      { id: 'assessment-formula/calculator-editor', order: 20 },
    ],
  },
}

/** what the server answers about a candidate's arithmetic */
const previewFor = (ref: string, over: { parameters?: Record<string, unknown> } = {}) => ({
  calculator: { ref, contractHash: 'contract-1' },
  inputSchema:
    ref === 'formula@1'
      ? {
          type: 'object',
          properties: over.parameters ?? { level: { ...GRADE, title: '等级分' } },
          required: Object.keys(over.parameters ?? { level: 0 }),
          additionalProperties: false,
        }
      : { type: 'object', properties: {}, required: [], additionalProperties: false },
  outputSchema: { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2 },
  form: { valid: true, issues: [] },
  bindableFields: [],
})

const bindingOptions = () => ({
  items: [],
  nextCursor: null,
  current: {
    versionId: FORMULA_VERSION_ID,
    functionId: '01920000-0000-7000-8000-0000000000e1',
    functionName: '竞赛加分',
    versionNo: 3,
    publishedAt: '2026-01-01T00:00:00.000Z',
    parameters: ['level'],
    bindableForNew: false,
  },
})

/** a minted determination id, the way the server hands one back */
const MINTED_ID = '01920000-0000-7000-8000-0000000000f9'

/**
 * A save as the server answers it: the question as stored, with the pen's
 * draft language for the arithmetic settled into its stored shape - handles
 * dropped, a determination without an id given one.
 */
const storedAfter = (
  base: Record<string, any>,
  payload: {
    title?: string
    scoreGroupId?: string
    maxEntries?: number | null
    config?: Record<string, any>
  },
) => {
  const scoring = payload.config?.['scoringConfig'] as Record<string, any> | undefined
  const settled =
    scoring !== undefined && Array.isArray(scoring['recognitions'])
      ? (() => {
          const drafted = scoring['recognitions'] as Record<string, any>[]
          const idOf = new Map(drafted.map((one) => [one['handle'], one['id'] ?? MINTED_ID]))
          return {
            ...scoring,
            recognitions: Object.fromEntries(
              drafted.map((one) => [
                idOf.get(one['handle']),
                {
                  label: one['label'],
                  refinement: one['refinement'],
                  defaultFromFieldId: one['defaultFromFieldId'],
                },
              ]),
            ),
            bindings: Object.fromEntries(
              Object.entries(scoring['bindings'] as Record<string, Record<string, any>>).map(
                ([parameter, binding]) => [
                  parameter,
                  binding['kind'] === 'recognition'
                    ? { kind: 'recognition', recognitionId: idOf.get(binding['handle']) }
                    : binding,
                ],
              ),
            ),
          }
        })()
      : scoring
  return {
    ...base,
    ...(payload.title === undefined ? {} : { title: payload.title }),
    ...(payload.scoreGroupId === undefined ? {} : { scoreGroupId: payload.scoreGroupId }),
    ...(payload.maxEntries === undefined ? {} : { maxEntries: payload.maxEntries }),
    currentRevision:
      payload.config === undefined
        ? base['currentRevision']
        : {
            ...base['currentRevision'],
            ...payload.config,
            ...(settled === undefined ? {} : { scoringConfig: settled }),
          },
  }
}

const open = (
  had: {
    items?: readonly unknown[]
    saved?: { config?: unknown; itemType?: unknown }[]
    question?: string
    panel?: string
    surfaces?: { collections: Record<string, unknown[]>; slots: Record<string, unknown[]> }
    preview?: unknown
    /** what the formula plugin offers this round to bind */
    formulas?: unknown
    /** what the live reading finds, asked of each composition as it settles */
    check?: (payload: { config: unknown }) => readonly {
      path: string
      reason: string
      handle?: string
      count?: number
      values?: readonly string[]
    }[]
    /** what already stands determined under the question's determinations */
    standing?: readonly unknown[]
    /** what a save is answered with instead of being taken, one answer per press */
    refuse?: unknown[]
    /** every question a write was asked of, in the order asked */
    touched?: string[]
    /** the sections of the paper, when a case needs more than the root */
    groups?: readonly unknown[]
    /** every tree a section save was asked to store */
    regrouped?: unknown[]
    /** held until it settles: a save's answer does not arrive before it */
    answerAfter?: Promise<void>
    /** a press that does what the browser's back button does */
    withBack?: boolean
  } = {},
) => {
  // what the server holds, so a save is read back as it was stored
  const holding = [...((had.items ?? []) as Record<string, any>[])]
  return renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: PAGES,
            ...(had.surfaces ?? CALCULATOR_SURFACES),
          }),
      },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: had.groups ?? [paper],
            version: 1,
            capabilities: { canManage: true },
          }),
        replaceScoreGroups: (call: { payload: unknown }) => {
          had.regrouped?.push(call.payload)
          return Effect.succeed({ groups: had.groups ?? [paper], version: 2 })
        },
        listItems: () => Effect.succeed({ items: holding, capabilities: { canManage: true } }),
        itemOptions: () =>
          Effect.succeed({
            orgTypes: [{ id: ORG_TYPE_ID, code: 'class', name: '班级' }],
            roles: [{ id: ROLE_ID, name: '审核员' }],
          }),
        reviewAlerts: () => Effect.succeed({ groups: [] }),
        reviewCoverage: () => Effect.succeed({ nodes: [] }),
        createItem: (call: { payload: { config?: unknown; itemType?: unknown } }) => {
          const refusal = had.refuse?.shift()
          if (refusal !== undefined) return Effect.fail(refusal)
          had.saved?.push(call.payload)
          return Effect.succeed({ item: { id: ITEM_ID } })
        },
        updateItem: (call: {
          params: { itemId: string }
          payload: { config?: Record<string, any>; itemType?: unknown }
        }) => {
          had.touched?.push(call.params.itemId)
          const refusal = had.refuse?.shift()
          if (refusal !== undefined) return Effect.fail(refusal)
          const at = holding.findIndex((one) => one['id'] === call.params.itemId)
          // as the server has it: nothing about a voided question is written
          if (holding[at]?.['status'] === 'voided') {
            return Effect.fail(
              apiError('ASSESSMENT_ITEM_CONFIG_INVALID', {
                issues: [{ path: 'item', reason: 'item-voided' }],
              }),
            )
          }
          had.saved?.push(call.payload)
          const stored = storedAfter(at === -1 ? { id: call.params.itemId } : holding[at]!, {
            ...call.payload,
          })
          if (at !== -1) holding[at] = stored
          return had.answerAfter === undefined
            ? Effect.succeed({ item: stored })
            : Effect.promise(() => had.answerAfter!).pipe(Effect.as({ item: stored }))
        },
        checkItem: (call: { payload: { config: unknown } }) =>
          Effect.succeed({ issues: had.check?.(call.payload) ?? [], standing: had.standing ?? [] }),
        previewScoring: (call: { payload: { calculator: { ref: string } } }) =>
          Effect.succeed(had.preview ?? previewFor(call.payload.calculator.ref)),
      },
      assessmentFormula: {
        listFormulaBindingOptions: () => Effect.succeed(had.formulas ?? bindingOptions()),
      },
    }),
    routes: [
      {
        path: '/assessment/batches/:batchId/items',
        element: (
          <>
            <ItemSettingsPage />
            {had.withBack === true && <BrowserBack />}
          </>
        ),
      },
    ] as never,
    registry: {
      slots: {
        'assessment/calculator-editor': {
          'assessment/fixed-calculator-editor': lazy(
            () => (() => import('../src/client/items/FixedCalculatorEditor.tsx'))() as never,
          ),
          'assessment-formula/calculator-editor': lazy(
            () =>
              (() => import('@qualy/plugin-assessment-formula/client/CalculatorEditor'))() as never,
          ),
        },
      },
    },
    route:
      had.question === undefined
        ? `/assessment/batches/${BATCH_ID}/items`
        : `/assessment/batches/${BATCH_ID}/items?question=${had.question}${had.panel === undefined ? '' : `&panel=${had.panel}`}`,
  })
}

const editor = () => page.getByTestId('item-editor')

/**
 * The browser's back button, as the router hears it. The harness routes in
 * memory, so the press goes to the router itself; what the page sees is the
 * same pop of the address a real back press is.
 */
function BrowserBack() {
  const navigate = useNavigate()
  return (
    <button type="button" data-testid="browser-back" onClick={() => void navigate(-1)}>
      back
    </button>
  )
}

/** into the editor of a question being composed */
const composeQuestion = async () => {
  await open()
  await page.getByRole('button', { name: '新建' }).click()
  await page.getByRole('menuitem', { name: '新建项目' }).click()
  await expect.element(editor()).toBeVisible()
}

const tab = (name: RegExp) => page.getByRole('tab', { name })

/** the one element a data attribute names, once it is on screen */
const seat = async (selector: string) => {
  await vi.waitFor(() => {
    if (document.querySelector(selector) === null)
      throw new Error(`${selector} is not on screen yet`)
  })
  return page.elementLocator(document.querySelector<HTMLElement>(selector)!)
}

const parameterRow = (parameter: string) => seat(`[data-parameter-row="${parameter}"]`)
const linkedRows = () =>
  document.querySelectorAll('[data-testid="form-field-row"][data-linked="true"]')

const chooseSource = async (parameter: string, option: string) => {
  const row = await parameterRow(parameter)
  await row.getByRole('combobox').click()
  await page.getByRole('option', { name: option }).click()
}

describe('choosing how a question is handled', () => {
  it('opens a new question on review, with participants filing, and the rules tab in place', async () => {
    await composeQuestion()
    await expect.element(editor()).toHaveAttribute('data-mode', 'review')
    await expect
      .element(page.getByRole('radio', { name: '审核后生效' }))
      .toHaveAttribute('aria-checked', 'true')
    await expect
      .element(page.getByRole('checkbox', { name: '参评人员申报' }))
      .toHaveAttribute('aria-checked', 'true')
    await expect
      .element(page.getByRole('checkbox', { name: '工作人员统一认定' }))
      .toHaveAttribute('aria-checked', 'false')
    await expect.element(tab(/记录与审核/)).toBeVisible()
  })

  it('folds the entry doors and the rules tab away under automatic scoring', async () => {
    await composeQuestion()
    await page.getByRole('radio', { name: '自动计分' }).click()
    await expect.element(editor()).toHaveAttribute('data-mode', 'automatic')
    expect(document.querySelector('[data-testid="channel-cards"]')).toBeNull()
    expect(page.getByRole('tab', { name: /记录与审核/ }).elements()).toHaveLength(0)
    await expect.element(tab(/^计分/)).toBeVisible()
  })

  it('refuses to open both doors shut, and says so in the pending list', async () => {
    await composeQuestion()
    await page.getByRole('checkbox', { name: '参评人员申报' }).click()
    const trigger = page.getByTestId('pending-trigger')
    await expect.element(trigger).toBeVisible()
    await trigger.click()
    await expect.element(page.getByTestId('pending-list')).toBeVisible()
    expect(
      page
        .getByTestId('pending-row')
        .elements()
        .map((row) => row.getAttribute('data-code')),
    ).toContain('channels-required')
  })

  // A recorded fact is contested on the escalation route alone, so opening
  // the staff door on a question with no escalation step leaves it pending.
  it('asks for an escalation step before staff records are opened', async () => {
    await open({ items: [officerItem()], question: ITEM_ID })
    await expect.element(page.getByRole('checkbox', { name: '工作人员统一认定' })).toBeVisible()
    await page.getByRole('checkbox', { name: '工作人员统一认定' }).click()
    const trigger = page.getByTestId('pending-trigger')
    await expect.element(trigger).toBeVisible()
    await trigger.click()
    await expect.element(page.getByTestId('pending-list')).toBeVisible()
    expect(
      page
        .getByTestId('pending-row')
        .elements()
        .map((row) => row.getAttribute('data-code')),
    ).toContain('escalation-required')
  })

  it('saves both doors when both are open', async () => {
    const saved: { config?: unknown }[] = []
    await open({ items: [officerWithAppeals()], question: ITEM_ID, saved })
    await expect.element(page.getByRole('checkbox', { name: '工作人员统一认定' })).toBeVisible()
    await page.getByRole('checkbox', { name: '工作人员统一认定' }).click()
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect((saved[0]!.config as { entryChannels: string[] }).entryChannels).toEqual([
      'participant',
      'administrative',
    ])
  })

  it('asks before the way back throws away what was not saved', async () => {
    await open({ items: [officerItem()], question: ITEM_ID })
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')

    await page.getByTestId('item-back').click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeVisible()
    await asked.getByRole('button', { name: '取消' }).click()
    await expect.element(editor()).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: '项目名称' }))
      .toHaveValue('学生干部任职（改）')

    await page.getByTestId('item-back').click()
    await page.getByRole('alertdialog').getByTestId('confirm-accept').click()
    await vi.waitFor(() => expect(document.querySelector('[data-testid="item-editor"]')).toBeNull())
  })

  it('holds a question with unsaved changes when the browser goes back', async () => {
    // filed straight under the paper, so the structure lists it
    await open({ items: [{ ...officerItem(), scoreGroupId: PAPER_ID }], withBack: true })
    await vi.waitFor(() =>
      expect(page.getByText('学生干部任职').elements().length).toBeGreaterThan(0),
    )
    // the row in the seat this width shows
    await userEvent.click(
      page
        .getByText('学生干部任职')
        .elements()
        .find((one) => (one as HTMLElement).checkVisibility())!,
    )
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
    expect(addressNow()).toContain(`question=${ITEM_ID}`)
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')

    // the address has gone back; the question has not, until the reader says so
    await page.getByTestId('browser-back').click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeVisible()
    await expect.element(editor()).toBeVisible()
    await asked.getByRole('button', { name: '取消' }).click()
    await vi.waitFor(() => expect(addressNow()).toContain(`question=${ITEM_ID}`))
    await expect
      .element(page.getByRole('textbox', { name: '项目名称' }))
      .toHaveValue('学生干部任职（改）')

    await page.getByTestId('browser-back').click()
    await page.getByRole('alertdialog').getByTestId('confirm-accept').click()
    await vi.waitFor(() => expect(document.querySelector('[data-testid="item-editor"]')).toBeNull())
    expect(addressNow()).not.toContain('question=')
  })

  it('leaves at once when nothing was changed', async () => {
    await open({ items: [officerItem()], question: ITEM_ID })
    await expect.element(editor()).toBeVisible()
    await page.getByTestId('item-back').click()
    await vi.waitFor(() => expect(document.querySelector('[data-testid="item-editor"]')).toBeNull())
    expect(page.getByRole('alertdialog').elements()).toHaveLength(0)
  })

  it('lets a blank new question go at once, and asks once something is written in it', async () => {
    await composeQuestion()
    await page.getByTestId('item-back').click()
    await vi.waitFor(() => expect(document.querySelector('[data-testid="item-editor"]')).toBeNull())
    expect(page.getByRole('alertdialog').elements()).toHaveLength(0)

    await page.getByRole('button', { name: '新建' }).click()
    await page.getByRole('menuitem', { name: '新建项目' }).click()
    await expect.element(editor()).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('志愿服务')
    await page.getByTestId('item-back').click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
  })

  it('names only the plain facts changed here, so a rename made elsewhere stands', async () => {
    const saved: Record<string, unknown>[] = []
    await open({ items: [officerWithAppeals()], question: ITEM_ID, saved })
    await expect.element(page.getByRole('checkbox', { name: '工作人员统一认定' })).toBeVisible()
    await page.getByRole('checkbox', { name: '工作人员统一认定' }).click()
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(Object.keys(saved[0]!)).not.toContain('title')
    expect(Object.keys(saved[0]!)).not.toContain('scoreGroupId')
    expect(Object.keys(saved[0]!)).not.toContain('maxEntries')

    // a title changed here is named
    await tab(/基本信息/).click()
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(2))
    expect(saved[1]).toMatchObject({ title: '学生干部任职（改）' })
    expect(Object.keys(saved[1]!)).not.toContain('scoreGroupId')
  })
})

describe('feeding the arithmetic', () => {
  it('lists the parameters, and a determined one becomes a determination field', async () => {
    await open({
      items: [formulaItem({ defaultFromFieldId: null })],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
    })
    await expect.element(await parameterRow('level')).toHaveAttribute('data-source', 'recognition')
    const recognition = page.getByTestId('recognition-row')
    await expect.element(recognition).toBeVisible()
    await expect.element(recognition).toHaveAttribute('data-linked', 'false')

    // a fixed value instead: the determination leaves, and a box for the value arrives
    await chooseSource('level', '固定值')
    await expect.element(await parameterRow('level')).toHaveAttribute('data-source', 'constant')
    await expect.element((await parameterRow('level')).getByTestId('parameter-value')).toBeVisible()
    expect(page.getByTestId('recognition-row').elements()).toHaveLength(0)
  })

  it('links a new submission field to a determination, and unlinks it back into a field of its own', async () => {
    const saved: { config?: unknown }[] = []
    await open({
      items: [formulaItem({ defaultFromFieldId: null })],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
      saved,
    })
    await expect.element(page.getByTestId('recognition-row')).toBeVisible()
    await page.getByTestId('recognition-row').click()
    const sheet = page.getByTestId('recognition-sheet')
    await expect.element(sheet).toBeVisible()
    await sheet.getByRole('button', { name: '新增申报字段并关联' }).click()
    await expect
      .element(sheet.getByTestId('recognition-link'))
      .toHaveAttribute('data-linked', 'true')
    await sheet.getByRole('button', { name: '完成' }).click()

    // the form now carries the filing side, marked as such and required
    const linked = await seat('[data-testid="form-field-row"][data-linked="true"]')
    await expect.element(linked).toHaveAttribute('data-required', 'true')
    await expect.element(page.getByTestId('recognition-row')).toHaveAttribute('data-linked', 'true')

    // saved, the field wears the determination's own bounds and the determination names it
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    const config = saved[0]?.config as {
      formConfig: { fields: { id: string; type: string; label: string; required?: boolean }[] }
      scoringConfig: { recognitions: { id?: string; defaultFromFieldId: string | null }[] }
    }
    const field = config.formConfig.fields.find((one) => one.type === 'decimal')
    expect(field).toMatchObject({ label: '认定级别', required: true })
    expect(config.scoringConfig.recognitions[0]).toMatchObject({
      id: RECOGNITION_ID,
      defaultFromFieldId: field?.id,
    })

    // and unlinking leaves it on the form as a field of its own
    await page.getByTestId('recognition-row').click()
    await sheet.getByRole('button', { name: '解除关联' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '解除关联' }).click()
    await expect
      .element(sheet.getByTestId('recognition-link'))
      .toHaveAttribute('data-linked', 'false')
    await sheet.getByRole('button', { name: '完成' }).click()
    await vi.waitFor(() => expect(linkedRows()).toHaveLength(0))
    expect(page.getByTestId('form-field-row').elements()).toHaveLength(2)
  })

  it('takes on what the save stored, so a second save keeps the minted determination', async () => {
    const saved: { config?: unknown }[] = []
    await open({
      items: [formulaItem({ defaultFromFieldId: null })],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
      saved,
    })
    // a determination of its own, made here: the server mints its id
    await chooseSource('level', '固定值')
    await chooseSource('level', '认定值')
    await expect.element(page.getByTestId('recognition-row')).toBeVisible()
    await expect.element(page.getByTestId('item-unsaved')).toBeVisible()
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))

    // saved is saved: nothing is left over for the pane to call unsaved
    await vi.waitFor(() => expect(page.getByTestId('item-unsaved').elements()).toHaveLength(0))

    // and the next save names the determination the first one minted
    await tab(/基本信息/).click()
    await page.getByLabelText('项目名称').fill('竞赛获奖（校级以上）')
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(2))
    const second = saved[1]!.config as { scoringConfig: unknown }
    expect(JSON.stringify(second.scoringConfig)).toContain(MINTED_ID)
  })

  it('keeps the minted determination when the question moved while its save was out', async () => {
    const saved: { config?: unknown }[] = []
    let answer = () => {}
    const answered = new Promise<void>((settle) => {
      answer = settle
    })
    await open({
      items: [formulaItem({ defaultFromFieldId: null })],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
      saved,
      answerAfter: answered,
    })
    await chooseSource('level', '固定值')
    await chooseSource('level', '认定值')
    await expect.element(page.getByTestId('recognition-row')).toBeVisible()
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))

    // written while the save is out, so the answer meets a composition that
    // is no longer the one it was asked about
    await tab(/基本信息/).click()
    await page.getByLabelText('项目名称').fill('竞赛获奖（校级以上）')
    await expect.element(page.getByTestId('item-save')).toBeDisabled()
    answer()
    await expect.element(page.getByTestId('item-save')).toBeEnabled()

    // what was typed stays, and the next save names the determination the
    // first one minted instead of creating another
    await expect.element(page.getByLabelText('项目名称')).toHaveValue('竞赛获奖（校级以上）')
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(2))
    const second = saved[1]!.config as { scoringConfig: unknown }
    expect(JSON.stringify(second.scoringConfig)).toContain(MINTED_ID)
  })

  it('asks before switching to take effect on submission while a determination has no field', async () => {
    await open({
      items: [formulaItem({ defaultFromFieldId: null })],
      question: ITEM_ID,
      surfaces: BOTH_CALCULATORS,
    })
    await expect.element(page.getByRole('radio', { name: '提交即生效' })).toBeVisible()
    // the contract has to be in hand for the editor to know what is unlinked
    await vi.waitFor(() => {
      if (
        document.querySelector('[data-testid="pending-trigger"], [data-testid="pending-none"]') ===
        null
      )
        throw new Error('not settled')
    })
    await page.getByRole('radio', { name: '提交即生效' }).click()
    const dialog = page.getByRole('alertdialog')
    await expect.element(dialog).toBeVisible()
    await dialog.getByRole('button', { name: '新增并切换' }).click()
    await expect.element(editor()).toHaveAttribute('data-mode', 'direct')
    await tab(/表单与计分/).click()
    // no determination list under direct handling; the field carries the parameter
    expect(document.querySelector('[data-testid="scoring-recognitions"]')).toBeNull()
    await vi.waitFor(() => expect(linkedRows()).toHaveLength(1))
    await expect.element(await parameterRow('level')).toHaveAttribute('data-source', 'recognition')
  })

  it('blocks automatic scoring while a parameter takes a determined value', async () => {
    await open({ items: [formulaItem()], question: ITEM_ID, surfaces: BOTH_CALCULATORS })
    await expect.element(page.getByRole('radio', { name: '自动计分' })).toBeVisible()
    await vi.waitFor(() => {
      if (
        document.querySelector('[data-testid="pending-trigger"], [data-testid="pending-none"]') ===
        null
      )
        throw new Error('not settled')
    })
    // a saved question's kind is settled: the card is locked
    await expect.element(page.getByRole('radio', { name: '自动计分' })).toBeDisabled()
    // and a greyed card is never left unexplained
    await page.getByTestId('mode-locked').hover()
    await expect.element(page.getByRole('tooltip')).toBeVisible()
  })
})

describe('the submission form', () => {
  it('adds a choice field through the dialog, and holds the door on a blank option', async () => {
    await composeQuestion()
    await tab(/表单与计分/).click()
    await page.getByRole('button', { name: '添加字段' }).click()
    await expect.element(page.getByTestId('add-field-types')).toBeVisible()
    await (await seat('[data-field-type="choice"]')).click()
    await expect.element(page.getByTestId('add-field-settings')).toBeVisible()
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('textbox', { name: '名称' }).fill('赛事级别')
    await dialog.getByRole('button', { name: '添加选项' }).click()
    // a blank option holds the add key shut
    await expect.element(dialog.getByRole('button', { name: '添加', exact: true })).toBeDisabled()
    await dialog.getByRole('textbox', { name: '选项名称' }).fill('校级赛事')
    await expect.element(dialog.getByRole('button', { name: '添加', exact: true })).toBeEnabled()
    await dialog.getByRole('button', { name: '添加', exact: true }).click()
    const row = page.getByTestId('form-field-row')
    await expect.element(row).toBeVisible()
    await expect.element(row).toHaveAttribute('data-required', 'false')
  })

  it('hands a sub-megabyte file ceiling back exactly as it arrived', async () => {
    const saved: { config?: unknown }[] = []
    const item = officerItem()
    item.currentRevision.formConfig = {
      files: {},
      fields: [
        {
          id: 'proof',
          key: 'proof',
          label: '证明材料',
          type: 'attachment',
          maxCount: 2,
          maxFileBytes: 512 * 1024,
        },
      ],
    } as never
    await open({ items: [item], question: ITEM_ID, saved })
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    const fields = (saved[0]!.config as { formConfig: { fields: { maxFileBytes?: number }[] } })
      .formConfig.fields
    expect(fields[0]?.maxFileBytes).toBe(512 * 1024)
  })

  it('says a file limit the api will not take is wrong on the field, not at the save', async () => {
    const saved: { config?: unknown }[] = []
    const item = officerItem()
    item.currentRevision.formConfig = {
      files: {},
      fields: [{ id: 'proof', key: 'proof', label: '证明材料', type: 'attachment', maxCount: 2 }],
    } as never
    await open({ items: [item], question: ITEM_ID, panel: 'scoring', saved })
    await page.getByTestId('form-field-row').click()
    const sheet = page.getByTestId('field-sheet')
    await sheet.getByRole('textbox', { name: '最多上传文件数' }).fill('2.5')
    await sheet.getByRole('button', { name: '完成' }).click()

    await expect.element(page.getByTestId('form-field-row')).toHaveAttribute('data-invalid', 'true')
    await page.getByTestId('pending-trigger').click()
    expect(
      page
        .getByTestId('pending-row')
        .elements()
        .map((row) => row.getAttribute('data-code')),
    ).toContain('field-invalid')
    expect(saved).toHaveLength(0)

    // a fraction of a megabyte is a size like any other, sent as whole bytes
    await page.getByTestId('form-field-row').click()
    await sheet.getByRole('textbox', { name: '最多上传文件数' }).fill('3')
    await sheet.getByRole('textbox', { name: '单个文件上限（MB）' }).fill('0.3')
    await sheet.getByRole('button', { name: '完成' }).click()
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    const fields = (saved[0]!.config as { formConfig: { fields: { maxFileBytes?: number }[] } })
      .formConfig.fields
    expect(fields[0]?.maxFileBytes).toBe(Math.round(0.3 * 1024 * 1024))
  })

  it("returns a formula question's arithmetic exactly as it arrived when nothing about it moved", async () => {
    const saved: { config?: unknown }[] = []
    await open({ items: [formulaItem()], question: ITEM_ID, surfaces: BOTH_CALCULATORS, saved })
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('竞赛获奖（改）')
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect((saved[0]!.config as { scoringConfig: unknown }).scoringConfig).toEqual(
      formulaItem().currentRevision.scoringConfig,
    )
  })
})

describe('records and review', () => {
  it('counts the entries the folding rule keeps, not every entry that may be filed', async () => {
    await composeQuestion()
    await tab(/表单与计分/).click()
    await page.getByRole('textbox', { name: '每条通过计分' }).fill('2')
    await tab(/记录与审核/).click()
    await page.getByRole('textbox', { name: '每人可申报条数' }).fill('5')
    const ceiling = page.getByTestId('item-ceiling')
    await expect.element(ceiling).toHaveAttribute('data-ceiling', '10')
    await page.getByRole('radio', { name: '仅计最高一条' }).click()
    await expect.element(ceiling).toHaveAttribute('data-ceiling', '2')
    await page.getByRole('radio', { name: '计最高 N 条之和' }).click()
    await expect.element(ceiling).toHaveAttribute('data-ceiling', '4')
    // the number a choice asks for sits beside that choice, and only while it is the one chosen
    await expect.element(page.getByRole('textbox', { name: '条数' })).toBeVisible()
    await page.getByRole('radio', { name: '全部累加' }).click()
    expect(page.getByRole('textbox', { name: '条数' }).elements()).toHaveLength(0)
    // no limit is a choice with no number: the box goes rather than greying out
    await page.getByRole('radio', { name: '不限条数' }).click()
    expect(page.getByRole('textbox', { name: '每人可申报条数' }).elements()).toHaveLength(0)
    await expect.element(ceiling).toHaveAttribute('data-ceiling', 'unlimited')
    await page.getByRole('radio', { name: '限定条数' }).click()
    await expect.element(page.getByRole('textbox', { name: '每人可申报条数' })).toHaveValue('1')
  })

  it('composes a step in its panel, and lets it into the chain only once it is whole', async () => {
    await composeQuestion()
    await tab(/记录与审核/).click()
    const steps = () => page.getByTestId('chain-step').elements()
    expect(steps()).toHaveLength(0)
    const sheet = () => page.getByTestId('stage-sheet')
    const add = () => page.getByTestId('chain-normal').getByTestId('chain-add').click()

    // unnamed, with nobody to review: the press says what is missing under
    // each control, and the chain is left exactly as it was
    await add()
    await sheet().getByTestId('stage-apply').click()
    await vi.waitFor(() =>
      expect(
        page
          .getByTestId('stage-problem')
          .elements()
          .map((node) => node.getAttribute('data-about')),
      ).toEqual(['label', 'roles']),
    )
    expect(steps()).toHaveLength(0)

    await sheet().getByRole('textbox', { name: '步骤名称' }).fill('班委初审')
    await sheet().getByRole('checkbox', { name: '审核员' }).click()
    await sheet().getByTestId('stage-apply').click()
    await expect
      .element(page.getByTestId('chain-step').first())
      .toHaveAttribute('data-step-complete', 'true')

    // walking away from a half-composed step leaves nothing behind
    await add()
    await sheet().getByRole('textbox', { name: '步骤名称' }).fill('无人认领')
    await sheet().getByRole('button', { name: '取消' }).click()
    await vi.waitFor(() => expect(steps()).toHaveLength(1))
  })

  it("moves and removes a step from the step's own panel, and keeps the last one", async () => {
    const stageOf = (id: string, label: string) => ({
      id,
      label,
      selector: { kind: 'roleAt', nodeTypeId: ORG_TYPE_ID, roleIds: [ROLE_ID] },
      quorum: { type: 'any' },
    })
    const item = officerItem()
    item.currentRevision.reviewPolicy = {
      normal: { stages: [stageOf('s-first', '班委初审'), stageOf('s-second', '专业复审')] },
      escalation: { stages: [] },
    }
    await open({ items: [item], question: ITEM_ID, panel: 'rules' })
    const steps = () => page.getByTestId('chain-step').elements()
    const sheet = () => page.getByTestId('stage-sheet')
    await vi.waitFor(() => expect(steps()).toHaveLength(2))
    const titlesNow = () => steps().map((node) => node.textContent ?? '')
    expect(titlesNow()[0]).toContain('班委初审')

    await page.getByTestId('chain-step').first().click()
    await sheet().getByRole('button', { name: '后移' }).click()
    await vi.waitFor(() => expect(titlesNow()[0]).toContain('专业复审'))
    await sheet().getByRole('button', { name: '删除步骤' }).click()
    await vi.waitFor(() => expect(steps()).toHaveLength(1))
    // the ordinary route keeps one step: the last cannot be taken out
    await page.getByTestId('chain-step').first().click()
    await expect.element(sheet().getByRole('button', { name: '删除步骤' })).toBeDisabled()
  })

  it('says a round that holds as many questions as it can takes no new one', async () => {
    await open({
      refuse: [
        apiError('ASSESSMENT_ITEM_CONFIG_INVALID', {
          issues: [{ path: 'batch', reason: 'too-many-items' }],
        }),
      ],
    })
    await page.getByRole('button', { name: '新建' }).click()
    await page.getByRole('menuitem', { name: '新建项目' }).click()
    await expect.element(editor()).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('第二百零一项')
    await page.getByRole('radio', { name: '自动计分' }).click()
    await page.getByTestId('item-save').click()
    await expect.element(page.getByTestId('save-refused')).toHaveAttribute('data-kind', 'full')
    expect(document.querySelector('[data-testid="save-failure"]')).toBeNull()
  })

  it('walks the save to the first unfinished thing instead of sending', async () => {
    const saved: { config?: unknown; itemType?: unknown }[] = []
    await open({ saved })
    await page.getByRole('button', { name: '新建' }).click()
    await page.getByRole('menuitem', { name: '新建项目' }).click()
    await expect.element(editor()).toBeVisible()
    await tab(/记录与审核/).click()
    await page.getByTestId('item-save').click()
    // the title is the first thing missing, and it lives on the basics tab
    await expect.element(editor()).toHaveAttribute('data-panel', 'basics')
    expect(saved).toHaveLength(0)
  })
})

describe('saying what is wrong where it is wrong', () => {
  const SCORE = {
    ...GRADE,
    title: '等级分',
    description: '按获奖等级折算的基础分',
  }

  it('says what a parameter is under its name, and refuses a fixed value outside its range in place', async () => {
    await open({
      items: [formulaItem({ defaultFromFieldId: null })],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
      preview: previewFor('formula@1', { parameters: { level: SCORE } }),
    })
    const row = await parameterRow('level')
    await expect
      .element(row.getByTestId('row-description'))
      .toHaveTextContent('按获奖等级折算的基础分')

    await chooseSource('level', '固定值')
    const value = (await parameterRow('level')).getByRole('textbox')
    await value.fill('120')
    await expect
      .element(await parameterRow('level'))
      .toHaveAttribute('data-problem', 'constant-out-of-range')
    await expect.element(value).toHaveAttribute('aria-invalid', 'true')
    await expect.element(page.getByTestId('parameter-problem')).toBeVisible()
    // something set wrongly holds the save shut, and the tab and the capsule turn
    await expect.element(page.getByTestId('item-save')).toBeDisabled()
    await expect.element(tab(/表单与计分/)).toHaveAttribute('data-tone', 'error')
    await expect.element(page.getByTestId('pending-trigger')).toHaveAttribute('data-tone', 'error')

    await value.fill('85.5')
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="parameter-problem"]')).toBeNull(),
    )
    await expect.element(page.getByTestId('item-save')).toBeEnabled()
  })

  it('asks the server as the composition settles, and pins what it finds on the row it is about', async () => {
    const asked: unknown[] = []
    await open({
      items: [formulaItem({ defaultFromFieldId: null })],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
      check: (payload) => {
        asked.push(payload)
        return [
          {
            path: `scoringConfig.recognitions.${RECOGNITION_ID}`,
            reason: 'recognition-unattainable',
          },
        ]
      },
    })
    const recognition = page.getByTestId('recognition-row')
    await expect.element(recognition).toBeVisible()
    await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0))
    await expect.element(recognition).toHaveAttribute('data-invalid', 'true')
    await expect.element(recognition.getByTestId('row-problem')).toBeVisible()
    await expect.element(page.getByTestId('item-save')).toBeDisabled()
    // the list of what is left names it too, with the way there
    await page.getByTestId('pending-trigger').click()
    expect(
      page
        .getByTestId('pending-row')
        .elements()
        .map((node) => node.getAttribute('data-code')),
    ).toContain('recognition-unattainable')
  })

  it('lists what a refused save was refused for, and thins the list as each is corrected', async () => {
    const saved: { config?: unknown }[] = []
    let live: readonly { path: string; reason: string }[] = []
    await open({
      items: [officerItem()],
      question: ITEM_ID,
      saved,
      check: () => live,
      refuse: [
        apiError('ASSESSMENT_ITEM_CONFIG_INVALID', {
          issues: [{ path: 'formConfig.fields[0]', reason: 'field-duplicate' }],
        }),
      ],
    })
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')
    live = [{ path: 'formConfig.fields[0]', reason: 'field-duplicate' }]
    await page.getByTestId('item-save').click()

    const failure = page.getByTestId('save-failure')
    await expect.element(failure).toBeVisible()
    await expect.element(failure).toHaveAttribute('data-count', '1')
    await expect.element(page.getByTestId('pending-trigger')).toHaveAttribute('data-failed', 'true')
    // the refusal took the editor to the tab the fault is on, and to its row
    await expect.element(editor()).toHaveAttribute('data-panel', 'scoring')
    await expect.element(page.getByTestId('form-field-row')).toHaveAttribute('data-invalid', 'true')
    expect(saved).toHaveLength(0)

    // corrected: the next reading finds nothing, and the card goes with the fault
    live = []
    await page.getByTestId('form-field-row').click()
    const sheet = page.getByTestId('field-sheet')
    await sheet.getByRole('textbox', { name: '名称' }).fill('任职级别')
    await sheet.getByRole('button', { name: '完成' }).click()
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="save-failure"]')).toBeNull(),
    )
    await expect.element(page.getByTestId('item-save')).toBeEnabled()
  })

  it('says what happened when somebody else saved first, and offers both ways on', async () => {
    const saved: { expectedRevisionId?: unknown }[] = []
    await open({
      items: [officerItem()],
      question: ITEM_ID,
      saved: saved as never,
      refuse: [
        apiError('ASSESSMENT_ITEM_CONFIG_INVALID', {
          issues: [{ path: 'expectedRevisionId', reason: 'item-revision-conflict' }],
        }),
      ],
    })
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')
    await page.getByTestId('item-save').click()
    const notice = page.getByTestId('save-refused')
    await expect.element(notice).toHaveAttribute('data-kind', 'conflict')
    expect(document.querySelector('[data-testid="save-failure"]')).toBeNull()

    // saving over it sends what was composed here against the revision now held
    await notice.getByRole('button', { name: '覆盖保存' }).click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(saved[0]?.expectedRevisionId).toBe(REVISION_ID)
  })
})

describe('the form beside the arithmetic', () => {
  it('lets a linked field go by a name of its own, and says which field a determination starts from', async () => {
    const saved: { config?: unknown }[] = []
    await open({
      items: [formulaItem()],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
      saved,
    })
    const linked = await seat('[data-testid="form-field-row"][data-linked="true"]')
    await linked.click()
    const sheet = page.getByTestId('field-sheet')
    await sheet.getByRole('textbox', { name: '名称' }).fill('申报的获奖级别')
    await sheet.getByRole('button', { name: '完成' }).click()

    // the determination keeps its own name and names the field it starts from
    const recognition = page.getByTestId('recognition-row')
    await expect.element(recognition.getByText('认定级别', { exact: true })).toBeVisible()
    await expect
      .element(recognition.getByTestId('linked-field-name'))
      .toHaveTextContent('申报的获奖级别')

    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    const config = saved[0]?.config as {
      formConfig: { fields: { id: string; label: string }[] }
      scoringConfig: { recognitions: { label: string }[] | Record<string, { label: string }> }
    }
    expect(config.formConfig.fields.find((one) => one.id === 'claimed-level')?.label).toBe(
      '申报的获奖级别',
    )
    expect(JSON.stringify(config.scoringConfig.recognitions)).toContain('认定级别')
  })

  it('keeps what a record shows in lists on the page, under the form', async () => {
    await open({ items: [officerItem()], question: ITEM_ID, panel: 'scoring' })
    const block = page.getByTestId('summary-block')
    await expect.element(block).toBeVisible()
    expect(page.getByRole('dialog').elements()).toHaveLength(0)
    await expect
      .element(await seat('[data-testid="summary-block"] [data-custom]'))
      .toHaveAttribute('data-custom', 'false')
  })

  it('shows an empty choice list as one, not as a lone add link', async () => {
    await composeQuestion()
    await tab(/表单与计分/).click()
    await page.getByRole('button', { name: '添加字段' }).click()
    await (await seat('[data-field-type="choice"]')).click()
    await expect.element(page.getByTestId('options-empty')).toBeVisible()
    await page.getByTestId('options-empty').getByRole('button', { name: '添加选项' }).click()
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="options-empty"]')).toBeNull(),
    )
  })
})

describe('the band', () => {
  it('says where the question is and how it is handled, and leaves the handling to the cards', async () => {
    await open({
      items: [formulaItem({ defaultFromFieldId: null })],
      question: ITEM_ID,
      surfaces: BOTH_CALCULATORS,
    })
    await expect.element(page.getByTestId('item-back')).toBeVisible()
    await expect.element(page.getByTestId('item-meta')).toHaveAttribute('data-revision', '1')
    await expect.element(page.getByTestId('item-meta')).toHaveAttribute('data-standing', 'active')
    // the handling is said in the band, never changed from it
    const mode = page.getByTestId('item-mode')
    await expect.element(mode).toBeVisible()
    expect(mode.element().closest('button')).toBeNull()
    expect(mode.element().querySelector('svg')).toBeNull()
  })
})

describe('choosing a published formula', () => {
  const FUNCTION_ID = '01920000-0000-7000-8000-0000000000e1'
  const OTHER_FUNCTION_ID = '01920000-0000-7000-8000-0000000000e2'
  const NEWER_VERSION_ID = '01920000-0000-7000-8000-0000000000f3'
  const OTHER_VERSION_ID = '01920000-0000-7000-8000-0000000000f4'
  const contractOf = (properties: Record<string, unknown>) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  })
  const option = (over: Record<string, unknown>) => ({
    versionId: FORMULA_VERSION_ID,
    functionId: FUNCTION_ID,
    functionName: '竞赛加分',
    functionDescription: '按获奖等级折算',
    versionNo: 3,
    releaseName: null,
    releaseNotes: null,
    publishedAt: '2026-01-01T00:00:00.000Z',
    parameters: ['level'],
    inputSchema: contractOf({ level: { ...GRADE, title: '等级分' } }),
    ...over,
  })
  const formulas = () => ({
    items: [
      option({}),
      option({
        versionId: NEWER_VERSION_ID,
        versionNo: 4,
        releaseName: '2026 春季规则',
        releaseNotes: '新增团队折算',
        parameters: ['level', 'team'],
        inputSchema: contractOf({
          level: { ...GRADE, title: '等级分' },
          team: { type: 'boolean', title: '是否团队' },
        }),
      }),
      option({
        versionId: OTHER_VERSION_ID,
        functionId: OTHER_FUNCTION_ID,
        functionName: '志愿服务时长折算',
        functionDescription: '按小时数分段折算',
        versionNo: 1,
        parameters: ['hours'],
        inputSchema: contractOf({ hours: { type: 'integer', minimum: 0, title: '服务时长' } }),
      }),
    ],
    nextCursor: null,
    current: { ...option({}), bindableForNew: true },
  })

  it('asks which formula, then which of its publications, and changes nothing until the second is confirmed', async () => {
    const saved: { config?: unknown }[] = []
    await open({
      items: [formulaItem()],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS_CONFIRMING,
      formulas: formulas(),
      saved,
    })
    await page.getByTestId('scoring-method').getByRole('button', { name: '更换公式' }).click()
    const picker = page.getByTestId('formula-version-picker')
    await expect.element(picker).toHaveAttribute('data-step', 'formula')
    // one row per formula, however many times each was published
    await expect.element(page.getByTestId('formula-count')).toHaveAttribute('data-count', '2')
    const rows = () => page.getByTestId('formula-option').elements()
    expect(rows().map((row) => row.getAttribute('data-current'))).toEqual(['true', 'false'])
    // the frame offers no confirming button of its own beside the picker's
    expect(
      page.getByTestId('scoring-method-dialog').getByRole('button', { name: '使用' }).elements(),
    ).toHaveLength(0)

    await page.getByTestId('formula-option').first().click()
    await expect.element(picker).toHaveAttribute('data-step', 'version')
    const versions = () => page.getByTestId('formula-version-option').elements()
    // newest first, and the one in use is the one marked: confirming it would change nothing
    expect(versions().map((row) => row.getAttribute('data-version-id'))).toEqual([
      NEWER_VERSION_ID,
      FORMULA_VERSION_ID,
    ])
    expect(versions().map((row) => row.getAttribute('data-version-chosen'))).toEqual([
      'false',
      'true',
    ])
    await expect.element(page.getByTestId('formula-version-use')).toBeDisabled()

    await page.getByTestId('formula-version-option').first().click()
    await expect.element(page.getByTestId('formula-version-use')).toBeEnabled()
    await page.getByTestId('formula-version-use').click()
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="scoring-method-dialog"]')).toBeNull(),
    )

    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(
      (saved[0]!.config as { scoringConfig: { calculator: { config: { versionId: string } } } })
        .scoringConfig.calculator.config.versionId,
    ).toBe(NEWER_VERSION_ID)
  })

  it('narrows the formulas by what is typed, and says so when nothing is left', async () => {
    await open({
      items: [formulaItem()],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS_CONFIRMING,
      formulas: formulas(),
    })
    await page.getByTestId('scoring-method').getByRole('button', { name: '更换公式' }).click()
    await expect.element(page.getByTestId('formula-version-picker')).toBeVisible()
    await page.getByRole('searchbox').fill('志愿')
    await vi.waitFor(() => expect(page.getByTestId('formula-option').elements()).toHaveLength(1))
    await page.getByRole('searchbox').fill('不存在的公式')
    await expect
      .element(page.getByTestId('formula-picker-empty'))
      .toHaveAttribute('data-searching', 'true')
  })
})

describe('what a participant will see', () => {
  it('says whose each box is to fill, rather than showing it empty', async () => {
    await open({ items: [officerItem()], question: ITEM_ID })
    await expect.element(page.getByRole('button', { name: '预览' })).toBeVisible()
    await page.getByRole('button', { name: '预览' }).click()
    const controls = () => page.getByTestId('preview-control').elements()
    await vi.waitFor(() => expect(controls()).toHaveLength(1))
    expect(controls()[0]?.getAttribute('data-field-type')).toBe('text')
    expect((controls()[0]?.textContent ?? '').trim()).not.toBe('')
  })
})

describe('what already stands under a question', () => {
  /** a question whose determination is one of three levels, with claims already determined under it */
  const levelled = () => {
    const item = formulaItem({ defaultFromFieldId: null })
    ;(
      item.currentRevision.scoringConfig as {
        recognitions: Record<string, { refinement: unknown }>
      }
    ).recognitions[RECOGNITION_ID]!.refinement = { ...LEVEL }
    return item
  }
  const levelPreview = () =>
    previewFor('formula@1', { parameters: { level: { ...LEVEL, title: '获奖级别' } } })

  it('holds shut the options that claims were determined as, and says why on hover', async () => {
    await open({
      items: [levelled()],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
      preview: levelPreview(),
      standing: [
        { recognitionId: RECOGNITION_ID, records: 2, openRounds: 1, determined: ['province'] },
      ],
    })
    await page.getByTestId('recognition-row').click()
    const option = (value: string) =>
      seat(`[data-testid="recognition-option"][data-value="${value}"]`)
    // what somebody was determined as cannot be let go of: its seat holds
    // the lock that says why, rather than a box that refuses every press
    expect((await option('province')).getByRole('checkbox').elements()).toHaveLength(0)
    await expect
      .element(
        (await option('province')).getByRole('img', { name: '已有记录认定为该选项，不能取消' }),
      )
      .toBeVisible()
    // a round still open holds nothing: it is stopped at its own decision
    await expect.element((await option('city')).getByRole('checkbox')).toBeEnabled()
    // nothing stands on this one, so it is the administrator's to narrow away
    await expect.element((await option('school')).getByRole('checkbox')).toBeEnabled()
    expect(
      page
        .getByTestId('option-held')
        .elements()
        .map((node) => node.getAttribute('data-held-by')),
    ).toEqual(['determined'])
    await page.getByTestId('option-held').first().hover()
    await expect.element(page.getByRole('tooltip')).toBeVisible()
  })

  it('pins a narrowing that claims do not fit on the determination, not on the scoring method', async () => {
    await open({
      items: [levelled()],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
      preview: levelPreview(),
      check: () => [
        {
          path: `scoringConfig.recognitions.${RECOGNITION_ID}`,
          reason: 'strands-determined-value',
          count: 2,
          values: ['province'],
        },
      ],
    })
    const row = page.getByTestId('recognition-row')
    await expect.element(row).toHaveAttribute('data-problem', 'recognition-strands-value')
    await expect.element(row.getByTestId('row-problem')).toBeVisible()
    expect(document.querySelector('[data-testid="method-problem"]')).toBeNull()
    await expect.element(page.getByTestId('item-save')).toBeDisabled()
  })

  it('reads a refusal that only names claims as one about the determinations', async () => {
    await open({
      items: [levelled()],
      question: ITEM_ID,
      panel: 'scoring',
      surfaces: BOTH_CALCULATORS,
      preview: levelPreview(),
      refuse: [
        apiError('ASSESSMENT_ITEM_CONFIG_INVALID', {
          issues: [
            {
              path: 'scoringConfig.recognitions:01a0bc36-05f8-7798-ad13-2aa82ed1499f',
              reason: 'strands-existing-recognition',
            },
          ],
        }),
      ],
    })
    await expect.element(page.getByTestId('recognition-row')).toBeVisible()
    await tab(/基本信息/).click()
    await page.getByRole('textbox', { name: '项目名称' }).fill('竞赛获奖（改）')
    await page.getByTestId('item-save').click()
    await expect.element(page.getByTestId('save-failure')).toBeVisible()
    // where the refusal took the editor, the fault is said over the determinations
    await expect.element(editor()).toHaveAttribute('data-panel', 'scoring')
    const said = await seat('[data-testid="block-problem"]')
    await expect.element(said).toHaveAttribute('data-block', 'recognitions')
    await expect.element(said).toHaveAttribute('data-code', 'recognition-strands')
    expect(document.querySelector('[data-testid="method-problem"]')).toBeNull()
    expect(document.querySelector('[data-testid="save-refused"]')).toBeNull()
  })
})

describe('rearranging the structure', () => {
  /** one row dragged onto another, the way a pointer does it: its top edge, or its middle */
  const dragOnto = (from: string, onto: string, where: 'top' | 'middle' = 'top') => {
    const rowOf = (title: string) =>
      [...document.querySelectorAll<HTMLElement>('[draggable="true"]')].find(
        (one) => (one.textContent ?? '').includes(title) && one.checkVisibility(),
      )!
    const source = rowOf(from)
    const target = rowOf(onto)
    const carried = new DataTransfer()
    const box = target.getBoundingClientRect()
    const at = { clientY: where === 'top' ? box.top + 1 : box.top + box.height / 2 }
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: carried }))
    target.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: carried, ...at }),
    )
    target.dispatchEvent(
      new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: carried, ...at }),
    )
  }

  it('leaves a voided question where it stands when its neighbours are reordered', async () => {
    const FIRST = '66666666-6666-4666-8666-6666666666a1'
    const VOIDED = '66666666-6666-4666-8666-6666666666a2'
    const LAST = '66666666-6666-4666-8666-6666666666a3'
    const touched: string[] = []
    const question = (id: string, title: string, sortOrder: number, voided = false) => ({
      ...officerItem(),
      id,
      title,
      scoreGroupId: PAPER_ID,
      sortOrder,
      ...(voided ? { status: 'voided', voidReason: '重复设置' } : {}),
    })
    await open({
      items: [
        question(FIRST, '志愿服务', 5),
        question(VOIDED, '社会实践', 6, true),
        question(LAST, '文艺演出', 7),
      ],
      touched,
    })
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[draggable="true"]').length).toBeGreaterThanOrEqual(3),
    )

    dragOnto('文艺演出', '志愿服务')

    // the two live questions are renumbered; the voided one is never asked to move
    await vi.waitFor(() => expect(touched).toEqual([LAST, FIRST]))
    await new Promise((settle) => setTimeout(settle, 300))
    expect(touched).not.toContain(VOIDED)
  })

  it('reorders a section among its siblings, and offers no way to drop one inside another', async () => {
    const section = (id: string, name: string, sortOrder: number) => ({
      id,
      parentGroupId: PAPER_ID,
      name,
      cap: null,
      floor: null,
      sortOrder,
      itemCount: 0,
    })
    const regrouped: unknown[] = []
    await open({
      groups: [
        paper,
        section('88888888-8888-4888-8888-8888888888b1', '德育素质', 0),
        section('88888888-8888-4888-8888-8888888888b2', '文体素质', 1),
      ],
      regrouped,
    })
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[draggable="true"]').length).toBeGreaterThanOrEqual(2),
    )

    // into another section: the drop is not taken, so nothing is saved
    dragOnto('文体素质', '德育素质', 'middle')
    await new Promise((settle) => setTimeout(settle, 300))
    expect(regrouped).toHaveLength(0)

    // beside it, among its siblings: that is a reorder, and it is saved
    dragOnto('文体素质', '德育素质', 'top')
    await vi.waitFor(() => expect(regrouped).toHaveLength(1))
  })
})

describe('while the page loads', () => {
  it('outlines the page it is about to be, rather than one slab', async () => {
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    await renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({ ...emptyManifest(), pages: PAGES, ...CALCULATOR_SURFACES }),
        },
        assessment: {
          getBatch: () => Effect.succeed({ batch: batch() }),
          listScoreGroups: () =>
            Effect.promise(() => held).pipe(
              Effect.as({ groups: [paper], version: 1, capabilities: { canManage: true } }),
            ),
          listItems: () => Effect.succeed({ items: [], capabilities: { canManage: true } }),
          itemOptions: () => Effect.succeed({ orgTypes: [], roles: [] }),
          reviewAlerts: () => Effect.succeed({ groups: [] }),
        },
      }),
      routes: [
        { path: '/assessment/batches/:batchId/items', element: <ItemSettingsPage /> },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/items`,
    })
    const outline = page.getByTestId('structure-skeleton')
    await expect.element(outline).toBeVisible()
    // a heading and a card of rows, not a single block
    expect(outline.element().querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(6)
    release?.()
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="structure-skeleton"]')).toBeNull(),
    )
  })
})
