import UserOrganizationPage from '../src/client/iam/UserOrganizationPage.tsx'
import OrgNodePicker from '../src/client/iam/OrgNodePicker.tsx'
import { lazy } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// Where one person stands, and the one act that changes it.
//
// Two things this screen has to get right, neither of which the api can:
// that a rung of the chain says what KIND of unit it is - a column of bare
// names only reads to somebody who already knows the naming - and that the
// destination is chosen in the product's own unit picker, contributed
// through its surface rather than written again here. The second is why the
// unit somebody already stands in, and a unit this reader may not
// administer, are drawn and refused rather than missing.

const USER_ID = '66666666-6666-4666-8666-666666666666'
const TYPE_ID = '11111111-1111-4111-8111-111111111111'
const SCHOOL = '44444444-4444-4444-8444-444444444441'
const COLLEGE_TYPE = '44444444-4444-4444-8444-444444444442'
const CLASS_TYPE = '44444444-4444-4444-8444-444444444443'
const ROOT = '77777777-7777-4777-8777-777777777777'
const COLLEGE = '88888888-8888-4888-8888-888888888888'
const KLASS = '88888888-8888-4888-8888-888888888889'
const SIBLING = '88888888-8888-4888-8888-888888888890'

const detail = {
  user: {
    id: USER_ID,
    businessNo: '20231001',
    email: null,
    emailVerifiedAt: null,
    displayName: '王五',
    status: 'active',
    version: 3,
    userType: { id: TYPE_ID, code: 'student', name: '学生' },
    primaryOrgNode: { id: KLASS, name: '软件2301班' },
    manageable: true,
  },
  orgPath: [
    { id: ROOT, name: '示例大学', orgTypeName: '学校' },
    { id: COLLEGE, name: '软件学院', orgTypeName: '学院' },
    { id: KLASS, name: '软件2301班', orgTypeName: '班级' },
  ],
  // a student stands in a class and nowhere else, which is the rule the
  // write enforces and the picker has to draw
  placement: { mode: 'allow-list', orgTypeIds: [CLASS_TYPE] },
  roles: [],
  lastSignInAt: null,
}

const unit = (over: {
  orgNodeId: string
  name: string
  parentId: string | null
  depth: number
  orgTypeId: string
  manageable: boolean
}) => over

const open = (stubs: Record<string, unknown> = {}) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            slots: { 'iam/org-node-picker': [{ id: 'auth/org-node-picker', order: 0 }] },
          }),
      },
      identity: {
        getUser: () => Effect.succeed(detail),
        getUserOptions: () =>
          Effect.succeed({
            truncated: false,
            orgTypes: [
              { id: SCHOOL, code: 'school', name: '学校' },
              { id: COLLEGE_TYPE, code: 'college', name: '学院' },
              { id: CLASS_TYPE, code: 'class', name: '班级' },
            ],
            userTypes: [],
            nodes: [
              // the top is readable and not this reader's to place into
              unit({
                orgNodeId: ROOT,
                name: '示例大学',
                parentId: null,
                depth: 0,
                orgTypeId: SCHOOL,
                manageable: false,
              }),
              unit({
                orgNodeId: COLLEGE,
                name: '软件学院',
                parentId: ROOT,
                depth: 1,
                orgTypeId: COLLEGE_TYPE,
                manageable: true,
              }),
              unit({
                orgNodeId: KLASS,
                name: '软件2301班',
                parentId: COLLEGE,
                depth: 2,
                orgTypeId: CLASS_TYPE,
                manageable: true,
              }),
              unit({
                orgNodeId: SIBLING,
                name: '软件2302班',
                parentId: COLLEGE,
                depth: 2,
                orgTypeId: CLASS_TYPE,
                manageable: true,
              }),
            ],
          }),
        ...stubs,
      },
    }),
    // the picker arrives the way the host delivers it, by surface
    registry: {
      slots: {
        'iam/org-node-picker': {
          'auth/org-node-picker': lazy(async () => ({ default: OrgNodePicker })),
        },
      } as never,
    },
    path: '/organization/users/:userId/organization',
    route: `/organization/users/${USER_ID}/organization`,
    children: <UserOrganizationPage />,
  })

describe('where one person stands', () => {
  it('spells the chain out as kind and name, a rung to a line', async () => {
    await open()
    const chain = page.getByTestId('org-chain')
    await expect.element(chain).toBeVisible()
    const rungs = [...(chain.element() as HTMLElement).querySelectorAll('[data-org-node]')]
    expect(rungs.map((rung) => rung.getAttribute('data-org-node'))).toEqual([ROOT, COLLEGE, KLASS])
    // the kind is stated, not left to whoever recognises the name
    const words = (chain.element() as HTMLElement).textContent ?? ''
    for (const kind of ['学校', '学院', '班级']) expect(words).toContain(kind)
  })

  it('draws the units it will not take, saying why, and sends the one it will', async () => {
    const moved = vi.fn(() => Effect.succeed({ ok: true }))
    await open({ setUserPlacement: moved })
    // the tree is behind a press: this page is a record, not a tree
    await page.getByTestId('move-open').click()
    const picker = page.getByTestId('move-picker')
    await expect.element(picker).toBeVisible()

    // Shown and refused rather than absent: a tree with holes in it is
    // harder to read than one that says which rows cannot be taken. Three
    // different answers, and the one about the KIND of unit is the rule the
    // write would otherwise refuse after the press.
    await vi.waitFor(() => {
      const box = picker.element() as HTMLElement
      expect(box.querySelector(`[data-picker-barred="${KLASS}"]`)).not.toBeNull()
      // a college is not a class, whoever may administer it
      expect(box.querySelector(`[data-picker-barred="${COLLEGE}"]`)).not.toBeNull()
      expect(box.querySelector(`[data-picker-barred="${ROOT}"]`)).not.toBeNull()
      // and the sibling class, which this reader may use, carries no mark
      expect(box.querySelector(`[data-picker-barred="${SIBLING}"]`)).toBeNull()
    })

    // nothing to move until somewhere is chosen
    const chosen = page.getByTestId('move-choose')
    await expect.element(chosen).toBeDisabled()
    await page.getByText('软件2302班').click()
    await expect.element(chosen).toBeEnabled()
    await chosen.click()

    // re-anchoring every authority that follows the unit is asked about first
    const ask = page.getByRole('alertdialog')
    await expect.element(ask).toBeVisible()
    expect(moved).not.toHaveBeenCalled()
    await ask.getByRole('button', { name: '移动至该组织' }).click()

    // the version read is carried back, so a stale page loses rather than wins
    await vi.waitFor(() =>
      expect(moved).toHaveBeenCalledWith({
        params: { userId: USER_ID },
        payload: { primaryOrgNodeId: SIBLING, version: 3 },
      }),
    )
  })
})
