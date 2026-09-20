import ItemSettingsPage from '../src/client/items/ItemSettingsPage.tsx'
import { lazy } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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
        ...(over.bindings ?? {}),
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
        label: { kind: 'message', id: 'assessment/items/calculator-fixed', defaultMessage: 'Fixed' },
        order: 10,
      },
    ],
  },
  slots: {
    'assessment/calculator-editor': [{ id: 'assessment/fixed-calculator-editor', order: 10 }],
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

const open = (
  had: {
    items?: readonly unknown[]
    saved?: { config?: unknown; itemType?: unknown }[]
    question?: string
    panel?: string
    surfaces?: { collections: Record<string, unknown[]>; slots: Record<string, unknown[]> }
    preview?: unknown
  } = {},
) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({ ...emptyManifest(), pages: PAGES, ...(had.surfaces ?? CALCULATOR_SURFACES) }),
      },
      assessment: {
        getBatch: () => Effect.succeed({ batch: batch() }),
        listScoreGroups: () =>
          Effect.succeed({ groups: [paper], version: 1, capabilities: { canManage: true } }),
        listItems: () => Effect.succeed({ items: had.items ?? [], capabilities: { canManage: true } }),
        itemOptions: () =>
          Effect.succeed({
            orgTypes: [{ id: ORG_TYPE_ID, code: 'class', name: '班级' }],
            roles: [{ id: ROLE_ID, name: '审核员' }],
          }),
        reviewAlerts: () => Effect.succeed({ groups: [] }),
        reviewCoverage: () => Effect.succeed({ nodes: [] }),
        createItem: (call: { payload: { config?: unknown; itemType?: unknown } }) => {
          had.saved?.push(call.payload)
          return Effect.succeed({ item: { id: ITEM_ID } })
        },
        updateItem: (call: { payload: { config?: unknown; itemType?: unknown } }) => {
          had.saved?.push(call.payload)
          return Effect.succeed({ item: { id: ITEM_ID } })
        },
        previewScoring: (call: { payload: { calculator: { ref: string } } }) =>
          Effect.succeed(had.preview ?? previewFor(call.payload.calculator.ref)),
      },
      assessmentFormula: {
        listFormulaBindingOptions: () => Effect.succeed(bindingOptions()),
      },
    } as never),
    routes: [{ path: '/assessment/batches/:batchId/items', element: <ItemSettingsPage /> }] as never,
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
    } as never,
    route:
      had.question === undefined
        ? `/assessment/batches/${BATCH_ID}/items`
        : `/assessment/batches/${BATCH_ID}/items?question=${had.question}${had.panel === undefined ? '' : `&panel=${had.panel}`}`,
  })

const editor = () => page.getByTestId('item-editor')

/** into the editor of a question being composed */
const composeQuestion = async () => {
  open()
  await page.getByRole('button', { name: '新建' }).click()
  await page.getByRole('menuitem', { name: '新建项目' }).click()
  await expect.element(editor()).toBeVisible()
}

const tab = (name: RegExp) => page.getByRole('tab', { name })

/** the one element a data attribute names, once it is on screen */
const seat = async (selector: string) => {
  await vi.waitFor(() => {
    if (document.querySelector(selector) === null) throw new Error(`${selector} is not on screen yet`)
  })
  return page.elementLocator(document.querySelector<HTMLElement>(selector)!)
}

const parameterRow = (parameter: string) => seat(`[data-parameter-row="${parameter}"]`)
const linkedRows = () => document.querySelectorAll('[data-testid="form-field-row"][data-linked="true"]')

const chooseSource = async (parameter: string, option: string) => {
  const row = await parameterRow(parameter)
  await row.getByRole('combobox').click()
  await page.getByRole('option', { name: option }).click()
}

