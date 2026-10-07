import { lazy } from 'react'
import { Route, Routes } from 'react-router'
import { afterEach, describe, expect, it } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import WorkspaceShell from '@qualy/plugin-layout-default/client/WorkspaceShell'
import ItemSettingsPage from '../src/client/items/ItemSettingsPage.tsx'
import { PendingList } from '../src/client/items/editor/PendingList.tsx'
import type { EditorProblem } from '../src/client/items/editor/model.ts'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

const BATCH = '11111111-1111-4111-8111-111111111111'
const PAPER = '22222222-2222-4222-8222-222222222222'
const ITEM = '66666666-6666-4666-8666-666666666666'
const TYPE = '33333333-3333-4333-8333-333333333333'
const ROLE = '44444444-4444-4444-8444-444444444444'
const PATH = '/assessment/batches/:batchId/items'

const mount = (locale: 'zh-CN' | 'en-US' = 'zh-CN', unfinished = false) =>
  renderScreen({
    locale,
    route: `/assessment/batches/${BATCH}/items?question=${ITEM}`,
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: [{ id: 'assessment/batch-items', path: PATH, layout: 'admin' }],
            collections: {
              'app-shell/navigation-groups': [],
              'app-shell/navigation-primary': [],
              'workspace-shell/navigation': [
                {
                  id: 'assessment/batch-items/rail',
                  label: '项目配置',
                  target: { kind: 'page', pageId: 'assessment/batch-items', path: PATH },
                  order: 10,
                },
              ],
              'assessment/calculator-authoring-options': [
                { id: 'assessment/fixed-calculator', ref: 'fixed@1', label: '固定分值', order: 10 },
              ],
            },
            slots: {
              'assessment/calculator-editor': [
                { id: 'assessment/fixed-calculator-editor', order: 10 },
              ],
            },
          }),
      },
      assessment: {
        getBatch: () =>
          Effect.succeed({
            batch: {
              id: BATCH,
              name: '2026 春季综测',
              descriptionMd: null,
              manageable: true,
              reviewReasons: { reject: [], escalate: [] },
              capabilities: {
                personal: false,
                review: false,
                record: false,
                manage: true,
                redetermine: false,
                readAll: false,
              },
              participantCount: 12,
              materialRange: { start: '2026-03-01', end: '2026-09-01' },
              timezone: 'Asia/Shanghai',
              status: 'draft',
              configRevision: 0,
              currentPhaseId: null,
              currentPhaseName: null,
              createdAt: '2026-02-01T00:00:00.000Z',
            },
          }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: [
              {
                id: PAPER,
                parentGroupId: null,
                name: '综合素质测评',
                cap: null,
                floor: null,
                sortOrder: 0,
                itemCount: 1,
              },
            ],
            version: 1,
            capabilities: { canManage: true },
          }),
        listItems: () =>
          Effect.succeed({
            items: [
              {
                id: ITEM,
                batchId: BATCH,
                itemType: 'evidence',
                title: '学生干部任职与班级社团工作履职情况',
                scoreGroupId: PAPER,
                maxEntries: 5,
                sortOrder: 0,
                status: 'active',
                voidReason: null,
                createdAt: '2026-02-01T00:00:00.000Z',
                currentRevision: {
                  id: '77777777-7777-4777-8777-777777777777',
                  revisionNo: 1,
                  entryChannels: ['participant'],
                  formConfig: {
                    files: {},
                    fields: [
                      {
                        id: 'claimed-level',
                        key: 'claimed-level',
                        label: '任职情况',
                        type: 'text',
                      },
                    ],
                  },
                  scoringConfig: {
                    calculator: { ref: 'fixed@1', config: { value: '2.00' } },
                    aggregator: { ref: 'max@1', config: {} },
                  },
                  reviewPolicy: {
                    normal: {
                      stages: [
                        {
                          id: 's-first',
                          label: unfinished ? '' : '班委初审',
                          selector: { kind: 'roleAt', nodeTypeId: TYPE, roleIds: [ROLE] },
                          quorum: { type: 'any' },
                        },
                      ],
                    },
                    escalation: { stages: [] },
                  },
                  displayConfig: {},
                  reason: null,
                  createdAt: '2026-02-01T00:00:00.000Z',
                },
              },
            ],
            capabilities: { canManage: true },
          }),
        itemOptions: () =>
          Effect.succeed({
            orgTypes: [{ id: TYPE, name: '班级' }],
            roles: [{ id: ROLE, name: '审核员' }],
          }),
        reviewAlerts: () =>
          Effect.succeed({
            groups: [],
            unreachable: { routes: [], cannotSubmit: 0, cannotAppeal: 0 },
          }),
        reviewCoverage: () => Effect.succeed({ nodes: [] }),
        listUnreachableParticipants: () =>
          Effect.succeed({ items: [], total: 0, page: 1, pageSize: 10 }),
        checkItem: () => Effect.succeed({ issues: [], standing: [] }),
      },
    }),
    registry: {
      slots: {
        'assessment/calculator-editor': {
          'assessment/fixed-calculator-editor': lazy(
            () => import('../src/client/items/FixedCalculatorEditor.tsx') as never,
          ),
        },
      },
    },
    children: (
      <Routes>
        <Route element={<WorkspaceShell />}>
          <Route path={PATH} element={<ItemSettingsPage />} />
        </Route>
      </Routes>
    ),
  })

