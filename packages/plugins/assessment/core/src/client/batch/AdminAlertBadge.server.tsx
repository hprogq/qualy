import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { readApiExit, type SurfacePrefetch } from '@qualy/web-rsc/request'
import { serverQueries, settle } from '@qualy/web-rsc/queries'
import { assessmentApi } from '../api.ts'
import { adminAlertReads, owesAdministration } from './admin-alert-reads.ts'
import { batchIdOf, readBatch } from './batch-reads.server.ts'

// What the batch owes its administrators, prepared by the server
// (docs/adr/0012-rsc-data-mode.md) for the dots beside the rail's entries
// and the overview's desk, which read the same counts: asked only of a
// reader the batch says administers it, and once for the request.

export { default } from './AdminAlertBadge.tsx'

export const prefetch: SurfacePrefetch = async ({ params }) => {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return undefined
  const subject = settle(await readBatch(batchId).exit)
  if (subject.kind !== 'answer' || !owesAdministration(subject.value.batch)) return undefined
  const owed = adminAlertReads(batchId)
  const keys = {
    alerts: queryKeyOf('assessment', 'reviewAlerts', owed.alerts),
    placements: queryKeyOf('assessment', 'listParticipantPlacements', owed.placements),
    access: queryKeyOf('assessment', 'previewAccessSync', owed.access),
  }
  const [alerts, placements, access] = await Promise.all([
    readApiExit(assessmentApi, (client) => client.assessment.reviewAlerts(owed.alerts), {
      key: keys.alerts,
    }),
    readApiExit(
      assessmentApi,
      (client) => client.assessment.listParticipantPlacements(owed.placements),
      { key: keys.placements },
    ),
    readApiExit(assessmentApi, (client) => client.assessment.previewAccessSync(owed.access), {
      key: keys.access,
    }),
  ])
  const queries = serverQueries()
  for (const [key, exit] of [
    [keys.alerts, alerts],
    [keys.placements, placements],
    [keys.access, access],
  ] as const) {
    const read = settle<unknown, unknown>(exit)
    if (read.kind === 'answer') queries.hold(key, read.value)
  }
  return { hydration: queries.dehydrated() }
}
