import FormulaEditorPage from '../src/client/FormulaEditorPage.tsx'
import { monaco } from '../src/client/monaco-setup.ts'
import { MINIMAL_EXAMPLE } from '../src/client/starter-source.ts'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// A formula's life around its one draft: a formula nobody has written a line
// of yet, naming a publication while it is made, and a piece of history
// opened read-only - which compiles nothing, runs what was frozen, and comes
// back only as the draft's newest state, asking first when that would
// replace unsaved work.

/** this file's own formula: the browser suite shares one origin, so two
 *  files naming the same stored formula race over its kept draft and its
 *  remembered tries */
const FN_ID = '01a04f4b-83a1-763f-9fbc-bfa53bc98e02'
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
  metadataRevision: 1,
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
  versionRuns: unknown[]
  relabels: unknown[]
}

const open = ({
  source = SAVED,
  route = '',
  publish,
  revisions = [],
}: {
  source?: string
  route?: string
  publish?: (attempt: number) => Effect.Effect<unknown, unknown>
  revisions?: readonly unknown[]
} = {}) => {
  const wire: Wire = {
    previews: [],
    publishes: [],
    restores: [],
    versionRuns: [],
    relabels: [],
  }
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
        evaluateFormulaVersion: (request: { payload: unknown }) => {
          wire.versionRuns.push(request.payload)
          return Effect.succeed({
            contractSha256: contract.contractSha256,
            inputSchema: contract.inputSchema,
            outputSchema: contract.outputSchema,
            cases: [{ clientId: 'try', actual: '7.5' }],
          })
        },
        listFormulaDraftRevisions: { items: revisions, nextCursor: null },
        getFormulaDraftRevision: () => Effect.succeed({ revision: savedRevision }),
        getFormulaVersionSharing: () => Effect.succeed({ scopes: [], token: 'token-1' }),
        listFormulaShareOptions: () => Effect.succeed({ nodes: [], truncated: false }),
        updateFormulaVersionInfo: (request: { payload: unknown }) => {
          wire.relabels.push(request.payload)
          return Effect.succeed({
            version: { ...frozen, releaseName: '2026 秋季规则', metadataRevision: 2 },
          })
        },
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
    }),
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

