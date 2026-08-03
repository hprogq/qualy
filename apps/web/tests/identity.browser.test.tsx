import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { components } from '../src/plugins.gen.ts'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// loaded through the registry the host actually uses, so a screen that lost
// its key would fail here rather than at runtime
const UserTypesPage = (await components['auth/UserTypesPage']!()).default
const RolesPage = (await components['rbac/RolesPage']!()).default

// What these cover is exactly what a service test cannot: whether the screen
// offers an action, whether a refusal reaches the reader in their own
// language, and whether a form can be submitted twice.

const userType = (over: Partial<Record<string, unknown>> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  code: 'student',
  name: '学生',
  description: null,
  allowLocalLogin: true,
  allowSsoLogin: false,
  status: 'active' as const,
  isSystem: false,
  sortOrder: 0,
  userCount: 0,
  permissions: [],
  ...over,
})

const role = (over: Partial<Record<string, unknown>> = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  code: 'org-manager',
  name: '院系管理员',
  description: null,
  kind: 'org' as const,
  isSystem: false,
  assignable: true,
  status: 'active' as const,
  assignmentCount: 0,
  permissions: [],
  allowedUserTypeIds: [],
  allowedOrgTypeIds: [],
  ...over,
})

const baseStubs = (over: Record<string, unknown> = {}) => ({
  app: { getManifest: () => Promise.resolve(emptyManifest()) },
  access: {
    listPermissions: () => Promise.resolve({ permissions: [] }),
    getRoleOptions: () => Promise.resolve({ userTypes: [], orgTypes: [] }),
  },
  identity: {},
  ...over,
})

describe('user types screen', () => {
  it('shows no management controls to a reader who may not manage', async () => {
    renderScreen({
      client: fakeClient(
        baseStubs({
          identity: {
            listUserTypes: () =>
              Promise.resolve({
                userTypes: [userType()],
                capabilities: { canManage: false },
              }),
          },
        }),
      ),
      route: '/admin/user-types?type=11111111-1111-4111-8111-111111111111',
      children: <UserTypesPage />,
    })

    await expect.element(page.getByText('学生').first()).toBeInTheDocument()
    // the record is visible and the editor opens, but nothing in it acts
    for (const save of await page.getByRole('button', { name: '保存' }).elements()) {
      expect(save).toBeDisabled()
    }
    expect(await page.getByRole('button', { name: '停用' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '删除' }).elements()).toHaveLength(0)
  })

  it('refuses to offer a disable that the api would reject', async () => {
    renderScreen({
      client: fakeClient(
        baseStubs({
          identity: {
            listUserTypes: () =>
              Promise.resolve({
                userTypes: [userType({ userCount: 3 })],
                capabilities: { canManage: true },
              }),
          },
        }),
      ),
      route: '/admin/user-types?type=11111111-1111-4111-8111-111111111111',
      children: <UserTypesPage />,
    })

    await expect.element(page.getByText('3 个用户')).toBeInTheDocument()
    // disabling a populated type is refused server side, so the control says
    // so instead of producing an error after a round trip
    await expect.element(page.getByRole('button', { name: '停用' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: '删除' })).toBeDisabled()
  })

  it('marks a type that opens no sign-in channel', async () => {
    renderScreen({
      client: fakeClient(
        baseStubs({
          identity: {
            listUserTypes: () =>
              Promise.resolve({
                userTypes: [userType({ allowLocalLogin: false, allowSsoLogin: false })],
                capabilities: { canManage: true },
              }),
          },
        }),
      ),
      children: <UserTypesPage />,
    })
    await expect.element(page.getByText('无法登录')).toBeInTheDocument()
  })

  it('localizes a typed refusal instead of showing the protocol message', async () => {
    const save = vi.fn(() =>
      // the backend says LAST_ADMINISTRATOR in english; the reader must not
      Promise.reject(apiError('LAST_ADMINISTRATOR', undefined, 409)),
    )
    renderScreen({
      client: fakeClient(
        baseStubs({
          identity: {
            listUserTypes: () =>
              Promise.resolve({
                userTypes: [userType({ isSystem: true })],
                capabilities: { canManage: true },
              }),
            updateUserType: save,
          },
        }),
      ),
      route: '/admin/user-types?type=11111111-1111-4111-8111-111111111111',
      children: <UserTypesPage />,
    })

    await expect.element(page.getByText('学生').first()).toBeInTheDocument()
    await page.getByRole('button', { name: '保存' }).first().click()
    await expect
      .element(page.getByText('这会让租户失去最后一个还能登录的管理员。'))
      .toBeInTheDocument()
    // the english protocol text never reaches the page
    expect(await page.getByText('LAST_ADMINISTRATOR').elements()).toHaveLength(0)
  })

  it('submits a form once, through the form itself', async () => {
    let resolve = () => {}
    const create = vi.fn(
      () =>
        new Promise<{ id: string }>((done) => {
          resolve = () => done({ id: 'new' })
        }),
    )
    renderScreen({
      client: fakeClient(
        baseStubs({
          identity: {
            listUserTypes: () =>
              Promise.resolve({ userTypes: [], capabilities: { canManage: true } }),
            createUserType: create,
          },
        }),
      ),
      children: <UserTypesPage />,
    })

    await expect.element(page.getByText('新建用户类型')).toBeInTheDocument()
    await page.getByRole('textbox', { name: 'code' }).fill('faculty')
    await page.getByRole('textbox', { name: '名称' }).fill('教职工')
    const submit = page.getByRole('button', { name: '创建' })
    await submit.click()
    // a second click while the first is in flight must not send a second
    // request, and the control has to say why it is refusing
    await expect.element(submit).toBeDisabled()
    await submit.click({ force: true })
    expect(create).toHaveBeenCalledTimes(1)
    resolve()
  })
})

