import FormulaEditorPage from '../src/client/FormulaEditorPage.tsx'
import { MINIMAL_EXAMPLE } from '../src/client/starter-source.ts'
import { forgetLocalDraft, keepLocalDraft } from '../src/client/local-draft.ts'
import { monaco } from '@qualy/plugin-assessment-formula/client/monaco-setup'
import { Effect } from 'effect'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The workbench around the draft: the buffer and its undo history outlive
// whatever draws them, what the page does to the buffer can be undone, the
// columns fold where they do not fit, and the acts that take something away
// ask first.

const FN_ID = '01a04f4b-83a1-763f-9fbc-bfa53bc98ecb'
const AUTHOR = '01920000-0000-7000-8000-0000000000a1'
const SAVED = 'const saved_by_hand = 1\n'

const contract = {
  sourceSha256: 'a'.repeat(64),
  contractSha256: 'b'.repeat(64),
  inputSchema: normalizeInputSchema({
    type: 'object',
    properties: {
      base: { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2, title: '基础分' },
      bonus: { type: 'integer', minimum: 0, maximum: 5 },
    },
    required: ['base', 'bonus'],
    additionalProperties: false,
    'x-qualy-order': ['base', 'bonus'],
  }),
  outputSchema: normalizeAtomicSchema({
    type: 'string',
    format: 'qualy-decimal',
    'x-qualy-maxScale': 2,
  }),
}

const draft = {
  id: FN_ID,
  name: '认定分值',
  description: null,
  authorUserId: AUTHOR,
  status: 'active',
  draftRevision: 3,
  latestVersionNo: null,
  latestReleaseName: null,
  updatedAt: new Date().toISOString(),
  draftSourceTs: SAVED,
  draftTests: [{ name: 'seed', input: { base: '1', bonus: 0 }, expected: '1' }],
}

const open = (wrote: { status: unknown[] } = { status: [] }) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: emptyManifest() },
      assessmentFormula: {
        getFormulaFunction: () =>
          Effect.succeed({ function: draft, versions: [], copiedFrom: null }),
        previewFormulaDraft: () => Effect.succeed(contract),
        listFormulaDraftRevisions: {
          items: [
            {
              revisionNo: 2,
              origin: 'saved',
              sourceSha256: 'e'.repeat(64),
              savedBy: AUTHOR,
              savedByName: '张老师',
              savedAt: '2026-08-30T02:00:00.000Z',
              sourceVersion: null,
              sourceDraftRevisionNo: null,
            },
          ],
          nextCursor: null,
        },
        getFormulaDraftRevision: {
          revision: {
            revisionNo: 2,
            origin: 'saved',
            sourceSha256: 'e'.repeat(64),
            savedBy: AUTHOR,
            savedByName: '张老师',
            savedAt: '2026-08-30T02:00:00.000Z',
            sourceVersion: null,
            sourceDraftRevisionNo: null,
            sourceTs: 'const earlier_save = 0\n',
            tests: [],
          },
        },
        setFormulaFunctionStatus: (request: { payload: unknown }) => {
          wrote.status.push(request.payload)
          return Effect.succeed({ function: { ...draft, status: 'archived' } })
        },
      },
    } as never),
    route: `/assessment/formulas/${FN_ID}`,
    path: '/assessment/formulas/:functionId',
    children: <FormulaEditorPage />,
  })

/** the model the page's draft editor draws, once it is drawn */
const draftModel = async (): Promise<monaco.editor.ITextModel> => {
  let found: monaco.editor.ITextModel | null = null
  await vi.waitFor(
    () => {
      found =
        monaco.editor
          .getEditors()
          .map((editor) => editor.getModel())
          .find((model) => model?.getValue().includes('saved_by_hand') === true) ?? null
      if (found === null) throw new Error('no draft editor yet')
    },
    { timeout: 10_000 },
  )
  return found!
}

/** types into the model the way the editor does: one undoable edit */
const typeInto = (model: monaco.editor.ITextModel, text: string) => {
  model.pushStackElement()
  model.pushEditOperations([], [{ range: new monaco.Range(1, 1, 1, 1), text }], () => null)
  model.pushStackElement()
}

const drawn = (model: monaco.editor.ITextModel) =>
  monaco.editor.getEditors().some((editor) => editor.getModel() === model)

afterEach(async () => {
  await page.viewport(1280, 800)
})

