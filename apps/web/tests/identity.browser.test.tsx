import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ApiResult, ClientOf } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import type { accessApi } from '@qualy/plugin-rbac/client/api'

// the rows as the api answers them: a fixture typed from a hand-written copy
// kept compiling after the api's own shape moved
type UserTypeDto = ApiResult<typeof authApi, 'identity', 'listUserTypes'>['userTypes'][number]
type RoleDto = ApiResult<typeof accessApi, 'access', 'listRoles'>['roles'][number]
type UserDto = ApiResult<typeof authApi, 'identity', 'getUser'>['user']
import { components } from 'virtual:qualy/plugins'
import { Effect } from 'effect'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// loaded through the registry the host actually uses, so a screen that lost
// its key would fail here rather than at runtime
const UserTypesPage = (await components['auth/UserTypesPage']!()).default
const RolesPage = (await components['rbac/RolesPage']!()).default
const UserDetailPage = (await components['auth/UserDetailPage']!()).default

// What these cover is exactly what a service test cannot: whether the screen
// offers an action, whether a refusal reaches the reader in their own
// language, and whether a form can be submitted twice.

const USER_TYPE_ID = '11111111-1111-4111-8111-111111111111'
const ROLE_ID = '22222222-2222-4222-8222-222222222222'
const ADMIN_ROLE_ID = '33333333-3333-4333-8333-333333333333'
const COLLEGE_TYPE_ID = '44444444-4444-4444-8444-444444444444'
const DEPARTMENT_TYPE_ID = '55555555-5555-4555-8555-555555555555'
const USER_ID = '66666666-6666-4666-8666-666666666666'
const ROOT_NODE_ID = '77777777-7777-4777-8777-777777777777'
const BRANCH_NODE_ID = '88888888-8888-4888-8888-888888888888'

const user = (over: Partial<UserDto> = {}): UserDto => ({
  id: USER_ID,
  businessNo: null,
  displayName: '张三',
  status: 'active',
  userType: { id: USER_TYPE_ID, code: 'student', name: '学生' },
  primaryOrgNode: { id: ROOT_NODE_ID, name: '本部' },
  identityCount: 1,
  manageable: true,
  ...over,
})

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
  holderPolicy: { mode: 'allow-list', userTypeIds: [] },
  anchorPolicy: { mode: 'allow-list', orgTypeIds: [] },
  ...over,
})

const orgTypeOptions = [
  { id: COLLEGE_TYPE_ID, code: 'college', name: '学院' },
  { id: DEPARTMENT_TYPE_ID, code: 'department', name: '系' },
]

// keys are checked against the real clients these screens derive, so a
// procedure that is renamed on the server takes this file down with it
// rather than leaving a stub nobody calls and a screen reading undefined
type Clients = ClientOf<typeof authApi> & ClientOf<typeof accessApi>
type Stubs<Namespace extends keyof Clients> = Partial<
  Record<keyof Clients[Namespace], (...args: never[]) => unknown>
>

// Defaults per namespace, overridden one method at a time: a test that only
// cares about roles must not have to restate every identity procedure, and
// forgetting one is a crash rather than a failed assertion.
const identityStubs = (over: Stubs<'identity'> = {}): Stubs<'identity'> => ({
  listUserTypes: () => Effect.succeed({ userTypes: [], capabilities: { canManage: false } }),
  getUserTypeOptions: () => Effect.succeed({ orgTypes: orgTypeOptions }),
  getUser: () => Effect.succeed({ user: user() }),
  getUserOptions: () =>
    Effect.succeed({
      truncated: false,
      nodes: [
        {
          orgNodeId: ROOT_NODE_ID,
          name: '本部',
          depth: 0,
          orgTypeId: COLLEGE_TYPE_ID,
          manageable: true,
        },
        {
          orgNodeId: BRANCH_NODE_ID,
          name: '分部',
          depth: 1,
          orgTypeId: DEPARTMENT_TYPE_ID,
          manageable: true,
        },
      ],
      userTypes: [],
    }),
  ...over,
})

const accessStubs = (over: Stubs<'access'> = {}): Stubs<'access'> => ({
  listPermissions: () => Effect.succeed({ permissions: [] }),
  getRoleOptions: () => Effect.succeed({ userTypes: [], orgTypes: [] }),
  getRoleGrantableRoles: () => Effect.succeed({ roleIds: [], appointedBy: [], version: 1 }),
  listRoles: () =>
    Effect.succeed({ roles: [], capabilities: { canManage: false, canEscalate: false } }),
  getUserRoleGrants: () => Effect.succeed({ grants: [] }),
  getRoleGrantOptions: () => Effect.succeed({ roles: [] }),
  ...over,
})

