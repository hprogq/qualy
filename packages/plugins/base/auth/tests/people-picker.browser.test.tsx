import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import type { PeoplePickerViewContext } from '@qualy/ui-contract'
import PeoplePicker from '../src/client/iam/PeoplePicker.tsx'
import PeoplePickerView from '../src/client/iam/PeoplePickerView.tsx'
import zhCN from '../src/client/locales/zh-CN.ts'
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

/** twenty people to a page, `total` of them, standing in three classes */
const pageOf = (at: number, total = 53) => {
  const from = (at - 1) * 20
  const count = Math.max(0, Math.min(20, total - from))
  return {
    items: Array.from({ length: count }, (_, index) => {
      const n = from + index
      return {
        id: person(n),
        businessNo: `20230${String(n).padStart(3, '0')}`,
        email: null,
        emailVerifiedAt: null,
        displayName: `同学${n}`,
        status: 'active' as const,
        version: 1,
        userType: { id: 'type-student', code: 'student', name: '本科生' },
        primaryOrgNode: { id: klass((n % 3) + 1), name: `软件工程 2301${(n % 3) + 1} 班` },
        manageable: true,
      }
    }),
    nextCursor: null,
    total,
    page: at,
    pageSize: 20,
  }
}

const listUsers = vi.fn((request: Request) =>
  Effect.succeed(pageOf(Number(request.query?.['page'] ?? '1'))),
)

const world = (list: (request: Request) => Effect.Effect<unknown> = listUsers) =>
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
      listUsers: list,
    },
  })

