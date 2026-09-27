import FormulaEditorPage from '../src/client/FormulaEditorPage.tsx'
import FormulaListPage from '../src/client/FormulaListPage.tsx'
import TemplatePage from '../src/client/FormulaTemplatePage.tsx'
import TemplatesPage from '../src/client/FormulaTemplatesPage.tsx'
import CalculatorEditor from '../src/client/CalculatorEditor.tsx'
import type { ReactNode } from 'react'
import { Effect } from 'effect'
import { monaco } from '@qualy/plugin-assessment-formula/client/monaco-setup'
import { forgetLocalDraft } from '../src/client/local-draft.ts'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// A formula or a template the address names and the reader cannot have: the
// page says so in place of itself, with the way back to where such things
// are listed, and offers another try only when another try could help.

/** this file's own ids: the browser suite shares one origin and its storage */
const FN_ID = '01a04f4b-83a1-763f-9fbc-bfa53bc98e0a'
const VERSION_ID = '01920000-0000-7000-8000-0000000000a9'

const PAGES = [
  { id: 'assessment-formula/list', path: '/assessment/formulas' },
  { id: 'assessment-formula/editor', path: '/assessment/formulas/:functionId' },
  { id: 'assessment-formula/templates', path: '/assessment/formula-templates' },
  { id: 'assessment-formula/template', path: '/assessment/formula-templates/:versionId' },
].map((one) => ({ ...one, layout: 'admin' }))

type Stub = (...args: never[]) => unknown

const formula = (getFormulaFunction: Stub, route = `/assessment/formulas/${FN_ID}`) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessmentFormula: {
        getFormulaFunction,
        getFormulaVersion: () => Effect.fail(apiError('ASSESSMENT_FORMULA_VERSION_NOT_FOUND')),
        listFormulaDraftRevisions: { items: [], nextCursor: null },
        listFormulaShareOptions: { nodes: [], truncated: false },
      },
    }),
    route,
    path: '/assessment/formulas/:functionId',
    children: <FormulaEditorPage />,
  })

const templateAt = (
  getFormulaTemplate: Stub,
  route = `/assessment/formula-templates/${VERSION_ID}`,
) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
      assessmentFormula: { getFormulaTemplate },
    }),
    route,
    path: '/assessment/formula-templates/:versionId',
    children: <TemplatePage />,
  })

/** the state the page stands in place of itself */
const state = () => page.getByRole('heading', { level: 1 })
const seatOf = () => state().element().closest('[data-slot="resource-state"]')

describe('a formula the reader cannot open', () => {
  it('stands a whole-page answer with the way back to the formulas, and no retry', async () => {
    await page.viewport(1280, 800)
    await formula(() => Effect.fail(apiError('ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND')))
    await expect.element(state()).toBeVisible()
    expect(seatOf()?.getAttribute('data-state')).toBe('missing')
    expect(seatOf()?.getAttribute('data-size')).toBe('page')
    expect(seatOf()?.querySelectorAll('button')).toHaveLength(0)
    expect(seatOf()?.querySelector('a[data-way-back]')?.getAttribute('href')).toBe(
      '/assessment/formulas',
    )
    await vi.waitFor(() => expect(document.activeElement).toBe(state().element()))
  })

  it('knows an address that names no formula without asking', async () => {
    await page.viewport(1280, 800)
    const asked = vi.fn(() => Effect.fail(apiError('ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND')))
    await formula(asked, '/assessment/formulas/not-a-formula')
    await expect.element(state()).toBeVisible()
    expect(seatOf()?.getAttribute('data-state')).toBe('missing')
    expect(asked).not.toHaveBeenCalled()
  })

  it('offers another try when the server could not answer', async () => {
    await page.viewport(1280, 800)
    const asked = vi.fn(() => Effect.fail(apiError('SERVICE_UNAVAILABLE')))
    await formula(asked)
    await expect.element(state(), { timeout: 8_000 }).toBeVisible()
    expect(seatOf()?.getAttribute('data-state')).toBe('unavailable')
    const before = asked.mock.calls.length
    await page.getByRole('button', { name: '重试' }).click()
    await vi.waitFor(() => expect(asked.mock.calls.length).toBeGreaterThan(before))
  })
})

