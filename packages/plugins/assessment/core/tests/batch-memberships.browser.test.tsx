import MyBatchesPage from '../src/client/person/MyBatchesPage.tsx'
import { describe, expect, it } from 'vitest'
import { page } from 'vitest/browser'
import { Effect } from 'effect'
import { emptyManifest, fakeClient, renderScreen } from './support/screen.tsx'

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
