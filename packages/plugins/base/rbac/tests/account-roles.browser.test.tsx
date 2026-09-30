import AccountRolesPage from '../src/client/AccountRolesPage.tsx'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The reader's own roles: where each holds, and what it lets them do by
// name - a long list folded, a role that carries everything said once.

const power = (n: number) => ({
  code: `x.${String(n)}`,
  name: `权限${String(n)}`,
})

const role = (over: Record<string, unknown>) => ({
  grantId: 'g',
  roleName: '辅导员',
  target: {
    kind: 'org-node' as const,
    orgNodeId: 'n',
    orgNodeName: '软件学院',
    coverage: 'subtree' as const,
  },
  resource: null,
  validFrom: null,
  validUntil: null,
  allPermissions: false,
  permissions: [power(1)],
  ...over,
})

describe('the reader’s roles', () => {
  it('names where each role holds, folds a long list of powers, and says everything once', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        access: {
          listSelfRoles: () =>
            Effect.succeed({
              roles: [
                role({
                  grantId: 'g1',
                  permissions: Array.from({ length: 12 }, (_, n) => power(n)),
                }),
                role({
                  grantId: 'g2',
                  roleName: '系统管理员',
                  target: { kind: 'tenant' },
                  allPermissions: true,
                  permissions: [],
                }),
              ],
            }),
        },
      }),
      route: '/account/roles',
      children: <AccountRolesPage />,
    })
    const rows = page.getByTestId('account-role')
    await expect.element(rows.first()).toBeInTheDocument()
    expect(rows.elements().map((row) => row.getAttribute('data-all'))).toEqual(['false', 'true'])
    // fixture names, not copy
    await expect.element(rows.first().getByText('软件学院', { exact: false })).toBeVisible()
    // eight shown, the rest a press away
    const first = rows.first().element()
    expect(first.textContent).toContain('权限7')
    expect(first.textContent).not.toContain('权限11')
    await rows.first().getByRole('button').click()
    await expect.element(rows.first().getByText('权限11')).toBeVisible()
  })

  // A server that cannot serve right now is told apart from one that failed,
  // and the state stands under the section's own heading.
  it('says their roles could not be read the way the reading failed', async () => {
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        access: { listSelfRoles: () => Effect.fail(apiError('SERVICE_UNAVAILABLE')) },
      }),
      route: '/account/roles',
      children: <AccountRolesPage />,
    })
    const state = () => document.querySelector('[data-slot="resource-state"]')
    await expect.poll(() => state()?.getAttribute('data-state')).toBe('unavailable')
    await expect.element(page.getByRole('button', { name: '重试' })).toBeVisible()
    expect(state()?.querySelector('h3')).not.toBeNull()
  })
})
