import UserTypesPage from '../src/client/iam/UserTypesPage.tsx'
import UserTypePage from '../src/client/iam/UserTypePage.tsx'
import RolesPage from '@qualy/plugin-rbac/client/RolesPage'
import RolePage from '@qualy/plugin-rbac/client/RolePage'
import UsersPage from '../src/client/iam/UsersPage.tsx'
import UserDetailHeader from '../src/client/iam/UserDetailHeader.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { type ApiResult, type ClientOf } from '@qualy/web-runtime/api'
import { type authApi } from '@qualy/plugin-auth/client/api'
import { type accessApi } from '@qualy/plugin-rbac/client/api'

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
  email: null,
  emailVerifiedAt: null,
  displayName: '张三',
  status: 'active',
  version: 1,
  userType: { id: USER_TYPE_ID, code: 'student', name: '学生' },
  primaryOrgNode: { id: ROOT_NODE_ID, name: '本部' },
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
  everGranted: false,
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
  listUsers: () => Effect.succeed({ items: [], nextCursor: null, total: 0, page: 1, pageSize: 20 }),
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
    await renderScreen({
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
    expect(page.getByText('新建用户类型').elements()).toHaveLength(0)
  })

  // A reading that failed is said in the words of reading, on a card of its
  // own where the list would have stood: a server that cannot serve right
  // now is told apart from one that failed.
  it('says the types could not be read right now, with another try', async () => {
    await renderScreen({
      client: fakeClient(
        stubs({
          identity: { listUserTypes: () => Effect.fail(apiError('SERVICE_UNAVAILABLE')) },
        }),
      ),
      children: <UserTypesPage />,
    })
    const state = () => document.querySelector('[data-slot="resource-state"]')
    await expect.poll(() => state()?.getAttribute('data-state')).toBe('unavailable')
    await expect.element(page.getByRole('button', { name: '重试' })).toBeVisible()
  })

  // Inside the dialog too: the kinds of unit a new type could be held to
  // that could not be read are said as a reading, and one refused is not
  // tried again.
  it('says in the new type dialog that the kinds of unit could not be read', async () => {
    await renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            listUserTypes: () =>
              Effect.succeed({ userTypes: [], capabilities: { canManage: true } }),
            getUserTypeOptions: () => Effect.fail(apiError('ACCESS_DENIED')),
          },
        }),
      ),
      children: <UserTypesPage />,
    })
    await page.getByRole('button', { name: '新建用户类型' }).click()
    const dialog = page.getByRole('dialog')
    await expect
      .poll(() =>
        dialog.element().querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
      )
      .toBe('denied')
    expect(dialog.getByRole('button', { name: '重试' }).query()).toBeNull()
  })

  // A type the list does not hold is the whole page: said once, with the way
  // back to the list, under no heading of a type.
  it('says a type is not there instead of drawing its page', async () => {
    await renderScreen({
      client: fakeClient({
        ...stubs({
          identity: {
            listUserTypes: () =>
              Effect.succeed({ userTypes: [userType()], capabilities: { canManage: true } }),
          },
        }),
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [{ id: 'auth/user-types', path: '/admin/user-types', layout: 'admin' }],
            }),
        },
      }),
      route: `/admin/user-types/${SECOND_USER_ID}`,
      path: '/admin/user-types/:typeId',
      children: <UserTypePage />,
    })
    const state = () => document.querySelector('[data-slot="resource-state"]')
    await expect.poll(() => state()?.getAttribute('data-state')).toBe('missing')
    expect(state()?.getAttribute('data-size')).toBe('page')
    expect(page.getByRole('button', { name: '重试' }).query()).toBeNull()
    await expect
      .element(page.getByRole('link', { name: '返回用户类型' }))
      .toHaveAttribute('href', '/admin/user-types')
  })

  // The people of a type: a reader without the grant to read people gets no
  // card, and a reading that failed otherwise is said in the card instead of
  // passing for that.
  it('says in the card that its people could not be read, and hides it only from those who may not', async () => {
    const mountWith = (getUserOptions: () => unknown) =>
      renderScreen({
        client: fakeClient(
          stubs({
            identity: {
              listUserTypes: () =>
                Effect.succeed({ userTypes: [userType()], capabilities: { canManage: false } }),
              getUserOptions,
            },
          }),
        ),
        route: `/admin/user-types/${USER_TYPE_ID}`,
        path: '/admin/user-types/:typeId',
        children: <UserTypePage />,
      })
    await mountWith(() => Effect.fail(apiError('INTERNAL_FAILURE')))
    const card = page.getByTestId('type-members')
    await expect.element(card).toBeInTheDocument()
    await expect
      .poll(() =>
        card.element().querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
      )
      .toBe('failed')
    await expect.element(card.getByRole('button', { name: '重试' })).toBeVisible()
  })

  it('shows no management controls to a reader who may not manage', async () => {
    await renderScreen({
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
    expect(page.getByRole('tab').elements()).toHaveLength(0)
    // and nothing on it acts
    expect(page.getByRole('button', { name: '保存', exact: false }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '重命名' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '停用' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '删除' }).elements()).toHaveLength(0)
    // and no way to make more of them
    expect(page.getByText('新建用户类型').elements()).toHaveLength(0)
  })

  it('refuses to offer a disable that the api would reject', async () => {
    await renderScreen({
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
    await renderScreen({
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
      // the backend says USER_TYPE_VERSION_CONFLICT in english; the reader must not
      Effect.fail(apiError('USER_TYPE_VERSION_CONFLICT', undefined)),
    )
    await renderScreen({
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
    expect(page.getByRole('button', { name: '保存', exact: false }).elements()).toHaveLength(0)
    await page.getByRole('button', { name: '重命名' }).click()
    await page.getByRole('button', { name: '保存', exact: false }).click()
    // The refusal reaches the reader as a sentence rather than as a code,
    // which is the subject here. Asserted as: something was said, it was
    // said as a refusal, and it was not the protocol word. Not as the
    // sentence itself: that belongs to this endpoint's message source.
    await expect.element(page.getByTestId('feedback')).toHaveAttribute('data-tone', 'error')
    expect(page.getByTestId('feedback').element().textContent ?? '').not.toBe('')
    expect(page.getByText('USER_TYPE_VERSION_CONFLICT').elements()).toHaveLength(0)
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
    await renderScreen({
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
    await renderScreen({
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
    expect(page.getByRole('button', { name: '重命名' }).elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '保存权限' }).elements()).toHaveLength(0)
    expect(page.getByRole('tab', { name: '可任命' }).elements()).toHaveLength(0)
    // and its standing offers nothing to switch and nothing destructive
    await expect.element(page.getByTestId('role-standing')).toHaveAttribute('data-status', 'active')
    expect(page.getByRole('button', { name: '删除角色' }).elements()).toHaveLength(0)
    expect(page.getByRole('tab', { name: '停用' }).elements()).toHaveLength(0)
  })

  it('does not present a failed supporting query as an empty picker', async () => {
    await renderScreen({
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
    expect(page.getByRole('button', { name: '重试' }).elements()).toHaveLength(1)
    expect(page.getByRole('checkbox').elements()).toHaveLength(0)
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
    await renderScreen({
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
    expect(page.getByRole('group', { name: '权限' }).elements()).toHaveLength(0)
    expect(page.getByRole('group', { name: '可以授予这些用户类型' }).elements()).toHaveLength(0)

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
      name: label,
      description: null,
      groupKey: 'assessment',
      group: '综合测评',
      target: 'org-node' as const,
    })
    await renderScreen({
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
    await renderScreen({
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
    user: user({ manageable: true, ...over }),
    orgPath: [
      { id: ROOT_NODE_ID, name: '本部', orgTypeName: '学院' },
      { id: BRANCH_NODE_ID, name: '分部', orgTypeName: '系' },
    ],
    placement: { mode: 'unrestricted' },
    roles: [{ grantId: 'g-1', roleId: 'r-1', roleName: '审核员', orgNodeName: '分部' }],
    lastSignInAt: null,
    accountManageable: true,
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

  // A person is looked at on their own page; the panel that once opened
  // beside the list is gone, and an address from then opens that page.
  it('opens the person a link from the old panel names on their own page', async () => {
    await renderScreen({
      client: fakeClient({
        ...rosterStubs(),
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [{ id: 'auth/user-detail', path: '/people/:userId', layout: 'admin' }],
            }),
        },
      }),
      routes: [
        { path: '/admin/users', element: <UsersPage /> },
        { path: '/people/:userId', element: <p data-testid="landed" /> },
      ] as never,
      route: `/admin/users?user=${USER_ID}`,
    })
    await expect.element(page.getByTestId('landed')).toBeInTheDocument()
    expect(addressNow()).toContain(`/people/${USER_ID}`)
  })

  it('offers no panel beside the roster, only the rows themselves', async () => {
    await renderScreen({
      client: fakeClient(rosterStubs()),
      route: '/admin/users',
      children: <UsersPage />,
    })
    await expect.poll(() => page.getByTestId('roster-row').elements().length).toBe(2)
    expect(document.querySelector('[data-testid="roster-look"]')).toBeNull()
    expect(document.querySelector('[data-testid="person-sheet"]')).toBeNull()
  })

  // Units that could not be read say so once, with another try, and never
  // also that the reader administers nobody: that is a different answer.
  it('says the units could not be read, and nothing about administering none', async () => {
    await renderScreen({
      client: fakeClient(
        rosterStubs({ getUserOptions: () => Effect.fail(apiError('INTERNAL_FAILURE')) }),
      ),
      route: '/admin/users',
      children: <UsersPage />,
    })
    await expect
      .poll(() =>
        document.querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
      )
      .toBe('failed')
    expect(document.querySelectorAll('[data-slot="resource-state"]')).toHaveLength(1)
    expect(document.querySelector('[data-testid="users-no-anchors"]')).toBeNull()
    expect(document.querySelector('[data-testid="feedback"]')).toBeNull()
    await expect.element(page.getByRole('button', { name: '重试' })).toBeVisible()
  })

  it('says so as a state when the reader administers nobody', async () => {
    await renderScreen({
      client: fakeClient(
        rosterStubs({
          getUserOptions: () => Effect.succeed({ truncated: false, nodes: [], userTypes: [] }),
        }),
      ),
      route: '/admin/users',
      children: <UsersPage />,
    })
    await expect
      .element(page.getByTestId('users-no-anchors'))
      .toHaveAttribute('data-state', 'denied')
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
    await renderScreen({
      client: fakeClient(rosterStubs({ listUsers: list })),
      route: '/admin/users',
      children: <UsersPage />,
    })

    await expect.poll(() => page.getByTestId('roster-row').elements().length).toBe(1)
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
    await renderScreen({
      client: fakeClient(rosterStubs()),
      route: '/admin/users',
      children: <UsersPage />,
    })

    await page.getByTestId('unit-switch').click()
    const sheet = page.getByTestId('unit-sheet')
    await expect.element(sheet).toBeVisible()
    await expect.element(sheet.getByRole('button', { name: '组织栏选项' })).toBeVisible()
    const search = sheet.getByRole('searchbox', { name: '搜索组织' }).element()
    const menu = sheet.getByRole('button', { name: '组织栏选项' }).element()
    expect(
      Math.abs(search.getBoundingClientRect().top - menu.getBoundingClientRect().top),
    ).toBeLessThan(8)

    const tall = sheet.element().getBoundingClientRect().height
    await userEvent.fill(sheet.getByRole('searchbox', { name: '搜索组织' }), '没有这个组织')
    await expect.element(sheet.getByText('未找到匹配的组织', { exact: false })).toBeVisible()
    expect(sheet.element().getBoundingClientRect().height).toBeCloseTo(tall, 0)
    await page.viewport(1280, 800)
  })

  it('walks the roster by page number, and widens the standing only when asked', async () => {
    const list = vi.fn(() =>
      Effect.succeed({
        items: [user({ id: USER_ID, displayName: '张明远' })],
        nextCursor: null,
        total: 120,
        page: 1,
        pageSize: 50,
      }),
    )
    await renderScreen({
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
    // those in good standing by default; either standing is asked for by
    // leaving the standing out, and a different question starts again at
    // its first page
    expect(asked().every((query) => query.status === 'active')).toBe(true)
    await page.getByTestId('roster-standing').click()
    await page.getByRole('option', { name: '全部状态' }).click()
    await vi.waitFor(() =>
      expect(asked().some((query) => query.status === undefined && query.page === '1')).toBe(true),
    )
  })

  it('keeps what a folded action opens, after the menu that offered it has shut', async () => {
    // Narrow, the band's spare actions fold into a menu. Choosing one closes
    // the menu - and the row IS the control that owns the dialog, so an
    // unmounted row took the dialog's own state with it: what it opened
    // flashed and was gone.
    await page.viewport(390, 844)
    await renderScreen({
      client: fakeClient(rosterStubs()),
      route: '/admin/users',
      children: <UsersPage />,
    })

    await expect.element(page.getByText('张明远')).toBeVisible()
    await page.getByRole('button', { name: '更多操作' }).click()
    const item = page.getByRole('menuitem', { name: '查找用户' })
    await expect.element(item).toBeVisible()
    await item.click()
    // still there a beat later, rather than gone with the menu
    await expect.element(page.getByTestId('user-jump')).toBeVisible()
    await new Promise((resolve) => setTimeout(resolve, 400))
    await expect.element(page.getByTestId('user-jump')).toBeVisible()
    await page.viewport(1280, 800)
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
    await renderScreen({
      client: fakeClient({
        ...rosterStubs({ listUsers: list }),
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [{ id: 'auth/user-detail', path: '/people/:userId', layout: 'admin' }],
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

// A refusal is said where the reader is looking: in the form while the form
// is up, since the band behind an open dialog is inert and hidden from
// assistive tech.
describe("a person's header", () => {
  const person = () => ({
    user: user({ email: 'zhang@example.edu' }),
    orgPath: [{ id: ROOT_NODE_ID, name: '本部', orgTypeName: '学院' }],
    placement: { mode: 'unrestricted' },
    roles: [],
    lastSignInAt: null,
    accountManageable: true,
  })
  const mount = (over: Stubs<'identity'>) =>
    renderScreen({
      client: fakeClient(stubs({ identity: { getUser: () => Effect.succeed(person()), ...over } })),
      route: `/organization/users/${USER_ID}`,
      path: '/organization/users/:userId',
      children: <UserDetailHeader />,
    })

  it('reads the line under the name the way the person reads their own, with what is missing marked', async () => {
    await mount({
      getUser: () =>
        Effect.succeed({
          ...person(),
          orgPath: [
            { id: ROOT_NODE_ID, name: '本部', orgTypeName: '学校' },
            { id: 'a', name: '2023级', orgTypeName: '年级' },
          ],
          lastSignInAt: '2026-09-25T06:30:00.000Z',
        }),
    })
    const facts = page.getByTestId('person-facts')
    await expect.element(facts).toBeInTheDocument()
    const fact = (key: string) =>
      facts.element().querySelector<HTMLElement>(`[data-fact="${key}"]`)!
    // their number, their unit, their address and when they last came in;
    // the roles are a section of their own and no count stands in for them
    expect(
      [...facts.element().querySelectorAll('[data-fact]')].map((el) =>
        el.getAttribute('data-fact'),
      ),
    ).toEqual(['business-no', 'unit', 'email', 'last-sign-in'])
    // a number they lack is said once, as missing, and not as its own label
    expect(fact('business-no').dataset['warn']).toBe('yes')
    expect(fact('email').dataset['warn']).toBe('no')
    // the unit shows its own name, the whole way down to it on hover
    expect(fact('unit').querySelector('[title]')?.getAttribute('title')).toBe('本部 / 2023级')
  })

  it('leaves the number off the platform’s own account, which never gets one', async () => {
    await mount({
      getUser: () => Effect.succeed({ ...person(), placement: { mode: 'tenant-root' } }),
    })
    const facts = page.getByTestId('person-facts')
    await expect.element(facts).toBeInTheDocument()
    expect(
      [...facts.element().querySelectorAll('[data-fact]')].map((el) =>
        el.getAttribute('data-fact'),
      ),
    ).toEqual(['unit', 'email', 'last-sign-in'])
  })

  // A long address on a phone gets a line of its own and gives way inside
  // itself, so the word saying it is unproven is still there to read.
  it('keeps what follows a long address in sight on a narrow screen', async () => {
    await page.viewport(390, 844)
    await renderScreen({
      client: fakeClient(
        stubs({
          identity: {
            getUser: () =>
              Effect.succeed({
                ...person(),
                user: user({
                  email: 'zhang.mingyuan.information-management-2023@graduate.example.edu.cn',
                }),
              }),
          },
        }),
      ),
      route: `/organization/users/${USER_ID}`,
      path: '/organization/users/:userId',
      // the shell's own gutters around the band
      children: (
        <div style={{ paddingInline: 16 }}>
          <UserDetailHeader />
        </div>
      ),
    })
    const facts = page.getByTestId('person-facts')
    await expect.element(facts).toBeInTheDocument()
    const aside = facts
      .element()
      .querySelector<HTMLElement>('[data-fact="email"] [data-fact-aside]')!
    const edge = facts.element().getBoundingClientRect().right
    expect(aside.getBoundingClientRect().width).toBeGreaterThan(0)
    expect(aside.getBoundingClientRect().right).toBeLessThanOrEqual(edge + 0.5)
  })

  // Nobody there is the whole answer, said in the page's place with the way
  // back to the roster, never a line in the band over sections of nobody.
  it('says the person is not there instead of drawing their band', async () => {
    await mount({ getUser: () => Effect.fail(apiError('USER_NOT_FOUND')) })
    const state = page.getByTestId('user-detail-absent')
    await expect.element(state).toBeInTheDocument()
    expect(
      state.element().querySelector('[data-slot="resource-state"]')?.getAttribute('data-state'),
    ).toBe('missing')
    expect(document.querySelector('[data-testid="feedback"]')).toBeNull()
    expect(document.querySelector('[data-testid="person-facts"]')).toBeNull()
    // another try would find nobody either: the way out is the roster
    expect(page.getByRole('button', { name: '重试' }).query()).toBeNull()
  })

  it('knows an address that names nobody without asking', async () => {
    const asked = vi.fn(() => Effect.succeed(person()))
    await renderScreen({
      client: fakeClient(stubs({ identity: { getUser: asked } })),
      route: '/organization/users/not-a-person',
      path: '/organization/users/:userId',
      children: <UserDetailHeader />,
    })
    const state = page.getByTestId('user-detail-absent')
    await expect.element(state).toBeInTheDocument()
    expect(state.element().querySelector('[data-state]')?.getAttribute('data-state')).toBe(
      'missing',
    )
    expect(asked).not.toHaveBeenCalled()
  })

  // Deleting leaves for the roster before the record is read again: read
  // again first, it answered "not found" and the page flashed its absence.
  it('leaves for the roster before anything reads the deleted person again', async () => {
    const answers = { deleted: false }
    const seen = { absence: false }
    const watcher = new MutationObserver(() => {
      if (document.querySelector('[data-testid="user-detail-absent"]')) seen.absence = true
    })
    watcher.observe(document.body, { childList: true, subtree: true })
    try {
      await renderScreen({
        client: fakeClient({
          ...stubs({
            identity: {
              getUser: () =>
                answers.deleted
                  ? Effect.fail(apiError('USER_NOT_FOUND'))
                  : Effect.succeed(person()),
              deleteUser: () => {
                answers.deleted = true
                return Effect.succeed({ ok: true as const })
              },
            },
          }),
          app: {
            getManifest: () =>
              Effect.succeed({
                ...emptyManifest(),
                pages: [{ id: 'auth/users', path: '/organization/users', layout: 'admin' }],
              }),
          },
        }),
        routes: [
          { path: '/organization/users', element: <p data-testid="roster" /> },
          { path: '/organization/users/:userId', element: <UserDetailHeader /> },
        ] as never,
        route: `/organization/users/${USER_ID}`,
      })
      await page.getByRole('button', { name: '更多操作' }).click()
      await page.getByRole('menuitem', { name: '删除' }).click()
      await page.getByRole('alertdialog').getByTestId('confirm-accept').click()
      await expect.element(page.getByTestId('roster')).toBeInTheDocument()
      expect(seen.absence).toBe(false)
    } finally {
      watcher.disconnect()
    }
  })

  it('says why a disable was refused once the question is put away, and not in the form after', async () => {
    const status = vi.fn(() => Effect.fail(apiError('LAST_ADMINISTRATOR')))
    await mount({ setUserStatus: status })
    await page.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menuitem', { name: '停用' }).click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeInTheDocument()
    await asked.getByTestId('confirm-accept').click()
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(1))
    // answering puts the question away, and the band says what refused it,
    // under no overlay
    await expect.poll(() => document.querySelector('[role="alertdialog"]')).toBeNull()
    const band = page.getByTestId('feedback')
    await expect.element(band).toHaveAttribute('data-tone', 'error')
    expect(band.element().closest('[aria-hidden="true"], [inert]')).toBeNull()
    // the form opened next is about the profile, and says nothing of it
    await page.getByRole('button', { name: '编辑资料' }).click()
    const dialog = page.getByRole('dialog')
    await expect.element(dialog.getByRole('textbox', { name: '邮箱' })).toBeInTheDocument()
    expect(dialog.element().querySelector('[data-testid="feedback"]')).toBeNull()
  })

  // An address somebody else holds is fixed in the field it was typed in,
  // so it is said there; a refusal about nothing in particular is the form's.
  it('says under the field what a save was refused for, and keeps nothing once it is put away', async () => {
    const update = vi.fn(() => Effect.fail(apiError('USER_EMAIL_CONFLICT')))
    await mount({ updateUser: update })
    await page.getByRole('button', { name: '编辑资料' }).click()
    const dialog = page.getByRole('dialog')
    const address = dialog.getByRole('textbox', { name: '邮箱' })
    await address.fill('taken@example.edu')
    await dialog.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    await expect.element(dialog.getByTestId('field-error')).toBeVisible()
    await expect.element(address).toHaveAttribute('aria-invalid', 'true')
    expect(dialog.element().querySelector('[data-testid="feedback"]')).toBeNull()
    // typing again takes the refusal back
    await address.fill('other@example.edu')
    expect(dialog.element().querySelector('[data-testid="field-error"]')).toBeNull()

    await dialog.getByRole('button', { name: '取消' }).click()
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[data-testid="feedback"]')).toBeNull()
  })

  it('says an address that cannot be one once the typing has settled, and will not save it', async () => {
    const update = vi.fn(() => Effect.succeed({ ok: true as const }))
    await mount({ updateUser: update })
    await page.getByRole('button', { name: '编辑资料' }).click()
    const dialog = page.getByRole('dialog')
    const address = dialog.getByRole('textbox', { name: '邮箱' })
    // when it is said is the field's own business (tests/field-system); here,
    // that it is said, and what it keeps from happening
    await address.fill('not-an-address')
    await expect.element(dialog.getByTestId('field-error')).toBeVisible()
    await expect.element(dialog.getByRole('button', { name: '保存' })).toBeDisabled()
    // the name is asked for, and said to be
    await expect
      .element(dialog.getByRole('textbox', { name: '名称' }))
      .toHaveAttribute('aria-required', 'true')
  })

  // Moving somebody from the band opens the move itself, over whichever
  // section is open: sending the reader to the organization section first
  // did nothing visible when they were already on it.
  it('opens the move in place from the band', async () => {
    await mount({ getUser: () => Effect.succeed({ ...person(), accountManageable: true }) })
    await page.getByRole('button', { name: '调动' }).click()
    await expect.element(page.getByTestId('move-picker')).toBeVisible()
    // still on the record it was opened from, not sent to another section
    expect(addressNow()).not.toMatch(/\/organization$/)
  })

  // Somebody holding authority the reader could not grant: their record is
  // the reader's to edit, their account is not. The controls that would only
  // be refused are not drawn, and a save sends none of the account's fields.
  it('offers only the record when the account is beyond the reader', async () => {
    const update = vi.fn((_: { payload: Record<string, unknown> }) =>
      Effect.succeed({ ok: true as const }),
    )
    await mount({
      getUser: () => Effect.succeed({ ...person(), accountManageable: false }),
      updateUser: update,
    })
    await expect.element(page.getByRole('button', { name: '编辑资料' })).toBeInTheDocument()
    expect(page.getByRole('button', { name: '调动' }).query()).toBeNull()
    expect(page.getByRole('button', { name: '更多操作' }).query()).toBeNull()

    await page.getByRole('button', { name: '编辑资料' }).click()
    const dialog = page.getByRole('dialog')
    await expect.element(dialog.getByRole('textbox', { name: '邮箱' })).toBeDisabled()
    await dialog.getByRole('textbox', { name: '名称' }).fill('张新')
    await dialog.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    const sent = update.mock.calls[0]![0].payload
    expect(sent).toMatchObject({ displayName: '张新' })
    expect(sent).not.toHaveProperty('email')
    expect(sent).not.toHaveProperty('businessNo')
  })
})
