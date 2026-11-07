import { pageNumber } from '@qualy/api-kit/schema'

// What the overview's first screen reads, and with what (BatchOverviewPage.tsx).
//
// One module for the page and for the server that reads first on its behalf
// (BatchOverviewPage.server.tsx): the inputs are part of each read's cache
// key, so an answer read for an input the page would not have asked with is
// an answer the page never finds, and asks for again. The address is read
// the same way on both sides, defaults and all - no parameter is the whole
// feed's first page - and the reads stay fresh for as long on both, so the
// page does not ask straight away for what the html was drawn from.

/** whose story the feed tells: everything, or one of the reader's standings */
export type Lane = 'all' | 'participant' | 'reviewer'

/** the address's word for the feed's lane, or the whole feed */
export const laneOf = (value: string | null | undefined): Lane =>
  value === 'participant' || value === 'reviewer' ? value : 'all'

/** the address parameters the feed keeps its place in */
export const ACTIVITY_LANE = 'activityLane'
export const ACTIVITY_PAGE = 'activityPage'

/**
 * How long the first screen's reads are taken as they are. What changes
 * them while the page is open is told by the batch's live channel, which
 * marks them stale; the clock is for a page that missed it.
 */
export const OVERVIEW_FRESH_MS = 30_000

/** the inputs of the overview's reads, for a batch and the feed's place in the address */
export const overviewReads = (
  batchId: string,
  place: { readonly lane: Lane; readonly page: string | undefined },
) => {
  const params = { batchId }
  return {
    batch: { params },
    timeline: { params },
    overview: { params },
    activity: {
      params,
      query: {
        page: String(pageNumber(place.page)),
        ...(place.lane === 'all' ? {} : { perspective: place.lane }),
      },
    },
  }
}
