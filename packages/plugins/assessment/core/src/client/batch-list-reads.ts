export const BATCH_LIST_PAGE_SIZE = 20
export const BATCH_LIST_FRESH_MS = 30_000

export type BatchStatusFilter = 'all' | 'draft' | 'active' | 'archived'

export const batchStatusOf = (status: string | null): BatchStatusFilter =>
  status === 'draft' || status === 'active' || status === 'archived' ? status : 'all'

export const batchListRead = (search: string, status: BatchStatusFilter, page: number) => ({
  query: {
    ...(search !== '' ? { q: search } : {}),
    ...(status !== 'all' ? { status } : {}),
    page: String(page),
    limit: String(BATCH_LIST_PAGE_SIZE),
  },
})

export const batchStandingRead = { query: {} }
