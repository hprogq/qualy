import { queryOptions } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'
import { everyPage, WHOLE_LIST_PAGE } from '../every-page.ts'

/**
 * The caller's own filings in one round, every one of them.
 *
 * The api pages them oldest first, so a screen that read one page would
 * lose the newest claims past the fiftieth: the one just submitted, the one
 * a reviewer is asking to supplement. The key is the endpoint's own, so
 * wake-ups and the local unread correction address the same entry.
 */
export function useMyEntriesQuery(batchId: string) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  return queryOptions({
    queryKey: query.assessment.listMyEntries.key({ params: { batchId }, query: {} }),
    queryFn: ({ signal }) =>
      everyPage(
        (cursor) =>
          run(
            api.assessment.listMyEntries({
              params: { batchId },
              query: { limit: WHOLE_LIST_PAGE, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        (page) => page.entries,
        (first, entries) => ({ ...first, entries, nextCursor: null }),
        signal,
      ),
  })
}
