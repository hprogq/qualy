import FormulaEditorPage from '../src/client/FormulaEditorPage.tsx'
import { MINIMAL_EXAMPLE } from '../src/client/starter-source.ts'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// A formula's life around its one draft: a formula nobody has written a line
// of yet, naming a publication while it is made, and a piece of history
// opened read-only - which compiles nothing, and comes back only as the
// draft's newest state, asking first when that would replace unsaved work.

const FN_ID = '01a04f4b-83a1-763f-9fbc-bfa53bc98ecb'
const AUTHOR = '01920000-0000-7000-8000-0000000000a1'
const SAVED = '// the draft as saved\n'
const FROZEN = '// published_source\n'

const contract = {
  sourceSha256: 'a'.repeat(64),
  contractSha256: 'b'.repeat(64),
  inputSchema: normalizeInputSchema({
    type: 'object',
    properties: { base: { type: 'string', format: 'qualy-decimal', 'x-qualy-maxScale': 2 } },
    required: ['base'],
    additionalProperties: false,
    'x-qualy-order': ['base'],
  }),
  outputSchema: normalizeAtomicSchema({
    type: 'string',
    format: 'qualy-decimal',
    'x-qualy-maxScale': 2,
  }),
}

const examples = [{ name: 'seed', input: { base: '1' }, expected: '1' }]

const draftOf = (source: string, draftRevision: number) => ({
  id: FN_ID,
  name: '认定分值',
  description: null,
  authorUserId: AUTHOR,
  status: 'active',
  draftRevision,
  latestVersionNo: 1,
  latestReleaseName: '2026 秋季正式规则',
  updatedAt: new Date().toISOString(),
  draftSourceTs: source,
  draftTests: examples,
})

const release = {
  versionId: '01920000-0000-7000-8000-0000000000f1',
  versionNo: 1,
  releaseName: '2026 秋季正式规则',
  releaseNotes: '按学院新规调整',
  contractSha256: contract.contractSha256,
  runtimeSha256: 'c'.repeat(64),
  publishedBy: AUTHOR,
  publishedByName: '张老师',
  publishedAt: '2026-09-01T06:30:00.000Z',
}

const frozen = {
  ...release,
  sourceTs: FROZEN,
  sourceSha256: contract.sourceSha256,
  inputSchema: contract.inputSchema,
  outputSchema: contract.outputSchema,
  typescriptVersion: '7.0.2',
  esbuildVersion: '0.28.0',
  formulaAbiVersion: 1,
  formulaRuntimeSha256: 'd'.repeat(64),
  quickjsEngineVersion: 'quickjs-test',
  valueSchemaProfileVersion: 1,
  regexProfileVersion: 1,
  sandboxAbiVersion: 1,
  sourcePolicyVersion: 1,
  sourcePolicyParserVersion: 'parser-1',
  authoringBuildId: 'authoring-1',
  sandboxRuntimeBuildId: 'runtime-1',
  tests: examples,
  testReport: [{ name: 'seed', passed: true, expected: '1', actual: '1' }],
}

const savedRevision = {
  revisionNo: 2,
  origin: 'saved',
  sourceSha256: 'e'.repeat(64),
  savedBy: AUTHOR,
  savedByName: '张老师',
  savedAt: '2026-08-30T02:00:00.000Z',
  sourceVersion: null,
  sourceDraftRevisionNo: null,
  sourceTs: '// earlier_save\n',
  tests: examples,
}

interface Wire {
  previews: string[]
  publishes: unknown[]
  restores: unknown[]
}

