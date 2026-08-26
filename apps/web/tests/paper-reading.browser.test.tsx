import '../src/app.css'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { components } from 'virtual:qualy/plugins'
import { addressNow, emptyManifest, fakeClient, renderScreen } from './support/harness.tsx'

// Reading the paper is scrolling, and the rail beside it has to keep up.
// Three things have to hold at once: an address lands the paper on the row
// it names without dragging the shell around it, the row under the reader
// is the one the rail marks, and the tail of the paper - which no scroll
// can lift as far as the reading line - is still reachable and still
// marked. Styles are loaded here because every one of those is geometry.

const MyEntriesPage = (await components['assessment/MyEntriesPage']!()).default

const BATCH_ID = '11111111-1111-4111-8111-111111111111'
const PARTICIPANT_ID = '44444444-4444-4444-8444-444444444444'
const ROOT = '70000000-7777-4777-8777-777777777770'
const BAND_A = '70000000-7777-4777-8777-777777777771'
const BAND_B = '70000000-7777-4777-8777-777777777772'
const itemId = (n: number) => `2000000${n}-2222-4222-8222-222222222220`
const TAIL = itemId(9)

const question = (n: number, title: string, group: string) => ({
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
    id: `3000000${n}-3333-4333-8333-333333333330`,
    revisionNo: 1,
    entrySource: 'student' as const,
    formConfig: { fields: [{ key: 'summary', type: 'text', label: '事项说明', required: true }] },
    scoringConfig: { calculator: { config: { value: '1.00' } } },
    reviewPolicy: { stages: [{ nodeType: 'class' }, { nodeType: 'college' }] },
    displayConfig: { description: '按学校规定提交材料，逾期不补。' },
    reason: null,
    createdAt: '2026-03-01T00:00:00.000Z',
  },
  createdAt: '2026-03-01T00:00:00.000Z',
})

const group = (id: string, parentGroupId: string | null, name: string, sortOrder: number) => ({
  id,
  parentGroupId,
  name,
  cap: '20.00',
  floor: null,
  sortOrder,
  itemCount: 0,
})

/** a paper long enough to scroll, ending in a band too short to scroll to */
const paper = (route: string) =>
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
                component: 'assessment/MyEntriesPage',
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
              capabilities: { personal: true, review: true, record: true, manage: false },
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
        listItems: () =>
          Effect.succeed({
            items: [
              ...Array.from({ length: 8 }, (_, i) => question(i + 1, `品德题目 ${i + 1}`, BAND_A)),
              question(9, '学科竞赛获奖', BAND_B),
            ],
            capabilities: { canManage: false },
          }),
        listMyEntries: () =>
          Effect.succeed({ participantId: PARTICIPANT_ID, entries: [], nextCursor: null }),
        listAwaitingSupplements: () => Effect.succeed({ items: [], nextCursor: null }),
        listScoreGroups: () =>
          Effect.succeed({
            groups: [
              group(ROOT, null, '综合素质测评', 0),
              group(BAND_A, ROOT, '品德行为表现', 0),
              group(BAND_B, ROOT, '学业发展', 1),
            ],
            version: 1,
            capabilities: { canManage: false },
          }),
        // the standing lands after the questions do, the way a real page
        // loads: the rows exist for a moment before the paper is on screen,
        // and anything that only looks for the paper once misses it
        getMyResult: () =>
          Effect.flatMap(Effect.sleep(60), () =>
            Effect.succeed({ mode: 'provisional', total: '0.00', groups: [], lines: [] }),
          ),
        getEntryHistory: () => Effect.succeed({ revisions: [], events: [], rounds: [] }),
      },
    } as never),
    route,
    routes: [
      {
        path: '/assessment/batches/:batchId/my-entries',
        // the shell the page is built for: a window-high frame the panes
        // scroll inside, not a document that grows
        // inline, not utilities: the tests directory is outside the Tailwind
        // scan, so a class here only ever worked while some production file
        // happened to use it too - the shell's StyleX migration proved it
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
              style={{
                display: 'flex',
                minHeight: 0,
                flex: '1 1 0%',
                flexDirection: 'column',
                overflowY: 'auto',
              }}
            >
              <MyEntriesPage />
            </main>
          </div>
        ),
      },
    ] as never,
  })

/** the paper's own scroller: the rail owns the first one on the page */
const paperScroller = (): HTMLElement =>
  document.querySelectorAll('[data-slot="scroll-area-viewport"]')[1] as HTMLElement

const marked = (): string =>
  (document.querySelector('[aria-current="true"]') as HTMLElement | null)?.innerText
    .replace(/\s+/g, ' ')
    .trim() ?? ''

