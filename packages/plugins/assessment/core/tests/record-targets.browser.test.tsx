import { RecordTargets, type RecordTarget } from '../src/client/record/RecordTargets.tsx'
import { lazy } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// Naming who an administrative finding is about by unit, as a recorder who
// may record in this round and may not browse the directory: the units and
// the kinds of people come from this round's own roster, drawn by the view
// that asks for no permission of its own.

const OrgNodePickerView = lazy(() => import('@qualy/plugin-auth/client/iam/OrgNodePickerView'))

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const COLLEGE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01'
const CLASS_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02'
const UNDERGRADUATE = '99999999-9999-4999-8999-999999999991'
const GRADUATE = '99999999-9999-4999-8999-999999999992'

interface Request {
  params?: Record<string, string>
  query?: Record<string, unknown>
}

const open = (
  stubs: Record<string, unknown>,
  onChange: (target: RecordTarget | null) => void = () => {},
) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            // only the drawings that ask for nothing: this reader holds no
            // directory permission, so the directory's own pickers are not
            // delivered to them at all
            slots: {
              'iam/org-node-picker-view': [{ id: 'auth/org-node-picker-view', order: 0 }],
            },
          }),
      },
      assessment: {
        listRosterUnits: () =>
          Effect.succeed({
            units: [
              { id: COLLEGE, name: '软件学院', parentId: null },
              { id: CLASS_A, name: '软件 2301 班', parentId: COLLEGE },
            ],
            userTypes: [
              { id: GRADUATE, name: '研究生' },
              { id: UNDERGRADUATE, name: '本科生' },
            ],
          }),
        listParticipants: () =>
          Effect.succeed({
            items: [
              {
                id: 'p-1',
                userId: 'u-1',
                displayName: '周予安',
                businessNo: '20230001',
                userTypeId: UNDERGRADUATE,
                anchorNodeId: CLASS_A,
                anchorPath: 'r.a.a1',
                status: 'active',
              },
            ],
            nextCursor: null,
          }),
        ...stubs,
      },
    }),
    children: <RecordTargets batchId={BATCH_ID} value={null} onChange={onChange} />,
    registry: {
      slots: {
        'iam/org-node-picker-view': { 'auth/org-node-picker-view': OrgNodePickerView },
      },
    },
  })

describe('choosing who a finding is about by unit', () => {
  it('draws this round’s units and kinds without the directory, and shows who they come to', async () => {
    const people = vi.fn((_request: Request) =>
      Effect.succeed({
        items: [
          {
            id: 'p-1',
            userId: 'u-1',
            displayName: '周予安',
            businessNo: '20230001',
            userTypeId: UNDERGRADUATE,
            anchorNodeId: CLASS_A,
            anchorPath: 'r.a.a1',
            status: 'active',
          },
        ],
        nextCursor: null,
      }),
    )
    const chosen = vi.fn((_target: RecordTarget | null) => {})
    await open({ listParticipants: people }, chosen)

    await page.getByRole('button', { name: '按组织选择' }).click()
    const units = page.getByTestId('record-units')
    await units.getByRole('checkbox', { name: '软件 2301 班' }).click()
    // the people it comes to, read from this round's roster
    await expect.element(page.getByTestId('unit-roster')).toBeVisible()
    await expect.element(page.getByText('周予安')).toBeVisible()
    expect([people.mock.calls.at(-1)![0].query?.['orgNodeIds']].flat()).toEqual([CLASS_A])

    // the kinds the round admitted its people as, narrowed to one
    await units.getByRole('checkbox', { name: '本科生' }).click()
    await expect.poll(() => people.mock.calls.at(-1)![0].query?.['userTypeId']).toBe(UNDERGRADUATE)

    await page.getByRole('button', { name: '已选择 1 个组织范围' }).click()
    expect(chosen).toHaveBeenLastCalledWith({
      kind: 'organization',
      orgNodeIds: [CLASS_A],
      userTypeIds: [UNDERGRADUATE],
    })
  })

  // The tree is read over the people a finding by this reader would reach,
  // which is recording authority alone, and comes with the kinds of its
  // units: a round of a thousand units is narrowed by kind, as the
  // directory's own tree is.
  it('draws the units a finding would reach, named as a block and narrowed by kind', async () => {
    const asked = vi.fn((_request: Request) =>
      Effect.succeed({
        units: [
          { id: COLLEGE, name: '软件学院', parentId: null, orgTypeId: 'college' },
          { id: CLASS_A, name: '软件 2301 班', parentId: COLLEGE, orgTypeId: 'class' },
        ],
        orgTypes: [
          { id: 'class', name: '班级' },
          { id: 'college', name: '学院' },
        ],
        userTypes: [{ id: UNDERGRADUATE, name: '本科生' }],
      }),
    )
    await open({ listRosterUnits: asked })
    await page.getByRole('button', { name: '按组织选择' }).click()
    const block = page.getByRole('region', { name: '组织单位' })
    await expect.element(block.getByRole('checkbox', { name: /软件学院/ })).toBeVisible()
    expect(asked.mock.calls.at(-1)![0].query).toEqual({ reading: 'recordable' })

    await block.getByRole('combobox', { name: '组织类型' }).click()
    await page.getByRole('option', { name: '班级' }).click()
    await expect.element(block.getByRole('checkbox', { name: /软件 2301 班/ })).toBeVisible()
    expect(block.getByRole('checkbox', { name: /软件学院/ }).elements()).toHaveLength(0)
  })

  it('offers no choice of kind when the round admitted only one', async () => {
    await open({
      listRosterUnits: () =>
        Effect.succeed({
          units: [{ id: COLLEGE, name: '软件学院', parentId: null }],
          userTypes: [{ id: UNDERGRADUATE, name: '本科生' }],
        }),
    })
    await page.getByRole('button', { name: '按组织选择' }).click()
    const units = page.getByTestId('record-units')
    await expect.element(units.getByRole('checkbox', { name: '软件学院' })).toBeVisible()
    expect(units.getByRole('checkbox', { name: '本科生' }).elements()).toHaveLength(0)
  })
})