/** an answer that arrives when the test says so */
const held_back = () => {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  return { gate, release: () => release() }
}

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

  // Somebody on a slow line presses a page and sees it taken at once; the
  // rows they were reading stay until the next ones arrive, and the strip
  // holds still rather than being pressed again.
  it('turns to the page asked for at once, and waits on it without blanking the table', async () => {
    const slow = held_back()
    const list = (request: Request) => {
      const at = Number(request.query?.['page'] ?? '1')
      const answer = Effect.succeed(pageOf(at))
      return at === 2 ? Effect.promise(() => slow.gate).pipe(Effect.andThen(answer)) : answer
    }
    await renderScreen({ client: world(list), children: <Harness /> })
    await expect.poll(() => rows().length).toBe(20)

    const pager = page.getByTestId('people-picker-pager')
    await pager.getByRole('button', { name: '2', exact: true }).click()
    await expect.element(pager).toHaveAttribute('data-page', '2')
    const box = page.getByTestId('people-picker-list')
    await expect.element(box).toHaveAttribute('aria-busy', 'true')
    await expect.element(box).toHaveAttribute('data-waiting', 'page')
    await expect.element(pager.getByRole('button', { name: '3', exact: true })).toBeDisabled()
    expect(rows()).toHaveLength(20)
    expect(rows()[0]!.textContent).toContain('同学0')

    slow.release()
    await expect.element(box).toHaveAttribute('aria-busy', 'false')
    await expect.poll(() => rows()[0]!.textContent).toContain('同学20')
    await expect.element(pager.getByRole('button', { name: '3', exact: true })).toBeEnabled()
  })

  // A changed question has not been counted yet: the old count and the old
  // pages would send a press to a page of the new question nobody has seen.
  it('offers no pages of the question before while a changed one is answered', async () => {
    const slow = held_back()
    const list = (request: Request) => {
      const answer = Effect.succeed(pageOf(Number(request.query?.['page'] ?? '1')))
      return request.query?.['search'] === undefined
        ? answer
        : Effect.promise(() => slow.gate).pipe(Effect.andThen(Effect.succeed(pageOf(1, 7))))
    }
    await renderScreen({ client: world(list), children: <Harness start={[person(40)]} /> })
    await expect.poll(() => rows().length).toBe(20)
    await expect
      .element(page.getByTestId('people-picker-count'))
      .toHaveAttribute('data-elsewhere', '1')

    await page.getByRole('textbox', { name: '姓名或学工号' }).fill('同学1')
    const box = page.getByTestId('people-picker-list')
    await expect.element(box).toHaveAttribute('data-waiting', 'question')
    expect(page.getByTestId('people-picker-pager').elements()).toHaveLength(0)
    await expect
      .element(page.getByTestId('people-picker-count'))
      .toHaveAttribute('data-elsewhere', '0')

    slow.release()
    await expect.poll(() => rows().length).toBe(7)
    await expect.element(box).toHaveAttribute('aria-busy', 'false')
    await expect.element(page.getByTestId('people-picker-pager')).toHaveAttribute('data-total', '7')
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

describe('the people picker over long words', () => {
  // somebody with a long name, already taken, of a long kind, in a class
  // four levels down
  const LONG = 'Maximilian Alexander Fitzgerald-Worthington'
  const KIND = '本科生（中外合作办学留学生）'
  const CLASS = klass(1)
  const context = (): PeoplePickerViewContext => ({
    nodes: nodes.map((node) => ({
      id: node.orgNodeId,
      name: node.name,
      parentId: node.parentId,
    })),
    userTypes: [],
    rows: [
      {
        id: 'long',
        displayName: LONG,
        businessNo: '2023000001',
        userTypeName: KIND,
        unitId: CLASS,
      },
      {
        id: 'short',
        displayName: '王',
        businessNo: '2023000002',
        userTypeName: '研究生',
        unitId: CLASS,
      },
    ],
    nodeId: null,
    scope: 'subtree',
    userTypeId: '',
    search: '',
    value: [],
    disabled: ['long'],
    disabledLabel: '已在名单中',
    pending: false,
    hasPrevious: false,
    hasNext: false,
    onNodeChange: () => {},
    onScopeChange: () => {},
    onUserTypeChange: () => {},
    onSearchChange: () => {},
    onToggle: () => {},
    onPrevious: () => {},
    onNext: () => {},
    onRetry: () => {},
  })

  /** nothing inside it is cut short */
  const whole = (element: Element) =>
    [element, ...element.querySelectorAll('*')].every(
      (inside) => inside.scrollWidth <= inside.clientWidth + 1,
    )

  it('keeps the unit’s own name whole beside a long name and a long kind', async () => {
    await page.viewport(1280, 800)
    // as wide as the dialog it stands in hands the list
    await renderScreen({
      client: world(),
      children: (
        <div style={{ display: 'flex', width: 900, height: 520, flexDirection: 'column' }}>
          <PeoplePickerView context={context()} />
        </div>
      ),
    })
    await expect.poll(() => rows().length).toBe(2)

    const unitHead = page.getByRole('columnheader', { name: '所属组织' }).element()
    expect(unitHead.getBoundingClientRect().width).toBeGreaterThanOrEqual(150)

    for (const row of rows()) {
      const path = row.querySelector('[data-testid="unit-path"]')!
      const cell = path.closest('td')!.getBoundingClientRect()
      const own = path.querySelector(
        `[data-path-step="${Number(path.getAttribute('data-steps')) - 1}"]`,
      )!
      // the class itself, on the line that shows and not cut short
      const step = own.getBoundingClientRect()
      expect(step.left).toBeGreaterThanOrEqual(cell.left)
      expect(step.right).toBeLessThanOrEqual(cell.right)
      expect(step.top).toBeGreaterThanOrEqual(path.getBoundingClientRect().top - 1)
      expect(step.bottom).toBeLessThanOrEqual(path.getBoundingClientRect().bottom + 1)
      expect(whole(own)).toBe(true)
    }

    // the long name gives way and is whole on hover; the mark beside it
    // does not give way at all
    const long = rows()[0]!
    const name = long.querySelector(`[title="${LONG}"]`)!
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth)
    expect(whole(long.querySelector('[data-slot="badge"]')!)).toBe(true)
  })

  it('keeps the mark beside a long name whole on a phone', async () => {
    await page.viewport(390, 844)
    await renderScreen({
      client: world(),
      children: (
        <div style={{ display: 'flex', height: 600, flexDirection: 'column' }}>
          <PeoplePickerView context={context()} />
        </div>
      ),
    })
    await expect.poll(() => rows().length).toBe(2)
    const long = rows()[0]!
    const mark = long.querySelector('[data-slot="badge"]')!
    expect(whole(mark)).toBe(true)
    expect(mark.getBoundingClientRect().right).toBeLessThanOrEqual(
      long.getBoundingClientRect().right,
    )
    expect(long.querySelector(`[title="${LONG}"]`)).not.toBeNull()
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

  // Nobody is elsewhere from a page that is not there: while the first
  // answer is awaited or has failed, the chosen are only counted.
  it('says nobody is on another page until there is a page', async () => {
    // waiting for the first answer, then failing to get one, then answered
    const stages = [
      view({ rows: [], value: ['x', 'y'], pending: true }),
      view({ rows: [], value: ['x', 'y'], error: 'no line' }),
      view({ value: ['a', 'x'] }),
    ]
    function Stages() {
      const [at, setAt] = useState(0)
      return (
        <>
          <button type="button" onClick={() => setAt((now) => now + 1)}>
            on
          </button>
          <PeoplePickerView context={stages[at]!} />
        </>
      )
    }
    await renderScreen({ client: world(), children: <Stages /> })
    const count = page.getByTestId('people-picker-count')
    await expect.element(count).toHaveAttribute('data-count', '2')
    await expect.element(count).toHaveAttribute('data-elsewhere', '0')
    await page.getByRole('button', { name: 'on', exact: true }).click()
    await expect.element(count).toHaveAttribute('data-elsewhere', '0')
    await page.getByRole('button', { name: 'on', exact: true }).click()
    await expect.element(count).toHaveAttribute('data-elsewhere', '1')
  })

  // Folded into a field, the tree says what the list is narrowed to: with
  // no unit chosen that is everywhere the reader may look, not the name of
  // the field.
  it('names the unit looked in, or all of them, in the folded field', async () => {
    await page.viewport(834, 1112)
    const tree = nodes.map((node) => ({
      id: node.orgNodeId,
      name: node.name,
      parentId: node.parentId,
    }))
    function Field() {
      const [nodeId, setNodeId] = useState<string | null>(null)
      return <PeoplePickerView context={view({ nodes: tree, nodeId, onNodeChange: setNodeId })} />
    }
    await renderScreen({ client: world(), children: <Field /> })
    const field = page.getByTestId('people-picker-unit')
    await expect.element(field).toHaveTextContent(zhCN['auth/picker/all-units']!)

    await field.click()
    await page.getByTestId('people-picker-tree').getByText('软件学院').click()
    await expect.element(field).toHaveTextContent('软件学院')
  })

  it('offers no whole-page choice to a caller that cannot take one', async () => {
    await renderScreen({ client: world(), children: <PeoplePickerView context={view()} /> })
    await expect.element(page.getByRole('checkbox', { name: '甲' })).toBeVisible()
    expect(page.getByRole('checkbox', { name: '全选本页' }).elements()).toHaveLength(0)
    // nor a unit column for rows that name none
    expect(page.getByRole('columnheader', { name: '所属组织' }).elements()).toHaveLength(0)
  })
})
