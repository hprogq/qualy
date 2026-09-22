import LoginMethodsPage from '../src/client/iam/LoginMethodsPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { authApi } from '@qualy/plugin-auth/client/api'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// loaded through the registry the host actually uses, so a screen that lost
// its key would fail here rather than at runtime

type ProviderDto = ApiResult<typeof authApi, 'identity', 'listAuthProviders'>['providers'][number]
type DetailDto = ApiResult<typeof authApi, 'identity', 'getAuthProvider'>
type UserTypeDto = ApiResult<typeof authApi, 'identity', 'listUserTypes'>['userTypes'][number]

const PASSWORD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const CAS_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const STUDENT_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const FACULTY_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

const provider = (over: Partial<ProviderDto> = {}): ProviderDto => ({
  id: PASSWORD_ID,
  code: 'password',
  type: 'password',
  name: '账号密码',
  status: 'active',
  setup: 'complete',
  isSystem: false,
  sortOrder: 0,
  version: 4,
  audience: { mode: 'unrestricted' },
  ...over,
})

const detail = (row: ProviderDto, over: Partial<Omit<DetailDto, 'provider'>> = {}): DetailDto => ({
  provider: row,
  missing: [],
  config: {},
  secrets: [],
  usage: { bindings: 0, sessions: 0 },
  ...over,
})

const word = (value: string) => ({ kind: 'literal' as const, value })

// a kind of entrance an installed driver lets a tenant add: an address, and a
// secret the server keeps
const casKind = {
  type: 'cas',
  label: word('统一身份认证'),
  fields: [
    { key: 'server', label: word('服务地址'), hint: null, kind: 'url' as const, required: true },
    {
      key: 'clientSecret',
      label: word('客户端密钥'),
      hint: null,
      kind: 'secret' as const,
      required: true,
    },
  ],
}

const cas = (over: Partial<ProviderDto> = {}) =>
  provider({ id: CAS_ID, code: 'cas', type: 'cas', name: '统一身份认证', ...over })

const userType = (over: Partial<UserTypeDto> = {}): UserTypeDto => ({
  id: STUDENT_ID,
  code: 'student',
  name: '学生',
  description: null,
  status: 'active',
  isSystem: false,
  sortOrder: 0,
  version: 1,
  userCount: 12,
  placementPolicy: { mode: 'unrestricted' },
  ...over,
})

const stubs = (over: Record<string, unknown> = {}) => ({
  app: { getManifest: () => Effect.succeed(emptyManifest()) },
  identity: {
    listAuthProviders: () => Effect.succeed({ providers: [provider()] }),
    getAuthProvider: () => Effect.succeed(detail(provider())),
    // the kinds that can be added: none installed here says so
    listAuthProviderKinds: () => Effect.succeed({ kinds: [] }),
    listUserTypes: () =>
      Effect.succeed({
        userTypes: [userType(), userType({ id: FACULTY_ID, code: 'faculty', name: '教职工' })],
        capabilities: { canManage: true },
      }),
    ...over,
  },
})

describe('login methods screen', () => {
  it('replaces the whole audience, stating the version it read', async () => {
    const save = vi.fn(() => Effect.succeed({ version: 5 }))
    renderScreen({
      client: fakeClient(stubs({ setAuthProviderAudience: save })),
      route: `/admin/login-methods?provider=${PASSWORD_ID}`,
      children: <LoginMethodsPage />,
    })

    await expect.element(page.getByRole('heading', { name: '账号密码' })).toBeInTheDocument()
    // nothing to save until something changes: a save button live on arrival
    // invites a write that says nothing
    // the sheet has two things to save, each in its own card: this is the audience's
    const save2 = page
      .getByTestId('audience-panel')
      .getByRole('button', { name: '保存', exact: false })
    await expect.element(save2).toBeDisabled()

    // narrowing the door from "anyone" to a named list is one decision, and
    // the list it lands on is the whole rule rather than a delta
    await page.getByRole('tab', { name: '仅指定类型', exact: false }).click()
    await page.getByRole('checkbox', { name: '学生', exact: false }).click()
    await expect.element(save2).toBeEnabled()
    await save2.click()

    expect(save).toHaveBeenCalledWith({
      params: { providerId: PASSWORD_ID },
      payload: {
        version: 4,
        audience: { mode: 'allow-list', userTypeIds: [STUDENT_ID] },
      },
    })
  })

  it('says out loud when a door would open for nobody', async () => {
    renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () =>
            Effect.succeed({
              providers: [
                provider(),
                provider({
                  id: CAS_ID,
                  code: 'cas',
                  type: 'cas',
                  name: '统一身份认证',
                  audience: { mode: 'allow-list', userTypeIds: [] },
                }),
              ],
            }),
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })

    // an empty allow-list is a legal rule and a real problem, so it is
    // reported rather than refused. The standing is the assertion, not the
    // sentence carrying it - the wording is copy and may change.
    await expect.element(page.getByRole('heading', { name: '统一身份认证' })).toBeInTheDocument()
    const open = document.querySelectorAll('[data-audience="empty"]')
    expect(open).toHaveLength(1)
    // and the list itself is offered, empty of ticks rather than absent
    const boxes = await page.getByRole('checkbox').elements()
    expect(boxes).toHaveLength(2)
    for (const box of boxes) expect(box).not.toBeChecked()
  })

  it('offers no save to a reader who may only look', async () => {
    renderScreen({
      client: fakeClient(
        stubs({
          listUserTypes: () =>
            Effect.succeed({ userTypes: [userType()], capabilities: { canManage: false } }),
        }),
      ),
      route: `/admin/login-methods?provider=${PASSWORD_ID}`,
      children: <LoginMethodsPage />,
    })

    await expect.element(page.getByRole('heading', { name: '账号密码' })).toBeInTheDocument()
    // the rule is stated, with nothing to switch it by
    await expect
      .element(page.getByTestId('audience-panel'))
      .toHaveAttribute('data-mode', 'unrestricted')
    expect(await page.getByRole('tab').elements()).toHaveLength(0)
    expect(await page.getByRole('button', { name: '保存', exact: false }).elements()).toHaveLength(
      0,
    )
  })
})