describe('a template the reader cannot open', () => {
  it('stands a whole-page answer with the way back to the templates', async () => {
    await page.viewport(1280, 800)
    await templateAt(() => Effect.fail(apiError('ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND')))
    await expect.element(state()).toBeVisible()
    expect(seatOf()?.getAttribute('data-state')).toBe('missing')
    expect(seatOf()?.querySelectorAll('button')).toHaveLength(0)
    expect(seatOf()?.querySelector('a[data-way-back]')?.getAttribute('href')).toBe(
      '/assessment/formula-templates',
    )
    // one way back, not a second one drawn above a template that is not there
    expect(document.querySelectorAll('a[href="/assessment/formula-templates"]')).toHaveLength(1)
  })

  it('knows an address that names no template without asking', async () => {
    await page.viewport(390, 844)
    const asked = vi.fn(() => Effect.fail(apiError('ASSESSMENT_FORMULA_TEMPLATE_NOT_FOUND')))
    await templateAt(asked, '/assessment/formula-templates/abc')
    await expect.element(state()).toBeVisible()
    expect(seatOf()?.getAttribute('data-state')).toBe('missing')
    expect(asked).not.toHaveBeenCalled()
  })
})

describe('a list of formulas to choose from that could not be read', () => {
  // Said once, as a failure with another try - not as a failure above a
  // sentence saying there are no formulas, which is the opposite of what
  // the reader was told a line earlier.
  it('says the reading failed, and not also that there are none', async () => {
    await page.viewport(1280, 800)
    let reachable = false
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
        assessmentFormula: {
          listFormulaBindingOptions: () =>
            reachable
              ? Effect.succeed({ items: [], current: null, nextCursor: null })
              : Effect.fail(apiError('SERVICE_UNAVAILABLE')),
        },
      }),
      children: (
        <CalculatorEditor
          context={{
            batchId: '11111111-1111-4111-8111-111111111111',
            itemId: null,
            calculator: { ref: 'formula@1', config: null },
            amountPer: 'entry',
            disabled: false,
            onChange: () => {},
            chooser: { commit: () => {}, close: () => {} },
          }}
        />
      ),
    })
    const unreadable = page.getByTestId('formula-picker-unreadable')
    await expect.element(unreadable, { timeout: 8_000 }).toBeVisible()
    expect(
      unreadable
        .element()
        .querySelector('[data-slot="resource-state"]')
        ?.getAttribute('data-state'),
    ).toBe('unavailable')
    expect(page.getByTestId('formula-picker-empty').elements()).toHaveLength(0)
    expect(page.getByTestId('feedback').elements()).toHaveLength(0)
    reachable = true
    await unreadable.getByRole('button', { name: '重试' }).click()
    await expect.element(page.getByTestId('formula-picker-empty')).toBeVisible()
  })
})

describe('a formula library that could not be read', () => {
  const library = (stubs: Record<string, Stub>, route: string, element: ReactNode) =>
    renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
        assessmentFormula: stubs,
      }),
      route,
      path: route,
      children: element,
    })
  const state = () => document.querySelector('[data-slot="resource-state"]')

  // Said by what happened, on a card of its own on the page's bare ground:
  // another try where one can help, and none for a reading the reader may
  // not make - not one line of red with a retry whatever it was.
  it('says my formulas could not be read, and reads them again on the word', async () => {
    await page.viewport(1280, 800)
    let reachable = false
    await library(
      {
        listFormulaFunctions: () =>
          reachable
            ? Effect.succeed({ items: [], nextCursor: null })
            : Effect.fail(apiError('SERVICE_UNAVAILABLE')),
      },
      '/assessment/formulas',
      <FormulaListPage />,
    )
    await vi.waitFor(() => expect(state()?.getAttribute('data-state')).toBe('unavailable'), {
      timeout: 8_000,
    })
    expect(state()?.querySelector('h2')).not.toBeNull()
    reachable = true
    await page.getByRole('button', { name: '重试' }).click()
    await expect.element(page.getByTestId('formula-list-empty')).toBeVisible()
  })

  it('offers no other try for templates the reader may not read', async () => {
    await page.viewport(390, 844)
    await library(
      { listFormulaTemplates: () => Effect.fail(apiError('ACCESS_DENIED')) },
      '/assessment/formula-templates',
      <TemplatesPage />,
    )
    await vi.waitFor(() => expect(state()?.getAttribute('data-state')).toBe('denied'))
    expect(state()?.querySelectorAll('button')).toHaveLength(0)
    expect(page.getByTestId('template-list-empty').elements()).toHaveLength(0)
  })
})

