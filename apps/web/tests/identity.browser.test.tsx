import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { AppClient } from '@qualy/api-client'
import type { UserTypeDto } from '@qualy/plugin-auth/contract'
import type { RoleDto } from '@qualy/plugin-rbac/contract'
import { components } from '../src/plugins.gen.ts'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// loaded through the registry the host actually uses, so a screen that lost
// its key would fail here rather than at runtime
const UserTypesPage = (await components['auth/UserTypesPage']!()).default
const RolesPage = (await components['rbac/RolesPage']!()).default

// What these cover is exactly what a service test cannot: whether the screen
// offers an action, whether a refusal reaches the reader in their own
// language, and whether a form can be submitted twice.

const USER_TYPE_ID = '11111111-1111-4111-8111-111111111111'
const ROLE_ID = '22222222-2222-4222-8222-222222222222'
const ADMIN_ROLE_ID = '33333333-3333-4333-8333-333333333333'
const COLLEGE_TYPE_ID = '44444444-4444-4444-8444-444444444444'
const DEPARTMENT_TYPE_ID = '55555555-5555-4555-8555-555555555555'

// The fixtures are the contract's own types, so a field that is added,
// renamed or dropped fails the typecheck of this file instead of quietly
// reaching a screen as undefined. A missing field rarely crashes: the role
// editor reads an absent `systemKey` as "this role is fixed" and removes
// every action, which looks like a screen that simply has none.
const userType = (over: Partial<UserTypeDto> = {}): UserTypeDto => ({
  id: USER_TYPE_ID,
  code: 'student',
  name: '学生',
  description: null,
  allowLocalLogin: true,
  allowSsoLogin: false,
  status: 'active',
  isSystem: false,
  sortOrder: 0,
  version: 3,
  userCount: 0,
  placementPolicy: { mode: 'unrestricted' },
  ...over,
})

const role = (over: Partial<RoleDto> = {}): RoleDto => ({
  id: ROLE_ID,
  code: 'org-manager',
  name: '院系管理员',
  description: null,
  kind: 'org',
  status: 'active',
  holdsEveryPermission: false,
  systemKey: null,
  assignable: true,
  version: 5,
  grantCount: 0,
  permissions: [],
  unavailablePermissions: [],
  eligibleUserTypeIds: [],
  anchorOrgTypeIds: [],
  ...over,
})

const orgTypeOptions = [
  { id: COLLEGE_TYPE_ID, code: 'college', name: '学院' },
  { id: DEPARTMENT_TYPE_ID, code: 'department', name: '系' },
]

// keys are checked against the real client, so a procedure that is renamed
// on the server takes this file down with it rather than leaving a stub
// nobody calls and a screen reading undefined
type Stubs<Namespace extends keyof AppClient> = Partial<
  Record<keyof AppClient[Namespace], (...args: never[]) => unknown>
>

// Defaults per namespace, overridden one method at a time: a test that only
// cares about roles must not have to restate every identity procedure, and
// forgetting one is a crash rather than a failed assertion.
const identityStubs = (over: Stubs<'identity'> = {}): Stubs<'identity'> => ({
  listUserTypes: () => Promise.resolve({ userTypes: [], capabilities: { canManage: false } }),
  getUserTypeOptions: () => Promise.resolve({ orgTypes: orgTypeOptions }),
  ...over,
})

const accessStubs = (over: Stubs<'access'> = {}): Stubs<'access'> => ({
  listPermissions: () => Promise.resolve({ permissions: [] }),
  getRoleOptions: () => Promise.resolve({ userTypes: [], orgTypes: [] }),
  listRoles: () =>
    Promise.resolve({ roles: [], capabilities: { canManage: false, canEscalate: false } }),
  ...over,
})

const stubs = ({
  identity,
  access,
}: { identity?: Stubs<'identity'>; access?: Stubs<'access'> } = {}) => ({
  app: { getManifest: () => Promise.resolve(emptyManifest()) },
  identity: identityStubs(identity),
  access: accessStubs(access),
})

