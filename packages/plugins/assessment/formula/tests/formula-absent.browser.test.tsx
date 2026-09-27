import FormulaEditorPage from '../src/client/FormulaEditorPage.tsx'
import FormulaListPage from '../src/client/FormulaListPage.tsx'
import TemplatePage from '../src/client/FormulaTemplatePage.tsx'
import TemplatesPage from '../src/client/FormulaTemplatesPage.tsx'
import CalculatorEditor from '../src/client/CalculatorEditor.tsx'
import type { ReactNode } from 'react'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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
