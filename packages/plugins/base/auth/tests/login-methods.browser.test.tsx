import LoginMethodsPage from '../src/client/iam/LoginMethodsPage.tsx'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
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
  kindLabel: { kind: 'literal', value: '邮箱密码' },
  name: '账号密码',
  status: 'active',
  setup: 'complete',
  isSystem: false,
  sortOrder: 0,
  prominence: 'primary',
  recommended: false,
  icon: { kind: 'builtin', key: 'mail' },
  iconChosen: false,
  version: 4,
  audience: { mode: 'unrestricted' },
  ...over,
})

const detail = (row: ProviderDto, over: Partial<Omit<DetailDto, 'provider'>> = {}): DetailDto => ({
  provider: row,
  missing: [],
  callbackUrl: null,
  config: {},
  secrets: [],
  usage: { bindings: 0, sessions: 0, sessionsByUserType: [] },
  ...over,
})

const word = (value: string) => ({ kind: 'literal' as const, value })

// every field a driver declares arrives flat: what a kind does not use is null
const box = {
  hint: null,
  section: 'basic' as const,
  visibleWhen: null,
  options: [],
  defaultValue: null,
  min: null,
  max: null,
  step: null,
}

// a kind of entrance an installed driver lets a tenant add: an address, and a
// secret the server keeps
const casKind = {
  type: 'cas',
  label: word('统一身份认证'),
  fields: [
    { ...box, key: 'server', label: word('服务地址'), kind: 'url' as const, required: true },
    {
      ...box,
      key: 'clientSecret',
      label: word('客户端密钥'),
      kind: 'secret' as const,
      required: true,
    },
  ],
}