const settle = async () => {
  await expect.element(page.getByTestId('item-editor-panel')).toBeVisible()
  await expect
    .poll(() => {
      let node: Element | null = page.getByTestId('item-editor').element()
      while (node !== null) {
        const style = getComputedStyle(node)
        if (style.transform !== 'none' || style.opacity !== '1') return false
        node = node.parentElement
      }
      return true
    })
    .toBe(true)
}

const openedProblems = async () => {
  await expect.element(page.getByTestId('pending-list')).toBeVisible()
  const dialog = page.getByRole('dialog').element()
  await expect
    .poll(() => {
      const style = getComputedStyle(dialog)
      return style.opacity === '1' && style.transform === 'none'
    })
    .toBe(true)
  return dialog
}

afterEach(() => page.viewport(1280, 900))

describe('the item editor navigation', () => {
  it.each(['zh-CN', 'en-US'] as const)(
    'fills the desktop sidebar with equal-width views and puts corrections below them in %s',
    async (locale) => {
      await page.viewport(1280, 900)
      await mount(locale, true)
      await settle()
      const navigation = page.getByTestId('item-tabs').element()
      const panel = page.getByTestId('item-editor-panel').element()
      const nav = navigation.getBoundingClientRect()
      const form = panel.getBoundingClientRect()
      expect(nav.width).toBe(192)
      expect(nav.right).toBeLessThan(form.left)
      expect(form.top).toBeCloseTo(nav.top, 0)
      expect(form.width).toBeGreaterThan(700)
      const basics = panel.querySelector('[data-block="basics"]')!.getBoundingClientRect()
      expect(basics.left).toBeCloseTo(form.left, 0)
      expect(basics.right).toBeCloseTo(form.right, 0)
      const description = panel.querySelector('textarea')!.getBoundingClientRect()
      expect(description.right).toBeCloseTo(form.right, 0)
      await expect
        .element(page.getByRole('tablist'))
        .toHaveAttribute('aria-orientation', 'vertical')
      const tabs = page.getByRole('tab').elements()
      for (const tab of tabs) {
        const bounds = tab.getBoundingClientRect()
        expect(bounds.left).toBeCloseTo(nav.left, 0)
        expect(bounds.width).toBeCloseTo(nav.width, 0)
      }
      for (let index = 1; index < tabs.length; index += 1) {
        expect(tabs[index]!.getBoundingClientRect().top).toBeGreaterThanOrEqual(
          tabs[index - 1]!.getBoundingClientRect().bottom,
        )
      }
      const problem = page.getByTestId('pending-trigger').element().getBoundingClientRect()
      const save = page.getByTestId('item-save').element().getBoundingClientRect()
      expect(problem.left).toBeGreaterThanOrEqual(nav.left)
      expect(problem.right).toBeLessThanOrEqual(nav.right)
      expect(problem.bottom).toBeLessThanOrEqual(nav.bottom)
      expect(problem.top - tabs.at(-1)!.getBoundingClientRect().bottom).toBeGreaterThanOrEqual(24)
      expect(problem.width).toBeLessThan(nav.width)
      expect(getComputedStyle(page.getByTestId('pending-trigger').element()).boxShadow).toBe('none')
      expect(save.bottom).toBeLessThan(form.top)
      expect(save.right).toBeLessThanOrEqual(1280)
      expect(page.getByRole('tab').elements()[2]!.getAttribute('data-tone')).toBe('error')
      const trigger = page.getByTestId('pending-trigger')
      expect(getComputedStyle(trigger.element()).paddingLeft).toBe('10px')
      expect(getComputedStyle(trigger.element()).paddingRight).toBe('10px')
      const triggerDot = trigger.element().querySelector('[data-tone]')!.getBoundingClientRect()
      const tabDot = tabs[0]!.querySelector('[data-tone]')!.getBoundingClientRect()
      expect(triggerDot.left).toBeCloseTo(tabDot.left, 0)
      await trigger.click()
      const dropdown = await openedProblems()
      const pop = dropdown.getBoundingClientRect()
      expect(pop.left - problem.right).toBeCloseTo(12, 0)
      expect(pop.left).toBeGreaterThanOrEqual(
        navigation.closest('main')!.getBoundingClientRect().left,
      )
      expect(pop.right).toBeLessThanOrEqual(1280)
      expect(pop.top).toBeGreaterThanOrEqual(0)
      expect(pop.bottom).toBeLessThanOrEqual(900)
      const row = page.getByTestId('pending-row').element()
      const [where, what, go] = Array.from(row.children)
      expect(where!.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        what!.getBoundingClientRect().top,
      )
      expect(what!.getBoundingClientRect().right).toBeLessThanOrEqual(
        go!.getBoundingClientRect().left,
      )
      expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth)
      await userEvent.keyboard('{Escape}')
      await expect.element(page.getByTestId('pending-list')).not.toBeInTheDocument()
      await expect.poll(() => document.activeElement).toBe(trigger.element())
    },
  )

  it.each(['zh-CN', 'en-US'] as const)(
    'preserves full form width and reachable compact tabs on a phone in %s',
    async (locale) => {
      await page.viewport(390, 844)
      await mount(locale, true)
      await settle()
      await expect
        .element(page.getByRole('tablist'))
        .toHaveAttribute('aria-orientation', 'horizontal')
      const panel = page.getByTestId('item-editor-panel').element().getBoundingClientRect()
      const nav = page.getByTestId('item-tabs').element().getBoundingClientRect()
      expect(panel.left).toBe(nav.left)
      expect(panel.width).toBe(nav.width)
      expect(panel.top).toBeGreaterThan(nav.bottom)
      const problem = page.getByTestId('pending-trigger').element().getBoundingClientRect()
      for (const tab of page.getByRole('tab').elements()) {
        expect(tab.getBoundingClientRect().width).toBeGreaterThan(40)
        expect(tab.getBoundingClientRect().right).toBeLessThanOrEqual(problem.left)
        const word = tab.querySelector('[title]')!
        const text = word.getBoundingClientRect()
        const button = tab.getBoundingClientRect()
        expect(text.left).toBeGreaterThanOrEqual(button.left)
        expect(text.right).toBeLessThanOrEqual(button.right)
        expect(text.width).toBeGreaterThan(24)
        expect(getComputedStyle(word).textOverflow).toBe('ellipsis')
      }
      expect(problem.right).toBeLessThanOrEqual(390 - 16 + 1)
      const firstLabel = page.getByRole('tab').first().element().querySelector('[title]')!
      expect(firstLabel.scrollWidth).toBeLessThanOrEqual(firstLabel.clientWidth)
      expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390)
    },
  )

  it('keeps desktop navigation sticky while a long form scrolls', async () => {
    await page.viewport(1440, 720)
    await mount()
    await settle()
    const navigation = page.getByTestId('item-tabs').element()
    const main = navigation.closest('main')!
    const port = main.getBoundingClientRect()
    main.scrollTop = main.scrollHeight
    await expect.poll(() => navigation.getBoundingClientRect().top).toBeGreaterThanOrEqual(port.top)
    expect(navigation.getBoundingClientRect().bottom).toBeLessThan(720)
    await page.getByRole('tab').nth(2).click()
    await expect.element(page.getByTestId('item-editor')).toHaveAttribute('data-panel', 'rules')
  })

  it('covers raised card edges behind the sticky horizontal navigation', async () => {
    await page.viewport(1024, 390)
    await mount('en-US', true)
    await settle()
    const navigation = page.getByTestId('item-tabs').element()
    const main = navigation.closest('main')!
    const card = page.getByRole('radio').first().element()
    const port = main.getBoundingClientRect()
    main.scrollTop += card.getBoundingClientRect().top - port.top - 12
    await expect.poll(() => navigation.getBoundingClientRect().top).toBeCloseTo(port.top, 0)
    expect(card.getBoundingClientRect().top).toBeLessThan(navigation.getBoundingClientRect().bottom)
    const shade = getComputedStyle(navigation, '::before')
    expect(shade.content).not.toBe('none')
    expect(shade.backgroundColor).toBe(getComputedStyle(navigation).backgroundColor)
    expect(shade.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    expect(parseFloat(shade.top)).toBeLessThanOrEqual(-2)
    expect(parseFloat(shade.left)).toBeLessThanOrEqual(-2)
    expect(parseFloat(shade.right)).toBeLessThanOrEqual(-2)
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1024)
  })

  it.each([
    { width: 1280, height: 390, sidebar: true },
    { width: 390, height: 844, sidebar: false },
    { width: 844, height: 390, sidebar: false },
  ])(
    'keeps 40 long problems reachable at $width by $height',
    async ({ width, height, sidebar }) => {
      await page.viewport(width, height)
      const problems: EditorProblem[] = Array.from({ length: 40 }, (_, index) => ({
        area: 'rules',
        block: 'review',
        code: 'stage-unnamed',
        tone: 'error',
        subject: `Review stage ${index + 1} for scholarship evidence requiring faculty confirmation`,
      }))
      const visited: EditorProblem[] = []
      await renderScreen({
        locale: 'en-US',
        client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
        route: '/',
        routes: [
          {
            path: '/',
            element: (
              <aside style={{ width: 192, marginLeft: sidebar ? 248 : 16, marginTop: 112 }}>
                <PendingList
                  problems={problems}
                  failed
                  sidebar={sidebar}
                  onGo={(problem) => visited.push(problem)}
                />
              </aside>
            ),
          },
        ],
      })
      const trigger = page.getByTestId('pending-trigger')
      await expect.element(trigger).toBeVisible()
      const button = trigger.element()
      if (sidebar) {
        expect(button.getBoundingClientRect().width).toBeLessThanOrEqual(192)
        expect(button.getBoundingClientRect().height).toBeGreaterThan(28)
        expect(getComputedStyle(button).whiteSpace).toBe('normal')
        expect(getComputedStyle(button).boxShadow).toBe('none')
      }
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth)
      if (sidebar) {
        const words = button.querySelector('span:not([aria-hidden])')!
        expect(words.textContent).toBe(button.getAttribute('aria-label'))
        expect(getComputedStyle(words).textOverflow).not.toBe('ellipsis')
        expect(words.getBoundingClientRect().right).toBeLessThan(
          button.getBoundingClientRect().right,
        )
      }
      await trigger.click()
      const dropdown = await openedProblems()
      const pop = dropdown.getBoundingClientRect()
      expect(pop.left).toBeGreaterThanOrEqual(0)
      expect(pop.top).toBeGreaterThanOrEqual(0)
      expect(pop.right).toBeLessThanOrEqual(width)
      expect(pop.bottom).toBeLessThanOrEqual(height)
      if (sidebar) expect(pop.left).toBeGreaterThan(button.getBoundingClientRect().right)
      const list = page.getByTestId('pending-list').element()
      expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
      expect(list.scrollWidth).toBeLessThanOrEqual(list.clientWidth)
      const heading = list.previousElementSibling!
      expect(list.getBoundingClientRect().top).toBeCloseTo(
        heading.getBoundingClientRect().bottom,
        0,
      )
      await userEvent.keyboard('{Escape}')
      await expect.element(page.getByTestId('pending-list')).not.toBeInTheDocument()
      await expect.poll(() => document.activeElement).toBe(button)
      await trigger.click()
      await openedProblems()
      const reopenedList = page.getByTestId('pending-list').element()
      const last = page.getByTestId('pending-row').last().element()
      last.scrollIntoView({ block: 'end' })
      await expect.poll(() => reopenedList.scrollTop).toBeGreaterThan(0)
      expect(last.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        reopenedList.getBoundingClientRect().bottom + 1,
      )
      await page.getByTestId('pending-row').last().click()
      expect(visited).toEqual([problems.at(-1)])
    },
  )

  it('keeps edits and URL selection through keyboard navigation and a responsive layout change', async () => {
    await page.viewport(1440, 900)
    await mount()
    await settle()
    const title = page.getByTestId('item-editor-panel').getByRole('textbox').first()
    await title.fill('保留中的标题')
    const first = page.getByRole('tab').first().element() as HTMLElement
    first.focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByTestId('item-editor')).toHaveAttribute('data-panel', 'scoring')
    expect(addressNow()).toContain('panel=scoring')
    await userEvent.keyboard('{ArrowDown}')
    await expect.element(page.getByTestId('item-editor')).toHaveAttribute('data-panel', 'rules')
    await page.viewport(390, 844)
    await expect
      .element(page.getByRole('tablist'))
      .toHaveAttribute('aria-orientation', 'horizontal')
    expect(addressNow()).toContain('panel=rules')
    const current = page.getByRole('tab').nth(2).element() as HTMLElement
    current.focus()
    await userEvent.keyboard('{Home}')
    expect(document.activeElement).toBe(page.getByRole('tab').first().element())
    await userEvent.keyboard('{Enter}')
    await expect.element(page.getByTestId('item-editor')).toHaveAttribute('data-panel', 'basics')
    await expect
      .element(page.getByTestId('item-editor-panel').getByRole('textbox').first())
      .toHaveValue('保留中的标题')
  })

  it.each([1280, 390])(
    'opens the affected review step from the problem list at width %s',
    async (width) => {
      await page.viewport(width, 900)
      await mount('zh-CN', true)
      await settle()
      await page.getByTestId('pending-trigger').click()
      await page.getByTestId('pending-row').click()
      await expect.element(page.getByTestId('item-editor')).toHaveAttribute('data-panel', 'rules')
      expect(addressNow()).toContain('panel=rules')
      await expect.element(page.getByTestId('stage-apply')).toBeVisible()
      await expect.element(page.getByRole('dialog').getByRole('textbox').first()).toHaveValue('')
    },
  )
})