describe('user types screen', () => {
  it('shows no management controls to a reader who may not manage', async () => {
    renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            listUserTypes: () =>
              Promise.resolve({
                userTypes: [userType()],
                capabilities: { canManage: false },
              }),
          },
        }),
      ),
      route: `/admin/user-types?type=${USER_TYPE_ID}`,
      children: <UserTypesPage />,
    })

    await expect.element(page.getByText('学生').first()).toBeInTheDocument()
    // the record is visible and the editor opens, but nothing in it acts.
    // The count is asserted too: a screen that rendered no controls at all
    // would satisfy "every control is disabled" without meaning it.
    const saves = await page.getByRole('button', { name: '保存' }).elements()
    expect(saves).toHaveLength(2)
    for (const save of saves) expect(save).toBeDisabled()
    expect(await page.getByRole('button', { name: '停用' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '删除' }).elements()).toHaveLength(0)
    // and no form for making more of them
    expect(await page.getByText('新建用户类型').elements()).toHaveLength(0)
  })

  it('refuses to offer a disable that the api would reject', async () => {
    renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            listUserTypes: () =>
              Promise.resolve({
                userTypes: [userType({ userCount: 3 })],
                capabilities: { canManage: true },
              }),
          },
        }),
      ),
      route: `/admin/user-types?type=${USER_TYPE_ID}`,
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
        stubs({
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

  it('refuses an allow-list that names nothing', async () => {
    const save = vi.fn(() => Promise.resolve({ version: 4 }))
    renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            listUserTypes: () =>
              Promise.resolve({
                userTypes: [
                  userType({
                    placementPolicy: { mode: 'allow-list', orgTypeIds: [COLLEGE_TYPE_ID] },
                  }),
                ],
                capabilities: { canManage: true },
              }),
            setPlacementPolicy: save,
          },
        }),
      ),
      route: `/admin/user-types?type=${USER_TYPE_ID}`,
      children: <UserTypesPage />,
    })

    // the policy the type was read with, offered for editing. The create
    // form below draws from the same options, so the editor's copy of a
    // control is the first one.
    const college = page.getByRole('checkbox', { name: '学院' }).first()
    await expect.element(college).toBeChecked()

    // an allow-list naming nothing is not a narrower rule, it is no rule at
    // all: the api refuses it, and clearing the last entry must not read as
    // "may stand anywhere"
    await college.click()
    const saves = page.getByRole('button', { name: '保存' })
    // the profile section saves separately and is unaffected
    await expect.element(saves.first()).toBeEnabled()
    await expect.element(saves.nth(1)).toBeDisabled()
    await saves.nth(1).click({ force: true })
    expect(save).not.toHaveBeenCalled()

    // saying "anywhere" is a decision the reader makes, not one that falls
    // out of an empty list
    await page.getByRole('checkbox', { name: '可以挂在任何组织节点下' }).first().click()
    await expect.element(saves.nth(1)).toBeEnabled()
    await saves.nth(1).click()
    await expect.element(page.getByText('已保存。')).toBeInTheDocument()
    expect(save).toHaveBeenCalledWith({
      userTypeId: USER_TYPE_ID,
      expectedVersion: 3,
      policy: { mode: 'unrestricted' },
    })
  })

  it('localizes a typed refusal instead of showing the protocol message', async () => {
    const save = vi.fn(() =>
      // the backend says LAST_ADMINISTRATOR in english; the reader must not
      Promise.reject(apiError('LAST_ADMINISTRATOR', undefined, 409)),
    )
    renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            listUserTypes: () =>
              Promise.resolve({
                userTypes: [
                  userType({
                    isSystem: true,
                    version: 7,
                    placementPolicy: { mode: 'tenant-root' },
                  }),
                ],
                capabilities: { canManage: true },
              }),
            updateUserType: save,
          },
        }),
      ),
      route: `/admin/user-types?type=${USER_TYPE_ID}`,
      children: <UserTypesPage />,
    })

    await expect.element(page.getByText('学生').first()).toBeInTheDocument()
    // a system identity stands at the tenant root whatever its row says, so
    // its placement is reported and the only save here is the profile one
    expect(await page.getByRole('button', { name: '保存' }).elements()).toHaveLength(1)
    await page.getByRole('button', { name: '保存' }).first().click()
    await expect
      .element(page.getByText('这会让租户失去最后一个还能登录的管理员。'))
      .toBeInTheDocument()
    // the english protocol text never reaches the page
    expect(await page.getByText('LAST_ADMINISTRATOR').elements()).toHaveLength(0)
    // the row is versioned as a whole, and a save that cannot say which
    // version it read is one that overwrites whoever went second
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ userTypeId: USER_TYPE_ID, expectedVersion: 7 }),
    )
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
        stubs({
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
    // a type is created complete: until it says where its people may stand
    // there is nothing to submit
    const submit = page.getByRole('button', { name: '创建' })
    await expect.element(submit).toBeDisabled()
    await page.getByRole('checkbox', { name: '可以挂在任何组织节点下' }).click()
    await submit.click()
    // a second click while the first is in flight must not send a second
    // request, and the control has to say why it is refusing
    await expect.element(submit).toBeDisabled()
    await submit.click({ force: true })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'faculty',
        name: '教职工',
        placementPolicy: { mode: 'unrestricted' },
      }),
    )
    resolve()
  })
})

