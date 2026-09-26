import MyEntriesPage from '../src/client/entry/MyEntriesPage.tsx'
import { WorkspaceSkeleton } from '../src/client/entry/workspace/WorkspaceSkeleton.tsx'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { ScreenFillScope, useScreenFillClaimed } from '@qualy/web-runtime'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { Effect, Stream } from 'effect'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'
import zhCN from '../src/client/locales/zh-CN.ts'

// The entries workspace as a reader moves through it: the structure down
// one side, one question or section opened beside it, and the claims under
// that question read a page at a time. Every width has its own shape - three
// columns at a desk, two on a tablet with the requirements in a sheet, and
// on a phone the structure first and one question after it - so each case
// names the window it is about.

afterEach(() => page.viewport(1280, 800))

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444'
const ROOT = '70000000-7777-4777-8777-777777777770'
const BAND_A = '70000000-7777-4777-8777-777777777771'
const BAND_B = '70000000-7777-4777-8777-777777777772'
const SUB_B = '70000000-7777-4777-8777-777777777773'
const DEEP_B = '70000000-7777-4777-8777-777777777774'
const itemId = (n: number) => `20000000-2222-4222-8222-2222222222${String(n).padStart(2, '0')}`
const TAIL = itemId(9)
const GPA = itemId(10)
const FITNESS = itemId(11)
const PENALTY = itemId(12)
const entryId = (n: number) => `e0000000-0000-4000-8000-0000000000${String(n).padStart(2, '0')}`

const question = (
  n: number,
  title: string,
  group: string,
  over: Record<string, unknown> = {},
  revision: Record<string, unknown> = {},
) => ({
  id: itemId(n),
  batchId: BATCH_ID,
  itemType: 'evidence' as const,
  title,
  scoreGroupId: group,
  maxEntries: 3,
  sortOrder: n,
  status: 'active' as const,
  voidReason: null,
  currentRevision: {
    id: `30000000-3333-4333-8333-3333333333${String(n).padStart(2, '0')}`,
    revisionNo: 1,
    entryChannels: ['participant'] as const,
    formConfig: { fields: [{ key: 'summary', type: 'text', label: '事项说明', required: true }] },
    scoringConfig: { calculator: { config: { value: '1.00' } } },
    reviewPolicy: { normal: { stages: [{ id: 's1', label: '班委初审' }] } },
    displayConfig: { description: '按学校规定提交材料' },
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...revision,
  },
  createdAt: '2026-03-01T00:00:00.000Z',
  ...over,
})

/** a question the office records, scored by one figure the record carries */
const recorded = (n: number, title: string, fields: readonly unknown[]) =>
  question(
    n,
    title,
    BAND_B,
    { itemType: 'evidence', maxEntries: 1 },
    {
      entryChannels: ['administrative'],
      formConfig: { fields },
      scoringConfig: {},
      reviewPolicy: null,
    },
  )

const hidden = { state: 'hidden' as const, reason: null }

const claim = (
  n: number,
  item: string,
  status: 'draft' | 'in_review' | 'needs_revision' | 'approved' | 'rejected' | 'voided',
  over: Record<string, unknown> = {},
) => ({
  id: entryId(n),
  batchId: BATCH_ID,
  itemId: item,
  participantId: PARTICIPANT_ID,
  status,
  source: 'self' as const,
  currentRevision: {
    id: `50000000-5555-4555-8555-5555555555${String(n).padStart(2, '0')}`,
    revisionNo: 1,
    itemRevisionId: 'r',
    payload: { summary: `活动 ${String(n)} 号` },
    note: null,
    source: 'self',
    actorId: PARTICIPANT_ID,
    subjectId: PARTICIPANT_ID,
    attachments: [],
    // older claims first, so "latest first" puts the highest number on top
    createdAt: new Date(Date.UTC(2026, 3, 1, 0, n)).toISOString(),
  },
  currentReviewInstanceId: null,
  createdAt: new Date(Date.UTC(2026, 3, 1, 0, n)).toISOString(),
  supplement: null,
  refusal: null,
  openRound: null,
  recognition: null,
  capabilities: { edit: hidden, submit: hidden, withdraw: hidden, appeal: hidden, abandon: hidden },
  ...over,
})

const group = (id: string, parentGroupId: string | null, name: string, sortOrder: number) => ({
  id,
  parentGroupId,
  name,
  cap: id === DEEP_B ? null : '20.00',
  floor: null,
  sortOrder,
  itemCount: 0,
})

/**
 * The browser's own back key, which a router held in memory has no button
 * for. Out of the layout, pressed from the test through the DOM.
 */
function BackKey() {
  const navigate = useNavigate()
  return (
    <button type="button" hidden data-testid="history-back" onClick={() => void navigate(-1)}>
      back
    </button>
  )
}

const pressBack = () =>
  (document.querySelector('[data-testid="history-back"]') as HTMLButtonElement).click()

/**
 * The page the reader came from, one press of the back key behind the
 * workspace: with a way to its structure, and a link straight to question 2.
 */
function Elsewhere() {
  const navigate = useNavigate()
  const entries = `/assessment/batches/${BATCH_ID}/my-entries`
  return (
    <>
      <button type="button" data-testid="to-entries" onClick={() => void navigate(entries)}>
        entries
      </button>
      <button
        type="button"
        data-testid="to-question"
        onClick={() => void navigate(`${entries}?open=${itemId(2)}`)}
      >
        question
      </button>
    </>
  )
}

const workspace = ({
  route,
  items = [
    ...Array.from({ length: 8 }, (_, i) => question(i + 1, `品德题目 ${String(i + 1)}`, BAND_A)),
    question(9, '学科竞赛获奖', DEEP_B, { maxEntries: null }),
  ],
  entries = [],
  lines = [],
  groups = [
    group(ROOT, null, '综合素质测评', 0),
    group(BAND_A, ROOT, '品德行为表现', 0),
    group(BAND_B, ROOT, '学业发展', 1),
    group(SUB_B, BAND_B, '学科竞赛', 0),
    group(DEEP_B, SUB_B, '竞赛奖项', 0),
  ],
  stubs = {},
  locale = 'zh-CN',
  storage = {},
  around = (screen) => screen,
}: {
  route: string
  items?: readonly unknown[]
  entries?: readonly unknown[]
  lines?: readonly unknown[]
  groups?: readonly unknown[]
  /** any read or write the case needs answered its own way */
  stubs?: Record<string, unknown>
  /** the reader's language, where a case is about how long its words run */
  locale?: 'zh-CN' | 'en-US'
  /** what this browser already keeps from an earlier visit */
  storage?: Record<string, string>
  /** what the shell puts around the page, where a case is about the two */
  around?: (screen: ReactNode) => ReactNode
}) =>
  renderScreen({
    client: fakeClient({
      app: {
        getManifest: () =>
          Effect.succeed({
            ...emptyManifest(),
            pages: [
              {
                id: 'assessment/batch-my-entries',
                path: '/assessment/batches/:batchId/my-entries',
                layout: 'admin',
              },
            ],
          }),
      },
      assessment: {
        getBatch: () =>
          Effect.succeed({
            batch: {
              id: BATCH_ID,
              name: '2026 春季综测',
              descriptionMd: null,
              manageable: false,
              reviewReasons: { reject: [], escalate: [] },
              capabilities: {
                personal: true,
                review: false,
                record: false,
                manage: false,
                redetermine: false,
              },
              participantCount: 12,
              materialRange: { start: '2026-03-01', end: '2026-09-01' },
              timezone: 'Asia/Shanghai',
              status: 'active',
              configRevision: 1,
              currentPhaseId: null,
              currentPhaseName: '填报期',
              createdAt: '2026-02-01T00:00:00.000Z',
            },
          }),
        listItems: () => Effect.succeed({ items, capabilities: { canManage: false } }),
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries,
            nextCursor: null,
            attention: { unreadEntryIds: [] },
          }),
        listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
        listScoreGroups: () =>
          Effect.succeed({ groups, version: 1, capabilities: { canManage: false } }),
        getMyResult: () =>
          Effect.succeed({ mode: 'provisional', total: '0.00', groups: [], lines }),
        getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
        ...stubs,
      },
    }),
    route,
    locale,
    storage,
    routes: [
      {
        path: '/assessment/batches/:batchId/my-entries',
        // the shell the page is built for: a window-high frame whose main
        // column scrolls, not a document that grows
        element: (
          <div
            style={{
              display: 'flex',
              height: '100dvh',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <main
              data-testid="page-scroller"
              style={{
                display: 'flex',
                minHeight: 0,
                flex: '1 1 0%',
                flexDirection: 'column',
                overflowY: 'auto',
              }}
            >
              {around(<MyEntriesPage />)}
            </main>
            <BackKey />
          </div>
        ),
      },
      { path: '/elsewhere', element: <Elsewhere /> },
    ] as never,
  })

const base = `/assessment/batches/${BATCH_ID}/my-entries`
const shape = () =>
  document.querySelector('[data-testid="entries-workspace"]')?.getAttribute('data-screen')
const openItem = () =>
  document.querySelector('[data-testid="item-pane"]')?.getAttribute('data-item') ?? null
const rows = () => [...document.querySelectorAll('[data-testid="claim-row"]')]

/** a long paper: thirty questions under one section */
const THIRTY = Array.from({ length: 30 }, (_, i) =>
  question(i + 1, `品德题目 ${String(i + 1)}`, BAND_A),
)
const railRow = (n: number) =>
  document.querySelector(`[data-rail-row="${itemId(n)}"]`) as HTMLElement

/** wholly on screen within the pane that scrolls it, clear of the section head pinned at its top */
const inView = (element: HTMLElement, scroller: Element) => {
  const port = scroller.getBoundingClientRect()
  const at = element.getBoundingClientRect()
  return at.top >= port.top + 44 && at.bottom <= port.bottom
}

