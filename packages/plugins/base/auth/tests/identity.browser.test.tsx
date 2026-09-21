import UserTypesPage from '../src/client/iam/UserTypesPage.tsx'
import UserTypePage from '../src/client/iam/UserTypePage.tsx'
import RolesPage from '@qualy/plugin-rbac/client/RolesPage'
import RolePage from '@qualy/plugin-rbac/client/RolePage'
import UsersPage from '../src/client/iam/UsersPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import type { ApiResult, ClientOf } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import type { accessApi } from '@qualy/plugin-rbac/client/api'

// the rows as the api answers them: a fixture typed from a hand-written copy
// kept compiling after the api's own shape moved
type UserTypeDto = ApiResult<typeof authApi, 'identity', 'listUserTypes'>['userTypes'][number]
type RoleDto = ApiResult<typeof accessApi, 'access', 'listRoles'>['roles'][number]
type UserDto = ApiResult<typeof authApi, 'identity', 'getUser'>['user']
import { Effect } from 'effect'
import { addressNow, apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// loaded through the registry the host actually uses, so a screen that lost
// its key would fail here rather than at runtime

// What these cover is exactly what a service test cannot: whether the screen
// offers an action, whether a refusal reaches the reader in their own
// language, and whether a form can be submitted twice.

const USER_TYPE_ID = '11111111-1111-4111-8111-111111111111'
const ROLE_ID = '22222222-2222-4222-8222-222222222222'
const ADMIN_ROLE_ID = '33333333-3333-4333-8333-333333333333'
const COLLEGE_TYPE_ID = '44444444-4444-4444-8444-444444444444'
const DEPARTMENT_TYPE_ID = '55555555-5555-4555-8555-555555555555'
const USER_ID = '66666666-6666-4666-8666-666666666666'
const SECOND_USER_ID = '99999999-9999-4999-8999-999999999999'
const ROOT_NODE_ID = '77777777-7777-4777-8777-777777777777'
const BRANCH_NODE_ID = '88888888-8888-4888-8888-888888888888'

const user = (over: Partial<UserDto> = {}): UserDto => ({
  id: USER_ID,
  businessNo: null,
  displayName: '张三',
  status: 'active',
  version: 1,
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
  listAuthProviders: () => Effect.succeed({ providers: [] }),
  listAuthProviderKinds: () => Effect.succeed({ kinds: [] }),
  // the people of a type, which a type's own page lists
  listUsers: () =>
    Effect.succeed({ items: [], nextCursor: null, total: 0, page: 1, pageSize: 20 }),
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
  it('lists each type with where it may belong and who lets it in', async () => {
    renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            listUserTypes: () =>
              Effect.succeed({
                userTypes: [userType({ userCount: 3 })],
                capabilities: { canManage: false },
              }),
          },
        }),
      ),
      children: <UserTypesPage />,
    })

    const row = page.getByTestId('type-row')
    await expect.element(row).toHaveAttribute('data-users', '3')
    // no entrance is in service in these stubs, and the row says so rather
    // than leaving the cell blank
    await expect.element(row).toHaveAttribute('data-entrances', '0')
    // and no way to make more of them
    expect(await page.getByText('新建用户类型').elements()).toHaveLength(0)
  })

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
      path: '/admin/user-types/:typeId',
      route: `/admin/user-types/${USER_TYPE_ID}`,
      children: <UserTypePage />,
    })

    await expect.element(page.getByText('学生').first()).toBeInTheDocument()
    // the placement panel arrives on a second query, so wait for the panel
    // itself rather than for whatever renders first
    await expect.element(page.getByTestId('placement-panel')).toBeInTheDocument()
    // the policy is legible - the rule is stated, with nothing to switch it
    // by. Asserting this first matters: a screen that rendered nothing at all
    // would satisfy "no controls" vacuously.
    await expect
      .element(page.getByTestId('placement-panel'))
      .toHaveAttribute('data-mode', 'unrestricted')
    expect(await page.getByRole('tab').elements()).toHaveLength(0)
    // and nothing on it acts
    expect(await page.getByRole('button', { name: '保存', exact: false }).elements()).toHaveLength(
      0,
    )
    expect(await page.getByRole('button', { name: '重命名' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '停用' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '删除' }).elements()).toHaveLength(0)
    // and no way to make more of them
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
      path: '/admin/user-types/:typeId',
      route: `/admin/user-types/${USER_TYPE_ID}`,
      children: <UserTypePage />,
    })

    await expect
      .element(page.getByTestId('type-lifecycle'))
      .toHaveAttribute('data-populated', 'true')
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
      path: '/admin/user-types/:typeId',
      route: `/admin/user-types/${USER_TYPE_ID}`,
      children: <UserTypePage />,
    })

    // the policy the type was read with, offered for editing
    const college = page.getByRole('checkbox', { name: '学院' }).first()
    await expect.element(college).toBeChecked()

    // an allow-list naming nothing is not a narrower rule, it is no rule at
    // all: the api refuses it, and clearing the last entry must not read as
    // "may stand anywhere"
    await college.click()
    const save2 = page.getByRole('button', { name: '保存', exact: false }).first()
    await expect.element(save2).toBeDisabled()
    await save2.click({ force: true })
    expect(save).not.toHaveBeenCalled()

    // saying "anywhere" is a decision the reader makes, not one that falls
    // out of an empty list
    await page.getByRole('tab', { name: '不限' }).first().click()
    await expect.element(save2).toBeEnabled()
    await save2.click()
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
      path: '/admin/user-types/:typeId',
      route: `/admin/user-types/${USER_TYPE_ID}`,
      children: <UserTypePage />,
    })

    await expect.element(page.getByText('学生').first()).toBeInTheDocument()
    // a system identity stands at the tenant root whatever its row says, so
    // there is no placement to edit and the only save is the one behind the
    // rename dialog
    expect(await page.getByRole('button', { name: '保存', exact: false }).elements()).toHaveLength(
      0,
    )
    await page.getByRole('button', { name: '重命名' }).click()
    await page.getByRole('button', { name: '保存', exact: false }).click()
    // The refusal reaches the reader as a sentence rather than as a code,
    // which is the subject here. Asserted as: something was said, it was
    // said as a refusal, and it was not the protocol word. Not as the
    // sentence itself - that one belongs to rbac's catalog, and an auth
    // test quoting it went red whenever rbac reworded.
    await expect.element(page.getByTestId('feedback')).toHaveAttribute('data-tone', 'error')
    expect(page.getByTestId('feedback').element().textContent ?? '').not.toBe('')
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

    // creating is an action on the page, not a form parked under the list
    await page.getByRole('button', { name: '新建用户类型' }).click()
    await page.getByRole('textbox', { name: '名称' }).fill('教职工')
    // a type is created complete: until it says where people of that kind
    // may belong there is nothing to submit
    const submit = page.getByRole('button', { name: '创建' })
    await expect.element(submit).toBeDisabled()
    await page.getByRole('radio', { name: '不限' }).click()
    await submit.click()
    // a second click while the first is in flight must not send a second
    // request, and the control has to say why it is refusing
    await expect.element(submit).toBeDisabled()
    await submit.click({ force: true })
    expect(create).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        // the machine key is the server's to invent; the form asks for a
        // name and where its people belong, and nothing else
        payload: expect.objectContaining({
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
      path: '/admin/roles/:roleId',
      route: `/admin/roles/${ADMIN_ROLE_ID}`,
      children: <RolePage />,
    })

    await expect.element(page.getByText('租户管理员').first()).toBeInTheDocument()
    // it is not renamed, not appointed through, and not saved
    expect(await page.getByRole('button', { name: '重命名' }).elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '保存权限' }).elements()).toHaveLength(0)
    expect(await page.getByRole('tab', { name: '可任命' }).elements()).toHaveLength(0)
    // and its standing offers nothing to switch and nothing destructive
    await expect.element(page.getByTestId('role-standing')).toHaveAttribute('data-status', 'active')
    expect(await page.getByRole('button', { name: '删除角色' }).elements()).toHaveLength(0)
    expect(await page.getByRole('tab', { name: '停用' }).elements()).toHaveLength(0)
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
      path: '/admin/roles/:roleId',
      route: `/admin/roles/${ROLE_ID}`,
      children: <RolePage />,
    })

    await expect.element(page.getByText('院系管理员').first()).toBeInTheDocument()
    // the section reports the failure and offers a retry rather than
    // rendering an empty, apparently-complete checkbox list
    await expect.element(page.getByRole('button', { name: '重试' }).first()).toBeInTheDocument()
    expect(await page.getByRole('button', { name: '重试' }).elements()).toHaveLength(1)
    expect(await page.getByRole('checkbox').elements()).toHaveLength(0)
    // the tab whose data did load is unaffected. Only the permissions tab
    // draws from the catalog: creation takes identity and kind, and
    // everything a role needs before it can be activated comes afterwards.
    await page.getByRole('tab', { name: '任职条件' }).click()
    await expect
      .element(page.getByRole('radio', { name: '仅指定类型', exact: false }).first())
      .toBeInTheDocument()
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

    await page.getByRole('button', { name: '新建组织角色' }).click()
    await expect.element(page.getByRole('group', { name: '生效范围' })).toBeInTheDocument()
    // nothing is asked for that creation cannot carry
    expect(await page.getByRole('group', { name: '权限' }).elements()).toHaveLength(0)
    expect(await page.getByRole('group', { name: '可以授予这些用户类型' }).elements()).toHaveLength(
      0,
    )

    await page.getByRole('textbox', { name: '名称' }).fill('审核员')
    await page.getByRole('radio', { name: /在整个租户范围/ }).click()
    await page.getByRole('button', { name: '创建' }).click()

    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({ payload: { name: '审核员', kind: 'tenant' } })
  })

  // Editing an active role's permissions is editing the office itself: the
  // save must state its blast radius and carry the version the editor read,
  // and a tick the user takes back before saving must send nothing.
  it('saves a changed permission set through the stated-impact confirmation', async () => {
    const save = vi.fn(() => Effect.succeed({ ok: true as const }))
    const permission = (code: string, label: string) => ({
      code,
      plugin: 'assessment',
      name: { kind: 'literal' as const, value: label },
      description: null,
      groupKey: 'assessment',
      group: { kind: 'literal' as const, value: '综合测评' },
      target: 'org-node' as const,
    })
    renderScreen({
      client: fakeClient(
        stubs({
          access: {
            listRoles: () =>
              Effect.succeed({
                roles: [role({ grantCount: 3, permissions: ['assessment.batch.read'] })],
                capabilities: { canManage: true, canEscalate: false },
              }),
            listPermissions: () =>
              Effect.succeed({
                permissions: [
                  permission('assessment.batch.read', '查看批次'),
                  permission('assessment.batch.manage', '编辑批次'),
                ],
              }),
            setRolePermissions: save,
          },
        }),
      ),
      path: '/admin/roles/:roleId',
      route: `/admin/roles/${ROLE_ID}`,
      children: <RolePage />,
    })

    const manage = page.getByRole('checkbox', { name: '编辑批次', exact: false })
    await expect.element(manage).toBeInTheDocument()
    await expect.element(manage).not.toBeChecked()
    await manage.click()
    await expect.element(manage).toBeChecked()

    // the role is active and held: the save asks first, out loud
    await page.getByRole('button', { name: '保存权限' }).click()
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument()
    await page.getByRole('alertdialog').getByRole('button', { name: '保存', exact: false }).click()

    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    // the version the editor read, and the set as the user left it: the
    // held tick first, the new one appended by the click
    expect(save).toHaveBeenCalledWith({
      params: { roleId: ROLE_ID },
      payload: { version: 5, codes: ['assessment.batch.read', 'assessment.batch.manage'] },
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
      path: '/admin/roles/:roleId',
      route: `/admin/roles/${ROLE_ID}`,
      children: <RolePage />,
    })

    await expect.element(page.getByText('院系管理员').first()).toBeInTheDocument()
    // deleting a role is a decision about its standing, so it lives with the
    // rest of them rather than beside what the role may do
    await page.getByRole('button', { name: '删除角色' }).click()
    // it asks before it acts, in a dialog of its own
    await expect.element(page.getByRole('alertdialog')).toBeInTheDocument()
    await page.getByRole('button', { name: '取消' }).click()
    expect(remove).not.toHaveBeenCalled()

    await page.getByRole('button', { name: '删除角色' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click()
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
// The workspace reads left to right - the unit, its roster, the open
// person - and every choice lives in the query string. The roster asks the
// server for the unit it says it is showing, and the open person survives a
// reload because the address carries them.
describe('users workspace', () => {
  const personAnswer = (over: Partial<UserDto> = {}) => ({
    user: user({ manageable: true, identityCount: 1, ...over }),
    orgPath: [
      { id: ROOT_NODE_ID, name: '本部', orgTypeName: '学院' },
      { id: BRANCH_NODE_ID, name: '分部', orgTypeName: '系' },
    ],
    placement: { mode: 'unrestricted' },
    roles: [{ grantId: 'g-1', roleId: 'r-1', roleName: '审核员', orgNodeName: '分部' }],
    identities: [],
  })
  const rosterStubs = (over: Stubs<'identity'> = {}) =>
    stubs({
      identity: {
        listUsers: () =>
          Effect.succeed({
            items: [
              user({ id: USER_ID, displayName: '张明远' }),
              user({ id: SECOND_USER_ID, displayName: '李文静', status: 'disabled' }),
            ],
            nextCursor: null,
            total: 120,
            page: 1,
            pageSize: 50,
          }),
        getUser: () => Effect.succeed(personAnswer()),
        ...over,
      },
    })

  it('looks at a person beside the roster from the mark at the end of their row, and says so in the address', async () => {
    renderScreen({
      client: fakeClient(rosterStubs()),
      route: '/admin/users',
      children: <UsersPage />,
    })

    await expect.element(page.getByRole('button', { name: '速览张明远' })).toBeVisible()
    await page.getByRole('button', { name: '速览张明远' }).click()
    // the open person is address state, not component state
    await vi.waitFor(() => expect(addressNow()).toContain(`user=${USER_ID}`))
    expect(
      document.querySelector('[data-testid="roster-row"][data-selected="true"]'),
    ).not.toBeNull()
    // the panel answers with the person, their standing and their roles -
    // and with nothing that changes them: the one way on is their own page
    const sheet = page.getByTestId('person-sheet')
    await expect.element(sheet).toBeVisible()
    await expect
      .element(sheet.getByTestId('person-status'))
      .toHaveAttribute('data-status', 'active')
    await expect.element(sheet.getByText('审核员')).toBeVisible()
    expect(sheet.getByRole('combobox').elements()).toHaveLength(0)
    expect(sheet.getByRole('textbox').elements()).toHaveLength(0)
  })

  it('a deep link opens straight onto the person it names', async () => {
    renderScreen({
      client: fakeClient(rosterStubs()),
      route: `/admin/users?user=${USER_ID}`,
      children: <UsersPage />,
    })
    // no clicks: the address alone opens the panel, on the row it names
    await expect.element(page.getByTestId('person-sheet')).toBeVisible()
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-testid="roster-row"][data-selected="true"]'),
      ).not.toBeNull(),
    )
  })

  it('asks the server for the unit the tree has selected', async () => {
    const list = vi.fn(() =>
      Effect.succeed({
        items: [user({ id: USER_ID, displayName: '张明远' })],
        nextCursor: null,
        total: 1,
        page: 1,
        pageSize: 50,
      }),
    )
    renderScreen({
      client: fakeClient(rosterStubs({ listUsers: list })),
      route: '/admin/users',
      children: <UsersPage />,
    })

    await expect.element(page.getByRole('button', { name: '速览张明远' })).toBeVisible()
    await vi.waitFor(() => expect(document.querySelector('[data-node-name="分部"]')).not.toBeNull())
    ;(document.querySelector('[data-node-name="分部"]') as HTMLElement).click()
    await vi.waitFor(() => expect(addressNow()).toContain(`anchor=${BRANCH_NODE_ID}`))
    await vi.waitFor(() =>
      expect(
        list.mock.calls.some(
          (call) =>
            (call as unknown as [{ query: { orgNodeId: string } }])[0].query.orgNodeId ===
            BRANCH_NODE_ID,
        ),
      ).toBe(true),
    )
  })

  it('keeps the unit sheet its own height while it is filtered, with its menu beside the search', async () => {
    // On a phone the tree is a sheet the reader filters. Two things go wrong
    // if the panel takes its height from what it holds: it collapses under
    // the hand that is still typing, and the control beside the search is
    // pushed on to a row of its own, which reads as a second band.
    await page.viewport(390, 844)
    renderScreen({
      client: fakeClient(rosterStubs()),
      route: '/admin/users',
      children: <UsersPage />,
    })

    await page.getByTestId('unit-switch').click()
    const sheet = page.getByTestId('unit-sheet')
    await expect.element(sheet).toBeVisible()
    await expect.element(sheet.getByRole('button', { name: '组织栏选项' })).toBeVisible()
    const search = await sheet.getByRole('searchbox', { name: '搜索组织' }).element()
    const menu = await sheet.getByRole('button', { name: '组织栏选项' }).element()
    expect(
      Math.abs(search.getBoundingClientRect().top - menu.getBoundingClientRect().top),
    ).toBeLessThan(8)

    const tall = (await sheet.element()).getBoundingClientRect().height
    await userEvent.fill(sheet.getByRole('searchbox', { name: '搜索组织' }), '没有这个组织')
    await expect.element(sheet.getByText('未找到匹配的组织', { exact: false })).toBeVisible()
    expect((await sheet.element()).getBoundingClientRect().height).toBeCloseTo(tall, 0)
    await page.viewport(1280, 800)
  })

  it('walks the roster by page number, and lists the removed only when asked', async () => {
    const list = vi.fn(() =>
      Effect.succeed({
        items: [user({ id: USER_ID, displayName: '张明远' })],
        nextCursor: null,
        total: 120,
        page: 1,
        pageSize: 50,
      }),
    )
    renderScreen({
      client: fakeClient(rosterStubs({ listUsers: list })),
      route: '/admin/users',
      children: <UsersPage />,
    })
    const asked = () =>
      (list.mock.calls as unknown as [{ query: { page?: string; status?: string } }][]).map(
        (call) => call[0].query,
      )
    // three pages of fifty, and the last one is one press away
    await expect.element(page.getByTestId('roster-pager')).toHaveAttribute('data-pages', '3')
    await page.getByRole('button', { name: '3', exact: true }).click()
    await vi.waitFor(() => expect(addressNow()).toContain('page=3'))
    await vi.waitFor(() => expect(asked().some((query) => query.page === '3')).toBe(true))
    // the living by default; the removed join them only on request, and a
    // different question starts again at its first page
    expect(asked().every((query) => query.status === undefined)).toBe(true)
    await page.getByTestId('show-removed').click()
    await vi.waitFor(() =>
      expect(asked().some((query) => query.status === 'any' && query.page === '1')).toBe(true),
    )
  })

  // Somebody who knows who they want types and goes: no tree, no filters, no
  // pages, and no mouse.
  it('finds a person by name or number and goes to them from the keyboard', async () => {
    const list = vi.fn(() =>
      Effect.succeed({
        items: [
          user({ id: USER_ID, displayName: '张明远', businessNo: '2023010101' }),
          user({ id: SECOND_USER_ID, displayName: '张文静', businessNo: '2023010102' }),
        ],
        nextCursor: null,
        total: 2,
        page: 1,
        pageSize: 8,
      }),
    )
    renderScreen({
      client: fakeClient({
        ...rosterStubs({ listUsers: list }),
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [
                { id: 'auth/user-detail', path: '/people/:userId', layout: 'admin' },
              ],
            }),
        },
      }),
      routes: [
        { path: '/admin/users', element: <UsersPage /> },
        { path: '/people/:userId', element: <p data-testid="landed" /> },
      ] as never,
      route: '/admin/users',
    })
    await page.getByTestId('user-jump-open').click()
    const box = page.getByRole('combobox', { name: /姓名或/ })
    // a search for other people is what a password manager likes to fill in
    await expect.element(box).toHaveAttribute('autocomplete', 'off')
    await box.fill('张')
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[data-testid="user-jump-option"]')).toHaveLength(2),
    )
    // asked across the whole tenant, not under whatever unit the roster shows;
    // waited for, because the box opens on people before anything is typed
    await vi.waitFor(() =>
      expect(
        (list.mock.calls as unknown as [{ query: { search?: string; scope?: string } }][]).some(
          (call) => call[0].query.search === '张' && call[0].query.scope === 'subtree',
        ),
      ).toBe(true),
    )
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await expect.element(page.getByTestId('landed')).toBeInTheDocument()
    expect(addressNow()).toContain(`/people/${SECOND_USER_ID}`)
  })
})
