import { type QueryKey } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { assessmentApi } from '../api.ts'

export type QueuePage = ApiResult<typeof assessmentApi, 'assessment', 'listReviewInbox'>
export type QueueRequest = {
  page?: string
  limit?: string
  view?: 'item' | 'time' | 'person'
  itemId?: string
  person?: string
  unitId?: string
  search?: string
  groupPage?: string
  groupOrder?: 'largest'
  focus?: string
  exclude?: readonly string[]
}

/** Every page, group count and workbench neighbor shares the endpoint's invalidation key. */
export function useQueueRefresh(batchId: string): (stale: (key: QueryKey) => void) => void {
  const query = useApiQuery(assessmentApi)
  return (stale) => {
    stale(query.assessment.listReviewInbox.key({ query: { batchId } }))
    stale(query.assessment.getMyOverview.key({ params: { batchId } }))
  }
}

export function useReviewQueueQuery(batchId: string, request: QueueRequest = {}) {
  return useApiQuery(assessmentApi).assessment.listReviewInbox.queryOptions({
    query: { batchId, ...request },
  })
}

export function useAwaitingQuery(batchId: string, page = 1, limit = 10) {
  return useApiQuery(assessmentApi).assessment.listAwaitingSupplements.queryOptions({
    query: { batchId, page: String(page), limit: String(limit) },
  })
}
