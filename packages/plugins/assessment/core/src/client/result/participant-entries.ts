import { queryOptions } from '@tanstack/react-query'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { assessmentApi } from '../api.ts'
import { everyPage, WHOLE_LIST_PAGE } from '../every-page.ts'

/**
 * Every claim of one person in the round, and what each stands recognised
 * as. The api pages them; an account that drew one page would answer for the
 * oldest claims as if they were all of them. Shared with the page around
 * this list, which counts the same claims under the same key.
 */
export function useParticipantEntries(batchId: string, participantId: string) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const run = useRunApi()
  return queryOptions({
    // the endpoint's own key, so a wake-up that stales it reaches this read
    queryKey: query.assessment.listParticipantEntries.key({
      params: { batchId, participantId },
      query: {},
    }),
    queryFn: ({ signal }) =>
      everyPage(
        (cursor) =>
          run(
            api.assessment.listParticipantEntries({
              params: { batchId, participantId },
              query: { limit: WHOLE_LIST_PAGE, ...(cursor === undefined ? {} : { cursor }) },
            }),
          ),
        (page) => page.entries,
        (first, entries) => ({ ...first, entries, nextCursor: null }),
        signal,
      ),
  })
}
