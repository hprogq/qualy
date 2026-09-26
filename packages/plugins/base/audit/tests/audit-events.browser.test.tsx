import AuditEventsPage from '../src/client/AuditEventsPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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
})
