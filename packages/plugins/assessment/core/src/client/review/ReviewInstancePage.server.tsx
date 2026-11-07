import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { renderRequest } from '@qualy/web-rsc/request'
import { answersOf, settle } from '@qualy/web-rsc/queries'
import { batchIdOf, keyed, namesRecord, readBatch } from '../batch/batch-reads.server.ts'
import { queueReadOf } from './inbox-reads.ts'
import { readRunScope } from './run-scope.ts'
import ReviewInstancePage from './ReviewInstancePage.tsx'

// One review as a server draws it (docs/adr/0012-rsc-data-mode.md): the
// round the address names, and the run of the queue it stands in - the
// slice the address's run walks, around this one - read for a reader the
// batch says reviews here, as the workbench reads them, and handed to the
// workbench, which goes on keeping both current with the batch's live
// channel. What a dialog, a version or a sibling opens reads for itself.

export default async function ReviewInstance({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const batchId = batchIdOf(params)
  const instanceId = params['instanceId'] ?? ''
  // an address that cannot name a round is the workbench's to say so
  if (batchId === undefined || !namesRecord(instanceId)) return <ReviewInstancePage />
  const subject = settle(await readBatch(batchId).exit)
  if (subject.kind !== 'answer' || !subject.value.batch.capabilities.review) {
    return <ReviewInstancePage />
  }
  const scope = readRunScope(renderRequest().url.searchParams.get('run') ?? '')
  // the run as the workbench asks for it before this sitting has decided
  // anything: nothing yet to leave out
  const run = queueReadOf(batchId, {
    ...(scope.kind === 'item' ? { itemId: scope.itemId } : {}),
    ...(scope.kind === 'person' ? { person: scope.participantId } : {}),
    exclude: [],
    focus: instanceId,
    limit: '20',
  })
  const round = { params: { instanceId } }
  const state = await answersOf([
    keyed('getReviewInstance', round, (client) => client.assessment.getReviewInstance(round)),
    keyed('listReviewInbox', run, (client) => client.assessment.listReviewInbox(run)),
  ])
  return (
    <QueryHydration state={state}>
      <ReviewInstancePage />
    </QueryHydration>
  )
}
