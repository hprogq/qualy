import UserRoleGrantsPage from '../src/client/UserRoleGrantsPage.tsx'
import { lazy, type ReactNode } from 'react'
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
  roleStatus: 'active',
  target: {
    kind: 'org-node',
    orgNodeId: BRANCH_NODE_ID,
    orgNodeName: '软件学院',
    coverage: 'subtree',
  },
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
    target: {
      kind: 'org-node',
      orgNodeId: BRANCH_NODE_ID,
      orgNodeName: '2023级',
      coverage: 'self',
    },
    manageable: true,
    scoped: true,
    resource: { namespace: 'assessment', type: 'batch', id: BATCH_ID },
    validUntil: '2026-09-30T16:00:00.000Z',
    ...over,
  })

const roleOptions = [
  { id: ROLE_ID, code: 'counsellor', name: '辅导员', kind: 'org' as const, administrator: false },
]

// a reader who may give roles across the tenant and in the tree
const everywhere = { tenant: true, organization: true }

const open = (
  stubs: Record<string, unknown> = {},
  manifest: Partial<ReturnType<typeof emptyManifest>> = {},
  registry: Parameters<typeof renderScreen>[0]['registry'] = {},
) =>
  renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed({ ...emptyManifest(), ...manifest }) },
      access: {
        getUserRoleGrants: () =>
          Effect.succeed({ grants: [grant(), confined()], grantable: everywhere }),
        getRoleGrantOptions: () => Effect.succeed({ roles: roleOptions, refused: [] }),
        ...stubs,
      },
    }),
    registry,
    route: `/organization/users/${USER_ID}/role-grants`,
    path: '/organization/users/:userId/role-grants',
    children: <UserRoleGrantsPage />,
  })

const rows = () => [...document.querySelectorAll('[data-testid="grant-row"]')]

