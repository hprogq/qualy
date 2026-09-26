import RolePage from '../src/client/RolePage.tsx'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { accessApi } from '../src/client/api.ts'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// One role's own page, and the one way out of it: a role nobody was ever
// granted may be deleted; one that was, even if nobody holds it now, only
// goes by being switched off.

type RoleDto = ApiResult<typeof accessApi, 'access', 'listRoles'>['roles'][number]

const ROLE_ID = '22222222-2222-4222-8222-222222222222'

const role = (over: Partial<RoleDto> = {}): RoleDto => ({
  id: ROLE_ID,
  code: 'counsellor',
  name: '辅导员',
  description: null,
  kind: 'org',
  status: 'disabled',
  holdsEveryPermission: false,
  systemKey: null,
  assignable: true,
  version: 4,
  grantCount: 0,
  everGranted: false,
  permissions: [],
  unavailablePermissions: [],
  holderPolicy: { mode: 'unrestricted' },
  anchorPolicy: { mode: 'unrestricted' },
  ...over,
})

const open = (shown: RoleDto) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      access: {
        listRoles: () =>
          Effect.succeed({
            roles: [shown],
            capabilities: { canManage: true, canEscalate: false },
          }),
        listPermissions: () => Effect.succeed({ permissions: [] }),
        getRoleOptions: () => Effect.succeed({ userTypes: [], orgTypes: [] }),
        getRoleGrantableRoles: () => Effect.succeed({ roleIds: [], appointedBy: [], version: 4 }),
        listRoleGrants: () =>
          Effect.succeed({ items: [], nextCursor: null, total: 0, page: 1, pageSize: 20 }),
      },
    }),
    path: '/admin/roles/:roleId',
    route: `/admin/roles/${ROLE_ID}`,
    children: <RolePage />,
  })

describe('removing a role', () => {
  it('offers deletion for a role nobody was ever granted', async () => {
    await open(role())
    await expect.element(page.getByTestId('role-removal')).toHaveAttribute('data-deletable', 'true')
    await expect.element(page.getByRole('button', { name: '删除角色' })).toBeEnabled()
  })

  it('withholds deletion from a role once granted, though nobody holds it now', async () => {
    // every grant withdrawn: no holders, and still a history that names it
    await open(role({ status: 'active', grantCount: 0, everGranted: true }))
    await expect
      .element(page.getByTestId('role-removal'))
      .toHaveAttribute('data-deletable', 'false')
    await expect.element(page.getByRole('button', { name: '删除角色' })).toBeDisabled()
    // and points at the way it does go
    await expect
      .element(page.getByTestId('role-removal-why'))
      .toHaveAttribute('data-suggests', 'disable')
  })

  it('points nowhere once a granted role is already switched off', async () => {
    await open(role({ status: 'disabled', everGranted: true }))
    await expect.element(page.getByRole('button', { name: '删除角色' })).toBeDisabled()
    await expect
      .element(page.getByTestId('role-removal-why'))
      .toHaveAttribute('data-suggests', 'nothing')
  })
})

// A role that is not there is the page, not a heading of a role over an
// error: said once, with the way back and no retry that cannot help.
describe('a role that cannot be shown', () => {
  const mount = (listRoles: () => unknown) =>
    renderScreen({
      client: fakeClient({
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [{ id: 'rbac/roles', path: '/admin/roles', layout: 'admin' }],
            }),
        },
        access: { listRoles },
      }),
      path: '/admin/roles/:roleId',
      route: `/admin/roles/${ROLE_ID}`,
      children: <RolePage />,
    })
  const state = () => document.querySelector('[data-slot="resource-state"]')

  it('says it is not there, with the way back to the list', async () => {
    await mount(() =>
      Effect.succeed({ roles: [], capabilities: { canManage: true, canEscalate: false } }),
    )
    await expect.poll(() => state()?.getAttribute('data-state')).toBe('missing')
    expect(state()?.getAttribute('data-size')).toBe('page')
    expect(page.getByRole('button', { name: '重试' }).query()).toBeNull()
    await expect
      .element(page.getByRole('link', { name: '返回角色' }))
      .toHaveAttribute('href', '/admin/roles')
  })

  it('offers another try when the list could not be read', async () => {
    await mount(() => Effect.fail(apiError('INTERNAL_FAILURE')))
    await expect.poll(() => state()?.getAttribute('data-state')).toBe('failed')
    await expect.element(page.getByRole('button', { name: '重试' })).toBeVisible()
  })
})