describe('reading the paper', () => {
  it('lands on the question the address names, without moving the shell', async () => {
    await page.viewport(1440, 860)
    paper(`/assessment/batches/${BATCH_ID}/my-entries?open=${TAIL}`)

    await expect.element(page.getByRole('heading', { name: '学科竞赛获奖' })).toBeVisible()
    // the two panes start their reading at the same line: the paper's
    // toolbar and the rail's heading are the same height, or the whole page
    // is a few pixels out of true
    const rail = document.querySelectorAll('[data-slot="scroll-area-viewport"]')[0] as HTMLElement
    expect(Math.round(rail.getBoundingClientRect().top)).toBe(
      Math.round(paperScroller().getBoundingClientRect().top),
    )
    await expect.poll(() => paperScroller().scrollTop).toBeGreaterThan(0)
    // scrolling the paper is the paper's business; the shell around it,
    // toolbar and rail included, stays where it was put
    expect(document.documentElement.scrollTop).toBe(0)
    // and an address is where the reading starts, not where it sticks: the
    // rail goes back to following the paper the moment it is scrolled
    await expect.poll(() => marked()).toMatch(/学科竞赛获奖/)
    paperScroller().scrollTop = 0
    await expect.poll(() => marked()).toMatch(/品德/)
  })

  it('marks the tail of the paper, which no scroll can lift to the reading line', async () => {
    await page.viewport(1440, 860)
    paper(`/assessment/batches/${BATCH_ID}/my-entries`)

    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    const viewport = paperScroller()
    viewport.scrollTop = viewport.scrollHeight
    await expect.poll(() => marked()).toMatch(/学科竞赛获奖/)
  })

  it('keeps the mark on a band clicked into view at the end of the paper', async () => {
    await page.viewport(1440, 860)
    paper(`/assessment/batches/${BATCH_ID}/my-entries`)

    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    await page.getByRole('button', { name: /^学业发展/ }).click()
    await expect.poll(() => marked()).toMatch(/^学业发展/)
    // the click parks the paper as far down as it goes, and there it stays:
    // the mark belongs to what was asked for, not to whatever the end of
    // the paper happens to show once the scroll has run out
    await new Promise((resolve) => setTimeout(resolve, 1800))
    // a stray scroll event long after the click, of the kind the tail of a
    // smooth scroll sends: it must not hand the mark to another row
    paperScroller().dispatchEvent(new Event('scroll'))
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(marked()).toMatch(/^学业发展/)
  })

  it('folds the structure into a drawer on a phone, and a pick scrolls the paper', async () => {
    await page.viewport(390, 844)
    paper(`/assessment/batches/${BATCH_ID}/my-entries`)

    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    // no rail beside the paper; the toolbar offers the drawer instead
    const scroller = document.querySelector('main') as HTMLElement
    expect(scroller.querySelectorAll('[data-slot="scroll-area-viewport"]')).toHaveLength(0)

    await page.getByRole('button', { name: '结构' }).click()
    await expect.poll(() => addressNow()).toContain('rail=1')
    await page.getByRole('button', { name: /^学科竞赛获奖/ }).click()

    // one write moved both layers: the pick landed in the address, the
    // drawer's layer cleared, and the paper scrolled to the row
    await expect.poll(() => addressNow()).toContain(`open=${TAIL}`)
    expect(addressNow()).not.toContain('rail=1')
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(200)
  })

  it('pins the section strip under the phone toolbar once its card scrolls past', async () => {
    await page.viewport(390, 844)
    paper(`/assessment/batches/${BATCH_ID}/my-entries`)

    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    const scroller = document.querySelector('main') as HTMLElement
    const strip = () =>
      Array.from(document.querySelectorAll('.backdrop-blur-sm')).some(
        (el) => el.textContent?.includes('品德行为表现') === true,
      )
    // reading the top of the paper: the band's own card is on screen, so
    // nothing repeats its name
    expect(strip()).toBe(false)
    scroller.scrollTop = 600
    await expect.poll(strip).toBe(true)
    // and it is pinned: more scroll does not carry it away
    const at = document.querySelector('.backdrop-blur-sm')!.getBoundingClientRect().top
    scroller.scrollTop = 800
    await expect.poll(strip).toBe(true)
    expect(
      Math.round(document.querySelector('.backdrop-blur-sm')!.getBoundingClientRect().top),
    ).toBe(Math.round(at))
  })

  it('glides to a question clicked in the rail, the first time as much as the tenth', async () => {
    await page.viewport(1440, 860)
    paper(`/assessment/batches/${BATCH_ID}/my-entries`)

    await expect.element(page.getByRole('heading', { name: '品德题目 1' })).toBeVisible()
    const viewport = paperScroller()
    await page.getByRole('button', { name: /^学科竞赛获奖/ }).click()
    // the very first click writes the address for the first time, and the
    // page must not read that back as an arrival and snap to it: a moment
    // after the press the paper is still on its way there
    const end = viewport.scrollHeight - viewport.clientHeight
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(viewport.scrollTop).toBeLessThan(end - 100)
    await expect.poll(() => Math.round(viewport.scrollTop)).toBeGreaterThan(end - 100)
  })
})