describe('finding a question', () => {
  it('lands on the question the address names, and marks it in the structure', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${TAIL}` })
    await expect.element(page.getByRole('heading', { name: '学科竞赛获奖' })).toBeVisible()
    expect(openItem()).toBe(TAIL)
    expect(document.querySelector(`[data-rail-row="${TAIL}"]`)?.getAttribute('aria-current')).toBe(
      'true',
    )
    // four levels deep, every section above it is a way back up
    const crumbs = page.getByRole('list', { name: '所在位置' })
    await expect.element(crumbs.getByRole('button', { name: /学业发展/ })).toBeVisible()
    await expect.element(crumbs.getByRole('button', { name: /竞赛奖项/ })).toBeVisible()
  })

  it('lands a desk without an address on the first question', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: base })
    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    expect(openItem()).toBe(itemId(1))
  })

  it('stands in three columns at a desk; a tablet brings the requirements up in a sheet', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${itemId(2)}` })
    const aside = page.getByRole('complementary', { name: '填报要求' })
    await expect.element(aside).toBeVisible()
    await expect.element(aside.getByTestId('item-requirements')).toBeVisible()
    expect(page.getByTestId('requirements-key').elements()).toHaveLength(0)

    await page.viewport(834, 1112)
    await expect
      .poll(() =>
        document.querySelector('[data-testid="entries-workspace"]')?.getAttribute('data-mode'),
      )
      .toBe('tablet')
    expect(page.getByRole('complementary', { name: '填报要求' }).elements()).toHaveLength(0)
    await page.getByTestId('requirements-key').click()
    const sheet = page.getByRole('dialog')
    await expect.element(sheet.getByTestId('item-requirements')).toBeVisible()
    // the question's own words on how to file travel with it
    await expect.element(sheet.getByText('按学校规定提交材料')).toBeVisible()
  })

  it.each([
    [1440, 340, 300],
    [1920, 380, 360],
  ] as const)(
    'gives a %ipx desk a %ipx structure and %ipx of requirements',
    async (wide, rail, aside) => {
      await page.viewport(wide, 900)
      await workspace({ route: `${base}?open=${itemId(2)}` })
      const requirements = page.getByRole('complementary', { name: '填报要求' })
      await expect.element(requirements).toBeVisible()
      // the column the structure stands in, its rule included
      await expect
        .poll(() =>
          Math.round(
            page.getByTestId('structure-rail').element().parentElement!.getBoundingClientRect()
              .width,
          ),
        )
        .toBe(rail)
      expect(Math.round(requirements.element().getBoundingClientRect().width)).toBe(aside)
    },
  )

  it('walks a phone from the structure into one question and back', async () => {
    await page.viewport(390, 844)
    await workspace({ route: base })
    await expect.poll(shape).toBe('structure')
    await page.getByRole('button', { name: /学科竞赛获奖/ }).click()
    await expect.poll(() => addressNow()).toContain(`open=${TAIL}`)
    await expect.poll(shape).toBe('item')
    await expect.element(page.getByRole('heading', { name: '学科竞赛获奖' })).toBeVisible()

    // the neighbours are one press away, and the structure one press back
    await page.getByRole('button', { name: '上一项' }).click()
    await expect.poll(() => addressNow()).toContain(`open=${itemId(8)}`)
    await page.getByRole('button', { name: /评分结构/ }).click()
    await expect.poll(() => addressNow()).not.toContain('open=')
    await expect.poll(shape).toBe('structure')
  })

  // Going into a question is the one layer the back key undoes: looking at
  // its neighbours, or pressing the way back up, stands in place of where
  // the reader was rather than piling up behind them.
  it('walks a phone back out one layer at a time, however many neighbours were looked at', async () => {
    await page.viewport(390, 844)
    await workspace({ route: base })
    await expect.poll(shape).toBe('structure')
    await page.getByRole('button', { name: /品德题目 3/ }).click()
    await expect.poll(() => addressNow()).toContain(`open=${itemId(3)}`)
    await page.getByRole('button', { name: '下一项' }).click()
    await expect.poll(() => addressNow()).toContain(`open=${itemId(4)}`)
    await page.getByRole('button', { name: '下一项' }).click()
    await expect.poll(() => addressNow()).toContain(`open=${itemId(5)}`)
    pressBack()
    await expect.poll(() => addressNow()).not.toContain('open=')
    await expect.poll(shape).toBe('structure')
  })

  // The way back up from a question the structure opened is the back key's
  // own step: it leaves no second structure behind it, so one more press
  // leaves the page - whatever was looked at or opened on the way.
  it('goes back up to a phone’s structure one press from leaving the page', async () => {
    await page.viewport(390, 844)
    await workspace({ route: '/elsewhere', entries: [claim(1, itemId(3), 'in_review')] })
    await page.getByTestId('to-entries').click()
    await expect.poll(shape).toBe('structure')
    await page.getByRole('button', { name: /品德题目 2/ }).click()
    await expect.poll(() => addressNow()).toContain(`open=${itemId(2)}`)
    await page.getByRole('button', { name: '下一项' }).click()
    await expect.poll(() => addressNow()).toContain(`open=${itemId(3)}`)
    // a claim's drawer opened and shut over the question on the way, once by
    // its own key and once by the back key
    await expect.poll(() => rows().length).toBe(1)
    await userEvent.click(rows()[0]!)
    await expect.poll(() => addressNow()).toContain('detail=')
    await page.getByRole('button', { name: '关闭' }).click()
    await expect.poll(() => addressNow()).not.toContain('detail=')
    await userEvent.click(rows()[0]!)
    await expect.poll(() => addressNow()).toContain('detail=')
    pressBack()
    await expect.poll(() => addressNow()).not.toContain('detail=')

    await page.getByRole('button', { name: /评分结构/ }).click()
    await expect.poll(shape).toBe('structure')
    expect(addressNow()).toBe(base)
    pressBack()
    await expect.poll(() => addressNow()).toBe('/elsewhere')
  })

  // Come in by a link, what lies behind the question is some other page, not
  // its structure: the way up stands in the question's place instead.
  it('goes up to the structure in place from a question a link opened', async () => {
    await page.viewport(390, 844)
    await workspace({ route: '/elsewhere' })
    await page.getByTestId('to-question').click()
    await expect.poll(shape).toBe('item')
    await page.getByRole('button', { name: /评分结构/ }).click()
    await expect.poll(shape).toBe('structure')
    expect(addressNow()).toBe(base)
    pressBack()
    await expect.poll(() => addressNow()).toBe('/elsewhere')
  })

  // A long structure keeps its place: back out of a question, the reader is
  // where they were in it, on the row they pressed; into one, they hear its
  // name.
  it('keeps a phone’s place in the structure, and its focus, across a question', async () => {
    await page.viewport(390, 844)
    await workspace({
      route: base,
      items: Array.from({ length: 30 }, (_, i) =>
        question(i + 1, `品德题目 ${String(i + 1)}`, BAND_A),
      ),
    })
    await expect.poll(shape).toBe('structure')
    const scroller = page.getByTestId('page-scroller').element()
    const row = () => document.querySelector(`[data-rail-row="${itemId(20)}"]`) as HTMLElement
    row().scrollIntoView({ block: 'center' })
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(200)
    const was = scroller.scrollTop
    await userEvent.click(row())
    await expect.poll(shape).toBe('item')
    await expect.poll(() => document.activeElement?.getAttribute('data-pane-title')).toBe('')
    expect(document.activeElement?.textContent).toBe('品德题目 20')

    await page.getByRole('button', { name: /评分结构/ }).click()
    await expect.poll(shape).toBe('structure')
    await expect.poll(() => Math.abs(scroller.scrollTop - was)).toBeLessThan(4)
    expect(document.activeElement).toBe(row())
  })

  // Focus lands on the row of the question left, which is not the row
  // pressed once the reader has stepped on from it: the structure shows it.
  it('shows the row a phone’s focus lands on, after stepping on from the one pressed', async () => {
    await page.viewport(390, 844)
    await workspace({ route: base, items: THIRTY })
    await expect.poll(shape).toBe('structure')
    const scroller = page.getByTestId('page-scroller').element()
    // the row pressed stands at the foot of the screen
    railRow(20).scrollIntoView({ block: 'end' })
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(200)
    await userEvent.click(railRow(20))
    await expect.poll(shape).toBe('item')
    await page.getByRole('button', { name: '下一项' }).click()
    await expect.poll(() => addressNow()).toContain(`open=${itemId(21)}`)
    await page.getByRole('button', { name: '下一项' }).click()
    await expect.poll(() => addressNow()).toContain(`open=${itemId(22)}`)

    await page.getByRole('button', { name: /评分结构/ }).click()
    await expect.poll(shape).toBe('structure')
    await expect.poll(() => document.activeElement).toBe(railRow(22))
    expect(inView(railRow(22), scroller)).toBe(true)
  })

  it('shows the row of a question a link opened, back on a phone’s structure', async () => {
    await page.viewport(390, 844)
    await workspace({ route: `${base}?open=${itemId(25)}`, items: THIRTY })
    await expect.poll(shape).toBe('item')
    await page.getByRole('button', { name: /评分结构/ }).click()
    await expect.poll(shape).toBe('structure')
    await expect.poll(() => document.activeElement).toBe(railRow(25))
    expect(inView(railRow(25), page.getByTestId('page-scroller').element())).toBe(true)
  })

  it('keeps the way to file at the foot of a phone, however little the question holds', async () => {
    await page.viewport(390, 844)
    await workspace({ route: `${base}?open=${itemId(7)}` })
    const foot = page.getByTestId('phone-foot')
    await expect.element(foot).toBeVisible()
    // one key, at the bottom edge where the thumb is - not a second one in
    // the empty list above it
    expect(page.getByTestId('file-claim').elements()).toHaveLength(1)
    await expect
      .poll(() => Math.round(window.innerHeight - foot.element().getBoundingClientRect().bottom))
      .toBeLessThan(2)
  })

  it('steps to the neighbouring question from the foot of the pane', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${itemId(8)}` })
    const steps = page.getByRole('navigation', { name: '相邻项目' })
    await steps.getByRole('button', { name: /学科竞赛获奖/ }).click()
    await expect.poll(() => addressNow()).toContain(`open=${TAIL}`)
    await expect.poll(openItem).toBe(TAIL)
  })

  it('opens a section on its own, and a question from there', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: base })
    // the section's own row in the structure, not its fold key beside it
    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    await userEvent.click(document.querySelector(`[data-rail-row="${BAND_A}"]`)!)
    await expect
      .poll(() => document.querySelector('[data-testid="group-pane"]')?.getAttribute('data-group'))
      .toBe(BAND_A)
    // a section has no requirements of its own to stand beside it
    expect(page.getByRole('complementary', { name: '填报要求' }).elements()).toHaveLength(0)
    await userEvent.click(document.querySelector(`[data-group-item="${itemId(3)}"]`)!)
    await expect.poll(openItem).toBe(itemId(3))
  })

  it('narrows the structure to what waits on the reader', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: base,
      entries: [
        claim(1, itemId(2), 'needs_revision'),
        claim(2, itemId(5), 'draft'),
        claim(3, TAIL, 'in_review'),
      ],
    })
    const todo = page.getByTestId('rail-todo')
    await expect.element(todo).toHaveAttribute('data-count', '2')
    await todo.click()
    await expect
      .poll(() =>
        [...document.querySelectorAll('[data-rail-row][data-kind="item"]')].map((row) =>
          row.getAttribute('data-rail-row'),
        ),
      )
      .toEqual([itemId(2), itemId(5)])
  })
})

describe('reading one question’s claims', () => {
  // forty-five claims under one question: some refused, some in review
  const lot = Array.from({ length: 45 }, (_, i) =>
    claim(i + 1, TAIL, i < 5 ? 'rejected' : i < 15 ? 'in_review' : 'approved'),
  )

  it('lists a long question a page at a time', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${TAIL}`, entries: lot })
    await expect.poll(() => rows().length).toBe(20)
    // latest first: the newest claim heads the list
    expect(rows()[0]!.getAttribute('data-entry')).toBe(entryId(45))
    await page.getByRole('button', { name: /再显示/ }).click()
    await expect.poll(() => rows().length).toBe(40)
    await page.getByRole('button', { name: /再显示/ }).click()
    await expect.poll(() => rows().length).toBe(45)
    expect(page.getByTestId('entries-more').elements()).toHaveLength(0)
    // and the other way round, oldest first: chosen from the list, which
    // names the order in force, and in force only once chosen
    const sort = page.getByRole('combobox', { name: '排序方式' })
    await expect.element(sort).toHaveAttribute('data-order', 'newest')
    // at a desk too it is a quiet key rather than a field: no box, no chevron
    expect(getComputedStyle(sort.element()).borderTopColor).toBe('rgba(0, 0, 0, 0)')
    expect(sort.element().parentElement!.querySelector('[data-position="right"]')).toBeNull()
    await sort.click()
    await expect.element(page.getByRole('option', { name: '最近更新在前' })).toBeVisible()
    // the list opens from the key's end, over the claims rather than across
    // into the requirements beside them
    const listEnd = () =>
      page.getByRole('listbox').element().closest('[data-slot="select-content"]')!
    await expect
      .poll(() =>
        Math.abs(
          listEnd().getBoundingClientRect().right - sort.element().getBoundingClientRect().right,
        ),
      )
      .toBeLessThanOrEqual(1)
    // opening the list changes nothing by itself
    expect(rows()[0]!.getAttribute('data-entry')).toBe(entryId(45))
    await page.getByRole('option', { name: '最早在前' }).click()
    await expect.element(sort).toHaveAttribute('data-order', 'oldest')
    await expect.poll(() => rows()[0]!.getAttribute('data-entry')).toBe(entryId(1))
  })

  // Narrower, the order is a quiet key beside the search: a word for the
  // eye and the full order for a screen reader, with a list that opens
  // inside the window and marks the order in force.
  it('says the order in force on a phone, and opens its list where it can be read', async () => {
    await page.viewport(390, 844)
    await workspace({ route: `${base}?open=${TAIL}`, entries: lot.slice(0, 3) })
    const sort = page.getByRole('combobox', { name: '排序方式' })
    await expect.element(sort).toHaveAttribute('data-order', 'newest')
    const said = () =>
      sort.element().querySelector('[data-slot="select-value"]')?.textContent?.trim() ?? ''
    expect(said()).not.toBe('')

    await sort.click()
    const chosen = page.getByRole('option', { selected: true })
    await expect.element(chosen).toBeVisible()
    // the key says what the list marks
    expect(said()).toBe(chosen.element().textContent?.trim())
    const inside = (box: DOMRect) => box.left >= 0 && box.right <= window.innerWidth
    expect(inside(page.getByRole('listbox').element().getBoundingClientRect())).toBe(true)
    expect(inside(chosen.element().querySelector('svg')!.getBoundingClientRect())).toBe(true)

    const other = page.getByRole('option', { selected: false })
    const next = other.element().textContent?.trim()
    await other.click()
    await expect.element(sort).toHaveAttribute('data-order', 'oldest')
    expect(said()).toBe(next)
    await expect.poll(() => rows()[0]!.getAttribute('data-entry')).toBe(entryId(1))
  })

  // At a desk the filters stand in one row beside the search and the order.
  // Where that row cannot hold them - a tablet's pane, in a language whose
  // words run long - the search gives up its room first, and then the
  // filters wrap as a narrower pane's do: none is ever cut off at the edge.
  it('keeps every filter whole where the row is tight', async () => {
    await page.viewport(1024, 768)
    await workspace({ route: `${base}?open=${TAIL}`, entries: lot, locale: 'en-US' })
    await expect.poll(() => rows().length).toBe(20)
    const whole = () => {
      const filters = document.querySelector('[data-chip="all"]')!.parentElement!
      const edge = filters.getBoundingClientRect()
      return (
        filters.scrollWidth <= filters.clientWidth + 1 &&
        [...filters.querySelectorAll('[data-chip]')].every(
          (chip) => chip.getBoundingClientRect().right <= edge.right + 1,
        )
      )
    }
    await expect.poll(whole).toBe(true)
    // where they fit whole in one row, they keep it
    await page.viewport(1440, 900)
    await expect.element(page.getByTestId('entries-toolbar')).toHaveAttribute('data-shape', 'row')
    expect(whole()).toBe(true)
  })

  // The filters, the search and the order are one row of keys: one height,
  // one middle line.
  it('stands the search, the order and the filters at one height', async () => {
    for (const width of [1440, 1920]) {
      await page.viewport(width, 900)
      const { unmount } = await workspace({ route: `${base}?open=${TAIL}`, entries: lot })
      await expect.element(page.getByTestId('entries-toolbar')).toHaveAttribute('data-shape', 'row')
      const box = (element: Element) => element.getBoundingClientRect()
      const search = box(page.getByTestId('entries-search').element())
      const sort = box(page.getByTestId('entries-sort').element())
      const filters = box(document.querySelector('[data-chip="all"]')!.parentElement!)
      for (const other of [sort, filters]) {
        expect({ width, height: Math.round(search.height) }).toEqual({
          width,
          height: Math.round(other.height),
        })
        expect({ width, top: Math.round(search.top) }).toEqual({
          width,
          top: Math.round(other.top),
        })
      }
      await unmount()
    }
  })

  it('filters the claims by where they stand, and finds one by what it says', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${TAIL}`, entries: lot })
    const refused = () => document.querySelector('[data-chip="rejected"]')
    await expect.poll(() => refused()?.getAttribute('data-count')).toBe('5')
    await userEvent.click(refused()!)
    await expect.poll(() => rows().length).toBe(5)
    expect(new Set(rows().map((row) => row.getAttribute('data-standing')))).toEqual(
      new Set(['rejected']),
    )

    await userEvent.click(document.querySelector('[data-chip="all"]')!)
    await page.getByRole('searchbox', { name: '搜索' }).fill('活动 27 号')
    await expect
      .poll(() => rows().map((row) => row.getAttribute('data-entry')))
      .toEqual([entryId(27)])
    await page.getByRole('searchbox', { name: '搜索' }).fill('没有这样的申报')
    await expect.element(page.getByTestId('entries-no-match')).toBeVisible()
    await page.getByRole('button', { name: '清除筛选' }).click()
    await expect.poll(() => rows().length).toBe(20)
  })

  // With motion allowed, a filter closes the claims up over the room the
  // leaving ones had. What follows the list moves in the same beat, so no
  // claim on its way up ever slides over the way to file another.
  it('moves the way to file with the claims closing up above it', async () => {
    await commands.emulateMedia({ reducedMotion: 'no-preference' })
    try {
      // the page has told its listeners before the screen that reads the
      // preference mounts: the change is announced a frame after it holds
      await expect.poll(() => matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
      for (let frame = 0; frame < 3; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      await page.viewport(1440, 900)
      const filed = [1, 2, 3, 4, 5].map((n) =>
        claim(n, TAIL, n === 1 || n === 4 ? 'approved' : 'in_review'),
      )
      await workspace({ route: `${base}?open=${TAIL}`, entries: filed })
      await expect.poll(() => rows().length).toBe(5)
      const staying = new Set([entryId(1), entryId(4)])
      // the last way to file on the pane: the one under the list
      const foot = () => [...document.querySelectorAll('[data-testid="file-claim"]')].at(-1)!
      const lowest = () =>
        Math.max(
          ...rows()
            .filter((row) => staying.has(row.getAttribute('data-entry')!))
            .map((row) => row.getBoundingClientRect().bottom),
        )
      const before = lowest()

      ;(document.querySelector('[data-chip="approved"]') as HTMLElement).click()
      const overlaps: number[] = []
      const seen: number[] = []
      for (const until = performance.now() + 450; performance.now() < until;) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const bottom = lowest()
        seen.push(bottom)
        const top = foot().getBoundingClientRect().top
        if (bottom > top + 1) overlaps.push(bottom - top)
      }
      // the claims did travel - some frame drew them short of where they
      // settled, however few frames a busy machine drew - and never over
      // what follows them
      expect(seen[0]).toBeLessThanOrEqual(before)
      const settled = seen.at(-1)!
      expect(seen.some((bottom) => Math.abs(bottom - settled) > 4)).toBe(true)
      expect(overlaps).toEqual([])
      await expect.poll(() => rows().length).toBe(2)
    } finally {
      await commands.emulateMedia({ reducedMotion: 'reduce' })
    }
  })

  it('carries what a reviewer said on the row, and what the claim counts for', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      entries: [
        claim(1, itemId(1), 'needs_revision', {
          refusal: {
            kind: 'returned',
            reason: null,
            comment: '证书扫描件不清晰',
            suggestedPayload: null,
            actorName: null,
            at: '2026-04-02T00:00:00.000Z',
          },
        }),
        claim(2, itemId(1), 'in_review', {
          supplement: {
            requestId: 'q1',
            instanceId: 'i1',
            requestNo: 1,
            instructions: '请补充时长截图',
            requirements: [],
            requestedByName: null,
            requestedAt: '2026-04-03T00:00:00.000Z',
          },
        }),
        claim(3, itemId(1), 'approved'),
      ],
      lines: [
        {
          lineId: `entry:${entryId(3)}`,
          kind: 'entry',
          label: '品德题目 1',
          value: '1.0000',
          itemId: itemId(1),
          provenance: { entryId: entryId(3) },
        },
      ],
    })
    await expect.poll(() => rows().length).toBe(3)
    const row = (n: number) => document.querySelector(`[data-entry="${entryId(n)}"]`)!
    expect(row(1).querySelector('[data-note="return"]')?.textContent).toContain('证书扫描件不清晰')
    expect(row(2).querySelector('[data-note="ask"]')?.textContent).toContain('请补充时长截图')
    expect(row(3).querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('1.00')
    // a claim still out with its reviewers would count its question's worth
    expect(row(2).querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('1.00')
  })

  it('says a figure once where it is also the amount it came to', async () => {
    await page.viewport(1440, 900)
    const record = (n: number, item: string, payload: Record<string, unknown>) =>
      claim(n, item, 'approved', {
        source: 'record',
        currentRevision: { ...claim(n, item, 'approved').currentRevision, payload },
      })
    const line = (n: number, item: string, value: string) => ({
      lineId: `entry:${entryId(n)}`,
      kind: 'entry',
      label: '',
      value,
      itemId: item,
      provenance: { entryId: entryId(n) },
    })
    await workspace({
      route: `${base}?open=${GPA}`,
      items: [
        question(1, '品德题目 1', BAND_A),
        recorded(10, '学业基础分', [{ key: 'gpa', type: 'decimal', label: '课程加权平均分' }]),
        recorded(11, '体测加分', [{ key: 'bonus', type: 'decimal', label: '体质测试加分' }]),
        recorded(12, '违纪扣分', [
          { key: 'kind', type: 'text', label: '处分类型' },
          { key: 'points', type: 'decimal', label: '扣分' },
        ]),
      ],
      entries: [
        record(1, GPA, { gpa: '95.02' }),
        record(2, FITNESS, { bonus: '2.00' }),
        record(3, PENALTY, { kind: '校级通报批评', points: '-2' }),
      ],
      lines: [line(1, GPA, '9.5000'), line(2, FITNESS, '2.0000'), line(3, PENALTY, '-2.0000')],
    })
    const only = () => rows()[0]!
    const lead = () => only().querySelector('[data-part="lead"]')?.textContent ?? ''
    // a figure that differs from what it came to keeps its name beside it,
    // set apart and quieter, so the two read as a name and its value
    await expect.poll(() => only().getAttribute('data-entry')).toBe(entryId(1))
    expect(lead()).toContain('课程加权平均分')
    expect(lead()).toContain('95.02')
    const name = only().querySelector('[data-part="lead"] [data-part-label]')!
    expect(name.textContent).toBe('课程加权平均分')
    expect(getComputedStyle(name).color).not.toBe(
      getComputedStyle(only().querySelector('[data-part="lead"]')!).color,
    )
    // the name and its figure stand as the language's catalog words them
    const figured = zhCN['assessment/entries/figure']
      .replace('{label}', '课程加权平均分')
      .replace('{value}', '95.02')
    expect(lead()).toBe(figured)
    expect(only().querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('9.50')

    // the drawer is headed by the same line, its field name set apart the same way
    await userEvent.click(only())
    const title = page.getByRole('dialog').getByRole('heading', { level: 2 }).first()
    await expect.element(title).toBeVisible()
    expect(title.element().textContent).toBe(figured)
    const titled = title.element().querySelector('[data-part-label]')!
    expect(titled.textContent).toBe('课程加权平均分')
    expect(getComputedStyle(titled).color).not.toBe(getComputedStyle(title.element()).color)
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()

    // one that equals it is said once, in the amount; the field alone names the row
    await userEvent.click(document.querySelector(`[data-rail-row="${FITNESS}"]`)!)
    await expect.poll(() => only().getAttribute('data-entry')).toBe(entryId(2))
    expect(lead()).toBe('体质测试加分')
    expect(only().textContent.split('2.00')).toHaveLength(2)
    expect(only().querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('2.00')

    // a deduction keeps its words and says its figure once, as a deduction
    await userEvent.click(document.querySelector(`[data-rail-row="${PENALTY}"]`)!)
    await expect.poll(() => only().getAttribute('data-entry')).toBe(entryId(3))
    expect(only().textContent).toContain('校级通报批评')
    expect(only().querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('−2.00')
  })

  it('keeps a withdrawn question on the structure, and what was filed under it readable', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: `${base}?open=${itemId(4)}`,
      items: [
        question(1, '品德题目 1', BAND_A),
        question(4, '学生干部任职（旧）', BAND_A, {
          status: 'voided',
          voidReason: '已并入优秀学生干部',
        }),
      ],
      entries: [claim(1, itemId(4), 'approved')],
    })
    await expect
      .poll(() =>
        document.querySelector(`[data-rail-row="${itemId(4)}"]`)?.getAttribute('data-tag'),
      )
      .toBe('voided')
    await expect.element(page.getByTestId('item-badge')).toBeVisible()
    await expect.poll(() => rows().length).toBe(1)
    // no longer counted, and nothing new to file
    expect(rows()[0]!.querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('')
    expect(page.getByTestId('file-claim').elements()).toHaveLength(0)
    await expect.element(page.getByText('已并入优秀学生干部')).toBeVisible()
  })
})

describe('the head of the structure', () => {
  /**
   * A line that opens a moment after the screen dials it, and says when it
   * has carried its first word. The moment matters: a first word sent at
   * once, while the dial a remount abandoned is still winding down, is
   * overwritten by that old dial saying the line is down.
   */
  const keptLive = () => {
    let heard = false
    return {
      heard: () => heard,
      watchBatch: () =>
        Effect.succeed(
          Stream.concat(
            Stream.fromEffect(
              Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50))).pipe(
                Effect.map(() => {
                  heard = true
                  return { kind: 'sync' as const }
                }),
              ),
            ),
            Stream.never,
          ),
        ),
    }
  }
  const live = () => page.getByTestId('entries-live')
  /** long enough after the line spoke for a mark to have been drawn */
  const settled = () => new Promise((resolve) => setTimeout(resolve, 300))

  // The account follows the round while the line is open, and the head says
  // so beside the way to ask again - never "provisional" in its place.
  it('says the account is kept live once the line opens, and nothing before', async () => {
    await page.viewport(1440, 900)
    let open = () => {}
    const opened = new Promise<void>((resolve) => {
      open = resolve
    })
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      stubs: {
        watchBatch: () =>
          Effect.succeed(
            Stream.concat(
              Stream.fromEffect(
                Effect.promise(() => opened).pipe(Effect.as({ kind: 'sync' as const })),
              ),
              Stream.never,
            ),
          ),
      },
    })
    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    expect(live().elements()).toHaveLength(0)
    open()
    await expect.element(live()).toHaveAttribute('data-state', 'live')
  })

  // The same rule as the score page's mark, which is the stream's own: a
  // line that drops before it proved steady is lost the moment it drops,
  // not after a grace of the page's own.
  it('says it is reconnecting as soon as a line drops before it proved steady', async () => {
    await page.viewport(1440, 900)
    // The first connection to speak says hello and drops; the ones after it
    // stay silent. It speaks a moment after it is dialled, so the dial a
    // remount abandons at once never does.
    let dropped = 0
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      stubs: {
        watchBatch: () =>
          Effect.succeed(
            dropped > 0
              ? Stream.never
              : Stream.fromEffect(
                  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 50))).pipe(
                    Effect.map(() => {
                      dropped = Date.now()
                      return { kind: 'sync' as const }
                    }),
                  ),
                ),
          ),
      },
    })
    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    await expect.poll(() => dropped, { timeout: 3_000 }).toBeGreaterThan(0)
    await expect
      .poll(() => live().element().getAttribute('data-state'), { timeout: 2_500 })
      .toBe('reconnecting')
    // well inside the five seconds a grace of the page's own would have waited
    expect(Date.now() - dropped).toBeLessThan(4_000)
  })

  // An account that no longer moves is not said to be kept current.
  it('says nothing about keeping current once the round is archived', async () => {
    await page.viewport(1440, 900)
    const line = keptLive()
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      stubs: {
        watchBatch: line.watchBatch,
        getBatch: () =>
          Effect.succeed({
            batch: {
              id: BATCH_ID,
              name: '2026 春季综测',
              descriptionMd: null,
              manageable: false,
              reviewReasons: { reject: [], escalate: [] },
              capabilities: {
                personal: true,
                review: false,
                record: false,
                manage: false,
                redetermine: false,
              },
              participantCount: 12,
              materialRange: { start: '2026-03-01', end: '2026-09-01' },
              timezone: 'Asia/Shanghai',
              status: 'archived',
              configRevision: 1,
              currentPhaseId: null,
              currentPhaseName: null,
              createdAt: '2026-02-01T00:00:00.000Z',
            },
          }),
      },
    })
    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    await expect.poll(line.heard).toBe(true)
    await settled()
    expect(live().elements()).toHaveLength(0)
  })

  it('says nothing about keeping current once the owner is off the roster', async () => {
    await page.viewport(1440, 900)
    const line = keptLive()
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      stubs: {
        watchBatch: line.watchBatch,
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: [claim(1, itemId(1), 'approved')],
            filing: [itemId(1), itemId(2)].map((id) => ({
              itemId: id,
              create: hidden,
              submit: hidden,
            })),
            nextCursor: null,
            attention: { unreadEntryIds: [] },
          }),
      },
    })
    await expect.poll(() => rows().length).toBe(1)
    await expect.poll(line.heard).toBe(true)
    await settled()
    expect(live().elements()).toHaveLength(0)
  })

  // The head's "in review" and the list's filter of the same name hold the
  // same claims: one the owner appealed is out with the reviewers again, and
  // one a reviewer asked more of is still in review while it waits on them.
  it('counts an appealed claim as in review, as its filter does', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      entries: [
        claim(1, itemId(1), 'in_review'),
        claim(2, itemId(1), 'rejected', {
          openRound: { origin: 'appeal' },
        }),
        claim(3, itemId(1), 'approved'),
        claim(4, itemId(1), 'in_review', {
          supplement: {
            requestId: 'r1',
            instanceId: 'i1',
            requestNo: 1,
            instructions: '请补充盖章页',
            requirements: [],
            requestedByName: null,
            requestedAt: '2026-04-02T00:00:00.000Z',
          },
        }),
      ],
    })
    await expect
      .poll(() => document.querySelector('[data-stat="in_review"]')?.getAttribute('data-count'))
      .toBe('3')
    expect(document.querySelector('[data-chip="in_review"]')?.getAttribute('data-count')).toBe('3')
    // and it is the owner's to-do as well
    expect(document.querySelector('[data-chip="todo"]')?.getAttribute('data-count')).toBe('1')
  })

  // Full marks are what the limited sections add up to; a deduction section
  // with no limit neither adds to them nor takes them away.
  it('totals full marks over the limited sections, past one that sets none', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: base,
      items: [question(1, '学业成绩', BAND_A), question(2, '违纪扣分', BAND_B)],
      groups: [group(BAND_A, null, '学业发展', 0), group(BAND_B, null, '纪律扣分', 1)],
      stubs: {
        // the limits the account applied, which is where the head reads them
        getMyResult: () =>
          Effect.succeed({
            mode: 'provisional',
            total: '4.00',
            groups: [
              { groupId: BAND_A, cap: '10.00', final: '6.00' },
              { groupId: BAND_B, cap: null, final: '-2.00' },
            ].map((one) => ({
              ...one,
              parentGroupId: null,
              depth: 0,
              name: one.groupId,
              itemsTotal: one.final,
              childrenTotal: '0.00',
              raw: one.final,
              floor: null,
            })),
            lines: [],
          }),
      },
    })
    await expect.element(page.getByTestId('entries-total')).toHaveAttribute('data-cap', '10')
  })

  // News landing on the claim being read is read at once: the mark does not
  // wait for the reader to shut the claim and open it again.
  it('reads news that arrives on the claim already open', async () => {
    await page.viewport(1440, 900)
    let unread: readonly string[] = []
    const looked = vi.fn((_: { params: { entryId: string } }) =>
      Effect.succeed({ ok: true as const }),
    )
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const filed = [claim(1, itemId(2), 'approved')]
    await workspace({
      route: `${base}?open=${itemId(2)}&detail=${entryId(1)}`,
      entries: filed,
      stubs: {
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: filed,
            nextCursor: null,
            attention: { unreadEntryIds: unread },
          }),
        markMyEntryRead: looked,
        watchBatch: () =>
          Effect.succeed(
            Stream.concat(
              Stream.fromEffect(
                Effect.promise(() => gate).pipe(Effect.as({ kind: 'entries-changed' as const })),
              ),
              Stream.never,
            ),
          ),
      },
    })
    // the claim's drawer is up over its question
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(looked).not.toHaveBeenCalled()
    unread = [entryId(1)]
    release()
    await vi.waitFor(() => expect(looked).toHaveBeenCalledOnce())
    expect(looked.mock.calls[0]![0].params.entryId).toBe(entryId(1))
    await expect.poll(() => page.getByTestId('unread-mark').elements().length).toBe(0)
    expect(railRow(2).getAttribute('data-unread')).toBe('false')
  })
})

describe('a question arriving', () => {
  // The pane steps in from a little way below when the reader goes to the
  // next question. That reach past the room it arrives in must never become
  // room to scroll into: it flashed a scroll bar up for every step down.
  it('never lets the pane’s arrival make its column scroll', async () => {
    await commands.emulateMedia({ reducedMotion: 'no-preference' })
    try {
      await expect.poll(() => matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(false)
      for (let frame = 0; frame < 3; frame += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }
      await page.viewport(1440, 900)
      await workspace({
        route: `${base}?open=${itemId(1)}`,
        entries: [claim(1, itemId(1), 'approved'), claim(2, itemId(2), 'approved')],
      })
      await expect.poll(() => rows().length).toBe(1)
      // the middle column's own scroller, the nearest one above the pane
      let column = document.querySelector('[data-testid="item-pane"]')!.parentElement!
      while (getComputedStyle(column).overflowY !== 'auto') column = column.parentElement!
      let most = 0
      let watching = true
      const watch = () => {
        most = Math.max(most, column.scrollHeight - column.clientHeight)
        if (watching) requestAnimationFrame(watch)
      }
      requestAnimationFrame(watch)
      await page.getByRole('button', { name: /下一项/ }).click()
      await expect.poll(() => openItem()).toBe(itemId(2))
      await new Promise((resolve) => setTimeout(resolve, 400))
      watching = false
      expect(most).toBeLessThanOrEqual(0)
    } finally {
      await commands.emulateMedia({ reducedMotion: 'reduce' })
    }
  })
})

/** what a shell reads of the screen inside it: whether it fills the room */
function FillProbe() {
  return <span hidden data-testid="fill-probe" data-claimed={useScreenFillClaimed()} />
}

describe('an address naming a claim', () => {
  // A link to a claim that is gone - given up, or never this reader's - opens
  // nothing: it used to open an empty form for a new claim in its place.
  it('opens no form for a claim that is not there', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: `${base}?open=${itemId(1)}&entry=${entryId(9)}`,
      entries: [claim(1, itemId(1), 'approved')],
    })
    await expect.poll(() => rows().length).toBe(1)
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('still opens the form for a new claim the address asks for', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${itemId(1)}&entry=new` })
    await expect.poll(() => document.querySelector('[role="dialog"]')).not.toBeNull()
  })
})

