import AuditEventsPage from '../src/client/AuditEventsPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The whole trail: a row opens into what the trail kept, and one actor's
// operations are one press away from any of theirs.

const ACTOR = '11111111-1111-4111-8111-111111111111'

const event = (id: string) => ({
  id,
  occurredAt: '2026-09-25T06:30:00.000Z',
  actionCode: `test.event.${id}`,
  actionVersion: 1,
  actionName: 'Edit user',
  actorKind: 'user' as const,
  actorUserId: ACTOR,
  actorLabel: '李老师',
  targetKind: 'auth.user',
  targetId: 'u1',
  targetLabel: '张三',
  organizationId: null,
  outcome: 'success' as const,
  reasonCode: null,
  details: { fields: ['email'] },
  source: 'http' as const,
  requestId: 'r1',
  traceId: null,
  clientIp: '203.0.113.7',
  userAgent: null,
})

describe('the audit log', () => {
  it('keeps rows during a slow page turn and moves keyboard focus to the results', async () => {
    let finish: (() => void) | undefined
    const list = vi.fn(({ query }: { query: Record<string, string> }) => {
      const at = Number(query['page'])
      const result = { items: [event(`page-${at}`)], total: 101, page: at, pageSize: 50 }
      return at === 1
        ? Effect.succeed(result)
        : Effect.promise(
            () =>
              new Promise<typeof result>((resolve) => {
                finish = () => resolve(result)
              }),
          )
    })
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        audit: {
          listAuditEvents: list,
          getAuditEventOptions: () => Effect.succeed({ actions: [] }),
        },
      }),
      route: '/organization/audit',
      path: '/organization/audit',
      children: <AuditEventsPage />,
    })
    const next = page.getByRole('button', { name: '下一页' })
    await expect.element(next).toBeEnabled()
    ;(next.element() as HTMLElement).focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(next).toBeDisabled()
    await expect
      .element(page.getByTestId('audit-row'))
      .toHaveAttribute('data-action', 'test.event.page-1')
    const results = page.getByTestId('audit-results').element()
    expect(document.activeElement).toBe(results)
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    finish!()
    await expect
      .element(page.getByTestId('audit-row'))
      .toHaveAttribute('data-action', 'test.event.page-2')
    await expect.element(next).toBeEnabled()
    expect(document.activeElement).toBe(results)
  })

  const openPages = (route = '/organization/audit') => {
    const list = vi.fn(({ query }: { query: Record<string, string> }) => {
      const total = query['outcome'] || query['actionCode'] ? 1 : 451
      const at = Math.min(Number(query['page']), Math.ceil(total / 50))
      return Effect.succeed({ items: [event(`page-${at}`)], total, page: at, pageSize: 50 })
    })
    return {
      list,
      screen: renderScreen({
        client: fakeClient({
          app: { getManifest: () => Effect.succeed(emptyManifest()) },
          audit: {
            listAuditEvents: list,
            getAuditEventOptions: () =>
              Effect.succeed({
                actions: [{ code: 'test.action', name: 'Test action', plugin: 'test' }],
              }),
          },
        }),
        route,
        path: '/organization/audit',
        children: <AuditEventsPage />,
      }),
    }
  }

  it('jumps directly to the last page, replaces rows, and restores the page from its address', async () => {
    const { screen, list } = openPages('/organization/audit?page=2')
    await screen
    const pager = page.getByTestId('audit-pager')
    await expect.element(pager).toHaveAttribute('data-page', '2')
    await expect.element(pager).toHaveAttribute('data-total', '451')
    await pager.getByRole('button', { name: '10', exact: true }).click()
    await expect.element(pager).toHaveAttribute('data-page', '10')
    expect(list).toHaveBeenLastCalledWith({ query: { page: '10' } })
    expect(addressNow()).toContain('page=10')
    expect(page.getByTestId('audit-row').elements()).toHaveLength(1)
    await expect
      .element(page.getByTestId('audit-row'))
      .toHaveAttribute('data-action', 'test.event.page-10')
    await pager.getByRole('button', { name: '上一页' }).click()
    await expect.element(pager).toHaveAttribute('data-page', '9')
  })

  it('resets the page together with action and outcome filters', async () => {
    const { screen, list } = openPages('/organization/audit?page=10')
    await screen
    await expect.element(page.getByTestId('audit-pager')).toHaveAttribute('data-page', '10')
    await page.getByRole('combobox').nth(0).click()
    await page.getByRole('option', { name: 'Test action' }).click()
    await vi.waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { actionCode: 'test.action', page: '1' } }),
    )
    expect(addressNow()).not.toContain('page=')
    await page.getByRole('combobox').nth(1).click()
    await page.getByRole('option', { name: '失败', exact: true }).click()
    await vi.waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({
        query: { actionCode: 'test.action', outcome: 'failure', page: '1' },
      }),
    )
    await expect.element(page.getByTestId('audit-pager')).toHaveAttribute('data-total', '1')
  })

  it('uses the clamped server page and keeps every pager control inside a phone viewport', async () => {
    await page.viewport(320, 740)
    try {
      const { screen } = openPages('/organization/audit?page=999')
      await screen
      const pager = page.getByTestId('audit-pager')
      await expect.element(pager).toHaveAttribute('data-page', '10')
      await pager.getByRole('button', { name: '上一页' }).click()
      await expect.element(pager).toHaveAttribute('data-page', '9')
      for (const control of pager.getByRole('button').elements()) {
        const bounds = control.getBoundingClientRect()
        expect(bounds.left).toBeGreaterThanOrEqual(0)
        expect(bounds.right).toBeLessThanOrEqual(320)
      }
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('narrows to the actor of an opened row, and asks the trail for theirs alone', async () => {
    const list = vi.fn((_: { query: Record<string, string> }) =>
      Effect.succeed({
        items: [event('e1')],
        total: 1,
        page: 1,
        pageSize: 50,
      }),
    )
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        audit: {
          listAuditEvents: list,
          getAuditEventOptions: () => Effect.succeed({ actions: [] }),
        },
      }),
      route: '/organization/audit?page=3',
      path: '/organization/audit',
      children: <AuditEventsPage />,
    })
    await page.getByTestId('audit-row').click()
    await expect.element(page.getByTestId('audit-detail')).toBeVisible()
    await page.getByRole('button', { name: '只看此人' }).click()
    await vi.waitFor(() => expect(addressNow()).toContain(`actor=${ACTOR}`))
    await vi.waitFor(() =>
      expect(list).toHaveBeenLastCalledWith({ query: { actorUserId: ACTOR, page: '1' } }),
    )
    expect(addressNow()).not.toContain('page=')
    await expect.element(page.getByTestId('actor-filter')).toHaveAttribute('data-actor', ACTOR)
  })

  // The picker is only there for a reader who may look people up. Without
  // it the choice opened a dialog holding one grey sentence; now it is not
  // offered, and a row's "only this person" is the way to narrow.
  const trail = (slots: Record<string, { id: string; order: number }[]>) =>
    renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed({ ...emptyManifest(), slots }) },
        audit: {
          listAuditEvents: () => Effect.succeed({ items: [], total: 0, page: 1, pageSize: 50 }),
          getAuditEventOptions: () => Effect.succeed({ actions: [] }),
        },
      }),
      route: '/organization/audit',
      path: '/organization/audit',
      children: <AuditEventsPage />,
    })

  it('offers to choose whose operations only where people can be looked up', async () => {
    const screen = await trail({})
    await expect.element(page.getByTestId('audit-table')).toBeVisible()
    expect(page.getByRole('button', { name: '全部操作人' }).elements()).toHaveLength(0)
    await screen.unmount()

    await trail({ 'iam/people-picker': [{ id: 'auth/people-picker', order: 0 }] })
    await expect.element(page.getByRole('button', { name: '全部操作人' })).toBeVisible()
  })

  // A trail that could not be read said one fixed sentence with a retry,
  // whatever the reason; one the reader may not read is not worth a retry,
  // and the answer is a pane under the page's own title.
  it('says a trail the reader may not read as that, with no retry', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        audit: {
          listAuditEvents: () => Effect.fail(apiError('ACCESS_DENIED')),
          getAuditEventOptions: () => Effect.succeed({ actions: [] }),
        },
      }),
      route: '/organization/audit',
      path: '/organization/audit',
      children: <AuditEventsPage />,
    })
    const state = page.getByResourceState()
    await expect.element(state).toHaveAttribute('data-state', 'denied')
    await expect.element(state.getByRole('heading', { level: 2 })).toBeVisible()
    expect(state.getByRole('button', { name: '重试' }).elements()).toHaveLength(0)
  })
})
