import TemplatesPage from '../src/client/FormulaTemplatesPage.tsx'
import TemplatePage from '../src/client/FormulaTemplatePage.tsx'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { vi } from 'vitest'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The library of formulas other people offered you.
//
// Everything on it belongs to somebody else, and the one thing to do with a
// row is start your own from it. So the assertions are about what a reader
// can reach and what they get - never about following a source, which this
// product deliberately does not do.

const VERSION_ID = '01920000-0000-7000-8000-0000000000a1'
// every shape the reader has to render without losing a character: quotes of
// both kinds, a template with an interpolation in it, both comment forms,
// numbers and language constants, a type, words in Chinese, and the three
// characters a page that built HTML out of this would swallow
const RICH_SOURCE = `import { Schema, defineFormula } from '@qualy/formula'

/* what a batch pays for a place
   on the list, across two lines */
type Rank = 1 | 2 | 3
const LABELS: Record<string, string> = { first: "一等奖", second: '二等奖' }

export default defineFormula({
  // a & b < c > d, which is text and not markup
  name: \`\${LABELS.first} 与 \${LABELS.second}\`,
  input: Schema.input({ rank: Schema.integer({ minimum: 1, maximum: 3 }) }),
  output: Schema.scoreAmount(),
  run: ({ rank }) => (rank === 1 ? 5 : rank === 2 ? 3 : null ?? 0),
})
`
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
].map((one) => ({ ...one, layout: 'admin' }))

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

  it('opens the examples the version was published with', async () => {
    // the count on the detail card is the way in: examples are the fastest
    // read of what the formula does, and there is nowhere else to see them
    open({
      route: `/assessment/formula-templates/${VERSION_ID}`,
      detail: {
        tests: [
          { name: '国家级一等奖', input: { level: 'national' }, expected: '8' },
          { name: '校级', input: { level: 'school' }, expected: '2' },
        ],
        inputSchema: {
          type: 'object',
          properties: { level: { type: 'string' } },
          required: ['level'],
          additionalProperties: false,
          'x-qualy-order': ['level'],
        },
      },
    })
    await page.getByTestId('template-examples-open').click()
    await expect.element(page.getByTestId('template-examples')).toBeVisible()
    expect(document.querySelectorAll('[data-testid="template-example"]')).toHaveLength(2)
    await expect.element(page.getByText('国家级一等奖')).toBeVisible()
  }, 30_000)

  it('reads the source out exactly, whatever the highlighter makes of it', async () => {
    open({
      route: `/assessment/formula-templates/${VERSION_ID}`,
      detail: { sourceTs: RICH_SOURCE },
    })
    const view = page.getByTestId('template-source')
    await expect.element(view).toBeVisible()

    // the lines a reader can copy, without the numbers beside them
    const code = () =>
      [...document.querySelectorAll('[data-testid="template-source"] code')]
        .map((one) => one.textContent ?? '')
        .join('\n')
    // before any colour has arrived, the whole source is already on screen
    expect(code()).toBe(RICH_SOURCE.replace(/\n$/, ''))

    // and once the colour is here, the text is exactly the source
    await vi.waitFor(
      () => {
        const source = document.querySelector('[data-testid="template-source"]')
        if (source?.getAttribute('data-state') !== 'read')
          throw new Error('still waiting for colour')
        if (source.querySelectorAll('code span[style]').length === 0)
          throw new Error('nothing coloured')
      },
      { timeout: 20_000 },
    )
    expect(code()).toBe(RICH_SOURCE.replace(/\n$/, ''))
    // the angle brackets are characters, not elements somebody built
    expect(document.querySelectorAll('[data-testid="template-source"] code div')).toHaveLength(0)
    expect(code()).toContain('a & b < c > d')
    expect(code()).toContain('一等奖')
    expect(code()).toContain('${LABELS.first}')
  }, 30_000)

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