describe('a formula that goes away while it is open', () => {
  /** this block's own formula, apart from the one above: kept edits are stored by id */
  const OPEN_ID = '01a04f4b-83a1-763f-9fbc-bfa53bc98e0b'
  const SAVED = 'const saved_by_hand = 1\n'
  const contract = {
    sourceSha256: 'a'.repeat(64),
    contractSha256: 'b'.repeat(64),
    inputSchema: normalizeInputSchema({
      type: 'object',
      properties: { bonus: { type: 'integer', minimum: 0, maximum: 5 } },
      required: ['bonus'],
      additionalProperties: false,
      'x-qualy-order': ['bonus'],
    }),
    outputSchema: normalizeAtomicSchema({
      type: 'string',
      format: 'qualy-decimal',
      'x-qualy-maxScale': 2,
    }),
  }
  const draft = (published: boolean) => ({
    id: OPEN_ID,
    name: '认定分值',
    description: null,
    authorUserId: '01920000-0000-7000-8000-0000000000a1',
    status: 'active',
    draftRevision: 3,
    latestVersionNo: published ? 1 : null,
    latestReleaseName: published ? '秋季规则' : null,
    updatedAt: new Date().toISOString(),
    draftSourceTs: SAVED,
    draftTests: [],
  })

  /** the editor over a formula that is there until `gone` says otherwise */
  const openFormula = (state: { gone: boolean; published: boolean }) =>
    renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }) },
        assessmentFormula: {
          getFormulaFunction: () =>
            state.gone
              ? Effect.fail(apiError('ASSESSMENT_FORMULA_FUNCTION_NOT_FOUND'))
              : Effect.succeed({
                  function: draft(state.published),
                  versions: [],
                  copiedFrom: null,
                }),
          getFormulaVersion: () =>
            Effect.succeed({
              version: { versionNo: 1, releaseName: '秋季规则', sourceTs: SAVED, tests: [] },
            }),
          previewFormulaDraft: () => Effect.succeed(contract),
          listFormulaShareOptions: { nodes: [], truncated: false },
          listFormulaDraftRevisions: { items: [], nextCursor: null },
          setFormulaFunctionStatus: () =>
            Effect.succeed({ function: { ...draft(state.published), status: 'archived' } }),
          deleteFormulaFunction: () => {
            state.gone = true
            return Effect.succeed({ deleted: true })
          },
        },
      }),
      route: `/assessment/formulas/${OPEN_ID}`,
      routes: [
        { path: '/assessment/formulas/:functionId', element: <FormulaEditorPage /> },
        { path: '/assessment/formulas', element: <div data-testid="formula-list-page" /> },
      ],
    })

  const draftModel = async (): Promise<monaco.editor.ITextModel> => {
    let found: monaco.editor.ITextModel | null = null
    await vi.waitFor(
      () => {
        found =
          monaco.editor
            .getEditors()
            .map((editor) => editor.getModel())
            .find((model) => model?.uri.toString().endsWith('/draft/formula.ts') === true) ?? null
        if (found === null) throw new Error('no draft editor yet')
      },
      { timeout: 10_000 },
    )
    return found!
  }

  // Deleted from another tab while this one held edits nobody saved: taking
  // the workbench away took the edits with it, with no chance to copy them.
  it('keeps unsaved edits on screen, and says the formula is gone', async () => {
    await page.viewport(1280, 800)
    const state = { gone: false, published: true }
    const view = await openFormula(state)
    try {
      const model = await draftModel()
      model.setValue('const typed_and_unsaved = 2\n')
      await expect
        .element(page.getByTestId('formula-save-state'))
        .toHaveAttribute('data-state', 'dirty')
      // the next look finds it gone: archiving reads the formula again
      state.gone = true
      await page.getByTestId('formula-more').click()
      await page.getByRole('menuitem', { name: '归档公式' }).click()
      await page.getByRole('button', { name: '归档', exact: true }).click()
      await expect.element(page.getByTestId('formula-gone')).toBeVisible()
      expect(document.querySelector('[data-slot="resource-state"]')).toBeNull()
      expect(model.isDisposed()).toBe(false)
      expect(model.getValue()).toBe('const typed_and_unsaved = 2\n')
      // and nothing is offered that could only be refused
      await expect.element(page.getByTestId('formula-save')).toBeDisabled()
      await expect.element(page.getByTestId('formula-publish-open')).toBeDisabled()
    } finally {
      await view.unmount()
      await forgetLocalDraft(OPEN_ID)
    }
  }, 60_000)

  // Deleting it here leaves first and reads again after: read while the
  // page still stood, the formula just deleted would answer "not found"
  // over it on the way out.
  it('leaves for the formulas after deleting one, without saying on the way that it is gone', async () => {
    await page.viewport(1280, 800)
    const state = { gone: false, published: false }
    const view = await openFormula(state)
    const seen: string[] = []
    const watch = new MutationObserver(() => {
      for (const one of document.querySelectorAll('[data-slot="resource-state"]'))
        seen.push(one.getAttribute('data-state') ?? '')
    })
    try {
      await draftModel()
      await page.getByTestId('formula-more').click()
      await page.getByTestId('formula-delete').click()
      watch.observe(document.body, { childList: true, subtree: true })
      await page.getByRole('button', { name: '删除', exact: true }).click()
      await expect.element(page.getByTestId('formula-list-page')).toBeInTheDocument()
      expect(addressNow()).toBe('/assessment/formulas')
      expect(seen).toEqual([])
    } finally {
      watch.disconnect()
      await view.unmount()
    }
  }, 60_000)
})