// a kind whose boxes depend on each other: a choice that reveals a box, and
// settings folded away until somebody asks
const shapedKind = {
  type: 'cas',
  label: word('统一身份认证'),
  fields: [
    {
      ...box,
      key: 'source',
      label: word('身份来源'),
      kind: 'choice' as const,
      required: true,
      options: [
        { value: 'principal', label: word('登录名') },
        { value: 'attribute', label: word('属性') },
      ],
      defaultValue: 'principal',
    },
    {
      ...box,
      key: 'attribute',
      label: word('属性名'),
      kind: 'text' as const,
      required: true,
      visibleWhen: { field: 'source', equals: 'attribute' },
    },
    {
      ...box,
      key: 'renew',
      label: word('每次都重新登录'),
      kind: 'toggle' as const,
      required: false,
      section: 'advanced' as const,
      defaultValue: 'false',
    },
    {
      ...box,
      key: 'skew',
      label: word('时钟容差'),
      kind: 'number' as const,
      required: false,
      section: 'advanced' as const,
      defaultValue: '60',
      min: 0,
      max: 300,
      step: 1,
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

/** the doors as the list answers them, with what this reader may do to them */
const doorsOf = (
  providers: readonly ProviderDto[],
  capabilities: { canManage: boolean; canManageTrust: boolean } = {
    canManage: true,
    canManageTrust: true,
  },
) => ({ providers, capabilities })

const stubs = (over: Record<string, unknown> = {}) => ({
  app: { getManifest: () => Effect.succeed(emptyManifest()) },
  identity: {
    listAuthProviders: () => Effect.succeed(doorsOf([provider()])),
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
    await renderScreen({
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

  it('asks before saving an audience that signs people out, saying how many', async () => {
    const save = vi.fn(() => Effect.succeed({ version: 5 }))
    await renderScreen({
      client: fakeClient(
        stubs({
          getAuthProvider: () =>
            Effect.succeed(
              detail(provider(), {
                usage: {
                  bindings: 0,
                  sessions: 5,
                  sessionsByUserType: [
                    { userTypeId: STUDENT_ID, sessions: 2 },
                    { userTypeId: FACULTY_ID, sessions: 3 },
                  ],
                },
              }),
            ),
          setAuthProviderAudience: save,
        }),
      ),
      route: `/admin/login-methods?provider=${PASSWORD_ID}`,
      children: <LoginMethodsPage />,
    })
    const panel = page.getByTestId('audience-panel')
    await expect.element(panel).toHaveAttribute('data-ending', '0')
    // students only: the faculty signed in through it would be signed out
    await page.getByRole('tab', { name: '仅指定类型', exact: false }).click()
    await page.getByRole('checkbox', { name: '学生', exact: false }).click()
    await expect.element(panel).toHaveAttribute('data-ending', '3')
    await panel.getByRole('button', { name: '保存', exact: false }).click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeInTheDocument()
    expect(asked.element().textContent ?? '').toContain('3')
    expect(save).not.toHaveBeenCalled()
    await asked.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save).toHaveBeenCalledWith({
      params: { providerId: PASSWORD_ID },
      payload: { version: 4, audience: { mode: 'allow-list', userTypeIds: [STUDENT_ID] } },
    })
  })

  it('takes a way in out of service only after saying how many sessions end', async () => {
    const setStatus = vi.fn(() => Effect.succeed({ version: 5 }))
    const row = cas()
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([provider(), row])),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          getAuthProvider: () =>
            Effect.succeed(
              detail(row, { usage: { bindings: 4, sessions: 17, sessionsByUserType: [] } }),
            ),
          setAuthProviderStatus: setStatus,
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    const details = page.getByTestId('method-details')
    await expect.element(details).toHaveAttribute('data-sessions', '17')
    await details.getByRole('tab', { name: '已停用' }).click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeInTheDocument()
    // the count is the fixture's, not copy
    expect(asked.element().textContent ?? '').toContain('17')
    expect(setStatus).not.toHaveBeenCalled()
    await asked.getByRole('button', { name: '停用' }).click()
    await vi.waitFor(() => expect(setStatus).toHaveBeenCalledTimes(1))
    expect(setStatus).toHaveBeenCalledWith({
      params: { providerId: CAS_ID },
      payload: { version: 4, status: 'disabled' },
    })
  })

  it('says out loud when a door would open for nobody', async () => {
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () =>
            Effect.succeed(
              doorsOf([
                provider(),
                provider({
                  id: CAS_ID,
                  code: 'cas',
                  type: 'cas',
                  name: '统一身份认证',
                  audience: { mode: 'allow-list', userTypeIds: [] },
                }),
              ]),
            ),
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
    const boxes = page.getByTestId('audience-panel').getByRole('checkbox').elements()
    expect(boxes).toHaveLength(2)
    for (const box of boxes) expect(box).not.toBeChecked()
  })

  it('offers no save to a reader who may only look', async () => {
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () =>
            Effect.succeed(doorsOf([provider()], { canManage: false, canManageTrust: false })),
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
    expect(page.getByRole('tab').elements()).toHaveLength(0)
    expect(page.getByRole('button', { name: '保存', exact: false }).elements()).toHaveLength(0)
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
    await renderScreen({
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
    await renderScreen({
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
    await renderScreen({
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
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([provider(), row])),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          getAuthProvider: () =>
            Effect.succeed(
              detail(row, {
                missing: [
                  { kind: 'field', key: 'server' },
                  { kind: 'field', key: 'clientSecret' },
                ],
                secrets: [{ key: 'clientSecret', stored: false, readable: true }],
              }),
            ),
          updateAuthProvider: update,
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    // the list says it is not set up, in full: the column holds the word
    await page.viewport(1280, 800)
    const status = await vi.waitFor(() => {
      const found = document
        .querySelectorAll('[data-testid="method-row"]')[1]
        ?.querySelector<HTMLElement>('[data-tone="bad"]')
      if (found == null) throw new Error('no status yet')
      return found
    })
    // the whole mark and word inside its column, not cut at the column's edge
    const listed = status.closest('[data-testid="method-row"]')!
    let seat: HTMLElement = status
    while (seat.parentElement !== null && seat.parentElement !== listed) seat = seat.parentElement
    expect(status.getBoundingClientRect().right).toBeLessThanOrEqual(
      seat.getBoundingClientRect().right + 0.5,
    )
    await expect
      .element(page.getByTestId('method-details'))
      .toHaveAttribute('data-setup', 'incomplete')
    await expect
      .element(page.getByTestId('method-missing'))
      .toHaveAttribute('data-missing', 'server,clientSecret')
    // nothing to switch it into service by
    expect(page.getByRole('tab', { name: '已启用' }).elements()).toHaveLength(0)

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

  // Arranging doors and deciding what one believes are two grants: whoever
  // may only arrange them renames a door, and is offered neither a new one
  // nor its settings.
  it('lets whoever may only arrange doors rename one, and nothing it believes', async () => {
    const update = vi.fn(() => Effect.succeed({ version: 5 }))
    const row = cas({ status: 'disabled', setup: 'incomplete' })
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () =>
            Effect.succeed(doorsOf([provider(), row], { canManage: true, canManageTrust: false })),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          getAuthProvider: () =>
            Effect.succeed(detail(row, { missing: [{ kind: 'field', key: 'server' }] })),
          updateAuthProvider: update,
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    // the kinds and the door's own settings are both in, so whatever is shut
    // now is shut by permission rather than by waiting
    await expect
      .element(page.getByTestId('method-missing'))
      .toHaveAttribute('data-missing', 'server')
    await expect.element(page.getByRole('textbox', { name: '服务地址' })).toBeInTheDocument()
    expect(page.getByRole('textbox', { name: '服务地址' }).element()).toBeDisabled()
    expect(page.getByRole('button', { name: '新增登录方式' }).query()).toBeNull()
    const details = page.getByTestId('method-details')
    await details.getByRole('textbox', { name: '名称' }).fill('学校统一认证')
    await details.getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({
      params: { providerId: CAS_ID },
      payload: { version: 4, name: '学校统一认证' },
    })
  })

  const settled = {
    config: { server: 'https://cas.example.edu' },
    secrets: [{ key: 'clientSecret', stored: true, readable: true }],
  }

  it('asks for a secret that no longer decrypts to be typed again, apart from what is missing', async () => {
    const update = vi.fn(() => Effect.succeed({ version: 5 }))
    const serving = cas({ setup: 'incomplete' })
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([provider(), serving])),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          getAuthProvider: () =>
            Effect.succeed(
              detail(serving, {
                ...settled,
                missing: [{ kind: 'secret-unreadable', key: 'clientSecret' }],
                secrets: [{ key: 'clientSecret', stored: true, readable: false }],
              }),
            ),
          updateAuthProvider: update,
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    await expect
      .element(page.getByTestId('method-unreadable'))
      .toHaveAttribute('data-keys', 'clientSecret')
    // nothing is missing: the box holds a value, one this deployment cannot open
    expect(page.getByTestId('method-missing').query()).toBeNull()
    await vi.waitFor(() =>
      expect(
        document
          .querySelector('input[name="entrance-clientSecret"]')
          ?.getAttribute('data-readable'),
      ).toBe('false'),
    )
    await page.getByLabelText('客户端密钥', { exact: false }).first().fill('n3w')
    await page.getByTestId('method-details').getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({
      params: { providerId: CAS_ID },
      payload: { version: 4, values: { clientSecret: 'n3w' } },
    })
  })

  it('keeps what a way in service needs', async () => {
    const serving = cas()
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([provider(), serving])),
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
    // empty, but not blank: marks stand where the value would be
    expect(
      (document.querySelector('input[name="entrance-clientSecret"]') as HTMLInputElement)
        .placeholder,
    ).not.toBe('')
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
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([provider(), resting])),
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

  it('shows a box only while another asks for it, and folds the rest away', async () => {
    const update = vi.fn(() => Effect.succeed({ version: 5 }))
    const row = cas({ status: 'disabled' })
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([provider(), row])),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [shapedKind] }),
          // the detail echoes what each box holds, defaults included
          getAuthProvider: () =>
            Effect.succeed(
              detail(row, { config: { source: 'principal', renew: 'false', skew: '60' } }),
            ),
          updateAuthProvider: update,
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    const source = page.getByRole('combobox', { name: '身份来源' })
    await expect.element(source).toBeInTheDocument()
    expect(document.querySelector('input[name="entrance-attribute"]')).toBeNull()

    await source.click()
    await page.getByRole('option', { name: '属性' }).click()
    const attribute = page.getByRole('textbox', { name: '属性名' })
    await expect.element(attribute).toBeInTheDocument()
    await attribute.fill('employeeNumber')

    // folded until opened; opened, they hold their defaults
    await expect
      .element(page.getByTestId('method-advanced'))
      .toHaveAttribute('data-state', 'closed')
    await page.getByTestId('method-advanced').getByRole('button').first().click()
    await expect.element(page.getByRole('spinbutton', { name: '时钟容差' })).toHaveValue(60)
    await page.getByRole('checkbox', { name: '每次都重新登录' }).click()

    await page.getByTestId('method-details').getByRole('button', { name: '保存' }).click()
    await vi.waitFor(() => expect(update).toHaveBeenCalledTimes(1))
    expect(update).toHaveBeenCalledWith({
      params: { providerId: CAS_ID },
      payload: {
        version: 4,
        values: { source: 'attribute', attribute: 'employeeNumber', renew: 'true' },
      },
    })
  })

  it('is deleted only after saying what it ends', async () => {
    const remove = vi.fn(() => Effect.succeed({ ok: true as const }))
    const row = cas()
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([provider(), row])),
          listAuthProviderKinds: () => Effect.succeed({ kinds: [casKind] }),
          getAuthProvider: () =>
            Effect.succeed(
              detail(row, { usage: { bindings: 37, sessions: 12, sessionsByUserType: [] } }),
            ),
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

  it('keeps a long callback address inside the sheet, and copies it whole', async () => {
    const address =
      'https://qualy.school.edu.cn/api/auth/cas/campus-unified-identity-authentication/callback'
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined)
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([cas()])),
          getAuthProvider: () => Effect.succeed(detail(cas(), { callbackUrl: address })),
        }),
      ),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    const shown = page.getByTestId('method-callback')
    await expect.element(shown).toHaveTextContent(address)
    const sheet = page.getByTestId('method-sheet').element().getBoundingClientRect()
    expect(shown.element().getBoundingClientRect().right).toBeLessThanOrEqual(sheet.right)
    await page.getByTestId('copy-value').click()
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith(address))
    write.mockRestore()
  })

  it('shows the platform\u2019s own door as not to be deleted, and says why', async () => {
    await renderScreen({
      client: fakeClient(
        stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([provider({ isSystem: true })])),
          getAuthProvider: () => Effect.succeed(detail(provider({ isSystem: true }))),
        }),
      ),
      route: `/admin/login-methods?provider=${PASSWORD_ID}`,
      children: <LoginMethodsPage />,
    })
    await expect.element(page.getByRole('heading', { name: '账号密码' })).toBeInTheDocument()
    // there, and not to be pressed, with the reason on hover
    await expect.element(page.getByTestId('method-delete')).toBeDisabled()
    await page.getByTestId('method-delete-refused').hover()
    await expect.element(page.getByRole('tooltip')).toBeVisible()
    // the kind in words, not its code
    await expect
      .element(page.getByTestId('method-sheet').getByText('邮箱密码').first())
      .toBeVisible()
  })
})

