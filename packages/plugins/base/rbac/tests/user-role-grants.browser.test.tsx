import UserRoleGrantsPage from '../src/client/UserRoleGrantsPage.tsx'
import { lazy } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { OrgNodePickerContext, ResourceGrantContext } from '@qualy/ui-contract'
import type { ApiResult } from '@qualy/web-runtime/api'
import type { accessApi } from '../src/client/api.ts'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The grants one person holds, on their own page: the organizational ones
// with the form and the revoke press, the confined ones as something to
// read - explained by whoever owns the object when a presenter is
// registered, named plainly when none is - and never revoked from here.

type GrantDto = ApiResult<typeof accessApi, 'access', 'getUserRoleGrants'>['grants'][number]

const USER_ID = '66666666-6666-4666-8666-666666666666'
const ROLE_ID = '22222222-2222-4222-8222-222222222222'
const BRANCH_NODE_ID = '88888888-8888-4888-8888-888888888888'
const BATCH_ID = '11111111-1111-4111-8111-111111111111'

const grant = (over: Partial<GrantDto> = {}): GrantDto => ({
  id: 'g-org',
  userId: USER_ID,
  userDisplayName: '张三',
  roleId: ROLE_ID,
  roleCode: 'counsellor',
  roleName: '辅导员',
  roleKind: 'org',
  target: { kind: 'org-node', orgNodeId: BRANCH_NODE_ID, orgNodeName: '软件学院', coverage: 'subtree' },
  manageable: true,
  scoped: false,
  resource: null,
  validFrom: null,
  validUntil: null,
  ...over,
})

const confined = (over: Partial<GrantDto> = {}): GrantDto =>
  grant({
    id: 'g-batch',
    roleCode: 'reviewer',
    roleName: '审核员',
    target: { kind: 'org-node', orgNodeId: BRANCH_NODE_ID, orgNodeName: '2023级', coverage: 'self' },
    manageable: true,
    scoped: true,
    resource: { namespace: 'assessment', type: 'batch', id: BATCH_ID },
    validUntil: '2026-09-30T16:00:00.000Z',
    ...over,
  })

const roleOptions = [{ id: ROLE_ID, code: 'counsellor', name: '辅导员', kind: 'org' as const }]

const open = (
  stubs: Record<string, unknown> = {},
  manifest: Partial<ReturnType<typeof emptyManifest>> = {},
  registry: Parameters<typeof renderScreen>[0]['registry'] = {},
) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), ...manifest }) },
      access: {
        getUserRoleGrants: () => Effect.succeed({ grants: [grant(), confined()] }),
        getRoleGrantOptions: () => Effect.succeed({ roles: roleOptions }),
        ...stubs,
      },
    } as never),
    registry,
    route: `/organization/users/${USER_ID}/role-grants`,
    path: '/organization/users/:userId/role-grants',
    children: <UserRoleGrantsPage />,
  })

const rows = () => [...document.querySelectorAll('[data-testid="grant-row"]')]

