import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { PeoplePickerViewContext } from '@qualy/ui-contract'
import PeoplePicker from '../src/client/iam/PeoplePicker.tsx'
import PeoplePickerView from '../src/client/iam/PeoplePickerView.tsx'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// Choosing people, as a table with a head.
//
// What is pinned is what a reader relies on: the columns are named, the unit
// a person stands at is the end of the way down that is shown, the pages are
// numbered and any of them can be gone to, a whole page can be taken in and
// let go without touching what was chosen on another, the head stays where
// it is while the rows move under it, and a phone gets lines rather than a
// table squeezed into a third of its width.

const ROOT = '22222222-2222-4222-8222-222222222201'
const COLLEGE = '22222222-2222-4222-8222-222222222202'
const MAJOR = '22222222-2222-4222-8222-222222222203'
const klass = (n: number) => `22222222-2222-4222-8222-2222222233${String(n).padStart(2, '0')}`
const person = (n: number) => `44444444-4444-4444-8444-4444444444${String(n).padStart(2, '0')}`

const nodes = [
  { orgNodeId: ROOT, name: '示例大学', parentId: null, orgTypeId: 'school', userCount: 0 },
  { orgNodeId: COLLEGE, name: '软件学院', parentId: ROOT, orgTypeId: 'college', userCount: 0 },
  { orgNodeId: MAJOR, name: '软件工程', parentId: COLLEGE, orgTypeId: 'major', userCount: 0 },
  ...[1, 2, 3].map((n) => ({
    orgNodeId: klass(n),
    name: `软件工程 2301${n} 班`,
    parentId: MAJOR,
    orgTypeId: 'class',
    userCount: 0,
  })),
]

interface Request {
  query?: Record<string, string>
}

/** twenty people to a page, fifty-three of them, standing in three classes */
const listUsers = vi.fn((request: Request) => {
  const at = Number(request.query?.['page'] ?? '1')
  const from = (at - 1) * 20
  const count = Math.max(0, Math.min(20, 53 - from))
  return Effect.succeed({
    items: Array.from({ length: count }, (_, index) => {
      const n = from + index
      return {
        id: person(n),
        businessNo: `20230${String(n).padStart(3, '0')}`,
        email: null,
        emailVerifiedAt: null,
        displayName: `同学${n}`,
        status: 'active',
        version: 1,
        userType: { id: 'type-student', code: 'student', name: '本科生' },
        primaryOrgNode: { id: klass((n % 3) + 1), name: `软件工程 2301${(n % 3) + 1} 班` },
        manageable: true,
      }
    }),
    nextCursor: null,
    total: 53,
    page: at,
    pageSize: 20,
  })
})

const world = () =>
  fakeClient({
    app: { getManifest: () => Effect.succeed(emptyManifest()) },
    identity: {
      getUserOptions: () =>
        Effect.succeed({
          truncated: false,
          nodes,
          orgTypes: [],
          userTypes: [{ id: 'type-student', code: 'student', name: '本科生' }],
        }),
      listUsers,
    },
  })

/** what the caller holds, read back through the page */
function Harness({ start = [] }: { start?: readonly string[] }) {
  const [value, setValue] = useState<readonly string[]>(start)
  return (
    <div style={{ display: 'flex', height: 520, flexDirection: 'column' }}>
      <output data-testid="held">{value.join(',')}</output>
      <PeoplePicker context={{ value, onChange: setValue }} />
    </div>
  )
}

const held = () => (document.querySelector('[data-testid="held"]')?.textContent ?? '').split(',')

const rows = () => [...document.querySelectorAll<HTMLElement>('[data-testid="people-picker-row"]')]

afterEach(async () => {
  listUsers.mockClear()
  await page.viewport(1280, 800)
})