describe('the room the page asks of the shell', () => {
  // From a tablet up the workspace scrolls each column in its own place and
  // the window never, so the page tells the shell it fills the room - the
  // shell keeps no gutter then for a scroll bar that never comes. A phone's
  // is a page that scrolls, and asks nothing.
  it.each([
    [1440, 900, 'true'],
    [834, 1112, 'true'],
    [390, 844, 'false'],
  ] as const)('fills the room at %ipx: %s', async (width, height, claimed) => {
    await page.viewport(width, height)
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      around: (screen) => (
        <ScreenFillScope>
          {screen}
          <FillProbe />
        </ScreenFillScope>
      ),
    })
    await expect.element(page.getByTestId('entries-workspace')).toBeInTheDocument()
    await expect.element(page.getByTestId('fill-probe')).toHaveAttribute('data-claimed', claimed)
  })
})

describe('the workspace while it loads', () => {
  const bones = () => document.querySelector('[data-testid="workspace-skeleton"]')
  const widths = () =>
    [...bones()!.children].map((part) => [
      part.getAttribute('data-bone'),
      Math.round(part.getBoundingClientRect().width),
    ])

  // It stands in the columns the workspace is about to fill, at the widths
  // it will fill them, so nothing moves when the reads come back.
  it.each([
    [1440, 900, 'desk', 340, 300],
    [1920, 1080, 'desk', 380, 360],
    [834, 1112, 'tablet', 300, null],
  ] as const)(
    'stands in the workspace’s own columns at %ipx',
    async (width, height, mode, structure, requirements) => {
      await page.viewport(width, height)
      await workspace({
        route: `${base}?open=${itemId(1)}`,
        stubs: { listItems: () => Effect.never },
      })
      await expect.poll(() => bones()?.getAttribute('data-mode')).toBe(mode)
      const parts = widths()
      expect(parts[0]).toEqual(['structure', structure])
      expect(parts[1]![0]).toBe('question')
      expect(parts[2] ?? null).toEqual(
        requirements === null ? null : ['requirements', requirements],
      )
      // as many figures under the total as the owner keeps out
      expect(bones()!.querySelector('[data-bone="stats"]')?.children.length).toBe(3)
    },
  )

  // The toolbar a question's pane takes is decided by the pane's width, and
  // a laptop's three columns leave the middle one narrow: the outline draws
  // the shape the pane is about to take, not the shape the window suggests.
  it.each([
    [1280, 800],
    [1440, 900],
    [834, 1112],
  ] as const)('outlines the toolbar the pane will take at %ipx', async (width, height) => {
    await page.viewport(width, height)
    const loading = await workspace({
      route: `${base}?open=${TAIL}`,
      stubs: { listItems: () => Effect.never },
    })
    await expect.poll(() => bones()).not.toBeNull()
    const outlined = bones()!.querySelector('[data-bone="toolbar"]')!.getAttribute('data-shape')
    await loading.unmount()
    await workspace({ route: `${base}?open=${TAIL}`, entries: [claim(1, TAIL, 'in_review')] })
    await expect.poll(() => rows().length).toBe(1)
    expect({ width, shape: outlined }).toEqual({
      width,
      shape: document.querySelector('[data-testid="entries-toolbar"]')!.getAttribute('data-shape'),
    })
  })

  it('stands in a phone’s structure, or the question the address opens', async () => {
    await page.viewport(390, 844)
    await workspace({ route: base, stubs: { listItems: () => Effect.never } })
    await expect.poll(() => bones()?.getAttribute('data-mode')).toBe('phone')
    expect(widths().map(([part]) => part)).toEqual(['structure'])
  })

  it('stands in the question a phone’s address opens', async () => {
    await page.viewport(390, 844)
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      stubs: { listItems: () => Effect.never },
    })
    await expect.poll(() => bones()?.getAttribute('data-mode')).toBe('phone')
    expect(widths().map(([part]) => part)).toEqual(['question'])
  })

  // The figures a reader has put away do not come back while the page loads,
  // and a staff reader's head holds six.
  it('draws the figures the reader keeps out, and none they put away', async () => {
    await page.viewport(1440, 900)
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        assessment: {},
      }),
      storage: { 'qualy:assessment-entries-stats:owner': '0' },
      routes: [
        {
          path: '/',
          element: (
            <div style={{ display: 'flex', height: '100dvh', flexDirection: 'column' }}>
              <div data-testid="owner" style={{ display: 'flex', flex: '1 1 0%', minHeight: 0 }}>
                <WorkspaceSkeleton viewer="owner" open={false} />
              </div>
              <div data-testid="staff" style={{ display: 'flex', flex: '1 1 0%', minHeight: 0 }}>
                <WorkspaceSkeleton viewer="staff" open={false} />
              </div>
            </div>
          ),
        },
      ] as never,
    })
    await expect.element(page.getByTestId('staff')).toBeInTheDocument()
    const stats = (who: string) =>
      document.querySelector(`[data-testid="${who}"] [data-bone="stats"]`)
    expect(stats('owner')).toBeNull()
    expect(stats('staff')?.children.length).toBe(6)
  })
})

