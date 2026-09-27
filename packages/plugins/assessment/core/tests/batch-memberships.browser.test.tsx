import MyBatchesPage from '../src/client/person/MyBatchesPage.tsx'
import UserEntriesPage from '../src/client/person/UserEntriesPage.tsx'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { apiError, emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

// The rounds a person is in, listed outside any one of them.
//
// Each round's moment is read on that round's clock, and the list is inside
// no round, so nothing above it says whose clock that is. The moment carries
// its round's offset for a reader whose device keeps another, which the
// suite's device does for any zone but Shanghai's (the browser config pins
// it). Kathmandu runs 2:15 behind it, an offset no other zone shares.

const KATHMANDU = 'Asia/Kathmandu'
// 17:15 UTC on 4 September 2025: 23:00 in Kathmandu, 01:15 the next day on
// the device; a year past, so the day is written with its year, the longest
// a moment on this list gets
const JOINED = '2025-09-04T17:15:00.000Z'

const offsetAt = (timeZone: string, at: string) =>
  new Intl.DateTimeFormat('zh-CN', { timeZone, timeZoneName: 'shortOffset' })
    .formatToParts(new Date(at))
    .find((part) => part.type === 'timeZoneName')!.value

const membership = (id: string, timezone: string, includedAt: string) => ({
  batch: {
    id,
    name: `综测 ${id}`,
    status: 'active' as const,
    materialRange: { start: '2025-03-01', end: '2025-09-01' },
    timezone,
    currentPhaseId: null,
    currentPhaseName: null,
    manageable: false,
  },
  membership: {
    status: 'active' as const,
    includedAt,
    excludedAt: null,
    anchorNodeName: '软件学院',
  },
})

const open = async (
  items: ReturnType<typeof membership>[],
  locale: 'zh-CN' | 'en-US' = 'zh-CN',
) => {
  await page.viewport(1280, 800)
  return renderScreen({
    client: fakeClient({
      app: { getManifest: () => Effect.succeed(emptyManifest()) },
      assessment: { listMyBatches: () => Effect.succeed({ items, nextCursor: null }) },
    }),
    children: <MyBatchesPage />,
    locale,
  })
}

describe('the rounds a person is in', () => {
  it('marks when they joined a round with its clock where the device keeps another', async () => {
    await open([membership('far', KATHMANDU, JOINED)])

    await expect.element(page.getByTestId('round-moment')).toBeVisible()
    const moment = page.getByTestId('round-moment').element()
    const mark = offsetAt(KATHMANDU, JOINED)
    expect(moment.getAttribute('data-zone-mark')).toBe(mark)
    expect(moment.textContent).toContain(`23:00 ${mark}`)
  })

  it.each(['zh-CN', 'en-US'] as const)(
    'keeps the whole of a marked moment in its column, in %s',
    async (locale) => {
      await open([membership('far', KATHMANDU, JOINED)], locale)

      await expect.element(page.getByTestId('round-moment')).toBeVisible()
      // the cell cuts what does not fit with an ellipsis, and the offset is
      // what would go
      const cell = page.getByTestId('round-moment').element().parentElement!
      expect(cell.scrollWidth).toBeLessThanOrEqual(cell.clientWidth)
    },
  )

  it("leaves a round's moment bare where the device keeps its clock", async () => {
    await open([membership('near', 'Asia/Shanghai', JOINED)])

    await expect.element(page.getByTestId('round-moment')).toBeVisible()
    const moment = page.getByTestId('round-moment').element()
    expect(moment.hasAttribute('data-zone-mark')).toBe(false)
    expect(moment.textContent).toContain('01:15')
  })
})

// A person's lists that could not be read say so by what went wrong: on the
// page's own ground, in a frame of their own, with another try only where
// another try could answer differently. A further page that did not come
// leaves the rows already read where they are.
describe('a person’s list that could not be read', () => {
  const USER_ID = '88888888-8888-4888-8888-888888888888'
  const claim = (n: number) => ({
    id: `99999999-9999-4999-8999-${String(n).padStart(12, '0')}`,
    batchId: '11111111-1111-4111-8111-111111111111',
    batchName: '2026 春季综测',
    itemId: '44444444-4444-4444-8444-444444444444',
    itemTitle: 'CET-6',
    status: 'approved' as const,
    source: 'self' as const,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  })
  const state = () => document.querySelector<HTMLElement>('[data-slot="resource-state"]')

  it('says the rounds could not be read, framed on the page, and asks again', async () => {
    await page.viewport(1280, 800)
    const reads = { fail: true }
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        assessment: {
          listMyBatches: () =>
            reads.fail
              ? Effect.fail(apiError('SOMETHING_ELSE'))
              : Effect.succeed({
                  items: [membership('near', 'Asia/Shanghai', JOINED)],
                  nextCursor: null,
                }),
        },
      }),
      children: <MyBatchesPage />,
    })
    await expect.poll(() => state()?.dataset['state']).toBe('failed')
    // a frame of its own on the bare page, under the page's own heading
    expect(getComputedStyle(state()!).boxShadow).not.toBe('none')
    expect(state()!.querySelector('h2')).not.toBeNull()
    reads.fail = false
    await page.getByRole('button', { name: '重试' }).click()
    await expect.element(page.getByTestId('person-batch')).toBeVisible()
  })

  it('offers no other try at claims the reader may not read', async () => {
    await page.viewport(1280, 800)
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        assessment: { listUserEntries: () => Effect.fail(apiError('ACCESS_DENIED')) },
      }),
      path: '/organization/users/:userId/assessment/entries',
      route: `/organization/users/${USER_ID}/assessment/entries`,
      children: <UserEntriesPage />,
    })
    await expect.poll(() => state()?.dataset['state']).toBe('denied')
    expect(page.getByRole('button', { name: '重试' }).elements()).toHaveLength(0)
  })

  it('keeps the claims read when a further page does not come', async () => {
    await page.viewport(1280, 800)
    await renderScreen({
      client: fakeClient({
        app: { getManifest: () => Effect.succeed(emptyManifest()) },
        assessment: {
          listUserEntries: (request: { query?: Record<string, unknown> }) =>
            request.query?.['cursor'] === undefined
              ? Effect.succeed({ items: [claim(1), claim(2)], nextCursor: 'more' })
              : Effect.fail(apiError('SOMETHING_ELSE')),
        },
      }),
      path: '/organization/users/:userId/assessment/entries',
      route: `/organization/users/${USER_ID}/assessment/entries`,
      children: <UserEntriesPage />,
    })
    await expect.poll(() => page.getByTestId('person-entry').elements().length).toBe(2)
    await page.getByRole('button', { name: '加载更多' }).click()
    await new Promise((settle) => setTimeout(settle, 500))
    expect(page.getByTestId('person-entry').elements()).toHaveLength(2)
    expect(state()).toBeNull()
  })
})