describe('a method as one row of a phone', () => {
  it('rules its facts apart only where there are two of them to rule', async () => {
    // The row leads with a seat held open for the drag handle a pointer
    // gets. Counted as a fact, it took the method's own name into the run
    // with it - and every fact after that was ruled off from the one
    // before, which filled the row with strokes. A column dropped narrow
    // has no side to be ruled from either.
    await page.viewport(390, 844)
    renderScreen({
      client: fakeClient(stubs()),
      route: '/admin/login-methods',
      children: <LoginMethodsPage />,
    })
    await expect.element(page.getByTestId('method-row').first()).toBeVisible()
    const row = document.querySelector('[data-testid="method-row"]')!
    const facts = row.querySelector('[class*="styles.facts"]')!
    // the name is the row's own lead, not one of the facts under it
    expect(facts.querySelector('[class*="styles.cellLead"]')).toBeNull()
    // two facts on show, so one rule
    expect(facts.querySelectorAll('[class*="factRule"]')).toHaveLength(1)
    await page.viewport(1280, 800)
  })
})

describe('a method as one row of a phone', () => {
  it('stands what the row is scanned by against the whole of it', async () => {
    // The column the drag handle rides in is a pointer's. Stacked there is
    // no such column - and the seat held open for it opened a row of its
    // own under the facts, which pushed the standing and the way in off the
    // row's middle.
    await page.viewport(390, 844)
    renderScreen({
      client: fakeClient(stubs()),
      route: '/admin/login-methods',
      children: <LoginMethodsPage />,
    })
    await expect.element(page.getByTestId('method-row').first()).toBeVisible()
    const row = document.querySelector('[data-testid="method-row"]') as HTMLElement
    const standing = row.querySelector('[data-tone]')!.closest('span[class*="cell"]')!
    const middle = (box: DOMRect) => box.top + box.height / 2
    expect(
      Math.abs(middle(standing.getBoundingClientRect()) - middle(row.getBoundingClientRect())),
    ).toBeLessThan(2)
    await page.viewport(1280, 800)
  })
})

