import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { components } from 'virtual:qualy/plugins'
import { emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

const TemplatesPage = (await components['assessment-formula/FormulaTemplatesPage']!()).default
const TemplatePage = (await components['assessment-formula/FormulaTemplatePage']!()).default

// The library of formulas other people offered you.
//
// Everything on it belongs to somebody else, and the one thing to do with a
// row is start your own from it. So the assertions are about what a reader
// can reach and what they get - never about following a source, which this
// product deliberately does not do.

const VERSION_ID = '01920000-0000-7000-8000-0000000000a1'
const NEW_FUNCTION_ID = '01920000-0000-7000-8000-0000000000b1'

const template = (over: Record<string, unknown> = {}) => ({
  versionId: VERSION_ID,
  functionId: '01920000-0000-7000-8000-0000000000c1',
  functionName: '竞赛加分',
  description: '按获奖等级给分',
  versionNo: 3,
  publishedAt: '2026-02-01T00:00:00.000Z',
  authorUserId: '01920000-0000-7000-8000-0000000000d1',
  authorName: '张老师',
  parameters: ['level'],
  sourceStatus: 'active',
  ...over,
})

const PAGES = [
  { id: 'assessment-formula/templates', path: '/assessment/formula-templates' },
  { id: 'assessment-formula/template', path: '/assessment/formula-templates/:versionId' },
  { id: 'assessment-formula/editor', path: '/assessment/formulas/:functionId' },
].map((one) => ({ ...one, component: one.id, layout: 'admin' }))

const open = (
  had: {
    items?: readonly unknown[]
    detail?: Record<string, unknown>
    copied?: { name: string; description?: string }[]
    route?: string
  } = {},
) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () => Effect.succeed({ ...emptyManifest(), pages: PAGES }),
      },
      assessmentFormula: {
        listFormulaTemplates: () =>
          Effect.succeed({ items: had.items ?? [template()], nextCursor: null }),
        getFormulaTemplate: () =>
          Effect.succeed({
            template: {
              ...template(),
              sourceTs: 'export default defineFormula({})',
              tests: [{ name: 'ok', input: {}, expected: '3' }],
              inputSchema: {},
              outputSchema: {},
              ...had.detail,
            },
          }),
        copyFormulaTemplate: (call: { payload: { name: string; description?: string } }) => {
          had.copied?.push(call.payload)
          return Effect.succeed({ function: { id: NEW_FUNCTION_ID } })
        },
      },
    } as never),
    routes: [
      { path: '/assessment/formula-templates', element: <TemplatesPage /> },
      { path: '/assessment/formula-templates/:versionId', element: <TemplatePage /> },
      { path: '/assessment/formulas/:functionId', element: <div>editor</div> },
    ] as never,
    route: had.route ?? '/assessment/formula-templates',
  })

describe('the formula template library', () => {
  it('lists what other people offered, naming who wrote each one', async () => {
    open()
    const row = page.getByTestId('template-row')
    await expect.element(row).toBeVisible()
    await expect.element(row).toHaveAttribute('data-version-id', VERSION_ID)
    await expect.element(row).toHaveAttribute('data-source-status', 'active')
    await expect.element(page.getByTestId('template-author')).toBeVisible()
  })

  it('says a template whose source was archived still is one', async () => {
    // archival stops a formula being offered for its author's own new
    // questions; it says nothing about what they already offered others
    open({ items: [template({ sourceStatus: 'archived' })] })
    await expect
      .element(page.getByTestId('template-row'))
      .toHaveAttribute('data-source-status', 'archived')
  })

  it('shows what a reader has to see before deciding to copy', async () => {
    open({ route: `/assessment/formula-templates/${VERSION_ID}` })
    await expect.element(page.getByTestId('template-detail')).toBeVisible()
    // the source is here because copying hands it over anyway
    await expect.element(page.getByTestId('template-source')).toBeVisible()
  })

  it('starts a formula of my own, named what I meant to call it', async () => {
    const copied: { name: string; description?: string }[] = []
    open({ route: `/assessment/formula-templates/${VERSION_ID}`, copied })
    await expect.element(page.getByTestId('template-detail')).toBeVisible()

    await page.getByRole('button', { name: '复制到我的公式' }).first().click()
    const name = page.getByRole('textbox', { name: '名称' })
    await expect.element(name).toBeVisible()
    // prefilled from the source, and the reader's to change
    await name.fill('我的竞赛加分')
    await page.getByTestId('template-copy-confirm').click()

    await expect.poll(() => copied.length).toBe(1)
    expect(copied[0]?.name).toBe('我的竞赛加分')
    // and it lands on the formula that is now theirs
    await expect
      .element(page.getByTestId('address'))
      .toHaveTextContent(`/assessment/formulas/${NEW_FUNCTION_ID}`)
  })

  it('offers no way to follow the source it came from', async () => {
    // a copy is a snapshot: there is nothing to sync, and a control saying
    // otherwise would promise something this product does not do
    open({ route: `/assessment/formula-templates/${VERSION_ID}` })
    await expect.element(page.getByTestId('template-detail')).toBeVisible()
    for (const word of ['同步', '升级', '更新到']) {
      expect(page.getByText(word).elements()).toHaveLength(0)
    }
  })
})