describe('the sign-in page, as its administrator arranges it', () => {
  const four = [
    provider(),
    cas({ id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', code: 'a', name: 'A 门' }),
    cas({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', code: 'b', name: 'B 门' }),
    cas({ prominence: 'secondary' }),
  ]

  it('lists the main ways in apart from the rest, each group in its order', async () => {
    await renderScreen({
      client: fakeClient(stubs({ listAuthProviders: () => Effect.succeed(doorsOf(four)) })),
      route: '/admin/login-methods',
      children: <LoginMethodsPage />,
    })
    const primary = page.getByTestId('method-group-primary')
    const secondary = page.getByTestId('method-group-secondary')
    await expect.element(primary).toHaveAttribute('data-count', '3')
    await expect.element(secondary).toHaveAttribute('data-count', '1')
    expect(
      [...primary.element().querySelectorAll('[data-testid="method-row"]')].map((row) =>
        row.getAttribute('data-code'),
      ),
    ).toEqual(['password', 'a', 'b'])
  })

  it('moves a way in between the groups from a phone, and not into a full one', async () => {
    await page.viewport(390, 844)
    try {
      const arrange = vi.fn(() => Effect.succeed({ ok: true as const }))
      await renderScreen({
        client: fakeClient(
          stubs({
            listAuthProviders: () => Effect.succeed(doorsOf(four)),
            setAuthProviderOrder: arrange,
          }),
        ),
        route: '/admin/login-methods',
        children: <LoginMethodsPage />,
      })
      // the main ways in are full: the other one cannot join them
      const other = page.getByTestId('method-group-secondary').getByTestId('method-order')
      await other.click()
      await expect.element(page.getByTestId('method-to-primary')).toHaveAttribute('data-disabled')
      await userEvent.keyboard('{Escape}')
      // one of them can leave for the rest
      await page.getByTestId('method-group-primary').getByTestId('method-order').first().click()
      await page.getByTestId('method-to-secondary').click()
      await expect.poll(() => arrange.mock.calls.length).toBe(1)
      expect(arrange.mock.calls[0]).toEqual([
        {
          payload: {
            primary: [
              'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
              'ffffffff-ffff-4fff-8fff-ffffffffffff',
            ],
            secondary: [CAS_ID, PASSWORD_ID],
          },
        },
      ])
    } finally {
      await page.viewport(1280, 800)
    }
  })

  it('recommends only a main way in, and draws a door by the icon chosen for it', async () => {
    const recommend = vi.fn(() => Effect.succeed({ ok: true as const }))
    const icon = vi.fn(() =>
      Effect.succeed({
        icon: { kind: 'builtin' as const, key: 'github' as const },
        iconChosen: true,
      }),
    )
    await renderScreen({
      client: fakeClient({
        ...stubs({
          listAuthProviders: () => Effect.succeed(doorsOf(four)),
          getAuthProvider: () => Effect.succeed(detail(four[3]!)),
          setRecommendedAuthProvider: recommend,
        }),
        loginIcon: { setProviderIcon: icon },
      }),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    const shown = page.getByTestId('method-shown')
    await expect.element(shown).toHaveAttribute('data-prominence', 'secondary')
    // one of the rest cannot be the one recommended
    await expect.element(shown.getByTestId('method-recommend')).toBeDisabled()
    await shown.getByRole('button', { name: '更换' }).click()
    await page.getByTestId('icon-picker').getByRole('button', { name: 'GitHub' }).click()
    await expect.poll(() => icon.mock.calls.length).toBe(1)
    expect(icon.mock.calls[0]).toEqual([
      { params: { providerId: CAS_ID }, payload: { icon: { kind: 'builtin', key: 'github' } } },
    ])
    expect(recommend).not.toHaveBeenCalled()
  })

  it('takes an image for each ground, the dark one only beside a light one', async () => {
    const icon = vi.fn(() =>
      Effect.succeed({
        icon: { kind: 'image' as const, version: 'v1', onDark: null },
        iconChosen: true,
      }),
    )
    await renderScreen({
      client: fakeClient({
        ...stubs({
          listAuthProviders: () => Effect.succeed(doorsOf(four)),
          getAuthProvider: () => Effect.succeed(detail(four[3]!)),
        }),
        loginIcon: { setProviderIcon: icon },
      }),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    const shown = page.getByTestId('method-shown')
    // the door as it stands on either ground
    await expect.element(shown.getByTestId('method-icon-light')).toBeVisible()
    await expect.element(shown.getByTestId('method-icon-dark')).toBeVisible()
    await shown.getByRole('button', { name: '更换' }).click()
    // nothing of its own yet: nothing to put a dark version beside
    await expect
      .element(page.getByTestId('icon-slot-dark').getByRole('button', { name: '上传图片' }))
      .toBeDisabled()
    // an SVG goes as it is, for the light ground
    const markup =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1H0z"/></svg>'
    await userEvent.upload(
      page.getByTestId('icon-file'),
      new File([markup], 'mark.svg', { type: 'image/svg+xml' }),
    )
    await expect.poll(() => icon.mock.calls.length).toBe(1)
    expect(icon.mock.calls[0]).toEqual([
      {
        params: { providerId: CAS_ID },
        payload: { icon: { kind: 'svg', markup, surface: 'light' } },
      },
    ])
  })

  it('takes away the dark version and keeps the light one', async () => {
    const icon = vi.fn(() =>
      Effect.succeed({
        icon: { kind: 'image' as const, version: 'v1', onDark: null },
        iconChosen: true,
      }),
    )
    const drawn = {
      ...four[3]!,
      icon: { kind: 'image' as const, version: 'v1', onDark: 'v2' },
      iconChosen: true,
    }
    await renderScreen({
      client: fakeClient({
        ...stubs({
          listAuthProviders: () => Effect.succeed(doorsOf([...four.slice(0, 3), drawn])),
          getAuthProvider: () => Effect.succeed(detail(drawn)),
        }),
        loginIcon: { setProviderIcon: icon },
      }),
      route: `/admin/login-methods?provider=${CAS_ID}`,
      children: <LoginMethodsPage />,
    })
    const shown = page.getByTestId('method-shown')
    await shown.getByRole('button', { name: '更换' }).click()
    await page.getByTestId('icon-slot-dark').getByRole('button', { name: '移除' }).click()
    await expect.poll(() => icon.mock.calls.length).toBe(1)
    expect(icon.mock.calls[0]).toEqual([
      { params: { providerId: CAS_ID }, payload: { icon: { kind: 'clear', surface: 'dark' } } },
    ])
  })
})