describe('the figures under the total', () => {
  // They take a good part of a short window. The reader may put them away,
  // this browser remembers, and nothing is lost: what waits on the reader is
  // still counted on the "to do" key.
  it('puts the figures away at the reader’s word, and keeps them away', async () => {
    await page.viewport(1440, 900)
    const filed = [claim(1, itemId(1), 'needs_revision'), claim(2, itemId(2), 'draft')]
    await workspace({ route: `${base}?open=${itemId(1)}`, entries: filed })
    const key = page.getByTestId('stats-toggle')
    await expect.element(key).toHaveAttribute('aria-expanded', 'true')
    await expect.element(page.getByTestId('entries-stats')).toBeVisible()
    await key.click()
    await expect.element(key).toHaveAttribute('aria-expanded', 'false')
    await expect.poll(() => document.querySelector('[data-testid="entries-stats"]')).toBeNull()
    expect(localStorage.getItem('qualy:assessment-entries-stats:owner')).toBe('0')
    await expect.element(page.getByTestId('rail-todo')).toHaveAttribute('data-count', '2')
    await key.click()
    await expect.element(page.getByTestId('entries-stats')).toBeVisible()
  })

  it('opens with the figures put away where this browser last left them so', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      entries: [claim(1, itemId(1), 'needs_revision')],
      storage: { 'qualy:assessment-entries-stats:owner': '0' },
    })
    await expect.element(page.getByTestId('stats-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('[data-testid="entries-stats"]')).toBeNull()
    await expect.element(page.getByTestId('rail-todo')).toHaveAttribute('data-count', '1')
  })
})