const open = ({
  source = SAVED,
  route = '',
  publish,
}: {
  source?: string
  route?: string
  publish?: (attempt: number) => Effect.Effect<unknown, unknown>
} = {}) => {
  const wire: Wire = { previews: [], publishes: [], restores: [] }
  let draft = draftOf(source, 3)
  const screen = renderScreen({
    client: fakeClient({
      app: { getManifest: emptyManifest() },
      assessmentFormula: {
        getFormulaFunction: () =>
          Effect.succeed({ function: draft, versions: [release], copiedFrom: null }),
        previewFormulaDraft: (request: { payload: { sourceTs: string } }) => {
          wire.previews.push(request.payload.sourceTs)
          return Effect.succeed(contract)
        },
        getFormulaVersion: () => Effect.succeed({ version: frozen }),
        listFormulaDraftRevisions: { items: [], nextCursor: null },
        getFormulaDraftRevision: () => Effect.succeed({ revision: savedRevision }),
        getFormulaVersionSharing: () => Effect.succeed({ scopes: [], token: 'token-1' }),
        listFormulaShareOptions: () => Effect.succeed({ nodes: [], truncated: false }),
        publishFormulaVersion: (request: { payload: unknown }) => {
          wire.publishes.push(request.payload)
          return publish?.(wire.publishes.length) ?? Effect.succeed({ version: frozen })
        },
        restoreFormulaDraft: (request: { payload: { from: { kind: string } } }) => {
          wire.restores.push(request.payload)
          draft = draftOf(
            request.payload.from.kind === 'published-version' ? FROZEN : savedRevision.sourceTs,
            4,
          )
          return Effect.succeed({ function: draft })
        },
      },
    } as never),
    route: `/assessment/formulas/${FN_ID}${route}`,
    path: '/assessment/formulas/:functionId',
    children: <FormulaEditorPage />,
  })
  return { wire, screen }
}

/** waits until the element under a test id holds the words */
const showsText = (testId: string, words: string) =>
  vi.waitFor(
    () =>
      expect(document.querySelector(`[data-testid="${testId}"]`)?.textContent ?? '').toContain(
        words,
      ),
    { timeout: 10_000 },
  )

/** longer than the preview waits after an edit, so a request it meant to send has gone */
const pastIdle = () => new Promise((resolve) => setTimeout(resolve, 1_500))

