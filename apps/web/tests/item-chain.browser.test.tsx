import { lazy } from 'react'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'
// the real stylesheet, because one assertion here is about visibility
// classes: the add key must not hide behind a hover
import '../src/app.css'

// The review chain as its author composes it: every step must be named and
// staffed before the question can be saved, and the chain itself has to say
// which step is unfinished; steps are added, reordered and removed with
// controls that are on show rather than discovered by hovering.

const ItemSettingsPage = (await components['assessment/ItemSettingsPage']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PAPER_ID = '22222222-2222-4222-8222-222222222222'
const ORG_TYPE_ID = '33333333-3333-4333-8333-333333333333'
const ROLE_ID = '44444444-4444-4444-8444-444444444444'
const SECTION_ID = '55555555-5555-4555-8555-555555555555'
const ITEM_ID = '66666666-6666-4666-8666-666666666666'
const REVISION_ID = '77777777-7777-4777-8777-777777777777'

const PAGES = [{ id: 'assessment/batch-items', path: '/assessment/batches/:batchId/items' }].map(
  (entry) => ({ ...entry, component: entry.id, layout: 'admin' }),
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

/** a saved office question: two points a post, five filable, highest counted */
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
    entrySource: 'student',
    // a named field: an unnamed one is another thing the editor refuses to
    // save, and this suite is about the scoring language
    formConfig: {
      files: {},
      fields: [{ id: 'claimed-level', key: 'claimed-level', label: '获奖级别', type: 'text' }],
    },
    scoringConfig: {
      calculator: { ref: 'fixed@1', config: { value: '2.00' } },
      aggregator: { ref: 'max@1', config: {} },
    },
    // a finished review step: the editor refuses to save an unfinished one,
    // and this suite's subject is the scoring language, not the chain
    reviewPolicy: {
      normal: {
        stages: [
          {
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

const FORMULA_VERSION_ID = '01920000-0000-7000-8000-0000000000f1'
const RECOGNITION_ID = '01920000-0000-7000-8000-0000000000f2'

/** a saved question whose arithmetic is a published formula: an identity
 *  this pen cannot yet author, and a refinement it cannot yet even show */
const formulaItem = () => ({
  ...officerItem(),
  title: '竞赛获奖',
  currentRevision: {
    ...officerItem().currentRevision,
    scoringConfig: {
      version: 2,
      calculator: { ref: 'formula@1', config: { versionId: FORMULA_VERSION_ID } },
      aggregator: { ref: 'max@1', config: {} },
      recognitions: {
        [RECOGNITION_ID]: {
          label: '认定级别',
          refinement: {
            type: 'string',
            format: 'qualy-decimal',
            'x-qualy-maxScale': 1,
            'x-qualy-minimum': '60',
            'x-qualy-maximum': '100',
          },
          defaultFromFieldId: 'claimed-level',
        },
      },
      bindings: { level: { kind: 'recognition', recognitionId: RECOGNITION_ID } },
    },
  },
})

/** the calculator surfaces this editor now assembles itself from: the
 *  chooser reads the manifest, and the chosen calculator's own editor
 *  arrives through the slot - the same route a plugin's would */
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
    'assessment/calculator-editor': [
      {
        id: 'assessment/fixed-calculator-editor',
        component: 'assessment/FixedCalculatorEditor',
        order: 10,
      },
    ],
  },
}

const open = (
  had: {
    groups?: readonly unknown[]
    items?: readonly unknown[]
    saved?: { config?: unknown }[]
    /** the question the page opens on, as the address names it */
    question?: string
    /** the calculator surfaces this assembly declares */
    surfaces?: { collections: Record<string, unknown[]>; slots: Record<string, unknown[]> }
  } = {},
) =>
  renderScreen({
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
        listItems: () =>
          Effect.succeed({ items: had.items ?? [], capabilities: { canManage: true } }),
        itemOptions: () =>
          Effect.succeed({
            orgTypes: [{ id: ORG_TYPE_ID, code: 'class', name: '班级' }],
            roles: [{ id: ROLE_ID, name: '审核员' }],
          }),
        reviewAlerts: () => Effect.succeed({ groups: [] }),
        reviewCoverage: () => Effect.succeed({ nodes: [] }),
        updateItem: (call: { payload: { config?: unknown } }) => {
          had.saved?.push(call.payload)
          return Effect.succeed({ item: { id: ITEM_ID } })
        },
      },
    } as never),
    routes: [
      {
        path: '/assessment/batches/:batchId/items',
        element: <ItemSettingsPage />,
      },
    ] as never,
    registry: {
      'assessment/FixedCalculatorEditor': lazy(
        () => components['assessment/FixedCalculatorEditor']!() as never,
      ),
    } as never,
    route:
      had.question === undefined
        ? `/assessment/batches/${BATCH_ID}/items`
        : `/assessment/batches/${BATCH_ID}/items?question=${had.question}`,
  })

/** into the editor of a question being composed, chain on screen */
const composeQuestion = async () => {
  open()
  await page.getByRole('button', { name: '新建' }).click()
  await page.getByRole('menuitem', { name: '新建项目' }).click()
  await expect.element(page.getByTestId('chain-step').first()).toBeVisible()
}

describe('composing the review chain', () => {
  it('marks the unnamed step unfinished instead of dressing it in a default name', async () => {
    await composeQuestion()

    // the fresh step has neither name nor reviewers: the chain says so
    const step = page.getByTestId('chain-step').first()
    await expect.element(step).toHaveAttribute('data-step-complete', 'false')

    // naming it and choosing its reviewers is what completes it
    await step.getByRole('button').first().click()
    const sheet = page.getByRole('dialog')
    const name = sheet.getByRole('textbox', { name: '环节名称' })
    // the name is required, and the field says so before anybody saves
    await expect.element(name).toHaveAttribute('aria-required')
    await name.fill('班委初审')
    await sheet.getByRole('checkbox', { name: '审核员' }).click()
    await sheet.getByRole('button', { name: '关闭' }).click()

    await expect.element(step).toHaveAttribute('data-step-complete', 'true')
    await expect.element(page.getByText('班委初审')).toBeVisible()
  })

  it('keeps the add key on show, and the sole ordinary step deletable-looking but held', async () => {
    await composeQuestion()

    // the way steps are added must be visible before anybody hovers: the
    // gap keys exist and are painted, not parked at opacity zero
    const adds = page.getByRole('button', { name: '添加审核步骤' }).elements()
    expect(adds.length).toBeGreaterThanOrEqual(2)
    for (const key of adds) {
      expect(getComputedStyle(key).opacity).toBe('1')
    }

    // the one step the ordinary route must keep: its remove key stands,
    // disabled, rather than vanishing and leaving nothing to explain
    const step = page.getByTestId('chain-step').first()
    await expect.element(step.getByRole('button', { name: '删除步骤' })).toBeDisabled()
    // and with a single step there is nowhere to move it
    await expect.element(step.getByRole('button', { name: '前移' })).toBeDisabled()
    await expect.element(step.getByRole('button', { name: '后移' })).toBeDisabled()
  })

  it('adds where the press pointed, reorders with the arrows, and frees the delete key', async () => {
    await composeQuestion()

    // name the step that is already there
    const first = page.getByTestId('chain-step').first()
    await first.getByRole('button').first().click()
    const sheet = () => page.getByRole('dialog')
    await sheet().getByRole('textbox', { name: '环节名称' }).fill('班委初审')
    await sheet().getByRole('checkbox', { name: '审核员' }).click()
    await sheet().getByRole('button', { name: '关闭' }).click()

    // one more after it, named through the sheet the add opens; the
    // locator click waits out the closing panel's animation
    await page.getByRole('button', { name: '添加审核步骤' }).nth(1).click()
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

    // the arrows swap neighbours; order is the chain's whole meaning
    await page.getByTestId('chain-step').first().getByRole('button', { name: '后移' }).click()
    expect(titlesNow()[0]).toContain('专业复审')
    expect(titlesNow()[1]).toContain('班委初审')

    // two steps on the ordinary route: both removable now, and removing
    // one puts the sole survivor back under guard
    await page.getByTestId('chain-step').first().getByRole('button', { name: '删除步骤' }).click()
    expect(page.getByTestId('chain-step').elements()).toHaveLength(1)
    await expect
      .element(page.getByTestId('chain-step').getByRole('button', { name: '删除步骤' }))
      .toBeDisabled()
  })
})

describe('what a question can contribute', () => {
  it('counts the entries the folding rule keeps, not every entry that may be filed', async () => {
    await composeQuestion()
    await page.getByRole('textbox', { name: '每条通过计分' }).fill('2')
    await page.getByRole('spinbutton', { name: '每人可申报条数' }).fill('5')

    // everything counts: five filings of two
    const ceiling = page.getByTestId('item-ceiling')
    await expect.element(ceiling).toHaveAttribute('data-ceiling', '10')

    // only the highest office counts, so the question is worth one filing
    // however many an officer may file
    const folding = () => page.getByRole('combobox', { name: '多条申报计分方式' })
    await folding().click()
    await page.getByRole('option', { name: '仅计最高一条' }).click()
    await expect.element(ceiling).toHaveAttribute('data-ceiling', '2')

    // the best two of the five
    await folding().click()
    await page.getByRole('option', { name: '计最高 N 条之和' }).click()
    await expect.element(ceiling).toHaveAttribute('data-ceiling', '4')
  })

  it('sizes a section against what the rule counts, not against every filing', async () => {
    open({
      groups: [
        paper,
        { ...paper, id: SECTION_ID, parentGroupId: PAPER_ID, name: '文体', itemCount: 1 },
      ],
      items: [officerItem()],
    })

    // 2 a post, five posts filed, only the highest counted
    await expect.element(page.getByTestId('group-subtotal')).toHaveAttribute('data-subtotal', '2')
  })
})

describe('what a save may not quietly rewrite', () => {
  it("returns a formula question's arithmetic exactly as it arrived", async () => {
    // The pen cannot author recognitions, bindings or refinements. Opening
    // such a question and renaming it must therefore hand the arithmetic
    // back byte for byte - anything less deletes what it cannot see.
    const saved: { config?: unknown }[] = []
    const item = formulaItem()
    open({
      groups: [paper, { ...paper, id: SECTION_ID, parentGroupId: PAPER_ID, name: '文体' }],
      items: [item],
      saved,
      question: ITEM_ID,
    })
    await expect.element(page.getByRole('textbox', { name: '标题' })).toBeVisible()
    await page.getByRole('textbox', { name: '标题' }).fill('竞赛获奖(改名)')
    await page.getByRole('button', { name: '保存' }).click()

    await expect.poll(() => saved.length).toBe(1)
    const sent = (saved[0]?.config as { scoringConfig?: unknown })?.scoringConfig
    expect(JSON.stringify(sent)).toBe(JSON.stringify(item.currentRevision.scoringConfig))
  })

  it('still rebuilds the legacy language from the fields that own it', async () => {
    const saved: { config?: unknown }[] = []
    open({
      groups: [paper, { ...paper, id: SECTION_ID, parentGroupId: PAPER_ID, name: '文体' }],
      items: [officerItem()],
      saved,
      question: ITEM_ID,
    })
    await expect.element(page.getByRole('textbox', { name: '每条通过计分' })).toBeVisible()
    await page.getByRole('textbox', { name: '每条通过计分' }).fill('3')
    await page.getByRole('button', { name: '保存' }).click()

    await expect.poll(() => saved.length).toBe(1)
    const sent = (saved[0]?.config as { scoringConfig?: { calculator?: { config?: unknown } } })
      ?.scoringConfig
    expect(sent?.calculator?.config).toEqual({ value: '3' })
  })
})

describe("what may do a question's arithmetic", () => {
  it('offers what the assembly installed, and lets it edit its own configuration', async () => {
    // The chooser is assembled from the manifest, so a second calculator
    // needs no case in this editor - and the amount field belongs to the
    // calculator that owns it, arriving through the slot.
    const saved: { config?: unknown }[] = []
    open({
      groups: [paper, { ...paper, id: SECTION_ID, parentGroupId: PAPER_ID, name: '文体' }],
      items: [officerItem()],
      saved,
      question: ITEM_ID,
      surfaces: {
        collections: {
          'assessment/calculator-authoring-options': [
            ...CALCULATOR_SURFACES.collections['assessment/calculator-authoring-options'],
            {
              id: 'test/other-calculator',
              ref: 'other@1',
              label: { kind: 'literal', value: '另一种算法' },
              order: 20,
            },
          ],
        },
        slots: CALCULATOR_SURFACES.slots,
      },
    })

    // what the assembly installed is what the chooser knows about; it is
    // read-only until every calculator on offer has an editor, so this
    // proves the enumeration and not a selection
    const chooser = page.getByRole('combobox', { name: '分值来源' })
    await expect.element(chooser).toBeVisible()
    await expect.element(chooser).toBeDisabled()
    // the built-in editor holds the seat, because it is what this question
    // is scored by
    await expect.element(page.getByRole('textbox', { name: '每条通过计分' })).toBeVisible()
  })

  it('leaves the seat empty for a calculator it does not own', async () => {
    // the same built-in editor, in front of a question scored by a formula:
    // it renders for its own reference and nothing for anybody else's
    open({
      groups: [paper, { ...paper, id: SECTION_ID, parentGroupId: PAPER_ID, name: '文体' }],
      items: [formulaItem()],
      question: ITEM_ID,
    })
    await expect.element(page.getByRole('textbox', { name: '标题' })).toBeVisible()
    expect(page.getByRole('textbox', { name: '每条通过计分' }).elements()).toHaveLength(0)
  })
})

describe('a scoring language this build does not speak', () => {
  it('carries it whole and refuses to author it', async () => {
    // Read as the legacy language, a newer build's configuration would be
    // rebuilt as a fixed amount by a rename - the very rewrite this model
    // exists to prevent. So it travels untouched and its controls close.
    const saved: { config?: unknown }[] = []
    const item = formulaItem()
    const future = {
      ...item,
      currentRevision: {
        ...item.currentRevision,
        scoringConfig: { ...item.currentRevision.scoringConfig, version: 3, novelty: 'kept' },
      },
    }
    open({
      groups: [paper, { ...paper, id: SECTION_ID, parentGroupId: PAPER_ID, name: '文体' }],
      items: [future],
      saved,
      question: ITEM_ID,
    })
    await expect.element(page.getByRole('textbox', { name: '标题' })).toBeVisible()
    expect(page.getByRole('textbox', { name: '每条通过计分' }).elements()).toHaveLength(0)
    await expect.element(page.getByRole('combobox', { name: '多条申报计分方式' })).toBeDisabled()

    await page.getByRole('textbox', { name: '标题' }).fill('未来的题(改名)')
    await page.getByRole('button', { name: '保存' }).click()
    await expect.poll(() => saved.length).toBe(1)
    const sent = (saved[0]?.config as { scoringConfig?: unknown })?.scoringConfig
    expect(JSON.stringify(sent)).toBe(JSON.stringify(future.currentRevision.scoringConfig))
  })
})

describe('who owns which half of a versioned configuration', () => {
  it('writes the folding rule it owns without disturbing the arithmetic', async () => {
    // The folding rule was always this editor's field; the calculator's
    // configuration, its recognitions and their refinements never were. A
    // change to one must not travel as a change to the other.
    const saved: { config?: unknown }[] = []
    const item = formulaItem()
    open({
      groups: [paper, { ...paper, id: SECTION_ID, parentGroupId: PAPER_ID, name: '文体' }],
      items: [item],
      saved,
      question: ITEM_ID,
    })
    const folding = page.getByRole('combobox', { name: '多条申报计分方式' })
    await expect.element(folding).toBeVisible()
    await folding.click()
    await page.getByRole('option', { name: '全部累加' }).click()
    await page.getByRole('button', { name: '保存' }).click()

    await expect.poll(() => saved.length).toBe(1)
    const sent = (saved[0]?.config as { scoringConfig?: Record<string, unknown> })?.scoringConfig
    const was = item.currentRevision.scoringConfig
    expect(sent?.['aggregator']).toEqual({ ref: 'sum@1', config: {} })
    expect(sent?.['version']).toBe(2)
    expect(JSON.stringify(sent?.['calculator'])).toBe(JSON.stringify(was.calculator))
    expect(JSON.stringify(sent?.['recognitions'])).toBe(JSON.stringify(was.recognitions))
    expect(JSON.stringify(sent?.['bindings'])).toBe(JSON.stringify(was.bindings))
  })
})