describe('the grants of one person', () => {
  it('keeps organizational and confined grants apart, and offers revoke only to the first', async () => {
    open()
    await vi.waitFor(() => expect(rows().length).toBe(2))
    expect(rows().map((row) => row.getAttribute('data-grant-kind'))).toEqual([
      'organizational',
      'confined',
    ])
    // the organizational row carries the press; the confined one does not,
    // whatever its manageable flag says - it is withdrawn where it was made
    expect(rows()[0]!.querySelector('button')).not.toBeNull()
    expect(rows()[1]!.querySelector('button')).toBeNull()
    // nobody has registered a presenter for assessment batches here, so the
    // kind is named plainly, and the window it holds in is still said
    await expect.element(page.getByTestId('grant-origin-plain')).toBeVisible()
    await expect.element(page.getByTestId('grant-until')).toBeVisible()
  })

  it('renders exactly the presenter registered for the object kind, with the grant', async () => {
    const seen = vi.fn()
    function BatchGrantWords({ context }: { context: ResourceGrantContext }) {
      seen(context.grant)
      return <span data-testid="grant-origin-batch">来自批次</span>
    }
    open(
      {},
      {
        collections: {
          'iam/resource-grant-presenters': [
            {
              id: 'assessment/batch-grant',
              namespace: 'assessment',
              type: 'batch',
              renderer: 'assessment/batch-grant',
            },
            // a presenter for another kind must not be asked about this one
            {
              id: 'course/grant',
              namespace: 'course',
              type: 'course',
              renderer: 'course/grant',
            },
          ],
        },
      },
      {
        slots: {
          'iam/resource-grant-renderer': {
            'assessment/batch-grant': lazy(() => Promise.resolve({ default: BatchGrantWords })),
            'course/grant': lazy(() =>
              Promise.resolve({
                default: () => <span data-testid="grant-origin-course">wrong</span>,
              }),
            ),
          },
        },
      },
    )
    await expect.element(page.getByTestId('grant-origin-batch')).toBeVisible()
    expect(document.querySelector('[data-testid="grant-origin-course"]')).toBeNull()
    expect(document.querySelector('[data-testid="grant-origin-plain"]')).toBeNull()
    expect(seen).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'g-batch',
        resource: { namespace: 'assessment', type: 'batch', id: BATCH_ID },
        validUntil: '2026-09-30T16:00:00.000Z',
      }),
    )
  })

  it('asks before revoking, and revokes the one grant asked about', async () => {
    const revoke = vi.fn(() => Effect.succeed({ ok: true as const }))
    open({ deleteRoleGrant: revoke })
    await vi.waitFor(() => expect(rows().length).toBe(2))
    await page.getByRole('button', { name: '撤销' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '撤销' }).click()
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledOnce())
    expect(revoke).toHaveBeenCalledWith({ params: { grantId: 'g-org' } })
  })

  it('grants at the tenant when that is the chosen scope', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created-grant' }))
    open({ createRoleGrant: create })
    await expect.element(page.getByRole('combobox', { name: '角色' })).toBeInTheDocument()
    await page.getByRole('button', { name: '授予' }).click()
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: { userId: USER_ID, roleId: ROLE_ID, target: { kind: 'tenant' } },
    })
  })

  it('asks the server again for the unit picked, and sends the unit it asked about', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created-grant' }))
    const options = vi.fn(() => Effect.succeed({ roles: roleOptions }))
    // the unit picker is the organization owner's contribution; here a
    // stand-in that offers one unit
    function OneUnitPicker({ context }: { context: OrgNodePickerContext }) {
      return (
        <button type="button" onClick={() => context.onChange([BRANCH_NODE_ID])}>
          分部
        </button>
      )
    }
    open(
      { getRoleGrantOptions: options, createRoleGrant: create },
      { slots: { 'iam/org-node-picker': [{ id: 'auth/org-node-picker', order: 0 }] } },
      {
        slots: {
          'iam/org-node-picker': {
            'auth/org-node-picker': lazy(() => Promise.resolve({ default: OneUnitPicker })),
          },
        },
      },
    )
    await expect.element(page.getByRole('combobox', { name: '生效范围' })).toBeInTheDocument()
    await page.getByRole('combobox', { name: '生效范围' }).click()
    await page.getByRole('option', { name: '某个组织节点' }).click()
    // no unit yet: nothing is asked for, and nothing can be granted
    await expect.element(page.getByRole('button', { name: '授予' })).toBeDisabled()
    await page.getByRole('button', { name: '分部' }).click()
    await page.getByRole('combobox', { name: '覆盖' }).click()
    await page.getByRole('option', { name: '仅该节点' }).click()
    await vi.waitFor(() =>
      expect(options).toHaveBeenCalledWith({
        query: { userId: USER_ID, target: 'org-node', orgNodeId: BRANCH_NODE_ID, coverage: 'self' },
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
    open({ getRoleGrantOptions: () => Effect.succeed({ roles: [] }) })
    await expect.element(page.getByTestId('grant-nothing-offered')).toBeInTheDocument()
    await expect.element(page.getByRole('button', { name: '授予' })).toBeDisabled()
  })
})
