import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { UnreachableDialog } from '../src/client/roster/UnreachableDialog.tsx'
import { PendingList } from '../src/client/items/editor/PendingList.tsx'
import type { EditorProblem } from '../src/client/items/editor/model.ts'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

const BATCH = '11111111-1111-4111-8111-111111111111'
const FIRST = '22222222-2222-4222-8222-222222222222'
const SECOND = '33333333-3333-4333-8333-333333333333'

const routeOf = (itemId: string, route: 'normal' | 'escalation', participants: number) => ({
  itemId,
  itemTitle: itemId === FIRST ? '志愿服务活动' : '学术交流',
  route,
  participants,
  levelNames: ['专业方向', '班级'],
})

const openPeople = async (
  route: 'normal' | 'escalation' = 'normal',
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) => {
  const requests = vi.fn(
    ({ query }: { query: { page: string; itemId: string; route: string; limit: string } }) => {
      const total = query.itemId === FIRST ? 10000 : 3
      const at = Math.min(Number(query.page), Math.ceil(total / 10))
      return Effect.succeed({
        items: Array.from({ length: Math.min(10, total - (at - 1) * 10) }, (_, index) => ({
          participantId: `${query.itemId}-${(at - 1) * 10 + index}`,
          userId: `user-${index}`,
          displayName: `参评人${(at - 1) * 10 + index + 1}`,
          businessNo: index === 0 ? null : `202300${index}`,
          unitPath: ['学校', '软件学院', '计算机科学与技术', '软件工程方向', '2023级1班'],
        })),
        total,
        page: at,
        pageSize: 10,
      })
    },
  )
  const opened = vi.fn()
  await renderScreen({
    locale,
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      assessment: {
        reviewAlerts: () =>
          Effect.succeed({
            groups: [],
            unreachable: {
              routes: [
                routeOf(FIRST, route, 10000),
                routeOf(SECOND, route, 3),
                routeOf('hidden', route === 'normal' ? 'escalation' : 'normal', 2),
              ],
              cannotSubmit: 10000,
              cannotAppeal: 10000,
            },
          }),
        listUnreachableParticipants: requests,
      },
    }),
    routes: [
      {
        path: '/',
        element: (
          <UnreachableDialog
            batchId={BATCH}
            route={route}
            open
            onClose={() => {}}
            {...(route === 'normal' ? { onOpenPerson: opened } : {})}
          />
        ),
      },
    ],
    route: '/',
  })
  return { requests, opened }
}