describe('choosing how a question is handled', () => {
  it('opens a new question on review, with participants filing, and the rules tab in place', async () => {
    await composeQuestion()
    await expect.element(editor()).toHaveAttribute('data-mode', 'review')
    await expect.element(page.getByRole('radio', { name: '审核后生效' })).toHaveAttribute('aria-checked', 'true')
    await expect.element(page.getByRole('checkbox', { name: '参评人员申报' })).toHaveAttribute('aria-checked', 'true')
    await expect.element(page.getByRole('checkbox', { name: '工作人员统一认定' })).toHaveAttribute('aria-checked', 'false')
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

  it('saves both doors when both are open', async () => {
    const saved: { config?: unknown }[] = []
    open({ items: [officerItem()], question: ITEM_ID, saved })
    await expect.element(page.getByRole('checkbox', { name: '工作人员统一认定' })).toBeVisible()
    await page.getByRole('checkbox', { name: '工作人员统一认定' }).click()
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect((saved[0]?.config as { entryChannels: string[] }).entryChannels).toEqual([
      'participant',
      'administrative',
    ])
  })
})

describe('feeding the arithmetic', () => {
  it('lists the parameters, and a determined one becomes a determination field', async () => {
    open({ items: [formulaItem({ defaultFromFieldId: null })], question: ITEM_ID, panel: 'scoring', surfaces: BOTH_CALCULATORS })
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
    open({
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
    await expect.element(sheet.getByTestId('recognition-link')).toHaveAttribute('data-linked', 'true')
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
    await expect.element(sheet.getByTestId('recognition-link')).toHaveAttribute('data-linked', 'false')
    await sheet.getByRole('button', { name: '完成' }).click()
    await vi.waitFor(() => expect(linkedRows()).toHaveLength(0))
    expect(page.getByTestId('form-field-row').elements()).toHaveLength(2)
  })

  it('asks before switching to take effect on submission while a determination has no field', async () => {
    open({ items: [formulaItem({ defaultFromFieldId: null })], question: ITEM_ID, surfaces: BOTH_CALCULATORS })
    await expect.element(page.getByRole('radio', { name: '提交即生效' })).toBeVisible()
    // the contract has to be in hand for the editor to know what is unlinked
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="pending-trigger"], [data-testid="pending-none"]') === null)
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
    open({ items: [formulaItem()], question: ITEM_ID, surfaces: BOTH_CALCULATORS })
    await expect.element(page.getByRole('radio', { name: '自动计分' })).toBeVisible()
    await vi.waitFor(() => {
      if (document.querySelector('[data-testid="pending-trigger"], [data-testid="pending-none"]') === null)
        throw new Error('not settled')
    })
    // a saved question's kind is settled: the card is locked
    await expect.element(page.getByRole('radio', { name: '自动计分' })).toBeDisabled()
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
    open({ items: [item], question: ITEM_ID, saved })
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('学生干部任职（改）')
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    const fields = (saved[0]?.config as { formConfig: { fields: { maxFileBytes?: number }[] } }).formConfig.fields
    expect(fields[0]?.maxFileBytes).toBe(512 * 1024)
  })

  it("returns a formula question's arithmetic exactly as it arrived when nothing about it moved", async () => {
    const saved: { config?: unknown }[] = []
    open({ items: [formulaItem()], question: ITEM_ID, surfaces: BOTH_CALCULATORS, saved })
    await expect.element(page.getByRole('textbox', { name: '项目名称' })).toBeVisible()
    await page.getByRole('textbox', { name: '项目名称' }).fill('竞赛获奖（改）')
    await page.getByTestId('item-save').click()
    await vi.waitFor(() => expect(saved).toHaveLength(1))
    expect((saved[0]?.config as { scoringConfig: unknown }).scoringConfig).toEqual(
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
    await page.getByRole('spinbutton', { name: '每人可申报条数' }).fill('5')
    const ceiling = page.getByTestId('item-ceiling')
    await expect.element(ceiling).toHaveAttribute('data-ceiling', '10')
    const folding = () => page.getByRole('combobox', { name: '多条申报计分方式' })
    await folding().click()
    await page.getByRole('option', { name: '仅计最高一条', exact: false }).click()
    await expect.element(ceiling).toHaveAttribute('data-ceiling', '2')
    await folding().click()
    await page.getByRole('option', { name: '计最高 N 条之和', exact: false }).click()
    await expect.element(ceiling).toHaveAttribute('data-ceiling', '4')
  })

  it('adds a step where the press pointed, names it in its sheet, and reorders it', async () => {
    await composeQuestion()
    await tab(/记录与审核/).click()
    // a new question starts with no step: the chain says so and the save walks there
    expect(page.getByTestId('chain-step').elements()).toHaveLength(0)
    await page.getByTestId('chain-normal').getByRole('button', { name: '添加审核步骤' }).first().click()
    const sheet = () => page.getByRole('dialog')
    await sheet().getByRole('textbox', { name: '环节名称' }).fill('班委初审')
    await sheet().getByRole('checkbox', { name: '审核员' }).click()
    await sheet().getByRole('button', { name: '关闭' }).click()
    await expect.element(page.getByTestId('chain-step').first()).toHaveAttribute('data-step-complete', 'true')

    await page.getByTestId('chain-normal').getByRole('button', { name: '添加审核步骤' }).nth(1).click()
    await sheet().getByRole('textbox', { name: '环节名称' }).fill('专业复审')
    await sheet().getByRole('checkbox', { name: '审核员' }).click()
    await sheet().getByRole('button', { name: '关闭' }).click()

    const titlesNow = () =>
      page
        .getByTestId('chain-step')
        .elements()
        .map((node) => node.textContent ?? '')
    expect(titlesNow()[0]).toContain('班委初审')
    expect(titlesNow()[1]).toContain('专业复审')
    await page.getByTestId('chain-step').first().getByRole('button', { name: '后移' }).click()
    expect(titlesNow()[0]).toContain('专业复审')
    await page.getByTestId('chain-step').first().getByRole('button', { name: '删除步骤' }).click()
    expect(page.getByTestId('chain-step').elements()).toHaveLength(1)
    await expect
      .element(page.getByTestId('chain-step').getByRole('button', { name: '删除步骤' }))
      .toBeDisabled()
  })

  it('walks the save to the first unfinished thing instead of sending', async () => {
    const saved: { config?: unknown; itemType?: unknown }[] = []
    open({ saved })
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
