import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { isSessionRefusal, serverQueries, settle } from '@qualy/web-rsc/queries'
import { assessmentApi } from '../api.ts'
import { batchIdOf, readBatch } from './batch-reads.server.ts'
import { batchWorkspaceCapabilities } from './capabilities.ts'

// The workspace's bar over an open batch, prepared by the server
// (docs/adr/0012-rsc-data-mode.md): the batch, its stages, and who the
// reader is in it. Every page of the batch stands under this bar, so this
// is where the workspace learns what its rail may show - not from whichever
// page happens to be open - and the rail is drawn right in the html of
// every one of them.
//
// A batch that is not there, or not the reader's, is handed over as that
// refusal, so the bar and the page under it say so from the first frame. A
// session that went is not: the page's own reads meet it.

export { default } from './BatchContextBar.tsx'

export const prefetch: SurfacePrefetch = async ({ params }) => {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return undefined
  const batch = readBatch(batchId)
  const plan = { params: { batchId } }
  const planKey = queryKeyOf('assessment', 'getTimeline', plan)
  const [subject, timeline] = await Promise.all([
    batch.exit.then(settle),
    readApiExit(assessmentApi, (client) => client.assessment.getTimeline(plan), {
      key: planKey,
    }).then(settle),
  ])
  const queries = serverQueries()
  if (subject.kind === 'refused' && !isSessionRefusal(subject.error)) {
    queries.holdRefusal(batch.key, subject.error)
  }
  if (subject.kind !== 'answer') return { hydration: queries.dehydrated() }
  queries.hold(batch.key, subject.value)
  if (timeline.kind === 'answer') queries.hold(planKey, timeline.value)
  return {
    hydration: queries.dehydrated(),
    workspaceCapabilities: batchWorkspaceCapabilities(subject.value.batch.capabilities),
  }
}