describe('what a question’s row says at a glance', () => {
  // The dot says where a question stands and only that; news the owner has
  // not read is a count of its own, read one claim at a time by opening the
  // claim - so opening a question takes nothing away, and reading a claim
  // leaves the standing exactly where it was.
  it('counts news apart from the dot, and opening a claim reads that claim alone', async () => {
    await page.viewport(1440, 900)
    const looked = vi.fn((_: { params: { entryId: string } }) =>
      Effect.succeed({ ok: true as const }),
    )
    const filed = [
      claim(1, itemId(3), 'needs_revision'),
      claim(2, itemId(3), 'approved'),
      claim(3, itemId(4), 'approved'),
    ]
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      entries: filed,
      stubs: {
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: filed,
            nextCursor: null,
            attention: { unreadEntryIds: [entryId(1), entryId(2), entryId(3)] },
          }),
        markMyEntryRead: looked,
      },
    })
    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    const dot = (n: number) => railRow(n).querySelector('[data-dot]')?.getAttribute('data-dot')
    const news = (n: number) =>
      railRow(n).querySelector('[data-testid="unread-mark"]')?.getAttribute('data-count') ?? null
    // unread, each still wears its own standing: amber for the one sent
    // back, green for the one that counts - never one colour for both
    await expect.poll(() => news(3)).toBe('2')
    expect(dot(3)).toBe('waits')
    expect(news(4)).toBe('1')
    expect(dot(4)).toBe('approved')

    // opening the question is not reading its claims
    await userEvent.click(railRow(3))
    await expect.element(page.getByRole('heading', { name: '品德题目 3' })).toBeVisible()
    expect(looked).not.toHaveBeenCalled()
    const claimRow = (n: number) =>
      document.querySelector(`[data-testid="claim-row"][data-entry="${entryId(n)}"]`)!
    expect(claimRow(1).getAttribute('data-unread')).toBe('true')
    expect(claimRow(2).getAttribute('data-unread')).toBe('true')
    // the news is in the list in view: no filter needs to point at it
    expect(document.querySelector('[data-chip="todo"]')?.hasAttribute('data-unread')).toBe(false)

    await userEvent.click(claimRow(1))
    await vi.waitFor(() => expect(looked).toHaveBeenCalledOnce())
    expect(looked.mock.calls[0]![0].params.entryId).toBe(entryId(1))
    await expect.poll(() => news(3)).toBe('1')
    expect(claimRow(1).hasAttribute('data-unread')).toBe(false)
    expect(claimRow(2).getAttribute('data-unread')).toBe('true')
    expect(dot(3)).toBe('waits')
    // the question not opened keeps its news
    expect(news(4)).toBe('1')
  })

  // A claim that went with its question, or a record the office took back,
  // is not among the question's live claims - but its news is read the same
  // way, so the filter it sits under is offered and says it holds news.
  it('opens a claim that went with its question, and reads it there', async () => {
    await page.viewport(1440, 900)
    const looked = vi.fn((_: { params: { entryId: string } }) =>
      Effect.succeed({ ok: true as const }),
    )
    const gone = question(2, '社团活动', BAND_A, { status: 'voided', voidReason: '已并入' })
    const filed = [claim(1, itemId(2), 'voided'), claim(2, itemId(1), 'voided')]
    await workspace({
      route: `${base}?open=${itemId(2)}`,
      items: [question(1, '品德题目 1', BAND_A), gone],
      entries: filed,
      stubs: {
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: filed,
            nextCursor: null,
            attention: { unreadEntryIds: [entryId(1)] },
          }),
        markMyEntryRead: looked,
      },
    })
    await expect.element(page.getByRole('heading', { name: '社团活动' })).toBeVisible()
    await expect
      .poll(() =>
        railRow(2).querySelector('[data-testid="unread-mark"]')?.getAttribute('data-count'),
      )
      .toBe('1')
    // nothing live under it: the list opens on the claim that went with it,
    // news and all, with no filter to find first and no empty tray saying
    // there is nothing
    await expect.poll(() => rows().length).toBe(1)
    const chip = () => document.querySelector('[data-chip="voided"]')!
    expect(chip().getAttribute('data-count')).toBe('1')
    expect(chip().getAttribute('aria-pressed')).toBe('true')
    expect(document.querySelector('[data-chip="all"]')).toBeNull()
    expect(document.querySelector('[data-testid="entries-tray"]')).toBeNull()
    const row = document.querySelector(`[data-testid="claim-row"][data-entry="${entryId(1)}"]`)!
    expect(row.getAttribute('data-unread')).toBe('true')
    // went with its question: voided, not given up by its owner - and with
    // no time given for it, since the claim holds none of its ending
    expect(row.querySelector('[data-testid="entry-standing"]')?.getAttribute('data-ended')).toBe(
      'with-item',
    )
    expect(row.querySelector('[data-when]')).toBeNull()
    await userEvent.click(row)
    await vi.waitFor(() => expect(looked).toHaveBeenCalledOnce())
    expect(looked.mock.calls[0]![0].params.entryId).toBe(entryId(1))
    await expect.poll(() => railRow(2).querySelector('[data-testid="unread-mark"]')).toBeNull()
    // nor does the drawer's head
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(document.querySelector('[data-head-fact="standing"]')).not.toBeNull()
    expect(document.querySelector('[data-head-fact="when"]')).toBeNull()

    // the one its owner gave up under a live question sits under its own filter
    await userEvent.keyboard('{Escape}')
    await expect.poll(() => document.querySelector('[role="dialog"]')).toBeNull()
    await userEvent.click(railRow(1))
    await expect
      .poll(() => document.querySelector('[data-chip="abandoned"]')?.getAttribute('data-count'))
      .toBe('1')
    expect(document.querySelector('[data-chip="voided"]')).toBeNull()
  })

  // News is never out of sight: a narrower view of the structure, or a
  // filter over the claims, that leaves some out says so on the key that
  // brings them back - to the eye with a dot, to a screen reader in words.
  it('says where news lies outside the view in force, to the eye and aloud', async () => {
    await page.viewport(1440, 900)
    const filed = [
      claim(1, itemId(1), 'approved'),
      claim(2, itemId(2), 'needs_revision'),
      claim(3, itemId(3), 'in_review'),
      claim(4, itemId(3), 'voided'),
    ]
    await workspace({
      route: `${base}?open=${itemId(3)}`,
      items: [
        question(1, '品德题目 1', BAND_A),
        question(2, '品德题目 2', BAND_A),
        question(3, '品德题目 3', BAND_A),
      ],
      entries: filed,
      stubs: {
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: filed,
            nextCursor: null,
            attention: { unreadEntryIds: [entryId(1), entryId(4)] },
          }),
      },
    })
    const holds = zhCN['assessment/entry/holds-unread']
    // the claim given up is behind its filter while the live ones show
    const abandoned = page.getByRole('button', { name: new RegExp(`已放弃.*${holds}`) })
    await expect.element(abandoned).toHaveAttribute('data-unread', 'true')

    // only what waits on the reader: the question with news is left out, and
    // the key back to all of them says so
    const all = () => document.querySelector('[data-testid="rail-all"]')!
    expect(all().hasAttribute('data-unread')).toBe(false)
    await userEvent.click(document.querySelector('[data-testid="rail-todo"]')!)
    await expect.poll(() => railRow(1)).toBeNull()
    expect(all().getAttribute('data-unread')).toBe('true')
    await expect.element(page.getByTestId('rail-all')).toHaveAccessibleName(new RegExp(holds))
  })

  // The dot on a claim with news stands level with its name and clear of the
  // row's edge and of the name, at a desk and on a phone alike.
  it('sets a claim’s news dot level with its name, clear of the edge', async () => {
    for (const width of [390, 834, 1440]) {
      await page.viewport(width, 900)
      const filed = [claim(1, itemId(1), 'in_review'), claim(2, itemId(1), 'approved')]
      const { unmount } = await workspace({
        route: `${base}?open=${itemId(1)}`,
        entries: filed,
        stubs: {
          listMyEntries: () =>
            Effect.succeed({
              participantId: PARTICIPANT_ID,
              entries: filed,
              nextCursor: null,
              attention: { unreadEntryIds: [entryId(1)] },
            }),
        },
      })
      await expect.poll(() => rows().length).toBe(2)
      const row = rows().find((one) => one.getAttribute('data-entry') === entryId(1))!
      const at = row.getBoundingClientRect()
      const dot = row.querySelector('[data-testid="unread-dot"]')!.getBoundingClientRect()
      const lead = row.querySelector('[data-part="lead"]')!.getBoundingClientRect()
      expect({ width, edge: dot.left - at.left >= 10 }).toEqual({ width, edge: true })
      expect({ width, gap: lead.left - dot.right >= 6 }).toEqual({ width, gap: true })
      const middle = (box: DOMRect) => box.top + box.height / 2
      expect({ width, level: Math.abs(middle(dot) - middle(lead)) <= 1.5 }).toEqual({
        width,
        level: true,
      })
      await unmount()
    }
  })

  // The count's small white figure reads on its red in either scheme: the
  // dark scheme lifts its red to be read as text, and a count mixed from it
  // came out too light for the figure on it.
  it('keeps the news count’s figure legible on its red, in the dark as on paper', async () => {
    /** a painted colour as sRGB channels, whatever notation it computes to */
    const channels = (css: string) => {
      const context = document.createElement('canvas').getContext('2d')!
      context.fillStyle = css
      context.fillRect(0, 0, 1, 1)
      return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)]
    }
    const luminance = (rgb: readonly number[]) => {
      const [r, g, b] = rgb.map((value) => {
        const unit = value / 255
        return unit <= 0.04045 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4
      })
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
    }
    const contrast = (a: readonly number[], b: readonly number[]) => {
      const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
      return (light! + 0.05) / (dark! + 0.05)
    }
    const root = document.documentElement
    try {
      for (const scheme of ['light', 'dark'] as const) {
        root.classList.toggle('dark', scheme === 'dark')
        root.setAttribute('data-mode', scheme)
        const filed = [claim(1, itemId(1), 'in_review')]
        const { unmount } = await workspace({
          route: `${base}?open=${itemId(2)}`,
          entries: filed,
          stubs: {
            listMyEntries: () =>
              Effect.succeed({
                participantId: PARTICIPANT_ID,
                entries: filed,
                nextCursor: null,
                attention: { unreadEntryIds: [entryId(1)] },
              }),
          },
        })
        await expect
          .poll(() => railRow(1).querySelector('[data-testid="unread-mark"]'))
          .not.toBeNull()
        const mark = getComputedStyle(railRow(1).querySelector('[data-testid="unread-mark"]')!)
        const ratio = contrast(channels(mark.backgroundColor), channels(mark.color))
        expect({ scheme, legible: ratio >= 4.5 }).toEqual({ scheme, legible: true })
        await unmount()
      }
    } finally {
      root.classList.remove('dark')
      root.setAttribute('data-mode', 'light')
    }
  })

  // Among ended claims the one holding news is where the list opens, and a
  // question still taking claims keeps its way in under them.
  it('opens on the ended claims holding news, and keeps the way to file under them', async () => {
    await page.viewport(1440, 900)
    const filed = [
      claim(1, itemId(1), 'voided'),
      claim(2, itemId(1), 'voided', { source: 'record' }),
    ]
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      items: [question(1, '品德题目 1', BAND_A)],
      entries: filed,
      stubs: {
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: filed,
            nextCursor: null,
            attention: { unreadEntryIds: [entryId(2)] },
          }),
      },
    })
    await expect
      .poll(() => rows().map((row) => row.getAttribute('data-entry')))
      .toEqual([entryId(2)])
    expect(document.querySelector('[data-chip="revoked"]')?.getAttribute('aria-pressed')).toBe(
      'true',
    )
    // the other ended claim is one filter away, and says nothing it has not
    expect(document.querySelector('[data-chip="abandoned"]')?.hasAttribute('data-unread')).toBe(
      false,
    )
    expect(document.querySelector('[data-testid="entries-tray"]')).toBeNull()
    // the way in stands after the claims, where the next one would start
    const keys = [...document.querySelectorAll('[data-testid="file-claim"]')]
    expect(
      keys.some(
        (key) => rows()[0]!.compareDocumentPosition(key) & Node.DOCUMENT_POSITION_FOLLOWING,
      ),
    ).toBe(true)
  })

  // The right edge of the structure says one thing one way: a word only
  // where the reader has something to do, every figure to two places in one
  // column, and a section's figure with its limit and no unit - the unit is
  // said once, at the head.
  it('draws a word only where the reader has work, and every figure one way', async () => {
    await page.viewport(1440, 900)
    const line = (n: number, item: string, value: string) => ({
      lineId: `entry:${entryId(n)}`,
      kind: 'entry',
      label: '',
      value,
      itemId: item,
      provenance: { entryId: entryId(n) },
    })
    const filed = [
      claim(1, itemId(1), 'approved'),
      claim(2, itemId(2), 'draft'),
      claim(3, itemId(2), 'approved'),
      claim(4, itemId(3), 'in_review'),
      claim(5, itemId(4), 'needs_revision'),
      claim(6, itemId(5), 'rejected'),
    ]
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      items: [
        question(1, '品德题目 1', BAND_A),
        question(2, '品德题目 2', BAND_A),
        question(3, '品德题目 3', BAND_A),
        question(4, '品德题目 4', BAND_A),
        question(5, '纪律题目 5', DEEP_B),
      ],
      groups: [group(BAND_A, null, '品德行为表现', 0), group(DEEP_B, null, '纪律扣分', 1)],
      entries: filed,
      stubs: {
        getMyResult: () =>
          Effect.succeed({
            mode: 'provisional',
            total: '5.80',
            groups: [
              { groupId: BAND_A, cap: '20.00', final: '5.8' },
              { groupId: DEEP_B, cap: null, final: '0' },
            ].map((one) => ({
              ...one,
              parentGroupId: null,
              depth: 0,
              name: one.groupId,
              itemsTotal: one.final,
              childrenTotal: '0.00',
              raw: one.final,
              floor: null,
            })),
            lines: [line(1, itemId(1), '4.8'), line(3, itemId(2), '1')],
          }),
      },
    })
    await expect
      .poll(() => railRow(1).querySelector('[data-amount]')?.getAttribute('data-amount'))
      .toBe('4.80')
    // words drawn only on the draft and the one sent back
    const worded = [...document.querySelectorAll('[data-rail-row] [data-word]')].map((word) =>
      word.closest('[data-rail-row]')?.getAttribute('data-tag'),
    )
    expect(worded).toEqual(['draft', 'needs_revision'])
    // ...and every row still says where it stands to a screen reader
    const said = {
      1: zhCN['assessment/entry/status-approved'],
      3: zhCN['assessment/entry/status-in-review'],
      5: zhCN['assessment/entry/status-rejected'],
    } as const
    for (const [n, word] of Object.entries(said)) {
      expect(railRow(Number(n)).querySelector('[data-word]')).toBeNull()
      expect(railRow(Number(n)).textContent).toContain(word)
    }
    // figures to two places, ending at one edge down the right; a question
    // with none keeps no empty column for one
    expect(railRow(2).querySelector('[data-amount]')?.getAttribute('data-amount')).toBe('1.00')
    for (const n of [3, 4, 5]) expect(railRow(n).querySelector('[data-amount]')).toBeNull()
    const cells = [1, 2].map((n) =>
      railRow(n).querySelector('[data-amount]')!.getBoundingClientRect(),
    )
    expect(Math.round(cells[1]!.right)).toBe(Math.round(cells[0]!.right))
    // a section's figure: two places, with its limit where it has one
    const figure = (id: string) =>
      document
        .querySelector(`[data-rail-row="${id}"]`)!
        .querySelector('[data-testid="section-figure"]')!
    expect(figure(BAND_A).getAttribute('data-got')).toBe('5.80')
    expect(figure(BAND_A).querySelector('[data-testid="section-meter"]')).not.toBeNull()
    expect(figure(DEEP_B).getAttribute('data-got')).toBe('0.00')
    expect(figure(DEEP_B).querySelector('[data-testid="section-meter"]')).toBeNull()
  })

  // On a tablet's narrow structure a long English word, a count and a figure
  // all ask for room beside a question's name; the name is what the row is,
  // so it keeps its first characters and the word gives way after it.
  it('keeps a question’s name in sight beside a long word on a tablet', async () => {
    await page.viewport(834, 900)
    const filed = [claim(1, itemId(1), 'needs_revision'), claim(2, itemId(1), 'approved')]
    await workspace({
      route: `${base}?open=${itemId(2)}`,
      locale: 'en-US',
      // two sections deep, where the row is narrowest
      items: [question(1, '学生干部任职情况', SUB_B), question(2, '品德题目 2', BAND_A)],
      groups: [
        group(BAND_A, null, '品德行为表现', 0),
        group(BAND_B, null, '学业发展', 1),
        group(SUB_B, BAND_B, '学科竞赛', 0),
      ],
      entries: filed,
      stubs: {
        listMyEntries: () =>
          Effect.succeed({
            participantId: PARTICIPANT_ID,
            entries: filed,
            nextCursor: null,
            attention: { unreadEntryIds: [entryId(1)] },
          }),
        getMyResult: () =>
          Effect.succeed({
            mode: 'provisional',
            total: '2.00',
            groups: [],
            lines: [
              {
                lineId: `entry:${entryId(2)}`,
                kind: 'entry',
                label: '',
                value: '2',
                itemId: itemId(1),
                provenance: { entryId: entryId(2) },
              },
            ],
          }),
      },
    })
    await expect
      .poll(() => railRow(1).querySelector('[data-amount]')?.getAttribute('data-amount'))
      .toBe('2.00')
    expect(railRow(1).querySelector('[data-word]')).not.toBeNull()
    expect(railRow(1).querySelector('[data-testid="unread-mark"]')).not.toBeNull()
    const name = railRow(1).querySelector('[data-rail-name]') as HTMLElement
    const size = Number.parseFloat(getComputedStyle(name).fontSize)
    // five characters of it at least, each as wide as the type is high
    expect(name.clientWidth).toBeGreaterThanOrEqual(5 * size - 1)
    // a question with neither word nor figure keeps no empty room for them
    const plain = railRow(2).querySelector('[data-rail-name]') as HTMLElement
    expect(plain.clientWidth).toBe(plain.scrollWidth)
  })

  // A section's fill is a small pie beside its figure, not a line along the foot
  // of its row: a full line there is indistinguishable from the rule under it.
  it('draws a section’s fill beside its figure, full in its own colour', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      items: [question(1, '学业成绩', BAND_A), question(2, '志愿服务', BAND_B)],
      groups: [group(BAND_A, null, '学业发展', 0), group(BAND_B, null, '思想品德', 1)],
      stubs: {
        getMyResult: () =>
          Effect.succeed({
            mode: 'provisional',
            total: '25.00',
            groups: [
              { groupId: BAND_A, cap: '20.00', final: '20.00' },
              { groupId: BAND_B, cap: '20.00', final: '5.00' },
            ].map((one) => ({
              ...one,
              parentGroupId: null,
              depth: 0,
              name: one.groupId,
              itemsTotal: one.final,
              childrenTotal: '0.00',
              raw: one.final,
              floor: null,
            })),
            lines: [],
          }),
      },
    })
    const meter = (id: string) =>
      document.querySelector(`[data-rail-row="${id}"] [data-testid="section-meter"]`)
    await expect.poll(() => meter(BAND_A)?.getAttribute('data-full')).toBe('true')
    expect(meter(BAND_A)?.getAttribute('data-share')).toBe('100')
    expect(meter(BAND_B)?.getAttribute('data-full')).toBe('false')
    expect(meter(BAND_B)?.getAttribute('data-share')).toBe('25')
    // nothing is drawn along the foot of the section's row
    const row = document.querySelector(`[data-rail-row="${BAND_A}"]`)!.closest('li')!
    const foot = row.getBoundingClientRect().bottom
    const lines = [...row.querySelectorAll('span')].filter((span) => {
      const box = span.getBoundingClientRect()
      return box.width > 60 && box.height <= 3 && Math.abs(box.bottom - foot) < 3
    })
    expect(lines).toHaveLength(0)
  })

  // The same pie wherever a section's figure stands: the sections a
  // question's requirements list, and a section's own page. A line across
  // either reads as a rule, full or not.
  it('draws a section’s fill as the same pie in the requirements and on its own page', async () => {
    await page.viewport(1440, 900)
    const finals: Record<string, string> = {
      [BAND_A]: '20.00',
      [BAND_B]: '20.00',
      [SUB_B]: '12.00',
    }
    await workspace({
      route: `${base}?open=${TAIL}`,
      stubs: {
        getMyResult: () =>
          Effect.succeed({
            mode: 'provisional',
            total: '40.00',
            groups: Object.entries(finals).map(([groupId, final]) => ({
              groupId,
              cap: '20.00',
              final,
              parentGroupId: null,
              depth: 0,
              name: groupId,
              itemsTotal: final,
              childrenTotal: '0.00',
              raw: final,
              floor: null,
            })),
            lines: [],
          }),
      },
    })
    /** anything drawn as a line: wide and a few pixels tall */
    const rules = (within: Element) =>
      [...within.querySelectorAll('span')].filter((span) => {
        const box = span.getBoundingClientRect()
        return box.width > 60 && box.height > 0 && box.height <= 4
      })
    const aside = page.getByRole('complementary', { name: '填报要求' })
    const meter = (id: string) =>
      aside.element().querySelector(`[data-section="${id}"] [data-testid="section-meter"]`)
    await expect.poll(() => meter(BAND_B)?.getAttribute('data-full')).toBe('true')
    expect(meter(SUB_B)?.getAttribute('data-full')).toBe('false')
    expect(meter(SUB_B)?.getAttribute('data-share')).toBe('60')
    // a section with no limit has nothing to fill
    expect(meter(DEEP_B)).toBeNull()
    const sections = aside.element().querySelector(`[data-section="${BAND_B}"]`)!.parentElement!
    expect(rules(sections)).toHaveLength(0)

    await userEvent.click(document.querySelector(`[data-rail-row="${BAND_A}"]`)!)
    const pane = page.getByTestId('group-pane')
    await expect.element(pane).toHaveAttribute('data-group', BAND_A)
    const head = pane.element().querySelector('[data-pane-title]')!.closest('div')!.parentElement!
    expect(head.querySelector('[data-testid="section-meter"]')?.getAttribute('data-full')).toBe(
      'true',
    )
    expect(rules(pane.element())).toHaveLength(0)
  })
})

