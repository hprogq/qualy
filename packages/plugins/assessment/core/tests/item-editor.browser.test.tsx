import ItemSettingsPage from '../src/client/items/ItemSettingsPage.tsx'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
import { MAX_ENTRIES_PER_ITEM } from '../src/api.ts'
import { lazy } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router'
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

const PAGES = [
  { id: 'assessment/batch-items', path: '/assessment/batches/:batchId/items' },
  { id: 'assessment/batch-access', path: '/assessment/batches/:batchId/access' },
].map((entry) => ({ ...entry, layout: 'admin' }))

const batch = () => ({
  id: BATCH_ID,
  name: '2026 春季综测',
  descriptionMd: null,
  manageable: true,
  reviewReasons: { reject: [], escalate: [] },
  capabilities: { personal: false, review: false, record: false, manage: true, redetermine: false },
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

/** what the round's alerts say when every route reaches everybody */
const NOBODY_UNREACHABLE = { routes: [], cannotSubmit: 0, cannotAppeal: 0 }

/** what the workspace shell draws its rail from: the round's own pages */
const SHELL_COLLECTIONS = {
  'app-shell/navigation-groups': [],
  'app-shell/navigation-primary': [],
  'workspace-shell/navigation': [
    ['assessment/batch-items', '项目配置', 10],
    ['assessment/batch-access', '人员权限', 20],
  ].map(([pageId, label, order]) => ({
    id: `${pageId}/rail`,
    label: { kind: 'literal', value: label },
    target: {
      kind: 'page',
      pageId,
      path: PAGES.find((one) => one.id === pageId)!.path,
    },
    order,
  })),
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
    /** where review is waiting for somebody to review it */
    alerts?: readonly unknown[]
    /** whether the reader may give out the round's roles */
    manage?: boolean
    locale?: 'zh-CN' | 'en-US'
    /** who a route being composed finds nowhere, by the unit kinds it asks for */
    unreachable?: (query: { nodeTypeIds?: unknown; page?: string }) => unknown
    /** another page of the round, and a link to it: what leaving the page is */
    elsewhere?: boolean
    /** how long every read of the questions after the first one takes */
    slowReads?: number
    /** the questions whose current route finds some of the roster nowhere */
    reach?: readonly unknown[]
    /** the units a step's roles are held at, and by how many */
    coverage?: readonly unknown[]
    /** where the round stands, when not being set up */
    status?: string
    /** what the round's questions are read as instead, one answer per read */
    itemsRead?: () => Effect.Effect<unknown, unknown>
    /** what the choices a question may be set to are read as instead */
    optionsRead?: () => Effect.Effect<unknown, unknown>
    /** inside the workspace shell the product draws, its rail open */
    inShell?: boolean
  } = {},
) => {
  // what the server holds, so a save is read back as it was stored
  const holding = [...((had.items ?? []) as Record<string, any>[])]
  let reads = 0
  const pages = [
    {
      path: '/assessment/batches/:batchId/items',
      element: (
        <>
          <ItemSettingsPage />
          {had.withBack === true && <BrowserBack />}
          {had.elsewhere === true && (
            <Link to={`/assessment/batches/${BATCH_ID}/access`}>elsewhere</Link>
          )}
        </>
      ),
    },
    ...(had.elsewhere === true
      ? [
          {
            path: '/assessment/batches/:batchId/access',
            element: <p data-testid="elsewhere">elsewhere</p>,
          },
        ]
      : []),
  ]
  const surfaces = had.surfaces ?? CALCULATOR_SURFACES
  return renderScreen({
    ...(had.locale === undefined ? {} : { locale: had.locale }),
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: PAGES,
            ...surfaces,
            collections: {
              ...surfaces.collections,
              ...(had.inShell === true ? SHELL_COLLECTIONS : {}),
            },
          }),
      },
      assessment: {
        getBatch: () =>
          Effect.succeed({
            batch: {
              ...batch(),
              ...(had.status === undefined ? {} : { status: had.status }),
              capabilities: { ...batch().capabilities, manage: had.manage ?? true },
            },
          }),
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
        listItems: () => {
          if (had.itemsRead !== undefined) return had.itemsRead()
          reads += 1
          const answer = Effect.succeed({ items: holding, capabilities: { canManage: true } })
          return had.slowReads === undefined || reads === 1
            ? answer
            : Effect.promise(
                () => new Promise<void>((settle) => setTimeout(settle, had.slowReads)),
              ).pipe(Effect.andThen(() => answer))
        },
        itemOptions: () =>
          had.optionsRead?.() ??
          Effect.succeed({
            orgTypes: [{ id: ORG_TYPE_ID, code: 'class', name: '班级' }],
            roles: [{ id: ROLE_ID, name: '审核员' }],
          }),
        reviewAlerts: () =>
          Effect.succeed({
            groups: had.alerts ?? [],
            unreachable: { ...NOBODY_UNREACHABLE, routes: had.reach ?? [] },
          }),
        reviewCoverage: () => Effect.succeed({ nodes: had.coverage ?? [] }),
        listUnreachableParticipants: (call: { query: { nodeTypeIds?: unknown; page?: string } }) =>
          had.unreachable === undefined
            ? Effect.succeed({ items: [], total: 0, page: 1, pageSize: 10 })
            : had.unreachable(call.query),
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
    ...(had.inShell === true
      ? {
          children: (
            <Routes>
              <Route element={<WorkspaceShell />}>
                {pages.map((one) => (
                  <Route key={one.path} path={one.path} element={one.element} />
                ))}
              </Route>
            </Routes>
          ),
        }
      : { routes: pages as never }),
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

/** the way back to the structure, at the head of the band */
const backButton = () => page.getByRole('button', { name: '返回项目配置' })

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

  // A question participants file with no escalation step can conclude with
  // nowhere to appeal, which the editor says where the route is set rather
  // than leaving it to be found at the appeal (ruling of 2026-09-25 #17).
  it('says a filed question with no escalation route takes no appeal', async () => {
    await open({ items: [officerItem()], question: ITEM_ID })
    await tab(/记录与审核/).click()
    await expect.element(page.getByTestId('no-appeal-route')).toBeVisible()
  })

  it('says nothing of appeals where an escalation route is set', async () => {
    await open({ items: [officerWithAppeals()], question: ITEM_ID })
    await tab(/记录与审核/).click()
    await expect.element(page.getByTestId('escalation-chain')).toBeVisible()
    expect(page.getByTestId('no-appeal-route').elements()).toHaveLength(0)
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

    await backButton().click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeVisible()
    await asked.getByRole('button', { name: '取消' }).click()
    await expect.element(editor()).toBeVisible()
    await expect
      .element(page.getByRole('textbox', { name: '项目名称' }))
      .toHaveValue('学生干部任职（改）')

    await backButton().click()
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
    // and it stays gone: the dialog closing after the discard must not put
    // the question back in the address
    await new Promise((settle) => setTimeout(settle, 400))
    expect(addressNow()).not.toContain('question=')
    expect(document.querySelector('[data-testid="item-editor"]')).toBeNull()
  })

  // The band speaks for whatever is on screen, and a question on hold keeps
  // the tab it was on: a band that followed the address changed shape under
  // the question being asked about, and staying came back on the first tab.
  it('keeps the band and the tab of a question the back button is held on', async () => {
    await open({ items: [{ ...officerItem(), scoreGroupId: PAPER_ID }], withBack: true })
    await vi.waitFor(() =>
      expect(page.getByText('学生干部任职').elements().length).toBeGreaterThan(0),
    )
    await userEvent.click(
      page
        .getByText('学生干部任职')
        .elements()
        .find((one) => (one as HTMLElement).checkVisibility())!,
    )
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')
    await tab(/表单与计分/).click()
    await expect.element(editor()).toHaveAttribute('data-panel', 'scoring')
    await expect.element(page.getByTestId('batch-band')).toHaveAttribute('data-banner', 'open')

    await page.getByTestId('browser-back').click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
    // held: the band still speaks for the question, on the tab it was on
    await expect.element(page.getByTestId('batch-band')).toHaveAttribute('data-banner', 'open')
    await expect.element(editor()).toHaveAttribute('data-panel', 'scoring')

    // and staying puts the tab back in the address with the question
    await page.getByRole('alertdialog').getByRole('button', { name: '取消' }).click()
    await vi.waitFor(() => {
      expect(addressNow()).toContain(`question=${ITEM_ID}`)
      expect(addressNow()).toContain('panel=scoring')
    })
    await expect.element(editor()).toHaveAttribute('data-panel', 'scoring')
  })

  it('leaves at once when nothing was changed', async () => {
    await open({ items: [officerItem()], question: ITEM_ID })
    await expect.element(editor()).toBeVisible()
    await backButton().click()
    await vi.waitFor(() => expect(document.querySelector('[data-testid="item-editor"]')).toBeNull())
    expect(page.getByRole('alertdialog').elements()).toHaveLength(0)
  })

  it('lets a blank new question go at once, and asks once something is written in it', async () => {
    await composeQuestion()
    await backButton().click()
    await vi.waitFor(() => expect(document.querySelector('[data-testid="item-editor"]')).toBeNull())
    expect(page.getByRole('alertdialog').elements()).toHaveLength(0)

    await page.getByRole('button', { name: '新建' }).click()
    await page.getByRole('menuitem', { name: '新建项目' }).click()
    await expect.element(editor()).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('志愿服务')
    await backButton().click()
    await expect.element(page.getByRole('alertdialog')).toBeVisible()
  })

  // Leaving for another page asks the application's own question, with a
  // way to save on the way out; moving between questions stays the page's
  // own hold, above.
  it('asks before another page is opened over unsaved changes, and saves on the way out', async () => {
    const saved: Record<string, unknown>[] = []
    // the round read again after the save answers late, as it can over a
    // real network: late enough to land after the reader has left
    await open({
      items: [officerItem()],
      question: ITEM_ID,
      saved,
      elsewhere: true,
      slowReads: 150,
    })
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')
    await page.getByRole('link', { name: 'elsewhere' }).click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeVisible()
    // still on the question while the reader decides
    expect(addressNow()).toContain('/items')
    await asked.getByRole('button', { name: '保存后离开' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ title: '学生干部任职（改）' })
    // and the save does not bring the reader back to the question it saved
    await new Promise((settle) => setTimeout(settle, 400))
    expect(addressNow()).toContain('/access')
    expect(document.querySelector('[data-testid="item-editor"]')).toBeNull()
  })

  it('stays on a question whose save cannot go through on the way out, and says why', async () => {
    const saved: Record<string, unknown>[] = []
    await open({ items: [officerItem()], question: ITEM_ID, saved, elsewhere: true })
    await page.getByRole('textbox', { name: '项目名称' }).fill('')
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '保存后离开' }).click()
    await new Promise((settle) => setTimeout(settle, 400))
    expect(addressNow()).toContain('/items')
    await expect.element(editor()).toBeVisible()
    expect(saved).toHaveLength(0)
    await expect.element(page.getByTestId('pending-trigger')).toBeVisible()

    // letting the changes go is leaving without them
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '放弃修改' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    expect(saved).toHaveLength(0)
  })

  // "Save and leave" on a change a running round wants a reason for asked
  // the reason and then stayed on the question, the press to leave gone.
  it('asks the reason a running round wants on the way out, then leaves once saved', async () => {
    const saved: Record<string, unknown>[] = []
    await open({
      items: [officerItem()],
      groups: [paper, { ...paper, id: SECTION_ID, parentGroupId: PAPER_ID, name: '学生工作' }],
      question: ITEM_ID,
      status: 'active',
      saved,
      elsewhere: true,
    })
    await page.getByRole('combobox', { name: '所属分组' }).click()
    await page.getByRole('option', { name: '综合素质测评' }).click()
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '保存后离开' }).click()
    // asked here, where the question is, and nothing saved or left yet
    const asked = page.getByRole('dialog', { name: '变更原因' })
    await expect.element(asked).toBeVisible()
    expect(addressNow()).toContain('/items')
    expect(saved).toHaveLength(0)
    await asked.getByRole('textbox').fill('并入总分')
    await asked.getByRole('button', { name: '保存' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    expect(saved).toHaveLength(1)
    expect(saved[0]).toMatchObject({ scoreGroupId: PAPER_ID, reason: '并入总分' })
    await new Promise((settle) => setTimeout(settle, 300))
    expect(addressNow()).toContain('/access')
  })

  it('stays on the question when the reason is not given, and does not leave on a later save', async () => {
    const saved: Record<string, unknown>[] = []
    await open({
      items: [officerItem()],
      groups: [paper, { ...paper, id: SECTION_ID, parentGroupId: PAPER_ID, name: '学生工作' }],
      question: ITEM_ID,
      status: 'active',
      saved,
      elsewhere: true,
    })
    await page.getByRole('combobox', { name: '所属分组' }).click()
    await page.getByRole('option', { name: '综合素质测评' }).click()
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '保存后离开' }).click()
    const asked = page.getByRole('dialog', { name: '变更原因' })
    await expect.element(asked).toBeVisible()
    await asked.getByRole('button', { name: '取消' }).click()
    await vi.waitFor(() => expect(page.getByRole('dialog').elements()).toHaveLength(0))
    // saved on its own afterwards, the question stays where it is
    await page.getByTestId('item-save').click()
    const again = page.getByRole('dialog', { name: '变更原因' })
    await again.getByRole('textbox').fill('并入总分')
    await again.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    await new Promise((settle) => setTimeout(settle, 300))
    expect(addressNow()).toContain('/items')
    await expect.element(editor()).toBeVisible()
  })

  // A save answered, then the round read again slowly: a press on another
  // page meanwhile was taken back to the question as the read came in.
  it('lets the reader leave while the round is read again after a save', async () => {
    const saved: Record<string, unknown>[] = []
    await open({
      items: [officerItem()],
      question: ITEM_ID,
      saved,
      elsewhere: true,
      slowReads: 600,
    })
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="item-unsaved"]')).toBeNull(),
    )
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    await new Promise((settle) => setTimeout(settle, 1000))
    expect(addressNow()).toContain('/access')
    expect(document.querySelector('[data-testid="item-editor"]')).toBeNull()
  })

  it('lets the page go without asking when nothing was changed', async () => {
    await open({ items: [officerItem()], question: ITEM_ID, elsewhere: true })
    await expect.element(editor()).toBeVisible()
    await page.getByRole('link', { name: 'elsewhere' }).click()
    await expect.element(page.getByTestId('elsewhere')).toBeVisible()
    expect(page.getByRole('alertdialog').elements()).toHaveLength(0)
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

  it('holds a limit of its own to the platform ceiling, where the number is typed', async () => {
    await composeQuestion()
    await tab(/记录与审核/).click()
    const limit = page.getByRole('textbox', { name: '每人可申报条数' })
    await limit.fill(String(MAX_ENTRIES_PER_ITEM + 1))
    await expect.element(limit).toHaveAttribute('aria-invalid', 'true')
    await limit.fill(String(MAX_ENTRIES_PER_ITEM))
    await expect.element(limit).not.toHaveAttribute('aria-invalid')
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

describe('composing the two routes', () => {
  const stageOf = (id: string, label: string, quorum: 'any' | 'all' = 'any') => ({
    id,
    label,
    selector: { kind: 'roleAt', nodeTypeId: ORG_TYPE_ID, roleIds: [ROLE_ID] },
    quorum: { type: quorum },
  })
  /** the officer question with these two routes */
  const routed = (normal: readonly unknown[], escalation: readonly unknown[] = []) => {
    const item = officerItem()
    item.currentRevision.reviewPolicy = {
      normal: { stages: normal as never },
      escalation: { stages: escalation as never },
    }
    return item
  }
  const steps = (chain: 'normal' | 'escalation') =>
    [
      ...document.querySelectorAll<HTMLElement>(
        `[data-testid="chain-${chain}"] [data-testid="chain-step"]`,
      ),
    ].map((node) => node.textContent ?? '')
  const sheet = () => page.getByTestId('stage-sheet')
  /** a name and a reviewer, which is all a step needs to be whole */
  const compose = async (name: string) => {
    await sheet().getByRole('textbox', { name: '步骤名称' }).fill(name)
    await sheet().getByRole('checkbox', { name: '审核员' }).click()
  }
  const quorumsSaved = (saved: { config?: unknown }[]) => {
    const config = saved.at(-1)!.config as {
      reviewPolicy: { escalation: { stages: { quorum: { type: string } }[] } }
    }
    return config.reviewPolicy.escalation.stages.map((one) => one.quorum.type)
  }

  it('inserts a step between two others from the place between them, and focuses it', async () => {
    await open({
      items: [routed([stageOf('s-first', '班委初审'), stageOf('s-second', '专业复审')])],
      question: ITEM_ID,
      panel: 'rules',
    })
    await vi.waitFor(() => expect(steps('normal')).toHaveLength(2))

    // a place before the first step too, named for the step it comes before
    await page.getByRole('button', { name: '在第 1 步「班委初审」之前插入审核步骤' }).click()
    await expect.element(sheet()).toBeVisible()
    await sheet().getByRole('button', { name: '取消' }).click()
    await vi.waitFor(() => expect(steps('normal')).toHaveLength(2))

    await page.getByRole('button', { name: '在第 2 步「专业复审」之前插入审核步骤' }).click()
    await expect
      .element(sheet().getByRole('combobox', { name: '位置' }))
      .toHaveTextContent('第 2 步')
    // the ordinary route has no panels, so it asks nothing about handling
    expect(document.querySelector('[data-testid="stage-participation"]')).toBeNull()
    await compose('辅导员审核')
    await sheet().getByTestId('stage-apply').click()

    await vi.waitFor(() => {
      const now = steps('normal')
      expect(now).toHaveLength(3)
      expect(now[0]).toContain('班委初审')
      expect(now[1]).toContain('辅导员审核')
      expect(now[2]).toContain('专业复审')
    })
    // the card of the step just added holds the focus, not the place it filled
    await vi.waitFor(() =>
      expect((document.activeElement as HTMLElement | null)?.textContent ?? '').toContain(
        '辅导员审核',
      ),
    )
  })

  // The place was 16px tall with a 20px mark in it, so the mark sat on the
  // cards either side, and the keyboard's ring ran the width of the chain.
  it('gives the place between two steps room for its mark, and rings only the mark and its words', async () => {
    await open({
      items: [routed([stageOf('s-first', '班委初审'), stageOf('s-second', '专业复审')])],
      question: ITEM_ID,
      panel: 'rules',
    })
    await vi.waitFor(() => expect(steps('normal')).toHaveLength(2))
    const place = page.getByRole('button', { name: '在第 2 步「专业复审」之前插入审核步骤' })
    const slot = place.element() as HTMLElement
    const tag = slot.querySelector<HTMLElement>('[data-testid="insert-tag"]')!
    const mark = tag.firstElementChild!.getBoundingClientRect()
    const room = slot.getBoundingClientRect()
    expect(mark.top).toBeGreaterThanOrEqual(room.top - 0.5)
    expect(mark.bottom).toBeLessThanOrEqual(room.bottom + 0.5)

    // reached by the keyboard, the ring is the mark's and its words', not the chain's
    await userEvent.keyboard('{Shift}')
    slot.focus()
    expect(slot.matches(':focus-visible')).toBe(true)
    expect(getComputedStyle(slot).outlineStyle).toBe('none')
    expect(getComputedStyle(tag).boxShadow).not.toBe('none')
    const chain = page.getByTestId('chain-normal').element().getBoundingClientRect()
    expect(tag.getBoundingClientRect().width).toBeLessThan(chain.width / 2)
  })

  it("moves a step by its position in the step's own panel, and cancel takes the move back", async () => {
    await open({
      items: [routed([stageOf('s-first', '班委初审'), stageOf('s-second', '专业复审')])],
      question: ITEM_ID,
      panel: 'rules',
    })
    await vi.waitFor(() => expect(steps('normal')).toHaveLength(2))
    const place = async (name: RegExp) => {
      await sheet().getByRole('combobox', { name: '位置' }).click()
      await page.getByRole('option', { name }).click()
    }

    await page.getByTestId('chain-step').first().click()
    await place(/第 2 步/)
    await sheet().getByRole('button', { name: '取消' }).click()
    await new Promise((settle) => setTimeout(settle, 250))
    expect(steps('normal')[0]).toContain('班委初审')

    await page.getByTestId('chain-step').first().click()
    await place(/第 2 步/)
    await sheet().getByTestId('stage-apply').click()
    await vi.waitFor(() => expect(steps('normal')[0]).toContain('专业复审'))

    await page.getByTestId('chain-step').first().click()
    await sheet().getByRole('button', { name: '删除步骤' }).click()
    await vi.waitFor(() => expect(steps('normal')).toHaveLength(1))
    // the ordinary route keeps one step: the last cannot be taken out
    await page.getByTestId('chain-step').first().click()
    await expect.element(sheet().getByRole('button', { name: '删除步骤' })).toBeDisabled()
  })

  // A new step was always the last one, where a panel is refused, so the
  // choice between the two ways never showed while a step was being made.
  it('offers both ways on a new escalation step, and holds the save while a panel ends the route', async () => {
    const saved: { config?: unknown }[] = []
    await open({
      items: [routed([stageOf('s-first', '班委初审')], [stageOf('s-appeal', '学院复核')])],
      question: ITEM_ID,
      panel: 'rules',
      saved,
    })
    await vi.waitFor(() => expect(steps('escalation')).toHaveLength(1))

    await page.getByTestId('chain-escalation').getByTestId('chain-add').click()
    await expect.element(sheet().getByTestId('stage-participation')).toBeVisible()
    await compose('学院复核小组')
    await sheet()
      .getByRole('radio', { name: /全员共同审核/ })
      .click()
    // chosen at the end of the route, it says what it still needs, and is taken
    await expect.element(sheet().getByTestId('stage-owed')).toBeVisible()
    await sheet().getByTestId('stage-apply').click()

    const panel = page.getByTestId('chain-escalation').getByTestId('chain-step').last()
    await expect.element(panel).toHaveAttribute('data-problem', 'stage-panel-last')
    await expect.element(panel).toHaveAttribute('data-tone', 'pending')

    // a save walks to it instead of sending, and it is settled from there
    await page.getByTestId('item-save').click()
    await expect.element(sheet().getByTestId('stage-owed')).toBeVisible()
    expect(saved).toHaveLength(0)
    await sheet().getByTestId('stage-add-after').click()
    await expect
      .element(sheet().getByRole('combobox', { name: '位置' }))
      .toHaveTextContent('第 3 步')
    await compose('学院终审')
    await sheet().getByTestId('stage-apply').click()

    await vi.waitFor(() => expect(steps('escalation')).toHaveLength(3))
    expect(document.querySelector('[data-problem="stage-panel-last"]')).toBeNull()
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect(quorumsSaved(saved)).toEqual(['any', 'all', 'any'])
  })

  // Written as "any one" on save, a panel left last by a removal changed a
  // choice nobody had taken back, while the chain still said the other thing.
  it('keeps a panel a removal left last as it was chosen, and waits for the step after it', async () => {
    const saved: { config?: unknown }[] = []
    await open({
      items: [
        routed(
          [stageOf('s-first', '班委初审')],
          [stageOf('s-panel', '学院复核小组', 'all'), stageOf('s-final', '学院终审')],
        ),
      ],
      question: ITEM_ID,
      panel: 'rules',
      saved,
    })
    await vi.waitFor(() => expect(steps('escalation')).toHaveLength(2))

    await page.getByTestId('chain-escalation').getByTestId('chain-step').last().click()
    await sheet().getByRole('button', { name: '删除步骤' }).click()
    const panel = page.getByTestId('chain-escalation').getByTestId('chain-step').first()
    await expect.element(panel).toHaveAttribute('data-participation', 'all')
    await expect.element(panel).toHaveAttribute('data-problem', 'stage-panel-last')

    await page.getByTestId('item-save').click()
    await expect.element(sheet()).toBeVisible()
    await new Promise((settle) => setTimeout(settle, 300))
    expect(saved).toHaveLength(0)
  })

  it('stops offering a step once a route holds ten, and says a refusal about a route on that route', async () => {
    const ten = Array.from({ length: 10 }, (_unused, index) =>
      stageOf(`s-step-${index}`, `第${index + 1}审`),
    )
    await open({
      items: [routed(ten, [stageOf('s-appeal', '学院复核')])],
      question: ITEM_ID,
      panel: 'rules',
      check: () => [{ path: 'reviewPolicy.escalation.stages', reason: 'policy-stages-too-many' }],
    })
    const normal = page.getByTestId('chain-normal')
    await expect.element(normal).toHaveAttribute('data-full', 'true')
    await expect.element(normal.getByTestId('chain-add')).toBeDisabled()
    expect(normal.getByTestId('chain-insert').elements()).toHaveLength(0)
    // the other route still has room, and places to use it
    expect(
      page.getByTestId('chain-escalation').getByTestId('chain-insert').elements(),
    ).toHaveLength(1)

    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="escalation-chain"] [data-tone="error"]'),
      ).not.toBeNull(),
    )
    expect(document.querySelector('[data-testid="review-chain"] [data-tone="error"]')).toBeNull()
  })
})

// A route every step of which asks for a kind of unit some people sit under
// none of finds them nowhere: they cannot submit, or cannot appeal, and no
// appointment mends it (§32.93). The editor says so under the route while
// it is composed, and never holds the save for it.
describe('a route that finds some of the roster nowhere', () => {
  const person = (index: number) => ({
    participantId: `p-${index}`,
    userId: `u-${index}`,
    displayName: `参评人${index}`,
    businessNo: `2023${String(index).padStart(4, '0')}`,
    unitPath: ['示例大学', '管理学院'],
  })
  const everyone = Array.from({ length: 12 }, (_unused, index) => person(index + 1))
  const answering =
    (asked: { nodeTypeIds?: unknown; page?: string }[]) =>
    (query: { nodeTypeIds?: unknown; page?: string }) => {
      asked.push(query)
      const page = Number(query.page ?? '1')
      return Effect.succeed({
        items: everyone.slice((page - 1) * 10, page * 10),
        total: everyone.length,
        page,
        pageSize: 10,
      })
    }

  it('says how many under the route, lists them a page at a time, and leaves the save alone', async () => {
    const asked: { nodeTypeIds?: unknown; page?: string }[] = []
    await open({
      items: [officerItem()],
      question: ITEM_ID,
      panel: 'rules',
      unreachable: answering(asked),
    })
    const normal = page.getByTestId('review-chain').getByTestId('route-reach')
    await expect.element(normal).toHaveAttribute('data-count', '12')
    await expect.element(normal).toHaveAttribute('data-route', 'normal')
    // asked by the unit kinds the route being composed asks for
    expect(asked[0]!.nodeTypeIds).toEqual([ORG_TYPE_ID])
    // the escalation route is empty, so nobody is asked about it
    expect(page.getByTestId('escalation-chain').getByTestId('route-reach').elements()).toHaveLength(
      0,
    )
    await expect.element(page.getByTestId('item-save')).toHaveAttribute('data-blocked', 'false')

    await normal.getByRole('button', { name: '查看人员' }).click()
    const dialog = page.getByTestId('route-reach-dialog')
    await expect.element(dialog).toBeVisible()
    await vi.waitFor(() =>
      expect(dialog.getByTestId('unreachable-person').elements()).toHaveLength(10),
    )
    // the list the roster shows them in, its first page the one the count
    // was read with
    expect(asked.every((one) => one.page === '1')).toBe(true)
    expect(dialog.getByTestId('unreachable-people').element().getAttribute('data-total')).toBe('12')
    // read, not pressed: there is nobody here to open
    expect(dialog.element().querySelector('button[data-testid="unreachable-person"]')).toBeNull()
    await dialog.getByRole('button', { name: '2', exact: true }).click()
    await vi.waitFor(() =>
      expect(dialog.getByTestId('unreachable-person').elements()).toHaveLength(2),
    )
    expect(
      dialog
        .getByTestId('unreachable-person')
        .elements()
        .map((row) => row.getAttribute('data-participant')),
    ).toEqual(['p-11', 'p-12'])
    expect(asked.at(-1)?.page).toBe('2')
    await dialog.getByRole('button', { name: '关闭' }).click()
    await vi.waitFor(() =>
      expect(document.querySelector('[data-testid="route-reach-dialog"]')).toBeNull(),
    )
  })

  it('asks nothing of a route with a step that finds its person wherever they sit', async () => {
    const asked: { nodeTypeIds?: unknown; page?: string }[] = []
    const item = officerItem()
    item.currentRevision.reviewPolicy = {
      normal: {
        stages: [
          {
            id: 's-first',
            label: '辅导员审核',
            selector: { kind: 'nearestRole', roleId: ROLE_ID } as never,
            quorum: { type: 'any' },
          },
        ],
      },
      escalation: { stages: [] },
    }
    await open({ items: [item], question: ITEM_ID, panel: 'rules', unreachable: answering(asked) })
    await vi.waitFor(() => expect(page.getByTestId('chain-step').elements()).toHaveLength(1))
    await new Promise((settle) => setTimeout(settle, 300))
    expect(asked).toHaveLength(0)
    expect(document.querySelector('[data-testid="route-reach"]')).toBeNull()
  })

  it('says nothing to a reader who may not read the roster', async () => {
    await open({
      items: [officerItem()],
      question: ITEM_ID,
      panel: 'rules',
      unreachable: () => Effect.fail(apiError('ACCESS_DENIED')),
    })
    await vi.waitFor(() => expect(page.getByTestId('chain-step').elements()).toHaveLength(1))
    await new Promise((settle) => setTimeout(settle, 300))
    expect(document.querySelector('[data-testid="route-reach"]')).toBeNull()
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
    await expect.element(backButton()).toBeVisible()
    await expect.element(page.getByTestId('item-meta')).toHaveAttribute('data-revision', '1')
    await expect.element(page.getByTestId('item-meta')).toHaveAttribute('data-standing', 'active')
    // the handling is said in the band, never changed from it
    const mode = page.getByTestId('item-mode')
    await expect.element(mode).toBeVisible()
    expect(mode.element().closest('button')).toBeNull()
    expect(mode.element().querySelector('svg')).toBeNull()
  })

  // The question's heading is the section heading's own shape, and its three
  // views are the first row of the body: a band that grew a row of tabs each
  // time a question opened pushed everything under it down by that row.
  // English says the section in more letters, and on a phone its line used
  // to wrap where the question's did not.
  for (const [width, locale] of [
    [1280, 'zh-CN'],
    [390, 'zh-CN'],
    [390, 'en-US'],
  ] as const) {
    it(`keeps the band one height whether the structure or a question holds it, at ${width} in ${locale}`, async () => {
      await page.viewport(width, 900)
      try {
        await open({ items: [{ ...officerItem(), scoreGroupId: PAPER_ID }], locale })
        const band = page.getByTestId('batch-band')
        await expect.element(band).toHaveAttribute('data-banner', 'section')
        await vi.waitFor(() =>
          expect(page.getByText('学生干部任职').elements().length).toBeGreaterThan(0),
        )
        await new Promise((settle) => setTimeout(settle, 300))
        const section = band.element().getBoundingClientRect().height

        await userEvent.click(
          page
            .getByText('学生干部任职')
            .elements()
            .find((one) => (one as HTMLElement).checkVisibility())!,
        )
        await expect.element(band).toHaveAttribute('data-banner', 'open')
        await expect.element(page.getByTestId('item-tabs')).toBeVisible()
        await new Promise((settle) => setTimeout(settle, 400))
        const question = band.element().getBoundingClientRect().height
        expect(Math.abs(question - section)).toBeLessThanOrEqual(1)
        // the views are under the band, not inside it
        expect(band.element().querySelector('[role="tab"]')).toBeNull()
      } finally {
        await page.viewport(1280, 900)
      }
    })
  }

  // A phone's row of views had room for two of the three once a line saying
  // all was well took its end, and the first view's fields took the width
  // of their longest hint and ran off the right of the screen. In English
  // the third view was still pushed past the edge, behind a hidden scroll.
  for (const locale of ['zh-CN', 'en-US'] as const) {
    it(`keeps every view and every field of a question on a phone screen, in ${locale}`, async () => {
      await page.viewport(390, 900)
      try {
        await open({ items: [officerItem()], question: ITEM_ID, locale })
        await expect.element(page.getByTestId('item-tabs')).toBeVisible()
        const tabs = page.getByRole('tab').elements()
        expect(tabs).toHaveLength(3)
        for (const one of tabs) {
          expect(one.getBoundingClientRect().right).toBeLessThanOrEqual(390 - 16 + 1)
        }
        const title = document.querySelector('[data-testid="item-editor"] input')!
        expect(title.getBoundingClientRect().right).toBeLessThanOrEqual(390)
        // every field's name on one line: a hint beside the description's
        // name squeezed it down to a letter per line
        for (const label of document.querySelectorAll<HTMLElement>(
          '[data-testid="item-editor"] label[for]',
        )) {
          if (!label.checkVisibility()) continue
          expect(label.getBoundingClientRect().height).toBeLessThan(26)
        }
        expect(document.querySelector('[data-testid="pending-none"]')?.checkVisibility()).toBe(
          false,
        )
      } finally {
        await page.viewport(1280, 900)
      }
    })

    // With something left to do, its count takes the end of the row too.
    it(`keeps every view on a phone beside what is left to do, in ${locale}`, async () => {
      await page.viewport(390, 900)
      try {
        await open({ items: [{ ...officerItem(), title: '' }], question: ITEM_ID, locale })
        await expect.element(page.getByTestId('pending-trigger')).toBeVisible()
        const trigger = page.getByTestId('pending-trigger').element().getBoundingClientRect()
        expect(trigger.right).toBeLessThanOrEqual(390 - 16 + 1)
        for (const one of page.getByRole('tab').elements()) {
          const box = one.getBoundingClientRect()
          expect(box.right).toBeLessThanOrEqual(trigger.left)
          // shortened where it can be seen, never squeezed out of sight
          expect(box.width).toBeGreaterThan(40)
        }
      } finally {
        await page.viewport(1280, 900)
      }
    })
  }

  // What a block said at its far end took a phone's line from its heading:
  // the name broke in two and the words under it ran a word to a line.
  for (const locale of ['zh-CN', 'en-US'] as const) {
    it(`keeps a block's name on one line on a phone, with what it says at its end under it, in ${locale}`, async () => {
      await page.viewport(390, 900)
      try {
        await open({
          items: [officerWithAppeals()],
          question: ITEM_ID,
          panel: 'rules',
          locale,
          coverage: [{ id: 'c1', name: '1班', reviewers: 0 }],
        })
        const review = page.getByTestId('review-chain')
        await vi.waitFor(() =>
          expect(review.element().querySelector('[data-tone="pending"]')).not.toBeNull(),
        )
        for (const heading of document.querySelectorAll<HTMLElement>(
          '[data-testid="item-editor"] section h2',
        )) {
          if (!heading.checkVisibility()) continue
          const block = heading.closest('section')!.getBoundingClientRect()
          expect(heading.getBoundingClientRect().height).toBeLessThan(24)
          const hint = heading.nextElementSibling
          if (hint !== null) {
            expect(hint.getBoundingClientRect().width).toBeGreaterThanOrEqual(block.width * 0.6)
          }
        }
        const aside = review.element().querySelector('[data-tone="pending"]')!
        const words = review.element().querySelector('h2')!.parentElement!
        expect(aside.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          words.getBoundingClientRect().bottom - 1,
        )
      } finally {
        await page.viewport(1280, 900)
      }
    })
  }

  // The path used to be the way back's own words, cut from the end: the
  // group the question is in - the one worth reading - went first, and the
  // button's name hid the whole path from a screen reader.
  it('keeps the group a question is in on the line, and its path beside the way back', async () => {
    const OUTER = '88888888-8888-4888-8888-8888888888e1'
    const INNER = '88888888-8888-4888-8888-8888888888e2'
    const group = (id: string, parentGroupId: string, name: string) => ({
      id,
      parentGroupId,
      name,
      cap: '20',
      floor: null,
      sortOrder: 0,
      itemCount: 0,
    })
    await page.viewport(834, 900)
    try {
      await open({
        groups: [
          paper,
          group(OUTER, PAPER_ID, '德育素质与思想政治表现综合评价'),
          group(INNER, OUTER, '学生干部任职与班级社团工作履职情况'),
        ],
        items: [{ ...officerItem(), scoreGroupId: INNER }],
        question: ITEM_ID,
      })
      await expect.element(backButton()).toBeVisible()
      const trail = page.getByTestId('item-trail')
      await expect.element(trail).toBeVisible()
      await new Promise((settle) => setTimeout(settle, 300))
      const box = trail.element().getBoundingClientRect()
      // the outer groups gave way from the paper down; the group the
      // question is in kept its whole name, inside the line
      await expect.element(trail).not.toHaveAttribute('data-folded', '0')
      const nearest = trail.element().querySelector<HTMLElement>(`[data-crumb="2"]`)!
      const word = nearest.lastElementChild as HTMLElement
      expect(word.textContent).toBe('学生干部任职与班级社团工作履职情况')
      expect(word.scrollWidth).toBeLessThanOrEqual(word.clientWidth + 1)
      expect(nearest.getBoundingClientRect().right).toBeLessThanOrEqual(box.right + 1)
      // and the way back keeps its words
      const back = backButton().element() as HTMLElement
      expect(back.scrollWidth).toBeLessThanOrEqual(back.clientWidth + 1)
      // beside the way back, not inside it, and the whole path read out
      expect(back.contains(trail.element())).toBe(false)
      expect(trail.element().closest('[aria-hidden="true"]')).toBeNull()
      expect(trail.element().textContent).toContain(
        '综合素质测评 / 德育素质与思想政治表现综合评价 / 学生干部任职与班级社团工作履职情况',
      )

      // with the room to say all of it, all of it is said
      await page.viewport(1440, 900)
      await vi.waitFor(() => expect(trail.element().getAttribute('data-folded')).toBe('0'))
      expect(trail.element().querySelectorAll('[data-crumb]')).toHaveLength(3)
      // and the room taken away again folds it again
      await page.viewport(834, 900)
      await vi.waitFor(() => expect(trail.element().getAttribute('data-folded')).not.toBe('0'))
    } finally {
      await page.viewport(1280, 900)
    }
  })

  // In English at a desk width with the rail open, the group a question is
  // in was cut to five letters while when it was saved stood whole beside
  // it, and a line whose other words changed was never measured again.
  it('gives way the outer groups, then the time and the version, before the group a question is in', async () => {
    const OUTER = '88888888-8888-4888-8888-8888888888e1'
    const INNER = '88888888-8888-4888-8888-8888888888e2'
    const group = (id: string, parentGroupId: string, name: string) => ({
      id,
      parentGroupId,
      name,
      cap: '20',
      floor: null,
      sortOrder: 0,
      itemCount: 0,
    })
    await page.viewport(1024, 900)
    try {
      await open({
        groups: [
          paper,
          group(OUTER, PAPER_ID, '德育素质与思想政治表现综合评价'),
          group(INNER, OUTER, '学生干部任职与班级社团工作履职情况'),
        ],
        items: [{ ...officerItem(), scoreGroupId: INNER }],
        question: ITEM_ID,
        locale: 'en-US',
        inShell: true,
      })
      await expect.element(page.getByTestId('workspace-rail')).toBeVisible()
      const trail = page.getByTestId('item-trail')
      await expect.element(trail).toBeVisible()
      const settle = () => new Promise((done) => setTimeout(done, 250))
      /** on the line, rather than on the one under it that nobody sees */
      const standing = (testId: string) => {
        const part = document.querySelector(`[data-testid="${testId}"]`)
        if (part === null) return false
        const room = document
          .querySelector('[data-testid="item-trail-after"]')!
          .getBoundingClientRect()
        const box = part.getBoundingClientRect()
        return box.width > 0 && box.bottom <= room.bottom + 1 && box.right <= room.right + 1
      }
      const nearestCut = () => {
        const crumbs = trail.element().querySelectorAll('[data-crumb]')
        const word = crumbs[crumbs.length - 1]!.lastElementChild as HTMLElement
        return word.scrollWidth > word.clientWidth + 1
      }
      const holds = () => {
        const seat = trail.element() as HTMLElement
        // nothing on the path is cut off without a mark
        expect(seat.scrollWidth).toBeLessThanOrEqual(seat.clientWidth + 1)
        const folded = Number(seat.getAttribute('data-folded'))
        // an outer group still on the line: nothing after the path gave way
        if (folded < 2) {
          expect(standing('item-version')).toBe(true)
          if (document.querySelector('[data-testid="item-saved-at"]') !== null) {
            expect(standing('item-saved-at')).toBe(true)
          }
        }
        // the time goes before the version, each whole
        if (standing('item-saved-at')) expect(standing('item-version')).toBe(true)
        // the group the question is in is cut short only once the rest is gone
        if (nearestCut()) {
          expect(folded).toBe(2)
          expect(standing('item-version')).toBe(false)
        }
      }
      await settle()
      holds()
      // at 1024 with the rail open there is room for the whole of it
      expect(nearestCut()).toBe(false)
      const title = page.getByRole('textbox', { name: 'Title' })
      for (const width of [1024, 1100, 1180, 1280, 1366, 1440]) {
        await page.viewport(width, 900)
        await settle()
        holds()
        // changes waiting take their place on the line, and the path is
        // measured again for what is left
        await userEvent.type(title, 'x')
        await expect.element(page.getByTestId('item-unsaved')).toBeVisible()
        await settle()
        holds()
        await userEvent.type(title, '{Backspace}')
        await vi.waitFor(() =>
          expect(document.querySelector('[data-testid="item-unsaved"]')).toBeNull(),
        )
        await settle()
        holds()
      }
    } finally {
      await page.viewport(1280, 900)
    }
  })

  it('keeps the section heading in the band until a question arriving by address can take it', async () => {
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
            Effect.succeed({ groups: [paper], version: 1, capabilities: { canManage: true } }),
          listItems: () =>
            Effect.promise(() => held).pipe(
              Effect.as({ items: [officerItem()], capabilities: { canManage: true } }),
            ),
          itemOptions: () =>
            Effect.succeed({
              orgTypes: [{ id: ORG_TYPE_ID, code: 'class', name: '班级' }],
              roles: [{ id: ROLE_ID, name: '审核员' }],
            }),
          reviewAlerts: () => Effect.succeed({ groups: [], unreachable: NOBODY_UNREACHABLE }),
          reviewCoverage: () => Effect.succeed({ nodes: [] }),
          checkItem: () => Effect.succeed({ issues: [], standing: [] }),
          previewScoring: () => Effect.succeed(previewFor('fixed@1')),
        },
      }),
      routes: [
        { path: '/assessment/batches/:batchId/items', element: <ItemSettingsPage /> },
      ] as never,
      route: `/assessment/batches/${BATCH_ID}/items?question=${ITEM_ID}`,
    })
    await expect.element(page.getByTestId('question-skeleton')).toBeVisible()
    const band = page.getByTestId('batch-band')
    // an empty band would stand shorter and grow when the question came
    await expect.element(band).toHaveAttribute('data-banner', 'section')
    const waiting = band.element().getBoundingClientRect().height
    expect(waiting).toBeGreaterThan(60)
    // The round is a draft, and the structure says so above itself. Said
    // over the outline too, the line went when the question came, and the
    // whole question jumped up by its height.
    await new Promise((settle) => setTimeout(settle, 300))
    const outlined = page
      .getByTestId('question-skeleton')
      .element()
      .firstElementChild!.getBoundingClientRect().top
    release?.()
    await expect.element(band).toHaveAttribute('data-banner', 'open')
    await expect.element(editor()).toBeVisible()
    await new Promise((settle) => setTimeout(settle, 400))
    expect(Math.abs(band.element().getBoundingClientRect().height - waiting)).toBeLessThanOrEqual(1)
    const arrived = page.getByTestId('item-tabs').element().getBoundingClientRect().top
    expect(Math.abs(arrived - outlined)).toBeLessThanOrEqual(1)
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

