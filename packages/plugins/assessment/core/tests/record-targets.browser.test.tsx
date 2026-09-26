import { RecordTargets, type RecordTarget } from '../src/client/record/RecordTargets.tsx'
import { lazy } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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

  // Side by side at a desk, the people it comes to stand in columns, and a
  // number at the end of one column never runs into the name that starts
  // the next.
  it('keeps a gutter between the columns of people it comes to', async () => {
    await page.viewport(1440, 900)
    try {
      const many = Array.from({ length: 12 }, (_, n) => ({
        id: `p-${n}`,
        userId: `u-${n}`,
        displayName: n % 2 === 0 ? '欧阳子轩·阿卜杜拉·买买提艾力' : '司马明哲',
        businessNo: `2023${String(n).padStart(6, '0')}`,
        userTypeId: UNDERGRADUATE,
        anchorNodeId: CLASS_A,
        anchorPath: 'r.a.a1',
        status: 'active',
      }))
      await open({ listParticipants: () => Effect.succeed({ items: many, nextCursor: null }) })
      await page.getByRole('button', { name: '按组织选择' }).click()
      await page.getByTestId('record-units').getByRole('checkbox', { name: '软件 2301 班' }).click()
      await expect
        .poll(() => document.querySelectorAll('[data-testid="unit-roster-row"]').length)
        .toBe(12)

      const lines = new Map<number, HTMLElement[]>()
      for (const row of document.querySelectorAll<HTMLElement>('[data-testid="unit-roster-row"]')) {
        const top = Math.round(row.getBoundingClientRect().top)
        lines.set(top, [...(lines.get(top) ?? []), row])
      }
      const shared = [...lines.values()].filter((line) => line.length > 1)
      expect(shared.length).toBeGreaterThan(0)
      for (const line of shared) {
        for (let at = 1; at < line.length; at += 1) {
          const before = line[at - 1]!.lastElementChild!.getBoundingClientRect()
          const after = line[at]!.firstElementChild!.getBoundingClientRect()
          expect(after.left - before.right).toBeGreaterThanOrEqual(12)
        }
      }
    } finally {
      await page.viewport(1280, 800)
    }
  })

  // Stacked on a phone, the tree, the kinds and the people it comes to are
  // one column the dialog's body scrolls through, each below the last -
  // squeezed to the body's height, they were drawn over one another.
  it('stacks the units, the kinds and the people without laying one over another', async () => {
    await page.viewport(390, 700)
    try {
      const many = Array.from({ length: 20 }, (_, n) => ({
        id: `p-${n}`,
        userId: `u-${n}`,
        displayName: `同学${n}`,
        businessNo: `2023${String(n).padStart(4, '0')}`,
        userTypeId: UNDERGRADUATE,
        anchorNodeId: CLASS_A,
        anchorPath: 'r.a.a1',
        status: 'active',
      }))
      await open({
        listParticipants: () => Effect.succeed({ items: many, nextCursor: 'more' }),
      })
      await page.getByRole('button', { name: '按组织选择' }).click()
      await page.getByTestId('record-units').getByRole('checkbox', { name: '软件 2301 班' }).click()
      await expect.element(page.getByTestId('unit-roster')).toBeVisible()

      // where each one's drawing ends, which is past its own box when the
      // box was squeezed smaller than what it holds
      const end = (element: Element) => element.getBoundingClientRect().top + element.scrollHeight
      const tree = page.getByRole('region', { name: '组织单位' }).element()
      const kinds = page.getByRole('group', { name: '人员类型' }).element()
      const people = page.getByTestId('unit-roster').element()
      expect(kinds.getBoundingClientRect().top).toBeGreaterThanOrEqual(end(tree) - 1)
      expect(people.getBoundingClientRect().top).toBeGreaterThanOrEqual(end(kinds) - 1)
    } finally {
      await page.viewport(1280, 800)
    }
  })
})

// Who the chosen units come to, when that cannot be read or is nobody: an
// answer where the names would be, and after a failure the way to ask
// again - it was one grey line of the error's words, with no way on.
describe('the people a unit finding comes to, when there are none to show', () => {
  it('says the read failed and reads again when asked', async () => {
    let calls = 0
    const people = vi.fn((_request: Request) => {
      calls += 1
      return calls === 1
        ? Effect.fail(apiError('SERVICE_UNAVAILABLE', {}))
        : Effect.succeed({
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
          })
    })
    await open({ listParticipants: people })
    await page.getByRole('button', { name: '按组织选择' }).click()
    await page.getByTestId('record-units').getByRole('checkbox', { name: '软件 2301 班' }).click()
    const state = page.getByTestId('unit-roster-state')
    await expect.element(state).toHaveAttribute('data-kind', 'failed')
    await state.getByRole('button', { name: '重试' }).click()
    await expect.element(page.getByTestId('unit-roster-row')).toBeVisible()
    expect(page.getByTestId('unit-roster-state').elements()).toHaveLength(0)
  })

  it('says nobody in the round stands in the chosen units', async () => {
    await open({ listParticipants: () => Effect.succeed({ items: [], nextCursor: null }) })
    await page.getByRole('button', { name: '按组织选择' }).click()
    await page.getByTestId('record-units').getByRole('checkbox', { name: '软件 2301 班' }).click()
    await expect
      .element(page.getByTestId('unit-roster-state'))
      .toHaveAttribute('data-kind', 'empty')
  })
})