describe('where filing is shut', () => {
  const shut = (reason: string) => ({ state: 'blocked' as const, reason })
  const filing = (reason: string) => ({
    listMyEntries: () =>
      Effect.succeed({
        participantId: PARTICIPANT_ID,
        entries: [claim(1, itemId(1), 'approved'), claim(2, itemId(1), 'in_review')],
        filing: [itemId(1), itemId(2)].map((id) => ({
          itemId: id,
          create: shut(reason),
          submit: shut(reason),
        })),
        nextCursor: null,
        attention: { unreadEntryIds: [] },
      }),
  })
  const archived = () =>
    Effect.succeed({
      batch: {
        id: BATCH_ID,
        name: '2026 春季综测',
        descriptionMd: null,
        manageable: false,
        reviewReasons: { reject: [], escalate: [] },
        capabilities: {
          personal: true,
          review: false,
          record: false,
          manage: false,
          redetermine: false,
        },
        participantCount: 12,
        materialRange: { start: '2026-03-01', end: '2026-09-01' },
        timezone: 'Asia/Shanghai',
        status: 'archived',
        configRevision: 1,
        currentPhaseId: null,
        currentPhaseName: null,
        createdAt: '2026-02-01T00:00:00.000Z',
      },
    })

  // Where the next claim would start, the reason it cannot, naming the act
  // and the stage that shut it - not a key that says only "unavailable".
  it('says why at the foot of the list, naming the stage', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${itemId(1)}`, stubs: filing('phase-closed') })
    const held = page.getByTestId('filing-held')
    await expect.element(held).toHaveAttribute('data-reason', 'phase-closed')
    // the sentence that names the stage, which this round has
    await expect.element(held).toHaveAttribute('data-said', 'assessment/entries/held-phase')
    // said there once: no greyed key beside the title saying only "not now"
    expect(page.getByTestId('file-claim').elements()).toHaveLength(0)
  })

  it('says why in an empty question, in place of its key', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${itemId(2)}`, stubs: filing('item-out-of-scope') })
    const tray = page.getByTestId('entries-tray')
    await expect.element(tray).toHaveAttribute('data-reason', 'item-out-of-scope')
    await expect.element(tray).toHaveAttribute('data-said', 'assessment/entries/held-item-scope')
    expect(tray.element().querySelector('[data-testid="file-claim"]')).toBeNull()
  })

  // A stage that opens only some questions says which, where it holds filing
  // on another: the reader learns where filing is open, not only that it is
  // shut here. A few by name, and how many past them.
  it('names the questions a stage opens where it holds filing on another', async () => {
    await page.viewport(1440, 900)
    const stage = (items: readonly { id: string; title: string }[]) => ({
      getTimeline: () =>
        Effect.succeed({
          timeline: [
            {
              phaseId: 'p1',
              displayName: '集中填报',
              entryNote: '',
              status: 'ended',
              description: '',
              entry: { kind: 'entered', at: '2026-03-01T00:00:00.000Z' },
              scope: { items: null, participantsLimited: false },
            },
            {
              phaseId: 'p2',
              displayName: '补充提交',
              entryNote: '',
              status: 'current',
              description: '',
              entry: { kind: 'entered', at: '2026-04-01T00:00:00.000Z' },
              scope: { items, participantsLimited: false },
            },
          ],
        }),
    })
    const named = (n: number) => ({ id: itemId(n), title: `品德题目 ${String(n)}` })
    const held = page.getByTestId('filing-held')

    const two = await workspace({
      route: `${base}?open=${itemId(1)}`,
      stubs: { ...filing('item-out-of-scope'), ...stage([named(3), named(4)]) },
    })
    await expect
      .element(held)
      .toHaveAttribute('data-said', 'assessment/entries/held-item-scope-only')
    expect(held.element().textContent).toContain('品德题目 3')
    expect(held.element().textContent).toContain('品德题目 4')
    await two.unmount()

    // five of them: three by name, the rest counted
    const five = await workspace({
      route: `${base}?open=${itemId(1)}`,
      stubs: {
        ...filing('item-out-of-scope'),
        ...stage([3, 4, 5, 6, 7].map(named)),
      },
    })
    await expect
      .element(held)
      .toHaveAttribute('data-said', 'assessment/entries/held-item-scope-only')
    expect(held.element().textContent).toContain('品德题目 5')
    expect(held.element().textContent).not.toContain('品德题目 6')
    await five.unmount()

    // none that can be named: said as some
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      stubs: { ...filing('item-out-of-scope'), ...stage([]) },
    })
    await expect
      .element(held)
      .toHaveAttribute('data-said', 'assessment/entries/held-item-scope-some')
  })

  // A route with nowhere to stand for the reader is no stage's doing: the
  // key's place says so from the first look, not after a filled-in form.
  it('says a route with nowhere to stand for the reader, in place of its key', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${itemId(2)}`, stubs: filing('review-level-missing') })
    const tray = page.getByTestId('entries-tray')
    await expect.element(tray).toHaveAttribute('data-reason', 'review-level-missing')
    await expect.element(tray).toHaveAttribute('data-said', 'assessment/entries/held-route')
    expect(tray.element().querySelector('[data-testid="file-claim"]')).toBeNull()
  })

  it('says an archived round is why, and keeps no dead key at a phone’s foot', async () => {
    await page.viewport(390, 844)
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      stubs: { ...filing('no-active-phase'), getBatch: archived },
    })
    const held = page.getByTestId('filing-held')
    await expect.element(held).toHaveAttribute('data-said', 'assessment/entries/held-archived')
    expect(page.getByTestId('phone-foot').elements()).toHaveLength(0)
    expect(page.getByTestId('file-claim').elements()).toHaveLength(0)
  })
})

describe('going up to a section and back', () => {
  /** whatever scrolls the opened question at a desk */
  const paneScroller = () => {
    let at: HTMLElement | null = document.querySelector('[data-testid="item-pane"]')
    while (at !== null && getComputedStyle(at).overflowY !== 'auto') at = at.parentElement
    return at
  }

  // Up to a section from inside a question is somewhere the back key
  // returns from: to the same question, scrolled where it was left.
  it('brings the back key back to the question, where it was read', async () => {
    await page.viewport(1440, 700)
    const lot = Array.from({ length: 12 }, (_, i) => claim(i + 1, TAIL, 'in_review'))
    await workspace({ route: `${base}?open=${TAIL}`, entries: lot })
    await expect.poll(() => rows().length).toBe(12)
    paneScroller()!.scrollTop = 240
    await expect.poll(() => paneScroller()!.scrollTop).toBeGreaterThan(200)
    const was = paneScroller()!.scrollTop

    const aside = page.getByRole('complementary', { name: '填报要求' })
    await userEvent.click(aside.element().querySelector(`[data-section="${SUB_B}"]`)!)
    await expect
      .poll(() => document.querySelector('[data-testid="group-pane"]')?.getAttribute('data-group'))
      .toBe(SUB_B)

    pressBack()
    await expect.poll(openItem).toBe(TAIL)
    await expect.poll(() => Math.abs(paneScroller()!.scrollTop - was)).toBeLessThan(4)
  })

  it('does the same from the question’s own crumbs', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: `${base}?open=${TAIL}` })
    const crumbs = page.getByRole('list', { name: '所在位置' })
    await crumbs.getByRole('button', { name: /学业发展/ }).click()
    await expect
      .poll(() => document.querySelector('[data-testid="group-pane"]')?.getAttribute('data-group'))
      .toBe(BAND_B)
    pressBack()
    await expect.poll(openItem).toBe(TAIL)
  })

  // Picking another question from the structure at a desk stays in place:
  // ten questions looked at are not ten presses of the back key.
  it('keeps picks from the structure out of the history', async () => {
    await page.viewport(1440, 900)
    await workspace({ route: '/elsewhere' })
    await page.getByTestId('to-question').click()
    await expect.poll(openItem).toBe(itemId(2))
    await userEvent.click(railRow(3))
    await expect.poll(openItem).toBe(itemId(3))
    pressBack()
    await expect.poll(() => addressNow()).toBe('/elsewhere')
  })
})

describe('the page’s own words', () => {
  // The owner's rule for this page: no interpunct anywhere in what it says.
  it('never separates anything with a middle dot', async () => {
    await page.viewport(1440, 900)
    await workspace({
      route: `${base}?open=${itemId(1)}`,
      entries: [
        claim(1, itemId(1), 'needs_revision', {
          refusal: {
            kind: 'returned',
            reason: null,
            comment: '证书扫描件不清晰',
            suggestedPayload: null,
            actorName: null,
            at: '2026-04-02T00:00:00.000Z',
          },
        }),
        claim(2, itemId(1), 'approved'),
        claim(3, itemId(1), 'in_review'),
      ],
    })
    await expect.poll(() => rows().length).toBe(3)
    expect(document.body.textContent).not.toContain('·')
    await userEvent.click(rows()[0]!)
    await expect.element(page.getByRole('dialog')).toBeVisible()
    expect(document.body.textContent).not.toContain('·')
  })
})