const stubs = ({
  identity,
  access,
}: { identity?: Stubs<'identity'>; access?: Stubs<'access'> } = {}) => ({
  app: { getManifest: () => Effect.succeed(emptyManifest()) },
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
              Effect.succeed({
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
    // the placement panel arrives on a second query, and its save button with
    // it. Counting before it lands is a coin flip that comes up two on a fast
    // machine and one on a busy ci runner, so wait for the panel itself.
    await expect.element(page.getByTestId('placement-panel')).toBeInTheDocument()
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
              Effect.succeed({
                userTypes: [userType({ userCount: 3 })],
                capabilities: { canManage: true },
              }),
          },
        }),
      ),
      route: `/admin/user-types?type=${USER_TYPE_ID}`,
      children: <UserTypesPage />,
    })

    await expect.element(page.getByTestId('type-summary')).toHaveAttribute('data-users', '3')
    // disabling a populated type is refused server side, so the control says
    // so instead of producing an error after a round trip
    await expect.element(page.getByRole('button', { name: '停用' })).toBeDisabled()
    await expect.element(page.getByRole('button', { name: '删除' })).toBeDisabled()
  })

  it('refuses an allow-list that names nothing', async () => {
    const save = vi.fn(() => Effect.succeed({ version: 4 }))
    renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            listUserTypes: () =>
              Effect.succeed({
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
    await expect.element(page.getByTestId('feedback')).toHaveAttribute('data-tone', 'success')
    expect(save).toHaveBeenCalledWith({
      params: { userTypeId: USER_TYPE_ID },
      payload: { version: 3, policy: { mode: 'unrestricted' } },
    })
  })

  it('localizes a typed refusal instead of showing the protocol message', async () => {
    const save = vi.fn(() =>
      // the backend says LAST_ADMINISTRATOR in english; the reader must not
      Effect.fail(apiError('LAST_ADMINISTRATOR', undefined)),
    )
    renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            listUserTypes: () =>
              Effect.succeed({
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
    // the refusal reaches the reader translated - the subject here is that
    // the raw code never does, asserted just below
    await expect
      .element(page.getByText('这会让租户失去最后一个还能登录的管理员。'))
      .toBeInTheDocument()
    // the english protocol text never reaches the page
    expect(await page.getByText('LAST_ADMINISTRATOR').elements()).toHaveLength(0)
    // the row is versioned as a whole, and a save that cannot say which
    // version it read is one that overwrites whoever went second
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { userTypeId: USER_TYPE_ID },
        payload: expect.objectContaining({ version: 7 }),
      }),
    )
  })

  it('submits a form once, through the form itself', async () => {
    // a call that stays in flight: the point is what the form does while one
    // is outstanding, so this effect is never allowed to settle
    const create = vi.fn(() => Effect.never as Effect.Effect<{ id: string }>)
    renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            listUserTypes: () =>
              Effect.succeed({ userTypes: [], capabilities: { canManage: true } }),
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
        payload: expect.objectContaining({
          code: 'faculty',
          name: '教职工',
          placementPolicy: { mode: 'unrestricted' },
        }),
      }),
    )
  })
})

