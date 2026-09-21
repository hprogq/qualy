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
  isSystem: false,
  sortOrder: 0,
  version: 4,
  audience: { mode: 'unrestricted' },
  ...over,
})

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