describe('a way in, from added to gone', () => {
  it('is added as a name and an address, then opened to be set up', async () => {
    const create = vi.fn(() => Effect.succeed({ id: CAS_ID }))
    renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          createAuthProvider: create,
        }),
      ),
      route: '/admin/login-methods',
      children: <LoginMethodsPage />,
    })
    await page.getByRole('button', { name: '新增登录方式' }).click()
    const dialog = page.getByRole('dialog')
    // what the kind needs is not asked for here
    await expect.element(dialog).toBeInTheDocument()
    expect(document.querySelector('input[name="entrance-server"]')).toBeNull()
    await dialog.getByRole('textbox', { name: '名称' }).fill('统一身份认证')
    await dialog.getByRole('textbox', { name: '地址标识' }).fill('cas')
    await dialog.getByRole('button', { name: '创建' }).click()
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: { type: 'cas', code: 'cas', name: '统一身份认证' },
    })
  })

  it('is set up over saves, and offered for service only once it has everything', async () => {
    const update = vi.fn(() => Effect.succeed({ version: 5 }))
    const row = cas({ status: 'disabled', setup: 'incomplete' })
    renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed({ providers: [provider(), row] }),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          getAuthProvider: () =>
            Effect.succeed(
              detail(row, {
                missing: [
                  { kind: 'field', key: 'server' },
                  { kind: 'field', key: 'clientSecret' },
                ],
                secrets: [{ key: 'clientSecret', stored: false }],
              }),
            ),
          updateAuthProvider: update,
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    await expect.element(page.getByTestId('method-details')).toHaveAttribute('data-setup', 'incomplete')
    await expect
      .element(page.getByTestId('method-missing'))
      .toHaveAttribute('data-missing', 'server,clientSecret')
    // nothing to switch it into service by
    expect(await page.getByRole('tab', { name: '已启用' }).elements()).toHaveLength(0)

    // part of it is enough to save
    await page.getByRole('textbox', { name: '服务地址' }).fill('https://cas.example.edu')
    await page.getByLabelText('客户端密钥', { exact: false }).fill('s3cret')
    await page.getByTestId('method-details').getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({
      params: { providerId: CAS_ID },
      payload: {
        version: 4,
        values: { server: 'https://cas.example.edu', clientSecret: 's3cret' },
      },
    })
  })

  const settled = {
    config: { server: 'https://cas.example.edu' },
    secrets: [{ key: 'clientSecret', stored: true }],
  }

  it('keeps what a way in service needs', async () => {
    const serving = cas()
    renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed({ providers: [provider(), serving] }),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          getAuthProvider: () => Effect.succeed(detail(serving, settled)),
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    // a stored secret never comes back; the box says there is one. Found by
    // the field it belongs to, because the press beside it is named for the
    // same field and a label would answer with both
    await vi.waitFor(() =>
      expect(
        document.querySelector('input[name="entrance-clientSecret"]')?.getAttribute('data-stored'),
      ).toBe('true'),
    )
    expect(
      (document.querySelector('input[name="entrance-clientSecret"]') as HTMLInputElement).value,
    ).toBe('')
    await expect.element(page.getByTestId('secret-clear')).toBeDisabled()
    // emptying a required box of a door in service is not saved
    const address = page.getByRole('textbox', { name: '服务地址' })
    await expect.element(address).toHaveValue('https://cas.example.edu')
    await address.fill('')
    await expect
      .element(page.getByTestId('method-details').getByRole('button', { name: '保存' }))
      .toBeDisabled()
  })

  it('lets a stored secret go once the way in is out of service', async () => {
    const clear = vi.fn(() => Effect.succeed({ version: 5 }))
    const resting = cas({ status: 'disabled' })
    renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed({ providers: [provider(), resting] }),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          getAuthProvider: () => Effect.succeed(detail(resting, settled)),
          deleteAuthProviderSecret: clear,
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    await expect.element(page.getByTestId('secret-clear')).toBeEnabled()
    await page.getByTestId('secret-clear').click()
    await vi.waitFor(() => expect(clear).toHaveBeenCalledTimes(1))
    expect(clear).toHaveBeenCalledWith({
      params: { providerId: CAS_ID, key: 'clientSecret' },
      query: { version: '4' },
    })
  })

  it('is deleted only after saying what it ends', async () => {
    const remove = vi.fn(() => Effect.succeed({ ok: true as const }))
    const row = cas()
    renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed({ providers: [provider(), row] }),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          getAuthProvider: () =>
            Effect.succeed(detail(row, { usage: { bindings: 37, sessions: 12 } })),
          deleteAuthProvider: remove,
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    await expect.element(page.getByTestId('method-delete')).toBeEnabled()
    await page.getByTestId('method-delete').click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeInTheDocument()
    // the counts are the fixture's, not copy
    const said = asked.element().textContent ?? ''
    expect(said).toContain('37')
    expect(said).toContain('12')
    expect(remove).not.toHaveBeenCalled()
    await asked.getByRole('button', { name: '删除' }).click()
    await vi.waitFor(() => expect(remove).toHaveBeenCalledTimes(1))
    expect(remove).toHaveBeenCalledWith({ params: { providerId: CAS_ID }, query: { version: '4' } })
  })

  it('never offers to delete the door the platform provides', async () => {
    renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed({ providers: [provider({ isSystem: true })] }),
          getAuthProvider: () => Effect.succeed(detail(provider({ isSystem: true }))),
        }),
      ),
      route: `/admin/login-methods?provider=${PASSWORD_ID}`,
      children: <LoginMethodsPage />,
    })
    await expect.element(page.getByRole('heading', { name: '账号密码' })).toBeInTheDocument()
    expect(document.querySelector('[data-testid="method-delete"]')).toBeNull()
  })
})
