import { lazy } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { AddPeopleDialog } from '../src/client/roster/AddPeopleDialog.tsx'
import { ImportDialog } from '../src/client/roster/ImportDialog.tsx'
import { PlacementDialog } from '../src/client/roster/PlacementDialog.tsx'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The roster's dialogs as somebody running a round meets them.
//
// Choosing people is a table the dialog is given over to: the list reaches
// the dialog's foot rather than stopping a band short of it, every person
// ends at the unit they stand at, and the pages are numbered. A dialog with
// more in it than the window holds scrolls its middle, and its title and its
// keys stay where they were put.

const PeoplePickerView = lazy(() => import('@qualy/plugin-auth/client/iam/PeoplePickerView'))
const OrgNodePickerView = lazy(() => import('@qualy/plugin-auth/client/iam/OrgNodePickerView'))

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const ROOT = '22222222-2222-4222-8222-222222222201'
const COLLEGE = '22222222-2222-4222-8222-222222222202'
const klass = (n: number) => `22222222-2222-4222-8222-2222222233${String(n).padStart(2, '0')}`
const person = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, '0')}`

interface Request {
  query?: Record<string, unknown>
}

const units = [
  { id: ROOT, name: '示例大学', parentId: null, depth: 0, orgTypeId: 'school' },
  { id: COLLEGE, name: '软件学院', parentId: ROOT, depth: 1, orgTypeId: 'college' },
  ...Array.from({ length: 30 }, (_, n) => ({
    id: klass(n),
    name: `软件工程 23${String(n).padStart(2, '0')} 班`,
    parentId: COLLEGE,
    depth: 2,
    orgTypeId: 'class',
  })),
]

/** forty-five people who could be added, the first of them on the roster already */
const candidates = vi.fn((request: Request) => {
  const at = Number(request.query?.['page'] ?? '1')
  const from = (at - 1) * 20
  return Effect.succeed({
    items: Array.from({ length: Math.min(20, 45 - from) }, (_, index) => {
      const n = from + index
      return {
        userId: person(n),
        displayName: `同学${n}`,
        businessNo: `2023${String(n).padStart(4, '0')}`,
        userTypeName: '本科生',
        orgNodeId: klass(n % 30),
        roster: n === 0 ? 'active' : null,
      }
    }),
    total: 45,
    page: at,
    pageSize: 20,
  })
})

const difference = (n: number) => ({
  participantId: person(n),
  displayName: `同学${n}`,
  businessNo: `2023${String(n).padStart(4, '0')}`,
  standing: 'changed',
  unavailable: null,
  changes: ['placement'],
  frozen: {
    units: [
      { id: ROOT, name: '示例大学' },
      { id: klass(1), name: '软件工程 2301 班' },
    ],
    userType: { id: 'type', name: '本科生' },
  },
  current: {
    units: [
      { id: ROOT, name: '示例大学' },
      { id: klass(2), name: '软件工程 2302 班' },
    ],
    userType: { id: 'type', name: '本科生' },
  },
  currentBeyondReach: false,
  canSync: true,
  observedFingerprint: `fingerprint-${n}`,
})

const open = (children: React.ReactNode) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            slots: {
              'iam/org-node-picker-view': [{ id: 'auth/org-node-picker-view', order: 0 }],
              'iam/people-picker-view': [{ id: 'auth/people-picker-view', order: 0 }],
            },
          }),
      },
      assessment: {
        listScopeOptions: () => Effect.succeed({ nodes: units, orgTypes: [] }),
        listUserTypeOptions: () =>
          Effect.succeed({ userTypes: [{ id: 'type', code: 'student', name: '本科生' }] }),
        listParticipantCandidates: candidates,
        previewImport: () => Effect.succeed({ candidates: 12 }),
        listParticipantPlacements: () =>
          Effect.succeed({
            items: Array.from({ length: 20 }, (_, n) => difference(n)),
            nextCursor: 'more',
            changedTotal: 40,
            unavailableTotal: 0,
          }),
      },
    }),
    children,
    registry: {
      slots: {
        'iam/org-node-picker-view': { 'auth/org-node-picker-view': OrgNodePickerView },
        'iam/people-picker-view': { 'auth/people-picker-view': PeoplePickerView },
      },
    },
  })

const one = (selector: string): HTMLElement => {
  const found = document.querySelectorAll<HTMLElement>(selector)
  if (found.length !== 1) throw new Error(`${selector}: ${found.length} on the page`)
  return found[0]!
}

const inView = (element: Element) => {
  const box = element.getBoundingClientRect()
  return box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight + 0.5
}

const rows = () => [...document.querySelectorAll('[data-testid="people-picker-row"]')]

afterEach(async () => {
  candidates.mockClear()
  await page.viewport(1280, 800)
})

describe('adding people to the roster', () => {
  it('gives the dialog over to the list, down to its foot', async () => {
    await page.viewport(1440, 900)
    await open(
      <AddPeopleDialog
        batchId={BATCH_ID}
        open
        pending={false}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    )
    await expect.poll(() => rows().length).toBe(20)
    const body = one('[data-slot="dialog-body"]').getBoundingClientRect()
    const picker = one('[data-testid="people-picker"]').getBoundingClientRect()
    // the picker fills the body it stands in, rather than a height of its own
    expect(body.bottom - picker.bottom).toBeLessThan(8)
    expect(picker.height).toBeGreaterThan(body.height - 16)
  })

  // the unit is the column a reader tells two people of one name apart by,
  // and at a desk it has room for a class's whole name beside the path
  it('gives the unit column room at a desk', async () => {
    await page.viewport(1440, 900)
    await open(
      <AddPeopleDialog
        batchId={BATCH_ID}
        open
        pending={false}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    )
    await expect.poll(() => rows().length).toBe(20)
    const unit = page.getByRole('columnheader', { name: '所属组织' }).element()
    expect(unit.getBoundingClientRect().width).toBeGreaterThanOrEqual(220)
  })

  it('pages the people by number, each ending at the unit they stand at', async () => {
    await open(
      <AddPeopleDialog
        batchId={BATCH_ID}
        open
        pending={false}
        onAdd={() => {}}
        onClose={() => {}}
      />,
    )
    await expect.poll(() => rows().length).toBe(20)
    // spelled from the units the reader manages, down to their own class
    expect(rows()[3]!.textContent).toContain('软件工程 2303 班')

    const pager = page.getByTestId('people-picker-pager')
    await expect.element(pager).toHaveAttribute('data-pages', '3')
    await pager.getByRole('button', { name: '2', exact: true }).click()
    await expect.poll(() => candidates.mock.calls.at(-1)?.[0].query?.['page']).toBe('2')
    await expect.element(pager).toHaveAttribute('data-page', '2')
  })

  it('takes a page in without the one already on the roster, and adds them all', async () => {
    const added = vi.fn()
    await open(
      <AddPeopleDialog batchId={BATCH_ID} open pending={false} onAdd={added} onClose={() => {}} />,
    )
    await expect.poll(() => rows().length).toBe(20)
    await page.getByRole('checkbox', { name: '全选本页' }).click()
    await expect
      .element(page.getByTestId('people-picker-count'))
      .toHaveAttribute('data-count', '19')
    await page.getByRole('button', { name: '添加 19 人' }).click()
    expect(added).toHaveBeenCalledTimes(1)
    const chosen = added.mock.calls[0]![0] as readonly string[]
    expect(chosen).toHaveLength(19)
    expect(chosen).not.toContain(person(0))
  })
})

describe('a roster dialog that outgrows the window', () => {
  it('keeps the placement check’s title and keys in view while its list scrolls', async () => {
    await open(
      <PlacementDialog
        batchId={BATCH_ID}
        open
        pending={false}
        onDecide={() => {}}
        onClose={() => {}}
      />,
    )
    await expect.element(page.getByTestId('placement-dialog')).toBeVisible()
    await expect
      .poll(() => document.querySelectorAll('[data-testid="placement-difference"]').length)
      .toBe(20)
    const panel = one('[data-slot="dialog-content"]')
    const body = one('[data-slot="dialog-body"]')
    expect(body.scrollHeight).toBeGreaterThan(body.clientHeight)
    body.scrollTop = body.scrollHeight
    await expect.poll(() => body.scrollTop).toBeGreaterThan(0)
    expect(panel.scrollTop).toBe(0)
    expect(inView(one('[data-slot="dialog-title"]'))).toBe(true)
    expect(inView(one('[data-slot="dialog-footer"]'))).toBe(true)
  })

  it('keeps the import’s title and keys in view on a phone', async () => {
    await page.viewport(390, 700)
    await open(
      <ImportDialog
        batchId={BATCH_ID}
        open
        pending={false}
        onImport={() => {}}
        onClose={() => {}}
      />,
    )
    await expect.element(page.getByTestId('import-units')).toBeVisible()
    const panel = one('[data-slot="dialog-content"]')
    const body = one('[data-slot="dialog-body"]')
    body.scrollTop = body.scrollHeight
    expect(panel.scrollTop).toBe(0)
    expect(panel.scrollHeight).toBeLessThanOrEqual(panel.clientHeight + 1)
    expect(inView(one('[data-slot="dialog-title"]'))).toBe(true)
    expect(inView(page.getByRole('button', { name: '导入', exact: true }).element())).toBe(true)
  })
})