describe('warning detail panels', () => {
  const question = (index: 'first' | 'last') =>
    page.getByTestId('unreachable-dialog').getByTestId('unreachable-question')[index]()

  it.each([
    [1280, 844],
    [844, 390],
  ])(
    'keeps the questions beside the chosen one’s people, paginated, at %i by %i px',
    async (width, height) => {
      await page.viewport(width, height)
      try {
        const { requests, opened } = await openPeople()
        const dialog = page.getByTestId('unreachable-dialog')
        await expect
          .poll(() => dialog.getByTestId('unreachable-question').elements().length)
          .toBe(2)
        // the first question is open from the start
        await expect.element(question('first')).toHaveAttribute('data-chosen', 'true')
        await expect.poll(() => dialog.getByTestId('unreachable-person').elements().length).toBe(10)
        expect(requests.mock.calls.at(-1)?.[0].query).toMatchObject({ itemId: FIRST, page: '1' })
        const list = dialog.getByTestId('unreachable-people').element()
        expect(list.getAttribute('data-total')).toBe('10000')
        expect(list.clientHeight).toBeGreaterThan(36)
        await expect.element(dialog.getByText('未绑定学工号')).toBeVisible()
        expect(dialog.element().querySelector('[title]')).toBeNull()
        const pager = dialog.getByTestId('unreachable-pager')
        const panelRect = dialog.element().getBoundingClientRect()
        const pagerRect = pager.element().getBoundingClientRect()
        expect(pagerRect.bottom).toBeLessThan(panelRect.bottom)
        expect(pagerRect.top).toBeGreaterThanOrEqual(list.getBoundingClientRect().bottom)
        expect(panelRect.left).toBeGreaterThanOrEqual(0)
        expect(panelRect.right).toBeLessThanOrEqual(width)
        // the questions stand beside the people, not over them
        const questions = dialog.getByTestId('unreachable-questions').element()
        expect(questions.getBoundingClientRect().right).toBeLessThanOrEqual(
          list.getBoundingClientRect().left + 1,
        )
        await pager.getByRole('button', { name: '1000', exact: true }).click()
        await expect.element(dialog.getByRole('button', { name: /参评人9991/ })).toBeVisible()
        expect(requests.mock.calls.at(-1)?.[0].query).toMatchObject({
          page: '1000',
          limit: '10',
          route: 'normal',
        })
        await dialog.getByRole('button', { name: /参评人9991/ }).click()
        expect(opened).toHaveBeenCalledWith(`${FIRST}-9990`)
        await question('last').getByRole('button').click()
        await expect.element(question('last')).toHaveAttribute('data-chosen', 'true')
        await expect.element(question('first')).toHaveAttribute('data-chosen', 'false')
        await expect.poll(() => dialog.getByTestId('unreachable-person').elements().length).toBe(3)
        expect(requests.mock.calls.at(-1)?.[0].query).toMatchObject({ itemId: SECOND, page: '1' })
        await expect.element(question('last').getByRole('button')).toHaveFocus()
      } finally {
        await page.viewport(1280, 800)
      }
    },
  )

  it.each([
    [390, 844],
    [390, 568],
  ])(
    'opens a question’s people in place of the list on a phone at %i by %i px',
    async (width, height) => {
      await page.viewport(width, height)
      try {
        const { requests, opened } = await openPeople()
        const dialog = page.getByTestId('unreachable-dialog')
        await expect
          .poll(() => dialog.getByTestId('unreachable-question').elements().length)
          .toBe(2)
        expect(requests).not.toHaveBeenCalled()
        await question('first').getByRole('button').click()
        await expect.poll(() => dialog.getByTestId('unreachable-person').elements().length).toBe(10)
        await expect
          .element(dialog.getByRole('button', { name: '返回', exact: true }))
          .toHaveFocus()
        const list = dialog.getByTestId('unreachable-people').element()
        expect(list.getAttribute('data-total')).toBe('10000')
        expect(list.scrollHeight).toBeGreaterThan(list.clientHeight)
        expect(list.clientHeight).toBeGreaterThan(36)
        expect(dialog.getByTestId('unreachable-question').elements()).toHaveLength(0)
        const pager = dialog.getByTestId('unreachable-pager')
        const panelRect = dialog.element().getBoundingClientRect()
        const pagerRect = pager.element().getBoundingClientRect()
        expect(pagerRect.bottom).toBeLessThan(panelRect.bottom)
        expect(pagerRect.top).toBeGreaterThanOrEqual(list.getBoundingClientRect().bottom)
        expect(panelRect.left).toBeGreaterThanOrEqual(0)
        expect(panelRect.right).toBeLessThanOrEqual(width)
        await pager.getByRole('button', { name: '1000', exact: true }).click()
        await dialog.getByRole('button', { name: /参评人9991/ }).click()
        expect(opened).toHaveBeenCalledWith(`${FIRST}-9990`)
        await dialog.getByRole('button', { name: '返回', exact: true }).click()
        await expect.element(question('first').getByRole('button')).toHaveFocus()
        await question('last').getByRole('button').click()
        await expect.poll(() => dialog.getByTestId('unreachable-person').elements().length).toBe(3)
        expect(requests.mock.calls.at(-1)?.[0].query).toMatchObject({ itemId: SECOND, page: '1' })
      } finally {
        await page.viewport(1280, 800)
      }
    },
  )

  it('uses the same layout for appeals without offering an unavailable account action', async () => {
    const { requests } = await openPeople('escalation')
    const dialog = page.getByTestId('unreachable-dialog')
    await expect.element(dialog.getByRole('heading', { name: '无法申诉的项目' })).toBeVisible()
    await expect.poll(() => dialog.getByTestId('unreachable-question').elements().length).toBe(2)
    await expect.poll(() => dialog.getByTestId('unreachable-person').elements().length).toBe(10)
    expect(requests.mock.calls.at(-1)?.[0].query.route).toBe('escalation')
    expect(dialog.element().querySelector('button[data-testid="unreachable-person"]')).toBeNull()
  })

  it('keeps English details and the close action separate on a narrow screen', async () => {
    await page.viewport(390, 844)
    try {
      await openPeople('normal', 'en-US')
      const dialog = page.getByTestId('unreachable-dialog')
      const heading = dialog.getByRole('heading')
      await expect.element(heading).toBeVisible()
      const close = dialog.element().querySelector('[data-slot="dialog-close"]')!
      expect(heading.element().getBoundingClientRect().right).toBeLessThan(
        close.getBoundingClientRect().left,
      )
      await question('first').getByRole('button').click()
      await expect.element(dialog.getByText('No Student/staff ID')).toBeVisible()
      const pager = dialog.getByTestId('unreachable-pager').element().getBoundingClientRect()
      expect(pager.bottom).toBeLessThan(dialog.element().getBoundingClientRect().bottom)
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it.each([1280, 390])(
    'joins the editor problem heading to its scrollable rows at %i px',
    async (width) => {
      await page.viewport(width, 844)
      try {
        const go = vi.fn()
        const problems: EditorProblem[] = Array.from({ length: 40 }, (_, index) => ({
          area: 'rules',
          block: 'review',
          code: 'stage-unnamed',
          tone: 'error',
          subject: `需要检查的审核步骤${index + 1}`,
        }))
        await renderScreen({
          client: fakeClient({ app: { getManifest: () => Effect.succeed(emptyManifest()) } }),
          routes: [
            { path: '/', element: <PendingList problems={problems} failed={false} onGo={go} /> },
          ],
          route: '/',
        })
        await page.getByTestId('pending-trigger').click()
        const list = page.getByTestId('pending-list')
        await expect.element(list).toBeVisible()
        const dropdown = list.element().parentElement!
        const heading = list.element().previousElementSibling!
        const listRect = list.element().getBoundingClientRect()
        expect(Math.abs(listRect.top - heading.getBoundingClientRect().bottom)).toBeLessThan(1)
        expect(getComputedStyle(dropdown).gap).toBe('0px')
        expect(list.element().scrollHeight).toBeGreaterThan(list.element().clientHeight)
        expect(dropdown.getBoundingClientRect().left).toBeGreaterThanOrEqual(0)
        expect(dropdown.getBoundingClientRect().right).toBeLessThanOrEqual(width)
        expect(dropdown.querySelector('[title]')).toBeNull()
        await page.getByTestId('pending-row').last().click()
        expect(go).toHaveBeenCalledWith(problems.at(-1))
      } finally {
        await page.viewport(1280, 800)
      }
    },
  )
})