describe('roles screen', () => {
  it('keeps the canonical administrator role out of reach', async () => {
    renderScreen({
      client: fakeClient(
        baseStubs({
          access: {
            listPermissions: () => Promise.resolve({ permissions: [] }),
            getRoleOptions: () => Promise.resolve({ userTypes: [], orgTypes: [] }),
            listRoles: () =>
              Promise.resolve({
                roles: [
                  role({
                    id: '33333333-3333-4333-8333-333333333333',
                    code: 'tenant-admin',
                    name: '租户管理员',
                    kind: 'tenant',
                    isSystem: true,
                  }),
                ],
                capabilities: { canManage: true },
              }),
          },
        }),
      ),
      route: '/admin/roles?role=33333333-3333-4333-8333-333333333333',
      children: <RolesPage />,
    })

    await expect.element(page.getByText('租户管理员').first()).toBeInTheDocument()
    await expect
      .element(page.getByText('租户管理员角色是固定的：不可停用、删除或改写权限。'))
      .toBeInTheDocument()
    // no destructive control is offered at all for it
    expect(await page.getByRole('button', { name: '删除' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '停用' }).elements()).toHaveLength(0)
  })

  it('does not present a failed supporting query as an empty picker', async () => {
    renderScreen({
      client: fakeClient(
        baseStubs({
          access: {
            listRoles: () =>
              Promise.resolve({ roles: [role()], capabilities: { canManage: true } }),
            // the permission catalog is what fills the checkbox list; a
            // failure here used to be indistinguishable from "no permissions"
            listPermissions: () => Promise.reject(apiError('INTERNAL_SERVER_ERROR', undefined, 500)),
            getRoleOptions: () => Promise.resolve({ userTypes: [], orgTypes: [] }),
          },
        }),
      ),
      route: '/admin/roles?role=22222222-2222-4222-8222-222222222222',
      children: <RolesPage />,
    })

    await expect.element(page.getByText('院系管理员').first()).toBeInTheDocument()
    // the section reports the failure and offers a retry rather than
    // rendering an empty, apparently-complete checkbox list
    // both the editor and the create form draw from that catalog, and both
    // report the failure rather than showing an empty list
    await expect.element(page.getByRole('button', { name: '重试' }).first()).toBeInTheDocument()
    expect(await page.getByRole('button', { name: '重试' }).elements()).toHaveLength(2)
    expect(await page.getByRole('group', { name: '权限' }).elements()).toHaveLength(0)
    // the sections whose data did load are unaffected
    expect(
      await page.getByRole('group', { name: '可授予这些用户类型' }).elements(),
    ).toHaveLength(2)
  })

  it('asks before deleting, in a dialog that can be read and cancelled', async () => {
    const remove = vi.fn(() => Promise.resolve({ ok: true as const }))
    renderScreen({
      client: fakeClient(
        baseStubs({
          access: {
            listPermissions: () => Promise.resolve({ permissions: [] }),
            getRoleOptions: () => Promise.resolve({ userTypes: [], orgTypes: [] }),
            listRoles: () =>
              Promise.resolve({ roles: [role()], capabilities: { canManage: true } }),
            deleteRole: remove,
          },
        }),
      ),
      route: '/admin/roles?role=22222222-2222-4222-8222-222222222222',
      children: <RolesPage />,
    })

    await expect.element(page.getByText('院系管理员').first()).toBeInTheDocument()
    await page.getByRole('button', { name: '删除' }).click()
    await expect.element(page.getByText('确定删除该角色？')).toBeInTheDocument()
    await page.getByRole('button', { name: '取消' }).click()
    expect(remove).not.toHaveBeenCalled()

    await page.getByRole('button', { name: '删除' }).first().click()
    await page.getByRole('button', { name: '删除' }).last().click()
    expect(remove).toHaveBeenCalledTimes(1)
  })
})