// A batch is named in full - year, term, college and what kind of round it
// is - and a column cannot hold every such name. It ends in an ellipsis on
// one line, the whole name its title and the link's own text.
describe('the batch column of a person’s claims', () => {
  it('holds a long batch name to one line, with the whole name a hover away', async () => {
    await page.viewport(1280, 800)
    const long = '2025-2026-2 计算机科学与技术学院本科生综合素质考核（含推荐免试研究生评价）'
    await renderScreen({
      client: fakeClient({
        // the batch page is known, as it is to an administrator: the name is a link
        app: {
          getManifest: () =>
            Effect.succeed({
              ...emptyManifest(),
              pages: [
                { id: 'assessment/batch', path: '/assessment/batches/:batchId', layout: 'blank' },
              ],
            }),
        },
        assessment: {
          listUserEntries: () =>
            Effect.succeed({
              items: [
                {
                  id: '99999999-9999-4999-8999-000000000001',
                  batchId: '11111111-1111-4111-8111-111111111111',
                  batchName: long,
                  itemId: '44444444-4444-4444-8444-444444444444',
                  itemTitle: 'CET-6',
                  status: 'approved' as const,
                  source: 'self' as const,
                  createdAt: '2026-03-01T00:00:00.000Z',
                  updatedAt: '2026-03-01T00:00:00.000Z',
                },
              ],
              nextCursor: null,
            }),
        },
      }),
      path: '/organization/users/:userId/assessment/entries',
      route: '/organization/users/88888888-8888-4888-8888-888888888888/assessment/entries',
      children: <UserEntriesPage />,
    })
    await expect.element(page.getByTestId('person-entry')).toBeVisible()
    const cell = page.getByTestId('person-entry').element().firstElementChild as HTMLElement
    const shown = cell.firstElementChild as HTMLElement
    expect(shown.textContent).toBe(long)
    expect(cell.getAttribute('title')).toBe(long)
    // one line, clipped, and inside its column
    expect(getComputedStyle(shown).whiteSpace).toBe('nowrap')
    expect(shown.scrollWidth).toBeGreaterThan(shown.clientWidth)
    expect(shown.getBoundingClientRect().right).toBeLessThanOrEqual(
      cell.getBoundingClientRect().right + 0.5,
    )
  })
})