describe('the formula workbench', () => {
  it('keeps the buffer and its undo history across a phone’s tabs', async () => {
    await page.viewport(390, 844)
    const view = await open()
    try {
      const model = await draftModel()
      typeInto(model, '// typed\n')
      await page.getByRole('tab', { name: /试运行/ }).click()
      await vi.waitFor(() => expect(drawn(model)).toBe(false), { timeout: 5_000 })
      await page.getByRole('tab', { name: /源码/ }).click()
      await vi.waitFor(() => expect(drawn(model)).toBe(true), { timeout: 5_000 })
      // the same model, drawn again, with its history intact
      expect(model.isDisposed()).toBe(false)
      expect(model.getValue()).toBe(`// typed\n${SAVED}`)
      expect(model.canUndo()).toBe(true)
      model.undo()
      expect(model.getValue()).toBe(SAVED)
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('keeps the buffer and its undo history across a look at a saved revision', async () => {
    const view = await open()
    try {
      const model = await draftModel()
      typeInto(model, '// typed\n')
      await page.getByRole('tab', { name: '草稿记录' }).click()
      await page.getByTestId('formula-revision').click()
      await expect.element(page.getByTestId('formula-revision-view')).toBeVisible()
      await vi.waitFor(() => expect(drawn(model)).toBe(false), { timeout: 5_000 })
      await page.getByTestId('formula-history-back').click()
      await vi.waitFor(() => expect(drawn(model)).toBe(true), { timeout: 5_000 })
      expect(model.getValue()).toBe(`// typed\n${SAVED}`)
      expect(model.canUndo()).toBe(true)
      model.undo()
      expect(model.getValue()).toBe(SAVED)
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('loads the minimal example as one step that undo takes back', async () => {
    const view = await open()
    try {
      const model = await draftModel()
      await page.getByTestId('formula-more').click()
      await page.getByRole('menuitem', { name: '载入最小示例…' }).click()
      await page.getByRole('button', { name: '载入示例' }).click()
      await vi.waitFor(() => expect(model.getValue()).toBe(MINIMAL_EXAMPLE), { timeout: 5_000 })
      model.undo()
      expect(model.getValue()).toBe(SAVED)
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('adds an example only once its dialog is confirmed', async () => {
    const view = await open()
    const rows = () => document.querySelectorAll('[data-testid="formula-test-case"]').length
    try {
      await vi.waitFor(() => expect(rows()).toBe(1), { timeout: 10_000 })
      await vi.waitFor(
        () =>
          expect(
            document.querySelector('[data-testid="formula-structure"]')?.getAttribute('data-state'),
          ).toBe('synced'),
        { timeout: 15_000 },
      )

      await page.getByRole('button', { name: '添加示例' }).click()
      await page.getByRole('button', { name: '取消' }).click()
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(rows()).toBe(1)

      await page.getByRole('button', { name: '添加示例' }).click()
      const form = page.getByTestId('formula-example-new')
      await expect.element(form).toBeVisible()
      // every field wears the key the code names it by, titled or not
      const keys = [
        ...document.querySelectorAll('[data-testid="formula-example-new"] [data-field-key]'),
      ]
      expect(
        keys.map((key) => [key.getAttribute('data-field-key'), key.getAttribute('data-titled')]),
      ).toEqual([
        ['base', 'true'],
        ['bonus', 'false'],
      ])
      const inputs = [
        ...document.querySelectorAll<HTMLInputElement>('[data-testid="formula-example-new"] input'),
      ]
      await userEvent.fill(inputs[0]!, '新示例')
      await userEvent.fill(inputs[1]!, '2.5')
      await userEvent.fill(inputs[2]!, '3')
      await userEvent.fill(inputs[3]!, '5.5')
      await page.getByTestId('formula-example-add-confirm').click()
      await vi.waitFor(() => expect(rows()).toBe(2), { timeout: 5_000 })
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('asks before archiving, and archives only on yes', async () => {
    const wrote = { status: [] as unknown[] }
    const view = await open(wrote)
    try {
      await page.getByTestId('formula-more').click()
      await page.getByRole('menuitem', { name: '归档公式' }).click()
      await page.getByRole('button', { name: '取消' }).click()
      await new Promise((resolve) => setTimeout(resolve, 300))
      expect(wrote.status).toEqual([])

      await page.getByTestId('formula-more').click()
      await page.getByRole('menuitem', { name: '归档公式' }).click()
      await page.getByRole('button', { name: '归档', exact: true }).click()
      await vi.waitFor(() => expect(wrote.status).toEqual([{ status: 'archived' }]), {
        timeout: 5_000,
      })
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('offers back the edits this browser kept, and puts them in the editor', async () => {
    await keepLocalDraft({
      functionId: FN_ID,
      name: '本机改过的名字',
      source: 'const kept_in_browser = 2\n',
      tests: [{ name: 'seed', inputText: '{"base":"1","bonus":0}', expected: '1' }],
      baseRevision: 3,
      keptAt: Date.now() - 60_000,
    })
    const view = await open()
    try {
      await expect.element(page.getByTestId('formula-local-draft')).toBeVisible()
      await page.getByTestId('formula-local-draft-take').click()
      await expect
        .element(page.getByRole('textbox', { name: '名称', exact: true }))
        .toHaveValue('本机改过的名字')
      await expect
        .element(page.getByTestId('formula-save-state'))
        .toHaveAttribute('data-state', 'dirty')
    } finally {
      view.unmount()
      await forgetLocalDraft(FN_ID)
    }
  }, 60_000)

  it('gives the try-run and the history a column each where they fit, and tabs where they do not', async () => {
    const wide = await open()
    try {
      await vi.waitFor(
        () =>
          expect(document.querySelector('[data-columns]')?.getAttribute('data-columns')).toBe(
            'split',
          ),
        { timeout: 10_000 },
      )
    } finally {
      wide.unmount()
    }
    await page.viewport(1100, 800)
    const narrow = await open()
    try {
      await vi.waitFor(
        () =>
          expect(document.querySelector('[data-columns]')?.getAttribute('data-columns')).toBe(
            'shared',
          ),
        { timeout: 10_000 },
      )
      await page.getByRole('tab', { name: '历史' }).click()
      await expect.element(page.getByTestId('formula-publish-open')).toBeVisible()
    } finally {
      narrow.unmount()
    }
  }, 60_000)
})