describe('the grants of one person', () => {
  it('marks a grant whose role has been disabled', async () => {
    await open({
      getUserRoleGrants: () =>
        Effect.succeed({
          grants: [grant(), grant({ id: 'g-off', roleName: '班主任', roleStatus: 'disabled' })],
        }),
    })
    await vi.waitFor(() => expect(rows().length).toBe(2))
    expect(rows().map((row) => row.getAttribute('data-role-status'))).toEqual([
      'active',
      'disabled',
    ])
    // still revocable: a disabled role is still held until somebody takes it back
    expect(rows()[1]!.querySelector('button')).not.toBeNull()
  })

  it('keeps organizational and confined grants apart, and offers revoke only to the first', async () => {
    await open()
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
    await open(
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
    await open({ deleteRoleGrant: revoke })
    await vi.waitFor(() => expect(rows().length).toBe(2))
    await page.getByRole('button', { name: '撤销' }).click()
    await page.getByRole('alertdialog').getByRole('button', { name: '撤销' }).click()
    await vi.waitFor(() => expect(revoke).toHaveBeenCalledOnce())
    expect(revoke).toHaveBeenCalledWith({ params: { grantId: 'g-org' } })
  })

  it('grants at the tenant when that is the chosen scope', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created-grant' }))
    await open({ createRoleGrant: create })
    // the form is a dialog over the section, opened from its heading
    await page.getByRole('button', { name: '授予角色' }).click()
    await page.getByRole('radio', { name: '整个租户' }).click()
    await expect.element(page.getByRole('combobox', { name: '角色' })).toBeInTheDocument()
    // the one office on offer is the answer already
    await expect.element(page.getByRole('button', { name: '授予', exact: true })).toBeEnabled()
    await page.getByRole('button', { name: '授予', exact: true }).click()
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: { userId: USER_ID, roleId: ROLE_ID, target: { kind: 'tenant' } },
    })
  })

  // The administrator role carries everything: it is never chosen for the
  // reader, and giving it is asked once more.
  it('never chooses the administrator role for the reader, and asks before giving it', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created-grant' }))
    await open({
      getRoleGrantOptions: () =>
        Effect.succeed({
          roles: [
            {
              id: OTHER_ROLE_ID,
              code: 'admin',
              name: '系统管理员',
              kind: 'tenant' as const,
              administrator: true,
            },
          ],
          refused: [],
        }),
      createRoleGrant: create,
    })
    await page.getByRole('button', { name: '授予角色' }).click()
    await page.getByRole('radio', { name: '整个租户' }).click()
    const role = page.getByRole('combobox', { name: '角色' })
    await expect.element(role).toBeEnabled()
    await expect.element(page.getByRole('button', { name: '授予', exact: true })).toBeDisabled()
    await role.click()
    await page.getByRole('option', { name: /系统管理员/ }).click()
    await page.getByRole('button', { name: '授予', exact: true }).click()
    const asked = page.getByRole('alertdialog')
    await expect.element(asked).toBeVisible()
    expect(create).not.toHaveBeenCalled()
    await asked.getByTestId('confirm-accept').click()
    await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
    expect(create).toHaveBeenCalledWith({
      payload: { userId: USER_ID, roleId: OTHER_ROLE_ID, target: { kind: 'tenant' } },
    })
  })

  it('asks the server again for the unit picked, and sends the unit it asked about', async () => {
    const create = vi.fn(() => Effect.succeed({ id: 'created-grant' }))
    const options = vi.fn(() => Effect.succeed({ roles: roleOptions, refused: [] }))
    const asked = vi.fn()
    // the unit picker is the organization owner's contribution; here a
    // stand-in that offers one unit
    function OneUnitPicker({ context }: { context: OrgNodePickerContext }) {
      asked(context)
      return (
        <button
          type="button"
          onClick={() =>
            context.onChange([BRANCH_NODE_ID], [{ id: BRANCH_NODE_ID, name: '分部', path: '分部' }])
          }
        >
          分部
        </button>
      )
    }
    await open(
      { getRoleGrantOptions: options, createRoleGrant: create },
      unitPicker.manifest,
      unitPicker.registry(OneUnitPicker),
    )
    // the form is a dialog over the section, opened from its heading, and
    // asks for a unit first: that is where nearly every office is held
    await page.getByRole('button', { name: '授予角色' }).click()
    await expect.element(page.getByTestId('grant-form')).toHaveAttribute('data-scope', 'org-node')
    // the form's one answer: the picker is asked to mark it on every row
    await vi.waitFor(() =>
      expect(asked).toHaveBeenCalledWith(expect.objectContaining({ single: true, radio: true })),
    )
    // no unit yet: nothing is asked for, and nothing can be granted
    await expect.element(page.getByRole('button', { name: '授予', exact: true })).toBeDisabled()
    expect(options).not.toHaveBeenCalled()
    await page.getByRole('button', { name: '分部' }).click()
    await page.getByRole('radio', { name: '仅该组织' }).click()
    await vi.waitFor(() =>
      expect(options).toHaveBeenCalledWith({
        query: { userId: USER_ID, target: 'org-node', orgNodeId: BRANCH_NODE_ID, coverage: 'self' },
      }),
    )
    await page.getByRole('button', { name: '授予', exact: true }).click()
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
    await open({
      getUserRoleGrants: () =>
        Effect.succeed({ grants: [grant()], grantable: { tenant: true, organization: false } }),
      getRoleGrantOptions: () => Effect.succeed({ roles: [], refused: [] }),
    })
    await page.getByRole('button', { name: '授予角色' }).click()
    // one scope the reader may give in: no choice of scope is offered
    await expect.element(page.getByTestId('grant-form')).toHaveAttribute('data-scope', 'tenant')
    expect(page.getByRole('radio', { name: '指定组织' }).query()).toBeNull()
    await expect
      .element(page.getByTestId('grant-nothing-offered'))
      .toHaveAttribute('data-summary', 'none')
    // one scope, nothing in it: only the way out stays
    expect(page.getByRole('button', { name: '授予', exact: true }).query()).toBeNull()
  })

  it('names the offices that do not fit here, with why, when none can be given', async () => {
    await open(
      {
        getRoleGrantOptions: () =>
          Effect.succeed({
            roles: [],
            refused: [
              { ...refusedRole('monitor', '班长'), refusal: 'org-type' as const },
              { ...refusedRole('mentor', '辅导员'), refusal: 'user-type' as const },
            ],
          }),
      },
      unitPicker.manifest,
      unitPicker.registry(PickBranch),
    )
    await page.getByRole('button', { name: '授予角色' }).click()
    await page.getByRole('button', { name: '分部' }).click()
    const nothing = page.getByTestId('grant-nothing-offered')
    await expect.element(nothing).toHaveAttribute('data-refused', '2')
    expect(
      [...nothing.element().querySelectorAll('[data-testid="grant-refused"]')].map((row) =>
        row.getAttribute('data-refusal'),
      ),
    ).toEqual(['org-type', 'user-type'])
    // two reasons, so the line above them names neither: each row says its own
    await expect.element(nothing).toHaveAttribute('data-summary', 'mixed')
    // the office names are the tenant's own words, read as they are
    expect(nothing.element().textContent).toContain('班长')
  })

  // The sentence above the refused offices follows their reasons: a kind of
  // person no unit admits is not solved by picking another unit.
  it('sends the reader to another unit only when the unit is what refuses', async () => {
    await open(
      {
        getRoleGrantOptions: () =>
          Effect.succeed({
            roles: [],
            refused: [
              { ...refusedRole('monitor', '班长'), refusal: 'user-type' as const },
              { ...refusedRole('mentor', '学委'), refusal: 'user-type' as const },
            ],
          }),
      },
      unitPicker.manifest,
      unitPicker.registry(PickBranch),
    )
    await page.getByRole('button', { name: '授予角色' }).click()
    await page.getByRole('button', { name: '分部' }).click()
    const nothing = page.getByTestId('grant-nothing-offered')
    await expect.element(nothing).toHaveAttribute('data-summary', 'user-type')
    // another unit may still have something, so the form stays open to it
    await expect.element(page.getByRole('button', { name: '授予', exact: true })).toBeDisabled()
  })

  it('names the office the reader holds and may not appoint, with why', async () => {
    await open(
      {
        getRoleGrantOptions: () =>
          Effect.succeed({
            roles: [],
            refused: [{ ...refusedRole('monitor', '学院管理员'), refusal: 'authority' as const }],
          }),
      },
      unitPicker.manifest,
      unitPicker.registry(PickBranch),
    )
    await page.getByRole('button', { name: '授予角色' }).click()
    await page.getByRole('button', { name: '分部' }).click()
    const nothing = page.getByTestId('grant-nothing-offered')
    await expect.element(nothing).toHaveAttribute('data-summary', 'authority')
    await expect
      .element(nothing.getByTestId('grant-refused'))
      .toHaveAttribute('data-refusal', 'authority')
  })

  it('keeps only the way out when nothing the form can change would help', async () => {
    await open({
      getUserRoleGrants: () =>
        Effect.succeed({ grants: [grant()], grantable: { tenant: true, organization: false } }),
      getRoleGrantOptions: () =>
        Effect.succeed({
          roles: [],
          refused: [{ ...refusedRole('monitor', '班长'), refusal: 'person-disabled' as const }],
        }),
    })
    await page.getByRole('button', { name: '授予角色' }).click()
    const nothing = page.getByTestId('grant-nothing-offered')
    await expect.element(nothing).toHaveAttribute('data-summary', 'person-disabled')
    // a press that can never be pressed is not left standing beside the way out
    expect(page.getByRole('button', { name: '授予', exact: true }).query()).toBeNull()
    await page.getByRole('button', { name: '关闭', exact: true }).click()
    await expect.poll(() => document.querySelector('[data-testid="grant-form"]')).toBeNull()
  })

  it('offers what can be given and shows what cannot beneath it, choosing nothing for the reader', async () => {
    await open(
      {
        getRoleGrantOptions: () =>
          Effect.succeed({
            roles: [
              ...roleOptions,
              {
                id: OTHER_ROLE_ID,
                code: 'head',
                name: '班主任',
                kind: 'org' as const,
                administrator: false,
              },
            ],
            refused: [{ ...refusedRole('monitor', '班长'), refusal: 'org-type' as const }],
          }),
      },
      unitPicker.manifest,
      unitPicker.registry(PickBranch),
    )
    await page.getByRole('button', { name: '授予角色' }).click()
    await page.getByRole('button', { name: '分部' }).click()
    const role = page.getByRole('combobox', { name: '角色' })
    await expect.element(role).toBeEnabled()
    // two on offer: the reader says which, and nothing is given until then
    await expect.element(page.getByRole('button', { name: '授予', exact: true })).toBeDisabled()
    await role.click()
    await expect.element(page.getByRole('option', { name: /辅导员/ })).toBeVisible()
    await expect
      .element(page.getByRole('option', { name: /班长/ }))
      .toHaveAttribute('data-combobox-disabled', 'true')
    await page.getByRole('option', { name: /班主任/ }).click()
    await expect.element(page.getByRole('button', { name: '授予', exact: true })).toBeEnabled()
  })

  it('offers no form to a reader who may give a role nowhere', async () => {
    await open({
      getUserRoleGrants: () =>
        Effect.succeed({ grants: [grant()], grantable: { tenant: false, organization: false } }),
    })
    await vi.waitFor(() => expect(rows().length).toBe(1))
    expect(page.getByRole('button', { name: '授予角色' }).query()).toBeNull()
  })
})

const OTHER_ROLE_ID = '33333333-3333-4333-8333-333333333333'

const refusedRole = (code: string, name: string) => ({
  id: `44444444-4444-4444-8444-${code === 'monitor' ? '000000000001' : '000000000002'}`,
  code,
  name,
  kind: 'org' as const,
})

function PickBranch({ context }: { context: OrgNodePickerContext }) {
  return (
    <button
      type="button"
      onClick={() =>
        context.onChange([BRANCH_NODE_ID], [{ id: BRANCH_NODE_ID, name: '分部', path: '分部' }])
      }
    >
      分部
    </button>
  )
}

/** the organization owner's picker, stood in for by whatever the test hands it */
const unitPicker = {
  manifest: { slots: { 'iam/org-node-picker': [{ id: 'auth/org-node-picker', order: 0 }] } },
  registry: (component: (props: { context: OrgNodePickerContext }) => ReactNode) => ({
    slots: {
      'iam/org-node-picker': {
        'auth/org-node-picker': lazy(() => Promise.resolve({ default: component })),
      },
    },
  }),
}
