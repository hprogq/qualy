import { pageNumber } from '@qualy/api-kit/schema'

// Where a person's rounds keep their place, and the cache entry each page of
// them lives in (batch-memberships.tsx). One module for the list and for a
// server that reads its first page on its behalf (MyBatchesPage.server.tsx):
// a page read under any other key is one the list never finds.

/** the address parameter the list keeps its page in */
export const MEMBERSHIPS_PAGE = 'batchesPage'

/** the page the address names, the first when it names none or no page */
export const membershipPageOf = (value: string | null | undefined): number =>
  pageNumber(value ?? undefined)

/** the cache entry of one page of a list whose pages live under `base` */
export const membershipPageKey = (base: readonly unknown[], page: number): unknown[] => [
  ...base,
  { page },
]