describe('roles screen', () => {
  it('keeps the canonical administrator role out of reach', async () => {
    renderScreen({
      client: fakeClient(
        stubs({
          access: {
            listRoles: () =>
              Promise.resolve({
                roles: [
                  role({
                    id: ADMIN_ROLE_ID,
                    code: 'tenant-admin',
                    name: '租户管理员',
                    kind: 'tenant',
                    systemKey: 'tenant-admin',
                    holdsEveryPermission: true,
                    permissions: ['iam.role.manage'],
                  }),
                ],
                capabilities: { canManage: true, canEscalate: false },
              }),
          },
        }),
      ),
      route: `/admin/roles?role=${ADMIN_ROLE_ID}`,
      children: <RolesPage />,
    })

    await expect.element(page.getByText('租户管理员').first()).toBeInTheDocument()
    await expect
      .element(page.getByText('租户管理员角色是固定的：不可停用、删除或改写权限。'))
      .toBeInTheDocument()
    // no destructive control is offered at all for it
    expect(await page.getByRole('button', { name: '删除' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '停用' }).elements()).toHaveLength(0)
    // what it holds is fixed by its permission mode, so the picker cannot be
    // saved; its display fields are ordinary and stay editable
    const saves = page.getByRole('button', { name: '保存' })
    await expect.element(saves.first()).toBeEnabled()
    await expect.element(saves.nth(1)).toBeDisabled()
  })

  it('does not present a failed supporting query as an empty picker', async () => {
    renderScreen({
      client: fakeClient(
        stubs({
          access: {
            listRoles: () =>
              Promise.resolve({
                roles: [role()],
                capabilities: { canManage: true, canEscalate: false },
              }),
            // the permission catalog is what fills the checkbox list, and a
            // failure here is otherwise indistinguishable from "no permissions"
            listPermissions: () =>
              Promise.reject(apiError('INTERNAL_SERVER_ERROR', undefined, 500)),
          },
        }),
      ),
      route: `/admin/roles?role=${ROLE_ID}`,
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
    expect(await page.getByRole('group', { name: '可以授予这些用户类型' }).elements()).toHaveLength(
      2,
    )
  })

  it('asks before deleting, in a dialog that can be read and cancelled', async () => {
    const remove = vi.fn(() => Promise.resolve({ ok: true as const }))
    renderScreen({
      client: fakeClient(
        stubs({
          access: {
            listRoles: () =>
              Promise.resolve({
                roles: [role()],
                capabilities: { canManage: true, canEscalate: false },
              }),
            deleteRole: remove,
          },
        }),
      ),
      route: `/admin/roles?role=${ROLE_ID}`,
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
    // deleting states the version it read, so a role edited meanwhile is a
    // refusal rather than a surprise
    expect(remove).toHaveBeenCalledWith({ roleId: ROLE_ID, expectedVersion: 5 })
  })
})