describe('roles screen', () => {
  it('keeps the canonical administrator role out of reach', async () => {
    renderScreen({
      client: fakeClient(
        stubs({
          access: {
            listRoles: () =>
              Effect.succeed({
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
              Effect.succeed({
                roles: [role()],
                capabilities: { canManage: true, canEscalate: false },
              }),
            // the permission catalog is what fills the checkbox list, and a
            // failure here is otherwise indistinguishable from "no permissions"
            listPermissions: () => Effect.fail(apiError('INTERNAL_SERVER_ERROR', undefined)),
          },
        }),
      ),
      route: `/admin/roles?role=${ROLE_ID}`,
      children: <RolesPage />,
    })

    await expect.element(page.getByText('院系管理员').first()).toBeInTheDocument()
    // the section reports the failure and offers a retry rather than
    // rendering an empty, apparently-complete checkbox list
    await expect.element(page.getByRole('button', { name: '重试' }).first()).toBeInTheDocument()
    expect(await page.getByRole('button', { name: '重试' }).elements()).toHaveLength(1)
    expect(await page.getByRole('group', { name: '权限' }).elements()).toHaveLength(0)
    // the section whose data did load is unaffected. Only the editor draws
    // from the catalog: creation takes identity and kind, and everything a
    // role needs before it can be activated is configured afterwards.
    expect(await page.getByRole('group', { name: '可以授予这些用户类型' }).elements()).toHaveLength(
      1,
    )
    expect(await page.getByRole('group', { name: '这个角色在哪里生效' }).elements()).toHaveLength(1)
  })

  // The form used to collect permissions and eligibility and then send only
  // the identity fields, so a careful administrator filled in three pickers
  // that were discarded on submit. It now asks for what it actually sends.
  it('creates a role from what the form asks for, including its kind', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created-role' }))
    renderScreen({
      client: fakeClient(
        stubs({
          access: {
            listRoles: () =>
              Effect.succeed({
                roles: [],
                capabilities: { canManage: true, canEscalate: false },
              }),
            createRole: create,
          },
        }),
      ),
      route: '/admin/roles',
      children: <RolesPage />,
    })

    await expect
      .element(page.getByRole('group', { name: '这个角色在哪里生效' }))
      .toBeInTheDocument()
    // nothing is asked for that creation cannot carry
    expect(await page.getByRole('group', { name: '权限' }).elements()).toHaveLength(0)
    expect(await page.getByRole('group', { name: '可以授予这些用户类型' }).elements()).toHaveLength(
      0,
    )

    await page.getByRole('textbox', { name: 'code' }).fill('reviewer')
    await page.getByRole('textbox', { name: '名称' }).fill('审核员')
    await page.getByRole('radio', { name: /在整个租户范围/ }).click()
    await page.getByRole('button', { name: '创建' }).click()

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: { code: 'reviewer', name: '审核员', kind: 'tenant' },
    })
  })

  it('asks before deleting, in a dialog that can be read and cancelled', async () => {
    const remove = vi.fn(() => Effect.succeed({ ok: true as const }))
    renderScreen({
      client: fakeClient(
        stubs({
          access: {
            listRoles: () =>
              Effect.succeed({
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
    // it asks before it acts, in a dialog of its own
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument()
    await page.getByRole('button', { name: '取消' }).click()
    expect(remove).not.toHaveBeenCalled()

    await page.getByRole('button', { name: '删除' }).first().click()
    await page.getByRole('button', { name: '删除' }).last().click()
    expect(remove).toHaveBeenCalledTimes(1)
    // deleting states the version it read, so a role edited meanwhile is a
    // refusal rather than a surprise
    expect(remove).toHaveBeenCalledWith({
      params: { roleId: ROLE_ID },
      // a delete carries its version in the query, since it has no body
      query: { version: '5' },
    })
  })
})

// Granting is two questions and their order is the whole design: the roles a
// caller may pass on depend on where the grant is anchored, so the target is
// chosen first and the list is refetched for it. A screen that asked for the
// role first would offer roles the target then invalidates, and the refusal
// would arrive as a rejected submission.
//
// Before this, the screen could only revoke. The api had every piece.
describe('granting a role on the user screen', () => {
  const roleOptions = [{ id: ROLE_ID, code: 'reviewer', name: '审核员', kind: 'org' as const }]

  it('grants at the tenant when that is the chosen scope', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created-grant' }))
    renderScreen({
      client: fakeClient(
        stubs({
          access: {
            getRoleGrantOptions: () => Effect.succeed({ roles: roleOptions }),
            createRoleGrant: create,
          },
        }),
      ),
      route: `/admin/users/${USER_ID}`,
      path: '/admin/users/:userId',
      children: <UserDetailPage />,
    })

    await expect.element(page.getByRole('combobox', { name: '角色' })).toBeInTheDocument()
    await page.getByRole('button', { name: '授予' }).click()

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: { userId: USER_ID, roleId: ROLE_ID, target: { kind: 'tenant' } },
    })
  })

  it('asks the server again when the anchor changes, and sends the anchor it asked about', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created-grant' }))
    const options = vi.fn(() => Effect.succeed({ roles: roleOptions }))
    renderScreen({
      client: fakeClient(
        stubs({ access: { getRoleGrantOptions: options, createRoleGrant: create } }),
      ),
      route: `/admin/users/${USER_ID}`,
      path: '/admin/users/:userId',
      children: <UserDetailPage />,
    })

    await expect.element(page.getByRole('combobox', { name: '生效范围' })).toBeInTheDocument()
    await page.getByRole('combobox', { name: '生效范围' }).selectOptions('某个组织节点')
    await page.getByRole('combobox', { name: '某个组织节点' }).selectOptions('分部')
    await page.getByRole('combobox', { name: '覆盖' }).selectOptions('仅该节点')

    await vi.waitFor(() =>
      // the target is said outright now, never inferred from which
      // parameters happen to be present
      expect(options).toHaveBeenCalledWith({
        query: {
          userId: USER_ID,
          target: 'org-node',
          orgNodeId: BRANCH_NODE_ID,
          coverage: 'self',
        },
      }),
    )

    await page.getByRole('button', { name: '授予' }).click()
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: {
        userId: USER_ID,
        roleId: ROLE_ID,
        target: { kind: 'org-node', orgNodeId: BRANCH_NODE_ID, coverage: 'self' },
      },
    })
  })

  // an empty list is an answer: this caller holds nothing wide enough to pass
  // on here, which is different from a list that has not arrived
  it('says so when nothing can be granted rather than offering an empty picker', async () => {
    renderScreen({
      client: fakeClient(
        stubs({ access: { getRoleGrantOptions: () => Effect.succeed({ roles: [] }) } }),
      ),
      route: `/admin/users/${USER_ID}`,
      path: '/admin/users/:userId',
      children: <UserDetailPage />,
    })

    await expect.element(page.getByTestId('grant-nothing-offered')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: '授予' })).toBeDisabled()
  })
})
