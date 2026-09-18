import FormulaEditorPage from '../src/client/FormulaEditorPage.tsx'
import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// Offering one published version to somebody, and taking it back, from the
// list of units beside the publication's line in the versions.
//
// The two directions are not symmetric on purpose. Widening needs the
// permission where it widens to, so an author who no longer holds it is
// shown nothing to add. Narrowing never does - otherwise losing the
// permission would trap whatever was already offered - so the controls
// that remove stay, and this file bears exactly that asymmetry.

const FN_ID = '01a04f4b-83a1-763f-9fbc-bfa53bc98ecb'
const COLLEGE = '01920000-0000-7000-8000-0000000000e1'
const DEPARTMENT = '01920000-0000-7000-8000-0000000000e2'

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

const detail = {
  function: {
    id: FN_ID,
    name: '认定分值',
    description: null,
    status: 'active',
    draftRevision: 1,
    latestVersionNo: 1,
    latestReleaseName: '2026 秋季正式规则',
    updatedAt: new Date().toISOString(),
    draftSourceTs: '// draft\n',
    draftTests: [],
  },
  versions: [
    {
      versionNo: 1,
      versionId: '01920000-0000-7000-8000-0000000000f1',
      releaseName: '2026 秋季正式规则',
      releaseNotes: null,
      publishedBy: '01920000-0000-7000-8000-0000000000a1',
      publishedByName: '张老师',
      publishedAt: '2026-02-01T00:00:00.000Z',
      sourceSha256: 'a'.repeat(64),
      runtimeSha256: 'c'.repeat(64),
      contractSha256: 'b'.repeat(64),
    },
  ],
  copiedFrom: null,
}

const frozen = {
  ...detail.versions[0]!,
  sourceTs: '// published\n',
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
  tests: [],
  testReport: [],
}

/** what one screen sees and what it asked the server to make true */
const open = (
  had: {
    scopes?: readonly { orgNodeId: string; name: string }[]
    options?: readonly { id: string; name: string; depth: number }[]
    replace?: () => Effect.Effect<never, never, never>
    wrote?: unknown[]
  } = {},
) => {
  const scopes = had.scopes ?? []
  // the list counts what the version is offered to, so the two agree
  const listed = {
    ...detail,
    versions: [{ ...detail.versions[0]!, sharedCount: scopes.length }],
  }
  return renderScreen({
    client: fakeClient({
      app: { getManifest: emptyManifest() },
      assessmentFormula: {
        getFormulaFunction: () => Effect.succeed(listed),
        listFormulaDraftRevisions: { items: [], nextCursor: null },
        previewFormulaDraft: () => Effect.succeed(contract),
        getFormulaVersion: () => Effect.succeed({ version: frozen }),
        evaluateFormulaVersion: { cases: [] },
        getFormulaVersionSharing: () => Effect.succeed({ scopes, token: 'token-1' }),
        listFormulaShareOptions: () =>
          Effect.succeed({ nodes: had.options ?? [], truncated: false }),
        replaceFormulaVersionSharing: (call: { payload: { orgNodeIds: readonly string[] } }) => {
          had.wrote?.push(call.payload)
          return (
            had.replace?.() ??
            Effect.succeed({
              scopes: call.payload.orgNodeIds.map((id) => ({ orgNodeId: id, name: '学院' })),
              token: 'token-2',
            })
          )
        },
      },
    } as never),
    route: `/assessment/formulas/${FN_ID}?view=release-1`,
    path: '/assessment/formulas/:functionId',
    children: <FormulaEditorPage />,
  })
}

const sharing = () => page.getByTestId('formula-sharing')

/** opens the publication's audience, which lives beside its line in the versions */
const openSharing = async () => {
  await page.getByTestId('formula-versions-open').click()
  await expect.element(page.getByTestId('formula-versions')).toBeVisible()
  await page.getByTestId('formula-release-share').click()
  await expect.element(sharing()).toBeVisible()
}

/** ticks a unit in the list by its name */
const tick = async (name: string) => {
  const option = [
    ...document.querySelectorAll<HTMLElement>('[data-testid="formula-sharing-unit"]'),
  ].find((one) => one.textContent?.includes(name))
  if (option === undefined) throw new Error(`no unit called ${name}`)
  option.querySelector<HTMLElement>('button, input')!.click()
}

describe('managing a published version’s audience', () => {
  it('offers a unit and asks the server for the whole audience it means', async () => {
    const wrote: unknown[] = []
    open({
      scopes: [{ orgNodeId: COLLEGE, name: '信息学院' }],
      options: [{ id: DEPARTMENT, name: '计算机系', depth: 2 }],
      wrote,
    })
    await openSharing()
    await expect.element(sharing()).toHaveAttribute('data-version', '1')

    await tick('计算机系')
    await page.getByTestId('formula-sharing-save').click()

    await vi.waitFor(() => expect(wrote.length).toBe(1))
    // the wire carries the audience as it should end up, not a diff
    expect(wrote[0]).toEqual({
      expectedToken: 'token-1',
      orgNodeIds: [COLLEGE, DEPARTMENT],
    })
  }, 30_000)

  it('takes an offer back without the permission that made it', async () => {
    const wrote: unknown[] = []
    // no options: this author cannot widen anywhere any more
    open({ scopes: [{ orgNodeId: COLLEGE, name: '信息学院' }], options: [], wrote })
    await openSharing()
    // what is already offered stays on the list, and can still be unticked
    await tick('信息学院')
    await page.getByTestId('formula-sharing-save').click()
    await vi.waitFor(() => expect(wrote.length).toBe(1))
    expect(wrote[0]).toEqual({ expectedToken: 'token-1', orgNodeIds: [] })
  }, 30_000)

  it('says a version nobody was offered is not shared', async () => {
    open({ scopes: [], options: [{ id: DEPARTMENT, name: '计算机系', depth: 2 }] })
    await page.getByTestId('formula-versions-open').click()
    await expect.element(page.getByTestId('formula-versions')).toBeVisible()
    expect(document.querySelectorAll('[data-testid="formula-release-shared"]').length).toBe(0)
  }, 30_000)

  it('reads back a refusal when somebody else moved the audience first', async () => {
    open({
      scopes: [{ orgNodeId: COLLEGE, name: '信息学院' }],
      options: [{ id: DEPARTMENT, name: '计算机系', depth: 2 }],
      replace: () => Effect.fail(apiError('ASSESSMENT_FORMULA_SHARING_CONFLICT')) as never,
    })
    await openSharing()
    await tick('计算机系')
    await page.getByTestId('formula-sharing-save').click()

    // a refusal a reader can act on, not a blank screen
    const refusal = page.getByTestId('sharing-failure')
    await expect.element(refusal).toBeVisible()
    await expect.element(refusal).not.toHaveTextContent('')
  }, 30_000)
})
