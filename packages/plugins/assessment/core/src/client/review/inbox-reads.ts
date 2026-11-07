import type { QueueRequest } from './queue.ts'

// What the review queue reads, and with what (ReviewInboxPage.tsx).
//
// One module for the page and for the server that reads its first screen on
// its behalf (ReviewInboxPage.server.tsx): the inputs are part of each
// read's cache key, so the address is read the same way on both sides,
// defaults and all, and the queue a server read is the one the page finds.

/** how the queue is laid out: by question, by time, by person, or what is out with somebody */
export type View = 'item' | 'time' | 'person' | 'asked'

const VIEWS: readonly View[] = ['item', 'time', 'person', 'asked']

/** the address's word for the view, or the queue by question */
export const viewOf = (raw: string): View =>
  (VIEWS as readonly string[]).includes(raw) ? (raw as View) : 'item'

/** the address parameters the queue keeps its place in, as the address says them */
export interface QueuePlace {
  readonly view: string
  readonly item: string
  readonly person: string
  readonly unit: string
  readonly search: string
  readonly page: string
  readonly groupPage: string
}

/** the place an address names, each parameter it leaves out at its default */
export const queuePlaceOf = (search: URLSearchParams): QueuePlace => ({
  view: search.get('view') ?? 'item',
  item: search.get('item') ?? '',
  person: search.get('person') ?? '',
  unit: search.get('unit') ?? '',
  search: search.get('q') ?? '',
  page: search.get('page') ?? '',
  groupPage: search.get('groupPage') ?? '',
})

/** what the queue asks the server for at a place */
export const queueRequestOf = (place: QueuePlace): QueueRequest => {
  const view = viewOf(place.view)
  return {
    view: view === 'asked' ? 'time' : view,
    page: place.page || '1',
    limit: view === 'time' ? '20' : '10',
    groupPage: place.groupPage || '1',
    ...(place.item !== '' && view !== 'person' ? { itemId: place.item } : {}),
    ...(place.person !== '' && view === 'person' ? { person: place.person } : {}),
    ...(place.unit !== '' ? { unitId: place.unit } : {}),
    ...(place.search.trim() !== '' ? { search: place.search.trim() } : {}),
  }
}

/** the input of the queue's read for a batch and a request */
export const queueReadOf = (batchId: string, request: QueueRequest) => ({
  query: { batchId, ...request },
})

/** the input of the read of what the reader's step has asked others for */
export const awaitingReadOf = (batchId: string, page = 1, limit = 10) => ({
  query: { batchId, page: String(page), limit: String(limit) },
})
