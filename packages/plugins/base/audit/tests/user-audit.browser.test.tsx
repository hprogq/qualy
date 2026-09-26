import UserAuditPage from '../src/client/UserAuditPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { auditApi } from '../src/client/api.ts'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// One person's part of the trail, on their record: what was done to their
// account by default, what they did one press away, each read from the
// trail by the person rather than filtered on the screen.

type Event = ApiResult<typeof auditApi, 'audit', 'listAuditEvents'>['items'][number]

const USER_ID = '66666666-6666-4666-8666-666666666666'

const event = (id: string, over: Partial<Event> = {}): Event => ({
  id,
  occurredAt: '2026-09-25T06:30:00.000Z',
  actionCode: 'auth.user.update',
  actionVersion: 1,
  actionName: { kind: 'literal', value: 'Edit user' },
  actorKind: 'user',
  actorUserId: '11111111-1111-4111-8111-111111111111',
  actorLabel: '李老师',
  targetKind: 'auth.user',
  targetId: USER_ID,
  targetLabel: '张三',
  organizationId: null,
  outcome: 'success',
  reasonCode: null,
  details: {},
  source: 'http',
  requestId: null,
  traceId: null,
  clientIp: '203.0.113.7',
  userAgent: null,
  ...over,
})

const open = (list: (input: { query: Record<string, string> }) => unknown) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      audit: { listAuditEvents: list },
    }),
    path: '/organization/users/:userId/audit',
    route: `/organization/users/${USER_ID}/audit`,
    children: <UserAuditPage />,
  })

describe("a person's audit events", () => {
  it('reads what was done to them, then what they did, from the trail by their id', async () => {
    const list = vi.fn(({ query }: { query: Record<string, string> }) =>
      Effect.succeed({
        items: query['actorUserId'] === undefined ? [event('e1'), event('e2')] : [],
        nextCursor: null,
      }),
    )
    await open(list)
    await expect.element(page.getByTestId('audit-count')).toHaveAttribute('data-count', '2')
    expect(list).toHaveBeenCalledWith({ query: { targetKind: 'auth.user', targetId: USER_ID } })
    await page.getByRole('radio', { name: '该用户的操作' }).click()
    await vi.waitFor(() => expect(list).toHaveBeenCalledWith({ query: { actorUserId: USER_ID } }))
    await expect.element(page.getByTestId('user-audit')).toHaveAttribute('data-view', 'by')
    // the half being read is in the address, for a reload or a link
    expect(addressNow()).toContain('view=by')
    expect(document.querySelectorAll('[data-testid="audit-row"]')).toHaveLength(0)
  })

  // What was done to them is all about them: a column naming them on every
  // row says nothing, and what they did names what they did it to.
  it('names the object only where it varies', async () => {
    await open(({ query }: { query: Record<string, string> }) =>
      Effect.succeed({
        items: [event(query['actorUserId'] === undefined ? 'about' : 'by')],
        nextCursor: null,
      }),
    )
    const row = page.getByTestId('audit-row')
    await expect.element(row).toBeInTheDocument()
    await expect.element(page.getByTestId('audit-head')).toHaveAttribute('data-columns', '5')
    expect(row.element().querySelector('[data-cell="target"]')).toBeNull()
    await page.getByRole('radio', { name: '该用户的操作' }).click()
    await expect.element(page.getByTestId('audit-head')).toHaveAttribute('data-columns', '6')
    await vi.waitFor(() =>
      expect(
        page.getByTestId('audit-row').element().querySelector('[data-cell="target"]'),
      ).not.toBeNull(),
    )
  })

  // A reading that failed is said as a reading, with a heading and another
  // try; a refusal to read the trail offers no try that cannot help.
  it('says the trail could not be read, and whether another try can help', async () => {
    await open(() => Effect.fail(apiError('ACCESS_DENIED')))
    await expect
      .poll(() =>
        document.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
      )
      .toBe('denied')
    expect(page.getByRole('button', { name: '重试' }).query()).toBeNull()
  })

  it('opens a row into what the trail kept, and offers no narrowing to one actor here', async () => {
    await open(() =>
      Effect.succeed({
        items: [event('e1', { outcome: 'denied', reasonCode: 'ACCESS_DENIED' })],
        nextCursor: null,
      }),
    )
    const row = page.getByTestId('audit-row')
    await expect.element(row).toHaveAttribute('data-event-outcome', 'denied')
    await row.click()
    await expect.element(page.getByTestId('audit-detail')).toBeVisible()
    expect(page.getByRole('button', { name: '只看此人' }).query()).toBeNull()
  })
})