describe('the structure', () => {
  const MORAL = '88888888-8888-4888-8888-8888888888c1'
  const CLASSWORK = '88888888-8888-4888-8888-8888888888c2'
  const section = (id: string, parent: string, name: string, sortOrder: number) => ({
    id,
    parentGroupId: parent,
    name,
    cap: '20',
    floor: null,
    sortOrder,
    itemCount: 0,
  })
  const question = (id: string, title: string, scoreGroupId: string, over: object = {}) => ({
    ...officerItem(),
    id,
    title,
    scoreGroupId,
    ...over,
  })
  const shown = () =>
    [...document.querySelectorAll<HTMLElement>('[data-testid="structure-row"]')].map((row) => ({
      name: row.textContent ?? '',
      kind: row.getAttribute('data-kind'),
      context: row.getAttribute('data-context'),
    }))
  const withSections = (items: readonly unknown[]) =>
    open({
      groups: [
        paper,
        section(MORAL, PAPER_ID, '德育素质', 0),
        section(CLASSWORK, MORAL, '班级与社团工作', 0),
      ],
      items,
    })

  // In English between 768 and 1024 the head could not hold the paper's
  // name, its limits and the tools on one line: the limits were cut short
  // and the way to add something dropped under the search field.
  for (const width of [834, 1024]) {
    it(`keeps the paper's limits whole and its tools on one line, in English at ${width}`, async () => {
      await page.viewport(width, 900)
      try {
        await open({
          groups: [paper, section(MORAL, PAPER_ID, '德育素质', 0)],
          items: [question('66666666-6666-4666-8666-6666666666d1', '学生干部任职', MORAL)],
          locale: 'en-US',
          inShell: width >= 1024,
        })
        await vi.waitFor(() => expect(shown()).toHaveLength(2))
        const search = page.getByRole('searchbox').element().getBoundingClientRect()
        const add = page
          .getByRole('button', { name: 'New', exact: true })
          .element()
          .getBoundingClientRect()
        const status = page.getByRole('combobox', { name: 'Status' }).element()
        expect(Math.abs(add.top - search.top)).toBeLessThanOrEqual(4)
        expect(Math.abs(status.getBoundingClientRect().top - search.top)).toBeLessThanOrEqual(4)
        expect(add.right).toBeLessThanOrEqual(width)
        // the paper's limits, whole
        const name = [...document.querySelectorAll('h2')].find(
          (one) => one.textContent === '综合素质测评',
        )!
        const limits = name.nextElementSibling as HTMLElement
        expect(limits.scrollWidth).toBeLessThanOrEqual(limits.clientWidth + 1)
        // and every column's name on the strip's one line
        for (const name of ['Score per entry', 'Entry limit', 'Review workflow']) {
          const cell = [...document.querySelectorAll<HTMLElement>('span')].find(
            (one) => one.textContent === name && one.checkVisibility(),
          )
          if (cell === undefined) continue
          expect(cell.getBoundingClientRect().height).toBeLessThan(20)
        }
      } finally {
        await page.viewport(1280, 900)
      }
    })
  }

  it('folds a section away with everything in it, and back', async () => {
    await withSections([
      question('66666666-6666-4666-8666-6666666666d1', '学生干部任职', CLASSWORK),
      question('66666666-6666-4666-8666-6666666666d2', '社会实践', MORAL),
    ])
    await vi.waitFor(() => expect(shown()).toHaveLength(4))
    const fold = page.getByRole('button', { name: '收起或展开「德育素质」' })
    await expect.element(fold).toHaveAttribute('aria-expanded', 'true')
    await fold.click()
    await vi.waitFor(() => expect(shown().map((row) => row.kind)).toEqual(['group']))
    await expect.element(fold).toHaveAttribute('aria-expanded', 'false')
    await fold.click()
    await vi.waitFor(() => expect(shown()).toHaveLength(4))
  })

  // A match lifted out of its section was a name with nothing to say where
  // it counts; the sections above it stay, quieter than the match.
  it('finds a question where it lives, with the sections it sits in', async () => {
    await withSections([
      question('66666666-6666-4666-8666-6666666666d1', '学生干部任职', CLASSWORK),
      question('66666666-6666-4666-8666-6666666666d2', '社会实践', MORAL),
    ])
    await vi.waitFor(() => expect(shown()).toHaveLength(4))
    await page.getByRole('searchbox', { name: '搜索分组或项目' }).fill('干部')
    await vi.waitFor(() =>
      expect(shown().map((row) => [row.kind, row.context])).toEqual([
        ['group', 'true'],
        ['group', 'true'],
        ['item', null],
      ]),
    )
    expect(shown()[2]!.name).toContain('学生干部任职')
  })

  // A row used to be a link with the row's own buttons inside it: a control
  // holding controls, whose spoken name ran every button's name together.
  it("opens a row from its name, a button of its own beside the row's other buttons", async () => {
    await withSections([
      question('66666666-6666-4666-8666-6666666666d1', '学生干部任职', CLASSWORK),
    ])
    await vi.waitFor(() => expect(shown()).toHaveLength(3))
    for (const row of document.querySelectorAll('[data-testid="structure-row"]')) {
      expect(row.getAttribute('role')).toBeNull()
      expect(row.hasAttribute('tabindex')).toBe(false)
      expect(row.querySelectorAll('button button, button a, a button').length).toBe(0)
      expect(row.querySelectorAll('[data-testid="structure-open"]')).toHaveLength(1)
    }
    const open = page.getByRole('button', { name: '学生干部任职', exact: true })
    ;(open.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(editor()).toBeVisible()
    expect(addressNow()).toContain('question=66666666-6666-4666-8666-6666666666d1')
  })

  // Found by its own name, a section came alone: its questions out of reach,
  // and no way to unfold it while the search stood.
  it('finds a section by its name with everything in it, still held to the state chosen', async () => {
    await withSections([
      question('66666666-6666-4666-8666-6666666666d1', '学生干部任职', CLASSWORK),
      question('66666666-6666-4666-8666-6666666666d2', '社会实践', MORAL, { status: 'draft' }),
    ])
    await vi.waitFor(() => expect(shown()).toHaveLength(4))
    await page.getByRole('searchbox', { name: '搜索分组或项目' }).fill('德育')
    await vi.waitFor(() =>
      expect(shown().map((row) => [row.kind, row.context])).toEqual([
        ['group', 'false'],
        ['item', null],
        ['group', 'false'],
        ['item', null],
      ]),
    )
    // what the state filter keeps out stays out, and the section stays as
    // the place the rest is found in
    await page.getByRole('combobox', { name: '状态' }).click()
    await page.getByRole('option', { name: '未发布' }).click()
    await vi.waitFor(() =>
      expect(shown().map((row) => [row.kind, row.context])).toEqual([
        ['group', 'true'],
        ['item', null],
      ]),
    )
    expect(shown()[1]!.name).toContain('社会实践')
  })

  // The questions whose route finds some of the roster nowhere are marked
  // where the paper is read, not only inside each question: an
  // administrator sees which to open before anybody files (§32.93).
  it('marks a question whose route finds some of the roster nowhere, by how many', async () => {
    const OTHER = '66666666-6666-4666-8666-6666666666d9'
    const at = { itemTitle: '学生干部任职', levelNames: ['班级'] }
    await open({
      items: [
        { ...officerItem(), scoreGroupId: PAPER_ID },
        { ...officerItem(), id: OTHER, title: '志愿服务', scoreGroupId: PAPER_ID },
      ],
      reach: [
        { ...at, itemId: ITEM_ID, route: 'escalation', participants: 3 },
        { ...at, itemId: ITEM_ID, route: 'normal', participants: 12 },
      ],
    })
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-testid="structure-review"]')).toHaveLength(2),
    )
    const cells = [...document.querySelectorAll('[data-testid="structure-review"]')]
    // a submission refused is said before an appeal refused
    const marked = cells[0]!.querySelector('[data-testid="structure-reach"]')!
    expect(marked.getAttribute('data-route')).toBe('normal')
    expect(marked.getAttribute('data-count')).toBe('12')
    expect(cells[1]!.querySelector('[data-testid="structure-reach"]')).toBeNull()
  })

  // The column read a single list off the stored policy, which has held two
  // routes for a long time, so it said nothing on every row.
  it('says how each question is reviewed from both of its routes, and when it is scored by a rule', async () => {
    const direct = question('66666666-6666-4666-8666-6666666666d3', '志愿服务', PAPER_ID, {
      currentRevision: { ...officerItem().currentRevision, reviewPolicy: { mode: 'none' } },
    })
    await open({
      items: [
        { ...officerWithAppeals(), scoreGroupId: PAPER_ID },
        direct,
        { ...formulaItem(), id: '66666666-6666-4666-8666-6666666666d4', scoreGroupId: PAPER_ID },
      ],
    })
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-testid="structure-review"]')).toHaveLength(3),
    )
    const said = (test: string, attribute: string) =>
      [...document.querySelectorAll(`[data-testid="${test}"]`)].map((cell) =>
        cell.getAttribute(attribute),
      )
    expect(said('structure-review', 'data-review')).toEqual(['1+1', 'direct', '1+0'])
    expect(said('structure-each', 'data-each')).toEqual(['2.00', '2.00', 'rule'])
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

  // Numbered by position, a question dropped right before a voided one took
  // the voided one's own value, and the list reads ties by age - so the
  // older voided question stayed first and the drop did not take.
  it('puts a question dropped beside a voided one where it was dropped', async () => {
    const FIRST = '66666666-6666-4666-8666-6666666666b1'
    const VOIDED = '66666666-6666-4666-8666-6666666666b2'
    const LAST = '66666666-6666-4666-8666-6666666666b3'
    const touched: string[] = []
    const saved: { sortOrder?: number }[] = []
    const question = (id: string, title: string, sortOrder: number, createdAt: string) => ({
      ...officerItem(),
      id,
      title,
      scoreGroupId: PAPER_ID,
      sortOrder,
      createdAt,
      ...(id === VOIDED ? { status: 'voided', voidReason: '重复设置' } : {}),
    })
    const items = [
      question(FIRST, '志愿服务', 0, '2026-02-01T00:00:00.000Z'),
      question(VOIDED, '社会实践', 1, '2026-01-01T00:00:00.000Z'),
      question(LAST, '文艺演出', 2, '2026-03-01T00:00:00.000Z'),
    ]
    await open({ items, touched, saved: saved as never })
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[draggable="true"]').length).toBeGreaterThanOrEqual(3),
    )

    dragOnto('文艺演出', '社会实践')
    await vi.waitFor(() => expect(touched).toContain(LAST))
    await new Promise((settle) => setTimeout(settle, 300))

    // the order the list will read back: by sort order, ties by age
    const now = new Map(items.map((one) => [one.id, one.sortOrder]))
    touched.forEach((id, index) => {
      const written = saved[index]?.sortOrder
      if (written !== undefined) now.set(id, written)
    })
    const read = [...items]
      .sort((a, b) => now.get(a.id)! - now.get(b.id)! || a.createdAt.localeCompare(b.createdAt))
      .map((one) => one.id)
    expect(read).toEqual([FIRST, LAST, VOIDED])
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

describe('review waiting for a reviewer', () => {
  const gaps = [
    {
      nodeId: 'n-major',
      nodeName: '大数据管理与应用',
      unitPath: ['示例大学', '管理学院', '大数据管理与应用'],
      roleIds: [ROLE_ID],
      roleNames: ['推免专业负责人'],
      reason: 'no-assignee',
      waiting: 1,
    },
    {
      nodeId: 'n-class',
      nodeName: '1班',
      unitPath: ['示例大学', '管理学院', '1班'],
      roleIds: [ROLE_ID],
      roleNames: ['班长', '学习委员'],
      reason: 'no-independent-reviewer',
      waiting: 4,
    },
    {
      nodeId: 'n-class-2',
      nodeName: '1班',
      unitPath: ['示例大学', '信息学院', '1班'],
      roleIds: [ROLE_ID],
      roleNames: ['班长'],
      reason: 'no-assignee',
      waiting: 3,
    },
    {
      nodeId: null,
      nodeName: null,
      unitPath: [],
      roleIds: [ROLE_ID],
      roleNames: ['辅导员'],
      reason: 'no-assignee',
      waiting: 2,
    },
  ]

  it('says in one amber line how much waits, and lays the units out only when asked', async () => {
    await open({ alerts: gaps })
    const notice = page.getByTestId('review-gap-notice')
    await expect.element(notice).toHaveAttribute('data-waiting', '10')
    // a step that stopped at no unit is not one more unit
    await expect.element(notice).toHaveAttribute('data-units', '3')
    // the rows wait behind a press: the page under this is the paper
    expect(page.getByTestId('review-gap-row').elements()).toHaveLength(0)
    await expect
      .element(notice.getByRole('link', { name: '去任命' }))
      .toHaveAttribute('href', `/assessment/batches/${BATCH_ID}/access`)

    await notice.getByRole('button', { name: '查看' }).click()
    await vi.waitFor(() => expect(page.getByTestId('review-gap-row').elements()).toHaveLength(4))
    // two classes called 1 are told apart by where they sit
    expect(
      page
        .getByTestId('review-gap-row')
        .elements()
        .map((row) => [
          row.getAttribute('data-place'),
          row.getAttribute('data-reason'),
          row.getAttribute('data-count'),
        ]),
    ).toEqual([
      ['管理学院/大数据管理与应用', 'no-assignee', '1'],
      ['管理学院/1班', 'no-independent-reviewer', '4'],
      ['信息学院/1班', 'no-assignee', '3'],
      ['', 'no-assignee', '2'],
    ])
    await notice.getByRole('button', { name: '收起' }).click()
    await vi.waitFor(() => expect(page.getByTestId('review-gap-row').elements()).toHaveLength(0))
  })

  // Read again every minute, it stands on the page for as long as review
  // waits: as a live region it cut into a screen reader each time a count
  // moved, and read the opened rows out in one breath. And its way to
  // appoint is a button, not a link in running prose: inside the notice's
  // title it was underlined like one.
  it('stands quietly on the page, with its way to appoint drawn as a button', async () => {
    await open({ alerts: gaps })
    const notice = page.getByTestId('review-gap-notice')
    await expect.element(notice).toBeVisible()
    const quiet = (element: Element | null) =>
      element === null ||
      (!['alert', 'status', 'log'].includes(element.getAttribute('role') ?? '') &&
        element.getAttribute('aria-live') === null)
    const inside = [notice.element(), ...notice.element().querySelectorAll('*')]
    expect(inside.every(quiet)).toBe(true)
    const appoint = notice.getByRole('link', { name: '去任命' }).element()
    expect(getComputedStyle(appoint).textDecorationLine).toBe('none')
  })

  it('offers no way to appoint to a reader who cannot give out the roles', async () => {
    await open({ alerts: gaps, manage: false })
    const notice = page.getByTestId('review-gap-notice')
    await expect.element(notice).toBeVisible()
    await expect.element(notice.getByRole('button', { name: '查看' })).toBeVisible()
    expect(notice.getByRole('link').elements()).toHaveLength(0)
  })

  it('says nothing where no review is waiting', async () => {
    await open({ items: [{ ...officerItem(), scoreGroupId: PAPER_ID }] })
    await vi.waitFor(() =>
      expect(page.getByText('学生干部任职').elements().length).toBeGreaterThan(0),
    )
    expect(document.querySelector('[data-testid="review-gap-notice"]')).toBeNull()
  })
})

describe('when the round cannot be read', () => {
  it('says the questions could not be read, on a card of its own, with a way to ask again', async () => {
    let fail = true
    const onPaper = { ...officerItem(), scoreGroupId: PAPER_ID }
    await open({
      itemsRead: () =>
        fail
          ? Effect.fail(apiError('INTERNAL_ERROR'))
          : Effect.succeed({ items: [onPaper], capabilities: { canManage: true } }),
    })
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="resource-state"]')).not.toBeNull(),
    )
    const failure = document.querySelector<HTMLElement>('[data-slot="resource-state"]')!
    expect(failure.getAttribute('data-state')).toBe('failed')
    // on the page's bare ground: a heading under the page's own, not a line
    expect(failure.querySelector('h2')).not.toBeNull()
    fail = false
    await page.getByRole('button', { name: '重试' }).click()
    await vi.waitFor(() =>
      expect(page.getByText('学生干部任职').elements().length).toBeGreaterThan(0),
    )
  })

  it('offers no second try to a reader refused the questions', async () => {
    await open({ itemsRead: () => Effect.fail(apiError('ACCESS_DENIED')) })
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="resource-state"]')).not.toBeNull(),
    )
    const failure = document.querySelector<HTMLElement>('[data-slot="resource-state"]')!
    expect(failure.getAttribute('data-state')).toBe('denied')
    expect(page.getByRole('button', { name: '重试' }).elements()).toHaveLength(0)
  })

  // What a question may be set to failed alone, and an opened question was
  // a blank pane with nothing said.
  it('says so when what a question may be set to cannot be read', async () => {
    await open({
      items: [officerItem()],
      question: ITEM_ID,
      optionsRead: () => Effect.fail(apiError('INTERNAL_ERROR')),
    })
    await vi.waitFor(() =>
      expect(document.querySelector('[data-slot="resource-state"]')).not.toBeNull(),
    )
    expect(document.querySelector('[data-slot="resource-state"]')!.getAttribute('data-state')).toBe(
      'failed',
    )
    await expect.element(page.getByRole('button', { name: '重试' })).toBeVisible()
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
          reviewAlerts: () => Effect.succeed({ groups: [], unreachable: NOBODY_UNREACHABLE }),
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
