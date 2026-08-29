import { describe, expect, it, vi } from 'vitest'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// The authoring loop around the editor: the draft contract preview turns
// the JSON test box into a typed form, the try-run and the regression rows
// share one evaluator wire, results go stale with the code, and a save
// never holds the code hostage to broken cases.

const FormulaEditorPage = (await components['assessment-formula/FormulaEditorPage']!()).default

const FN_ID = '01a04f4b-83a1-763f-9fbc-bfa53bc98ecb'

// the stubbed preview never compiles this; any stable text will do
const SOURCE = `// the draft buffer the page loads; the compiled truth lives server-side
`

const contract = {
  sourceSha256: 'a'.repeat(64),
  contractSha256: 'b'.repeat(64),
  inputSchema: normalizeInputSchema({
    type: 'object',
    properties: {
      level: {
        type: 'string',
        enum: ['national', 'provincial'],
        'x-qualy-enumLabels': { national: '国家级', provincial: '省级' },
        title: '赛事级别',
      },
      ordinal: { type: 'integer', minimum: 1, maximum: 10, title: '奖项序位' },
      base: {
        type: 'string',
        format: 'qualy-decimal',
        'x-qualy-maxScale': 2,
        'x-qualy-minimum': '0',
        'x-qualy-maximum': '10',
      },
    },
    required: ['base', 'level', 'ordinal'],
    additionalProperties: false,
    'x-qualy-order': ['level', 'ordinal', 'base'],
  }),
  outputSchema: normalizeAtomicSchema({
    type: 'string',
    format: 'qualy-decimal',
    'x-qualy-maxScale': 2,
  }),
}

const detail = (tests: readonly { name: string; input: unknown; expected: string }[]) => ({
  function: {
    id: FN_ID,
    name: '认定分值',
    description: null,
    ownerNodeId: 'node-1',
    status: 'active',
    draftRevision: 1,
    latestVersionNo: null,
    updatedAt: new Date().toISOString(),
    draftSourceTs: SOURCE,
    draftTests: tests,
  },
  versions: [],
})

interface Wire {
  previews: unknown[]
  evaluations: { sourceTs: string; cases: readonly { clientId: string; input: unknown; expected?: string }[] }[]
  saves: Record<string, unknown>[]
}

const screenFor = (
  tests: readonly { name: string; input: unknown; expected: string }[],
  answer: (cases: readonly { clientId: string; input: unknown }[]) => readonly Record<string, unknown>[],
) => {
  const wire: Wire = { previews: [], evaluations: [], saves: [] }
  const client = fakeClient({
    app: { getManifest: emptyManifest() },
    assessmentFormula: {
      getFormulaFunction: detail(tests),
      previewFormulaDraft: (request: { payload: { sourceTs: string } }) => {
        wire.previews.push(request.payload.sourceTs)
        return Effect.succeed(contract)
      },
      evaluateFormulaDraft: (request: {
        payload: { sourceTs: string; cases: Wire['evaluations'][number]['cases'] }
      }) => {
        wire.evaluations.push(request.payload)
        return Effect.succeed({ ...contract, cases: answer(request.payload.cases) })
      },
      updateFormulaDraft: (request: { payload: Record<string, unknown> }) => {
        wire.saves.push(request.payload)
        return Effect.succeed(detail(tests))
      },
    },
  })
  const screen = renderScreen({
    client,
    route: `/assessment/formulas/${FN_ID}`,
    path: '/assessment/formulas/:functionId',
    children: <FormulaEditorPage />,
  })
  return { wire, screen }
}

const waitForForm = async (screen: Awaited<ReturnType<typeof renderScreen>>) => {
  await vi.waitFor(
    () => {
      const state = screen.container
        .querySelector('[data-testid="formula-structure"]')
        ?.getAttribute('data-state')
      if (state !== 'synced') throw new Error(`structure is ${state ?? 'absent'}`)
    },
    { timeout: 15_000 },
  )
}

