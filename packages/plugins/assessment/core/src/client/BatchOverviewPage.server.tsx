import { Schema } from 'effect'
import { uuidInput } from '@qualy/api-kit/schema'
import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { isSessionRefusal, serverQueries, settle } from '@qualy/web-rsc/queries'
import { assessmentApi } from './api.ts'
import { ACTIVITY_LANE, ACTIVITY_PAGE, laneOf, overviewReads } from './overview-reads.ts'
import { batchWorkspaceCapabilities } from './batch/capabilities.ts'
import { adminAlertReads, owesAdministration } from './batch/admin-alert-reads.ts'

// The batch overview as a server draws it (docs/adr/0012-rsc-data-mode.md).
//
// The page is the browser's page; what the server adds is its first screen.
// Before the document is drawn it reads, as the reader, what that screen
// shows - the batch, its plan, the reader's desk, the feed at the place the
// address names, and for whoever administers the batch what it owes them -
// so the html carries the screen and the page does not ask for any of it
// again while it is fresh (overview-reads.ts, batch/admin-alert-reads.ts).
//
// Only answers the page would have had are handed over. A batch that is not
// there, or not the reader's, is handed over as the refusal it is, so the
// html already says so where it would have shown a loading state. A session
// that went is not: the page's own reads meet it, and the session's recovery
// answers. Anything else the page asks for itself, as it always has.

export { default } from './BatchOverviewPage.tsx'

const recordId = Schema.is(uuidInput)

export const prefetch: SurfacePrefetch = async ({ params, url }) => {
  const batchId = params['batchId']
  // an address that cannot name a batch is not asked about, by the page either
  if (batchId === undefined || !recordId(batchId)) return undefined
  const reads = overviewReads(batchId, {
    lane: laneOf(url.searchParams.get(ACTIVITY_LANE)),
    page: url.searchParams.get(ACTIVITY_PAGE) ?? undefined,
  })
  const [batch, timeline, overview, activity] = await Promise.all([
    readApiExit(assessmentApi, (client) => client.assessment.getBatch(reads.batch)),
    readApiExit(assessmentApi, (client) => client.assessment.getTimeline(reads.timeline)),
    readApiExit(assessmentApi, (client) => client.assessment.getMyOverview(reads.overview)),
    readApiExit(assessmentApi, (client) => client.assessment.listMyActivity(reads.activity)),
  ])
  const queries = serverQueries()
  const subject = settle(batch)
  const key = queryKeyOf('assessment', 'getBatch', reads.batch)
  if (subject.kind === 'answer') queries.hold(key, subject.value)
  else if (subject.kind === 'refused' && !isSessionRefusal(subject.error)) {
    queries.holdRefusal(key, subject.error)
  }
  // the rest only alongside a batch to show them in
  if (subject.kind !== 'answer') return { hydration: queries.dehydrated() }
  const held = (endpoint: string, input: unknown, exit: Parameters<typeof settle>[0]) => {
    const read = settle<unknown, unknown>(exit)
    if (read.kind === 'answer') queries.hold(queryKeyOf('assessment', endpoint, input), read.value)
  }
  held('getTimeline', reads.timeline, timeline)
  held('getMyOverview', reads.overview, overview)
  held('listMyActivity', reads.activity, activity)
  // what the batch owes its administrators, asked only of one: the desk
  // lists it, and asked of anybody else it is a refusal
  if (owesAdministration(subject.value.batch)) {
    const owed = adminAlertReads(batchId)
    const [alerts, placements, access] = await Promise.all([
      readApiExit(assessmentApi, (client) => client.assessment.reviewAlerts(owed.alerts)),
      readApiExit(assessmentApi, (client) =>
        client.assessment.listParticipantPlacements(owed.placements),
      ),
      readApiExit(assessmentApi, (client) => client.assessment.previewAccessSync(owed.access)),
    ])
    held('reviewAlerts', owed.alerts, alerts)
    held('listParticipantPlacements', owed.placements, placements)
    held('previewAccessSync', owed.access, access)
  }
  return {
    hydration: queries.dehydrated(),
    workspaceCapabilities: batchWorkspaceCapabilities(subject.value.batch.capabilities),
  }
}
