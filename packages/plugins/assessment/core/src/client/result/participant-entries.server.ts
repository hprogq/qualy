import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit } from '@qualy/web-rsc/request'
import { assessmentApi } from '../api.ts'
import { WHOLE_LIST_PAGE } from '../every-page.ts'
import { everyPageExit } from '../every-page.server.ts'

// Somebody's filings in one round, every one of them, read on the server as
// the account page's own query reads them (participant-entries.ts), under
// the same key.

export const readParticipantEntries = (batchId: string, participantId: string) => {
  const params = { batchId, participantId }
  const key = queryKeyOf('assessment', 'listParticipantEntries', { params, query: {} })
  const exit = everyPageExit(
    (cursor) =>
      readApiExit(assessmentApi, (client) =>
        client.assessment.listParticipantEntries({
          params,
          query: { limit: WHOLE_LIST_PAGE, ...(cursor === undefined ? {} : { cursor }) },
        }),
      ),
    (page) => page.entries,
    (first, entries) => ({ ...first, entries, nextCursor: null }),
  )
  return { key, exit }
}
