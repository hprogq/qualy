import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { serverQueries, settle } from '@qualy/web-rsc/queries'
import { assessmentApi } from '../api.ts'

export { default } from './SectionBadge.tsx'

// Desktop and compact rails share these reads. Hand both their initial
// counts to the document before either hydrates and updates the shared cache.
export const prefetch: SurfacePrefetch = async ({ params }) => {
  const userId = params['userId']
  if (userId === undefined) return undefined
  const input = { params: { userId }, query: { limit: '1' } }
  const batches = queryKeyOf('assessment', 'listUserBatches', input)
  const entries = queryKeyOf('assessment', 'listUserEntries', input)
  const [batchRead, entryRead] = await Promise.all([
    readApiExit(assessmentApi, (client) => client.assessment.listUserBatches(input), {
      key: batches,
    }),
    readApiExit(assessmentApi, (client) => client.assessment.listUserEntries(input), {
      key: entries,
    }),
  ])
  const queries = serverQueries()
  const batchResult = settle(batchRead)
  const entryResult = settle(entryRead)
  if (batchResult.kind === 'answer') queries.hold(batches, batchResult.value)
  if (entryResult.kind === 'answer') queries.hold(entries, entryResult.value)
  return { hydration: queries.dehydrated() }
}
