import { queryOptions } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'
import { everyPage, WHOLE_LIST_PAGE } from '../every-page.ts'

// The reviewer's two lists in one round, whole.
//
// The queue page counts them, filters and searches them, groups them by
// question and by person; the workbench walks them in order and says how
// many are left; the rail's badge counts them. Each of those is only true
// over the whole list, and the api serves it oldest first, so a single page
// answered for the first fifty as if they were everything. One key per list
// - the endpoint's own - so the three screens share one read and every
// wake-up that stales the endpoint stales this.

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
