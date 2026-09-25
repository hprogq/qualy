import { queryOptions, useQueryClient } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'
import { everyPage, WHOLE_LIST_PAGE } from '../every-page.ts'

// The reviewer's two lists in one round, whole.
//
// The queue page counts them, filters and searches them, groups them by
// question and by person; the workbench walks them in order and says how
// many are left. Each of those is only true over the whole list, and the api
// serves it oldest first, so a single page answered for the first fifty as
// if they were everything. One key per list - the endpoint's own - so the
// two screens share one read and every wake-up that stales the endpoint
// stales this.
//
// The rail's badge is not one of them: it reads the server's own count from
// the reader's desk (getMyOverview), because the rail stands on every page
// of the round and walking the whole list to count it cost a request per
// page. So whatever stales the queue has to stale that count too, or the
// badge waits out its own poll - which is what `useQueueRefresh` is for.

/**
 * What a change to the queue makes stale: the whole list, and the rail's
 * count, which is the desk's own figure rather than a count of this list.
 * Every screen that hears the queue move calls this rather than naming the
 * two keys itself.
 */
export function useQueueRefresh(batchId: string): () => void {
  const queryClient = useQueryClient()
  const query = useApiQuery(assessmentApi)
  return () => {
    void queryClient.invalidateQueries({
      queryKey: query.assessment.listReviewInbox.key({ query: { batchId } }),
    })
    void queryClient.invalidateQueries({
      queryKey: query.assessment.getMyOverview.key({ params: { batchId } }),
    })
  }
}

/** everything waiting for this reader's decision in the round */
export function useReviewQueueQuery(batchId: string) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  return queryOptions({
    queryKey: query.assessment.listReviewInbox.key({ query: { batchId } }),
    queryFn: ({ signal }) =>
      everyPage(
        (cursor) =>
          run(
            api.assessment.listReviewInbox({
              query: {
                batchId,
                limit: WHOLE_LIST_PAGE,
                ...(cursor === undefined ? {} : { cursor }),
              },
            }),
          ),
        (page) => page.items,
        (first, items) => ({ ...first, items, nextCursor: null }),
        signal,
      ),
  })
}

/** everything this reader's step has asked somebody else for in the round */
export function useAwaitingQuery(batchId: string) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  return queryOptions({
    queryKey: query.assessment.listAwaitingSupplements.key({ query: { batchId } }),
    queryFn: ({ signal }) =>
      everyPage(
        (cursor) =>
          run(
            api.assessment.listAwaitingSupplements({
              query: {
                batchId,
                limit: WHOLE_LIST_PAGE,
                ...(cursor === undefined ? {} : { cursor }),
              },
            }),
          ),
        (page) => page.items,
        (first, items) => ({ ...first, items, nextCursor: null }),
        signal,
      ),
  })
}