describe('the formula authoring tools', () => {
  it('turns the contract preview into a typed form and runs the try-case', async () => {
    const { wire, screen } = screenFor(
      [{ name: 'seed', input: { level: 'national', ordinal: 2, base: '4' }, expected: '8' }],
      (cases) => cases.map((one) => ({ clientId: one.clientId, actual: '5' })),
    )
    const view = await screen
    try {
      await waitForForm(view)
      // the preview asked about the loaded draft buffer
      expect(wire.previews[0]).toBe(SOURCE)

      // the try form speaks the annotation words, in authored order
      const tryForm = view.container.querySelector('[data-testid="value-form-try"]')!
      expect(tryForm.textContent).toContain('赛事级别')
      const order = [...tryForm.querySelectorAll('[data-parameter]')].map((node) =>
        node.getAttribute('data-parameter'),
      )
      expect(order).toEqual(['level', 'ordinal', 'base'])

      // fill and run: the wire sees the MATERIALIZED value, typed
      const select = tryForm.querySelector('select')!
      select.value = 'provincial'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      const [ordinalInput, baseInput] = [
        ...tryForm.querySelectorAll('input:not([type="checkbox"])'),
      ] as HTMLInputElement[]
      for (const [element, value] of [
        [ordinalInput!, '3'],
        [baseInput!, '2.50'],
      ] as const) {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          'value',
        )!.set!
        setter.call(element, value)
        element.dispatchEvent(new Event('input', { bubbles: true }))
      }
      const runButton = [...view.container.querySelectorAll('button')].find(
        (button) => button.textContent === '运行',
      )!
      runButton.click()
      await vi.waitFor(
        () => {
          if (view.container.querySelector('[data-testid="formula-try-result"]') === null)
            throw new Error('no result yet')
        },
        { timeout: 10_000 },
      )
      expect(wire.evaluations[0]!.cases).toEqual([
        { clientId: 'try', input: { level: 'provincial', ordinal: 3, base: '2.5' } },
      ])
      expect(
        view.container.querySelector('[data-testid="formula-try-result"]')!.textContent,
      ).toContain('5')
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('runs the whole suite and marks rows; an illegal row blocks only the tests', async () => {
    const { wire, screen } = screenFor(
      [
        { name: 'good', input: { level: 'national', ordinal: 2, base: '4' }, expected: '8' },
        { name: 'ghost', input: { level: 'municipal', ordinal: 1, base: '1' }, expected: '1' },
      ],
      (cases) =>
        cases.map((one, index) => ({
          clientId: one.clientId,
          passed: index === 0,
          actual: index === 0 ? '8' : '2',
          expected: '8',
        })),
    )
    const view = await screen
    try {
      await waitForForm(view)
      const rows = view.container.querySelectorAll('[data-testid="formula-test-case"]')
      expect(rows.length).toBe(2)
      expect(rows[0]!.getAttribute('data-legal')).toBe('true')
      // the stored value no longer fits the contract: marked, not deleted
      expect(rows[1]!.getAttribute('data-legal')).toBe('false')

      const runAll = [...view.container.querySelectorAll('button')].find(
        (button) => button.textContent === '全部运行',
      )!
      runAll.click()
      await vi.waitFor(
        () => {
          if (view.container.querySelector('[data-testid="formula-case-result"]') === null)
            throw new Error('no case results yet')
        },
        { timeout: 10_000 },
      )
      const results = view.container.querySelectorAll('[data-testid="formula-case-result"]')
      expect(results[0]!.getAttribute('data-passed')).toBe('true')

      // a CLEAN save is a business no-op: the button is disabled and no
      // request leaves the browser
      const saveButton = [...view.container.querySelectorAll('button')].find(
        (button) => button.textContent === '保存草稿',
      )!
      expect(saveButton.disabled).toBe(true)
      expect(wire.saves.length).toBe(0)

      // dirty the tests (rename a case) and the function name; saving then
      // patches the name only - the broken case holds the tests back, and
      // nothing claims they were contract-checked
      const caseName = rows[0]!.querySelector('input')! as HTMLInputElement
      const nameSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        'value',
      )!.set!
      nameSetter.call(caseName, 'renamed case')
      caseName.dispatchEvent(new Event('input', { bubbles: true }))
      const inputs = [...view.container.querySelectorAll('input')] as HTMLInputElement[]
      const nameField = inputs.find((one) => one.value === '认定分值')!
      nameSetter.call(nameField, '认定分值 v2')
      nameField.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.waitFor(
        () => {
          if (saveButton.disabled) throw new Error('still clean')
        },
        { timeout: 5_000 },
      )
      saveButton.click()
      await vi.waitFor(
        () => {
          if (wire.saves.length === 0) throw new Error('no save yet')
        },
        { timeout: 10_000 },
      )
      expect(wire.saves[0]).toHaveProperty('name', '认定分值 v2')
      expect(wire.saves[0]).not.toHaveProperty('draftTests')
      expect(wire.saves[0]).not.toHaveProperty('draftSourceTs')
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('keeps results honest: edits stale them, and a stale actual cannot be adopted', async () => {
    const { screen } = screenFor(
      [{ name: 'seed', input: { level: 'national', ordinal: 2, base: '4' }, expected: '8' }],
      (cases) => cases.map((one) => ({ clientId: one.clientId, actual: '5' })),
    )
    const view = await screen
    try {
      await waitForForm(view)
      const tryForm = view.container.querySelector('[data-testid="value-form-try"]')!
      const select = tryForm.querySelector('select')!
      select.value = 'national'
      select.dispatchEvent(new Event('change', { bubbles: true }))
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      const [ordinalInput, baseInput] = [
        ...tryForm.querySelectorAll('input:not([type="checkbox"])'),
      ] as HTMLInputElement[]
      setter.call(ordinalInput!, '2')
      ordinalInput!.dispatchEvent(new Event('input', { bubbles: true }))
      setter.call(baseInput!, '4')
      baseInput!.dispatchEvent(new Event('input', { bubbles: true }))
      const runButton = [...view.container.querySelectorAll('button')].find(
        (button) => button.textContent === '运行',
      )!
      runButton.click()
      await vi.waitFor(
        () => {
          if (view.container.querySelector('[data-testid="formula-try-result"]') === null)
            throw new Error('no result yet')
        },
        { timeout: 10_000 },
      )
      // fresh: the adopt button offers the actual
      expect(
        [...view.container.querySelectorAll('button')].some((button) =>
          button.textContent?.includes('设为预期值'),
        ),
      ).toBe(true)

      // the INPUT moves; the result and the adopt offer both go stale,
      // though the code never changed
      setter.call(ordinalInput!, '9')
      ordinalInput!.dispatchEvent(new Event('input', { bubbles: true }))
      await vi.waitFor(
        () => {
          const result = view.container.querySelector('[data-testid="formula-try-result"]')
          if (result?.getAttribute('data-stale') !== 'true') throw new Error('not stale yet')
        },
        { timeout: 5_000 },
      )
      expect(
        [...view.container.querySelectorAll('button')].some((button) =>
          button.textContent?.includes('设为预期值'),
        ),
      ).toBe(false)
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('keeps results with their case when a neighbour is deleted', async () => {
    const { screen } = screenFor(
      [
        { name: 'first', input: { level: 'national', ordinal: 1, base: '1' }, expected: '2' },
        { name: 'second', input: { level: 'provincial', ordinal: 2, base: '2' }, expected: '2' },
      ],
      (cases) => cases.map((one) => ({ clientId: one.clientId, passed: true, actual: '2' })),
    )
    const view = await screen
    try {
      await waitForForm(view)
      const rows = () => [...view.container.querySelectorAll('[data-testid="formula-test-case"]')]
      // run the SECOND row only
      const secondRun = [...rows()[1]!.querySelectorAll('button')].find(
        (button) => button.textContent === '运行',
      )!
      secondRun.click()
      await vi.waitFor(
        () => {
          if (rows()[1]!.querySelector('[data-testid="formula-case-result"]') === null)
            throw new Error('no result yet')
        },
        { timeout: 10_000 },
      )
      // delete the FIRST row: the survivor keeps ITS result
      const firstDelete = [...rows()[0]!.querySelectorAll('button')].find(
        (button) => button.textContent === '移除',
      )!
      firstDelete.click()
      await vi.waitFor(
        () => {
          if (rows().length !== 1) throw new Error('row not deleted yet')
        },
        { timeout: 5_000 },
      )
      const survivor = rows()[0]!
      expect(survivor.querySelector('input')!.value).toBe('second')
      expect(
        survivor.querySelector('[data-testid="formula-case-result"]')?.getAttribute('data-passed'),
      ).toBe('true')
    } finally {
      view.unmount()
    }
  }, 60_000)
})
