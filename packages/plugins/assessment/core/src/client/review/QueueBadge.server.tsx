import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { serverQueries, settle } from '@qualy/web-rsc/queries'
import { assessmentApi } from '../api.ts'
import { batchIdOf } from '../batch/batch-reads.server.ts'

// The rail's count of what waits for review, prepared by the server
// (docs/adr/0012-rsc-data-mode.md): the reader's desk, read once for the
// request under the key the badge and the overview's desk both read, so the
// rail is drawn with its count and neither asks for the desk again.

export { default } from './QueueBadge.tsx'

export const prefetch: SurfacePrefetch = async ({ params }) => {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return undefined
  const desk = { params: { batchId } }
  const key = queryKeyOf('assessment', 'getMyOverview', desk)
  const read = settle(
    await readApiExit(assessmentApi, (client) => client.assessment.getMyOverview(desk), { key }),
  )
  const queries = serverQueries()
  if (read.kind === 'answer') queries.hold(key, read.value)
  return { hydration: queries.dehydrated() }
}