/** the versions live behind a drawer; opening one closes it again */
const openVersions = async () => {
  await page.getByTestId('formula-versions-open').click()
  await expect.element(page.getByTestId('formula-versions')).toBeVisible()
}

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
      await view.unmount()
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
      await page.getByRole('textbox', { name: '版本名称' }).fill('2026 秋季正式规则')
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
      await page.getByRole('textbox', { name: '版本名称' }).fill('2026 秋季修订')
      await confirm.click()
      await vi.waitFor(() => expect(wire.publishes.length).toBe(2), { timeout: 5_000 })
      expect(wire.publishes[1]).toMatchObject({ releaseName: '2026 秋季修订' })
      await vi.waitFor(
        () => expect(document.querySelector('[data-testid="formula-publish-confirm"]')).toBeNull(),
        { timeout: 5_000 },
      )
    } finally {
      await view.unmount()
    }
  }, 60_000)

  it('opens a publication as it was frozen, runs its frozen artifact, and restores it', async () => {
    const { wire, screen } = open({ route: '?view=release-1' })
    const view = await screen
    try {
      await showsText('formula-release-source', 'published_source')
      await showsText('formula-release-environment', 'authoring-1')
      // what it is called, and its notes, are one press from its name
      await page.getByTestId('formula-release-info-open').click()
      await showsText('formula-release-card', '按学院新规调整')
      await userEvent.keyboard('{Escape}')

      // a try runs the publication's own artifact; the compiler is never asked
      const input = document.querySelector<HTMLInputElement>(
        '[data-testid="value-form-try"] input',
      )!
      await userEvent.fill(input, '3')
      await page.getByRole('button', { name: '运行' }).click()
      await vi.waitFor(() => expect(wire.versionRuns.length).toBe(1), { timeout: 5_000 })
      expect(wire.versionRuns[0]).toEqual({ cases: [{ clientId: 'try', input: { base: '3' } }] })
      await showsText('formula-try-result', '7.5')
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
      await view.unmount()
    }
  }, 60_000)

  it('rewrites a publication’s name and notes without publishing anything', async () => {
    const { wire, screen } = open({ route: '?view=release-1' })
    const view = await screen
    try {
      await expect.element(page.getByTestId('formula-release-view')).toBeVisible()
      // the card beside the name is where a publication explains itself, and
      // the one thing to do from it is fix what it is called
      await page.getByTestId('formula-release-info-open').click()
      await page.getByTestId('formula-release-info-edit').click()
      await expect.element(page.getByTestId('formula-version-info')).toBeVisible()

      await page.getByRole('textbox', { name: '版本名称' }).fill('2026 秋季规则')
      await page.getByTestId('formula-version-info-save').click()
      await vi.waitFor(() => expect(wire.relabels.length).toBe(1), { timeout: 5_000 })
      expect(wire.relabels[0]).toEqual({
        expectedMetadataRevision: 1,
        releaseName: '2026 秋季规则',
        releaseNotes: '按学院新规调整',
      })
      // nothing was published, and the reader is still on the same version
      expect(wire.publishes).toEqual([])
      expect(addressNow()).toBe(`/assessment/formulas/${FN_ID}?view=release-1`)
    } finally {
      await view.unmount()
    }
  }, 60_000)

  it('renames a publication from its line in the versions', async () => {
    // reaching it should not mean opening the version first: the line is
    // where a reader is when they notice the name is wrong
    const { wire, screen } = open()
    const view = await screen
    try {
      await openVersions()
      await page.getByTestId('formula-release-rename').click()
      await expect.element(page.getByTestId('formula-version-info')).toBeVisible()
      await page.getByRole('textbox', { name: '版本名称' }).fill('2026 秋季规则')
      await page.getByTestId('formula-version-info-save').click()
      await vi.waitFor(() => expect(wire.relabels.length).toBe(1), { timeout: 5_000 })
      expect(wire.relabels[0]).toMatchObject({
        expectedMetadataRevision: 1,
        releaseName: '2026 秋季规则',
      })
      expect(wire.publishes).toEqual([])
    } finally {
      await view.unmount()
    }
  }, 60_000)

  it('keeps unsaved edits across a look at the history, and asks before replacing them', async () => {
    const { wire, screen } = open()
    const view = await screen
    try {
      const model = await vi.waitFor(
        () => {
          const found = monaco.editor
            .getEditors()
            .map((editor) => editor.getModel())
            .find((one) => one?.uri.toString().endsWith('/draft/formula.ts') === true)
          if (found === undefined || found === null) throw new Error('no draft editor yet')
          return found
        },
        { timeout: 20_000 },
      )
      const edited = `${model.getValue()}// being revised\n`
      model.pushEditOperations(
        null,
        [{ range: model.getFullModelRange(), text: edited }],
        () => null,
      )
      await expect
        .element(page.getByTestId('formula-save-state'))
        .toHaveAttribute('data-state', 'dirty')

      await openVersions()
      await page.getByTestId('formula-release').click()
      await expect.element(page.getByTestId('formula-release-source')).toBeVisible()
      expect(addressNow()).toBe(`/assessment/formulas/${FN_ID}?view=release-1`)

      // replacing unsaved work asks first, and saying no sends nothing
      await page.getByTestId('formula-release-restore').click()
      await page.getByRole('button', { name: '取消' }).click()
      await pastIdle()
      expect(wire.restores).toEqual([])

      await page.getByTestId('formula-back-to-draft').click()
      await vi.waitFor(() => expect(model.getValue()).toBe(edited), { timeout: 10_000 })

      await openVersions()
      await page.getByTestId('formula-release').click()
      await page.getByTestId('formula-release-restore').click()
      await page.getByRole('button', { name: '替换当前草稿' }).click()
      await vi.waitFor(() => expect(wire.restores.length).toBe(1), { timeout: 5_000 })
      // the restored draft is the editor's now, the edit it replaced gone
      await vi.waitFor(() => expect(model.getValue()).not.toBe(edited), { timeout: 10_000 })
    } finally {
      await view.unmount()
    }
  }, 60_000)

  it('comes back to the draft from the bar, or with Escape', async () => {
    const { screen } = open()
    const view = await screen
    try {
      await openVersions()
      await page.getByTestId('formula-release').click()
      await expect.element(page.getByTestId('formula-release-view')).toBeVisible()
      await page.getByTestId('formula-back-to-draft').click()
      await expect.element(page.getByTestId('formula-editor')).toBeVisible()
      expect(addressNow()).toBe(`/assessment/formulas/${FN_ID}`)

      await openVersions()
      await page.getByTestId('formula-release').click()
      await expect.element(page.getByTestId('formula-release-view')).toBeVisible()
      await userEvent.keyboard('{Escape}')
      await expect.element(page.getByTestId('formula-editor')).toBeVisible()
    } finally {
      await view.unmount()
    }
  }, 60_000)

  it('says so when there are no draft saves to list', async () => {
    const { screen } = open({ revisions: [] })
    const view = await screen
    try {
      await openVersions()
      await page.getByRole('tab', { name: '草稿记录' }).click()
      await expect.element(page.getByTestId('formula-revisions-empty')).toBeVisible()
    } finally {
      await view.unmount()
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
      await view.unmount()
    }
  }, 60_000)
})