describe('a formula’s draft and its history', () => {
  it('offers two ways to begin an empty formula, and compiles nothing until one is taken', async () => {
    const { wire, screen } = open({ source: '' })
    const view = await screen
    try {
      await expect.element(page.getByTestId('formula-empty-source')).toBeVisible()
      await expect
        .element(page.getByTestId('formula-compile-state'))
        .toHaveAttribute('data-state', 'blank')
      await expect.element(page.getByTestId('formula-publish-open')).toBeDisabled()
      await pastIdle()
      expect(wire.previews).toEqual([])

      await page.getByRole('button', { name: '载入最小示例' }).click()
      await vi.waitFor(() => expect(wire.previews.length).toBeGreaterThan(0), {
        timeout: 10_000,
      })
      expect(new Set(wire.previews)).toEqual(new Set([MINIMAL_EXAMPLE]))
      expect(document.querySelector('[data-testid="formula-empty-source"]')).toBeNull()
      // the example is in the editor only; keeping it is the author's call
      await expect
        .element(page.getByTestId('formula-save-state'))
        .toHaveAttribute('data-state', 'dirty')
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('names a publication as it is made, and keeps the dialog on a name already taken', async () => {
    const { wire, screen } = open({
      publish: (attempt) =>
        attempt === 1
          ? Effect.fail(apiError('ASSESSMENT_FORMULA_RELEASE_NAME_TAKEN'))
          : Effect.succeed({ version: { ...frozen, versionNo: 2, releaseName: '2026 秋季修订' } }),
    })
    const view = await screen
    try {
      await page.getByTestId('formula-publish-open').click()
      const confirm = page.getByTestId('formula-publish-confirm')
      // a publication has no name until its author gives it one
      await expect.element(confirm).toBeDisabled()
      await page.getByRole('textbox', { name: '发布名称' }).fill('2026 秋季正式规则')
      await page.getByRole('textbox', { name: '发布说明' }).fill('按学院新规调整')
      await confirm.click()
      await vi.waitFor(() => expect(wire.publishes.length).toBe(1), { timeout: 5_000 })
      expect(wire.publishes[0]).toEqual({
        expectedDraftRevision: 3,
        releaseName: '2026 秋季正式规则',
        releaseNotes: '按学院新规调整',
      })

      // the name is the dialog's to fix, so the dialog stays
      await expect.element(page.getByRole('alert')).toBeVisible()
      await page.getByRole('textbox', { name: '发布名称' }).fill('2026 秋季修订')
      await confirm.click()
      await vi.waitFor(() => expect(wire.publishes.length).toBe(2), { timeout: 5_000 })
      expect(wire.publishes[1]).toMatchObject({ releaseName: '2026 秋季修订' })
      await vi.waitFor(
        () => expect(document.querySelector('[data-testid="formula-publish-confirm"]')).toBeNull(),
        { timeout: 5_000 },
      )
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('opens a publication as it was frozen, and restores it as the draft', async () => {
    const { wire, screen } = open({ route: '?view=release-1' })
    const view = await screen
    try {
      await showsText('formula-release-source', 'published_source')
      await showsText('formula-release-info', '2026 秋季正式规则')
      await showsText('formula-release-environment', 'authoring-1')
      // read off the version row: the compiler is never asked about it
      await pastIdle()
      expect(wire.previews).toEqual([])

      await page.getByTestId('formula-release-restore').click()
      await vi.waitFor(() => expect(wire.restores.length).toBe(1), { timeout: 5_000 })
      expect(wire.restores[0]).toEqual({
        expectedDraftRevision: 3,
        from: { kind: 'published-version', versionNo: 1 },
      })
      await expect.element(page.getByTestId('formula-editor')).toBeVisible()
      expect(addressNow()).toBe(`/assessment/formulas/${FN_ID}`)
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('keeps unsaved edits across a look at the history, and asks before replacing them', async () => {
    const { wire, screen } = open()
    const view = await screen
    try {
      const name = page.getByRole('textbox', { name: '名称', exact: true })
      await expect.element(name).toHaveValue('认定分值')
      await name.fill('认定分值（修订中）')
      await expect
        .element(page.getByTestId('formula-save-state'))
        .toHaveAttribute('data-state', 'dirty')

      await page.getByTestId('formula-release').click()
      await expect.element(page.getByTestId('formula-release-source')).toBeVisible()
      expect(addressNow()).toBe(`/assessment/formulas/${FN_ID}?view=release-1`)

      // replacing unsaved work asks first, and saying no sends nothing
      await page.getByTestId('formula-release-restore').click()
      await page.getByRole('button', { name: '取消' }).click()
      await pastIdle()
      expect(wire.restores).toEqual([])

      await page.getByRole('button', { name: '返回当前草稿' }).click()
      await expect.element(name).toHaveValue('认定分值（修订中）')

      await page.getByTestId('formula-release').click()
      await page.getByTestId('formula-release-restore').click()
      await page.getByRole('button', { name: '替换当前草稿' }).click()
      await vi.waitFor(() => expect(wire.restores.length).toBe(1), { timeout: 5_000 })
      // the restored draft is the editor's now, the edit it replaced gone
      await expect.element(name).toHaveValue('认定分值')
    } finally {
      view.unmount()
    }
  }, 60_000)

  it('restores a saved revision by its number', async () => {
    const { wire, screen } = open({ route: '?view=revision-2' })
    const view = await screen
    try {
      await showsText('formula-revision-source', 'earlier_save')
      await page.getByTestId('formula-revision-restore').click()
      await vi.waitFor(() => expect(wire.restores.length).toBe(1), { timeout: 5_000 })
      expect(wire.restores[0]).toEqual({
        expectedDraftRevision: 3,
        from: { kind: 'draft-revision', revisionNo: 2 },
      })
    } finally {
      view.unmount()
    }
  }, 60_000)
})
