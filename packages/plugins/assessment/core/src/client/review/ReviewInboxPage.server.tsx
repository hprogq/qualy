import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { renderRequest } from '@qualy/web-rsc/request'
import { answersOf, settle } from '@qualy/web-rsc/queries'
import { batchIdOf, keyed, readBatch } from '../batch/batch-reads.server.ts'
import { awaitingReadOf, queuePlaceOf, queueReadOf, queueRequestOf } from './inbox-reads.ts'
import ReviewInboxPage from './ReviewInboxPage.tsx'

// The review queue as a server draws it (docs/adr/0012-rsc-data-mode.md):
// what waits for the reader's decision at the place the address names, and
// what their step has asked others for - read only for a reader the batch
// says reviews here, as the page asks only then - and handed to the page,
// which goes on keeping the queue current with the batch's live channel.

export default async function ReviewInbox({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const batchId = batchIdOf(params)
  if (batchId === undefined) return <ReviewInboxPage />
  const subject = settle(await readBatch(batchId).exit)
  if (subject.kind !== 'answer' || !subject.value.batch.capabilities.review) {
    return <ReviewInboxPage />
  }
  const queue = queueReadOf(batchId, queueRequestOf(queuePlaceOf(renderRequest().url.searchParams)))
  const awaiting = awaitingReadOf(batchId)
  const handed = await answersOf([
    keyed('listReviewInbox', queue, (client) => client.assessment.listReviewInbox(queue)),
    keyed('listAwaitingSupplements', awaiting, (client) =>
      client.assessment.listAwaitingSupplements(awaiting),
    ),
  ])
  return (
    <QueryHydration {...handed}>
      <ReviewInboxPage />
    </QueryHydration>
  )
}