describe('the people picker', () => {
  it('lays people out as a table with a head, each ending at their own unit', async () => {
    await renderScreen({ client: world(), children: <Harness /> })
    await expect.poll(() => rows().length).toBe(20)

    const table = page.getByRole('table')
    for (const name of ['姓名', '学工号', '所属组织', '类型']) {
      await expect.element(table.getByRole('columnheader', { name })).toBeVisible()
    }
    // the way down to the unit they stand at, from under the unit being
    // looked at - the top one, which is the same for everybody
    const first = rows()[0]!.textContent ?? ''
    expect(first).toContain('软件工程 23011 班')
    expect(first).toContain('软件学院')
    expect(first).not.toContain('示例大学')
  })

  it('numbers the pages and goes to any of them', async () => {
    await renderScreen({ client: world(), children: <Harness /> })
    const pager = page.getByTestId('people-picker-pager')
    await expect.element(pager).toHaveAttribute('data-pages', '3')
    await pager.getByRole('button', { name: '3', exact: true }).click()
    await expect.poll(() => listUsers.mock.calls.at(-1)?.[0].query?.['page']).toBe('3')
    await expect.element(pager).toHaveAttribute('data-page', '3')
    await expect.poll(() => rows().length).toBe(13)
  })

  it('takes a whole page in and lets it go, and keeps what was chosen elsewhere', async () => {
    // somebody chosen on a page that is not on screen
    await renderScreen({ client: world(), children: <Harness start={[person(40)]} /> })
    await expect.poll(() => rows().length).toBe(20)

    await page.getByRole('checkbox', { name: '全选本页' }).click()
    await expect.poll(() => held().length).toBe(21)
    expect(held()).toContain(person(40))
    await expect
      .element(page.getByTestId('people-picker-count'))
      .toHaveAttribute('data-count', '21')

    await page.getByRole('checkbox', { name: '全选本页' }).click()
    await expect.poll(() => held()).toEqual([person(40)])

    // and everybody at once
    await page.getByRole('button', { name: '清空' }).click()
    await expect.element(page.getByTestId('people-picker-count')).toHaveAttribute('data-count', '0')
  })

  it('chooses somebody by a press anywhere on their row', async () => {
    await renderScreen({ client: world(), children: <Harness /> })
    await expect.poll(() => rows().length).toBe(20)
    // their number, which is nowhere near the box
    await page.getByText('20230004', { exact: true }).click()
    await expect.poll(() => held()).toEqual([person(4)])
    await expect.element(page.getByRole('checkbox', { name: '同学4' })).toBeChecked()
    // and again, which lets them go
    await page.getByText('20230004', { exact: true }).click()
    await expect.poll(() => held()).toEqual([''])
  })

  it('holds the head in place while the rows scroll under it', async () => {
    await renderScreen({ client: world(), children: <Harness /> })
    await expect.poll(() => rows().length).toBe(20)
    const scroller = document.querySelector<HTMLElement>('[data-slot="table-container"]')!
    // the head's cells are what hold still
    const head = document.querySelector<HTMLElement>('[data-slot="table-head"]')!
    expect(scroller.scrollHeight).toBeGreaterThan(scroller.clientHeight)
    scroller.scrollTop = scroller.scrollHeight
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(0)
    expect(head.getBoundingClientRect().top).toBeCloseTo(scroller.getBoundingClientRect().top, 0)
    // and the count and the pages below the list never moved with it
    const foot = page.getByTestId('people-picker-pager').element().getBoundingClientRect()
    expect(foot.bottom).toBeLessThanOrEqual(window.innerHeight)
  })

  it('draws a phone a line per person rather than a table', async () => {
    await page.viewport(390, 844)
    await renderScreen({ client: world(), children: <Harness /> })
    await expect.poll(() => rows().length).toBe(20)
    expect(page.getByRole('table').elements()).toHaveLength(0)
    expect(page.getByRole('list', { name: '人员' }).elements()).toHaveLength(1)
    // the tree is a field that opens it, and a whole page is still one press
    await expect.element(page.getByTestId('people-picker-unit')).toBeVisible()
    await page.getByRole('checkbox', { name: '全选本页' }).click()
    await expect.poll(() => held().length).toBe(20)
  })
})

describe('the people picker over a list read forwards', () => {
  const view = (over: Partial<PeoplePickerViewContext> = {}): PeoplePickerViewContext => ({
    nodes: [],
    userTypes: [],
    rows: [
      { id: 'a', displayName: '甲', businessNo: '1', userTypeName: null },
      { id: 'b', displayName: '乙', businessNo: '2', userTypeName: null },
    ],
    nodeId: null,
    scope: 'subtree',
    userTypeId: '',
    search: '',
    value: [],
    pending: false,
    hasPrevious: true,
    hasNext: true,
    position: 2,
    onNodeChange: () => {},
    onScopeChange: () => {},
    onUserTypeChange: () => {},
    onSearchChange: () => {},
    onToggle: () => {},
    onPrevious: () => {},
    onNext: () => {},
    onRetry: () => {},
    ...over,
  })

  it('walks back and on from the page it is on, in the numbered strip’s own controls', async () => {
    const onNext = vi.fn()
    const onPrevious = vi.fn()
    await renderScreen({
      client: world(),
      children: <PeoplePickerView context={view({ onNext, onPrevious })} />,
    })
    const pager = page.getByTestId('people-picker-pager')
    await expect.element(pager).toHaveAttribute('data-page', '2')
    await pager.getByRole('button', { name: '下一页' }).click()
    expect(onNext).toHaveBeenCalledTimes(1)
    await pager.getByRole('button', { name: '上一页' }).click()
    expect(onPrevious).toHaveBeenCalledTimes(1)
  })

  it('offers no whole-page choice to a caller that cannot take one', async () => {
    await renderScreen({ client: world(), children: <PeoplePickerView context={view()} /> })
    await expect.element(page.getByRole('checkbox', { name: '甲' })).toBeVisible()
    expect(page.getByRole('checkbox', { name: '全选本页' }).elements()).toHaveLength(0)
    // nor a unit column for rows that name none
    expect(page.getByRole('columnheader', { name: '所属组织' }).elements()).toHaveLength(0)
  })
})
