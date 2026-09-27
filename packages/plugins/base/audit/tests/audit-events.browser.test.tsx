import AuditEventsPage from '../src/client/AuditEventsPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The whole trail: a row opens into what the trail kept, and one actor's
// operations are one press away from any of theirs.

const ACTOR = '11111111-1111-4111-8111-111111111111'

describe('the audit log', () => {
  it('narrows to the actor of an opened row, and asks the trail for theirs alone', async () => {
    const list = vi.fn((_: { query: Record<string, string> }) =>
      Effect.succeed({
        items: [
          {
            id: 'e1',
            occurredAt: '2026-09-25T06:30:00.000Z',
            actionCode: 'auth.user.update',
            actionVersion: 1,
            actionName: { kind: 'literal' as const, value: 'Edit user' },
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
          },
        ],
        nextCursor: null,
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
      route: '/organization/audit',
      path: '/organization/audit',
      children: <AuditEventsPage />,
    })
    await page.getByTestId('audit-row').click()
    await expect.element(page.getByTestId('audit-detail')).toBeVisible()
    await page.getByRole('button', { name: '只看此人' }).click()
    await vi.waitFor(() => expect(addressNow()).toContain(`actor=${ACTOR}`))
    await vi.waitFor(() => expect(list).toHaveBeenLastCalledWith({ query: { actorUserId: ACTOR } }))
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
          listAuditEvents: () => Effect.succeed({ items: [], nextCursor: null }),
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
