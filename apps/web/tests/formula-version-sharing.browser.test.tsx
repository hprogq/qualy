import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { components } from 'virtual:qualy/plugins'
import { normalizeAtomicSchema, normalizeInputSchema } from '@qualy/value-schema'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// Offering one published version to somebody, and taking it back.
//
// The two directions are not symmetric on purpose. Widening needs the
// permission where it widens to, so an author who no longer holds it is
// shown nothing to add. Narrowing never does - otherwise losing the
// permission would trap whatever was already offered - so the controls
// that remove stay, and this file bears exactly that asymmetry.

const FormulaEditorPage = (await components['assessment-formula/FormulaEditorPage']!()).default

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
    updatedAt: new Date().toISOString(),
    draftSourceTs: '// draft\n',
    draftTests: [],
  },
  versions: [
    {
      versionNo: 1,
      versionId: '01920000-0000-7000-8000-0000000000f1',
      publishedAt: '2026-02-01T00:00:00.000Z',
      sourceSha256: 'a'.repeat(64),
      runtimeSha256: 'c'.repeat(64),
      contractSha256: 'b'.repeat(64),
    },
  ],
  copiedFrom: null,
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
  return renderScreen({
    client: fakeClient({
      app: { getManifest: emptyManifest() },
      assessmentFormula: {
        getFormulaFunction: () => Effect.succeed(detail),
        previewFormulaDraft: () => Effect.succeed(contract),
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
    route: `/assessment/formulas/${FN_ID}`,
    path: '/assessment/formulas/:functionId',
    children: <FormulaEditorPage />,
  })
}

const sharingRow = () => page.getByTestId('version-sharing')

describe('managing a published version’s audience', () => {
  it('offers a unit and asks the server for the whole audience it means', async () => {
    const wrote: unknown[] = []
    open({
      scopes: [{ orgNodeId: COLLEGE, name: '信息学院' }],
      options: [{ id: DEPARTMENT, name: '计算机系', depth: 2 }],
      wrote,
    })
    await expect.element(sharingRow()).toBeVisible()
    await expect.element(sharingRow()).toHaveAttribute('data-version', '1')

    await page.getByRole('combobox', { name: '共享给某个单位' }).click()
    await page.getByRole('option', { name: '计算机系' }).click()

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
    await expect.element(sharingRow()).toBeVisible()
    await expect.element(page.getByTestId('sharing-scope')).toBeVisible()
    // nothing to add with
    expect(document.querySelectorAll('[data-testid="sharing-add"]').length).toBe(0)

    await page.getByRole('button', { name: '停止共享给信息学院' }).click()
    await vi.waitFor(() => expect(wrote.length).toBe(1))
    expect(wrote[0]).toEqual({ expectedToken: 'token-1', orgNodeIds: [] })
  }, 30_000)

  it('says a version nobody was offered is not shared', async () => {
    open({ scopes: [], options: [{ id: DEPARTMENT, name: '计算机系', depth: 2 }] })
    await expect.element(page.getByTestId('sharing-private')).toBeVisible()
  }, 30_000)

  it('reads back a refusal when somebody else moved the audience first', async () => {
    open({
      scopes: [{ orgNodeId: COLLEGE, name: '信息学院' }],
      options: [{ id: DEPARTMENT, name: '计算机系', depth: 2 }],
      replace: () => Effect.fail(apiError('ASSESSMENT_FORMULA_SHARING_CONFLICT')) as never,
    })
    await expect.element(sharingRow()).toBeVisible()
    await page.getByRole('combobox', { name: '共享给某个单位' }).click()
    await page.getByRole('option', { name: '计算机系' }).click()

    // a refusal a reader can act on, not a blank screen
    const refusal = page.getByTestId('sharing-failure')
    await expect.element(refusal).toBeVisible()
    await expect.element(refusal).not.toHaveTextContent('')
  }, 30_000)
})
