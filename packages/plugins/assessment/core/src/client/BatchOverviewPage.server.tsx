import { queryKeyOf } from '@qualy/web-runtime/query-key'
import { QueryHydration } from '@qualy/web-runtime/query-hydration'
import { readApiExit, renderRequest } from '@qualy/web-rsc/request'
import { answersOf, settle } from '@qualy/web-rsc/queries'
import { assessmentApi } from './api.ts'
import { ACTIVITY_LANE, ACTIVITY_PAGE, laneOf, overviewReads } from './overview-reads.ts'
import { batchIdOf, readBatch } from './batch/batch-reads.server.ts'
import NoteMarkdown from './batch/NoteMarkdown.tsx'
import BatchOverviewPage from './BatchOverviewPage.tsx'

// The batch overview as a server draws it (docs/adr/0012-rsc-data-mode.md).
//
// Two kinds of content, owned two ways. What the server alone shows - the
// batch's note, drawn from its markup here, so neither the renderer nor the
// parser goes to the browser - is drawn here and handed to the page as
// elements. What the page keeps working with - the reader's desk and the
// feed at the place the address names, which the batch's live channel
// refreshes and the reader pages through - stays the page's queries, handed
// the answers this request read so the html carries them and the page does
// not ask again while they are fresh.
//
// The workspace around the page - the batch, its stages, what the rail may
// show - is the workspace's own to prepare (batch/BatchContextBar.server.tsx),
// and every read both ask for is made once for the request.

export default async function BatchOverview({
  params = {},
}: {
  params?: Readonly<Record<string, string | undefined>>
}) {
  const batchId = batchIdOf(params)
  // an address that cannot name a batch is the page's to say so
  if (batchId === undefined) return <BatchOverviewPage />
  const { url } = renderRequest()
  const reads = overviewReads(batchId, {
    lane: laneOf(url.searchParams.get(ACTIVITY_LANE)),
    page: url.searchParams.get(ACTIVITY_PAGE) ?? undefined,
  })
  const keys = {
    overview: queryKeyOf('assessment', 'getMyOverview', reads.overview),
    activity: queryKeyOf('assessment', 'listMyActivity', reads.activity),
  }
  const [subject, handed] = await Promise.all([
    readBatch(batchId).exit.then(settle),
    answersOf([
      {
        key: keys.overview,
        exit: readApiExit(
          assessmentApi,
          (client) => client.assessment.getMyOverview(reads.overview),
          { key: keys.overview },
        ),
      },
      {
        key: keys.activity,
        exit: readApiExit(
          assessmentApi,
          (client) => client.assessment.listMyActivity(reads.activity),
          { key: keys.activity },
        ),
      },
    ]),
  ])
  // a batch that is not there is the workspace's to say, and it has
  if (subject.kind !== 'answer') return <BatchOverviewPage />
  const text = subject.value.batch.descriptionMd?.trim() ?? ''
  return (
    <QueryHydration {...handed}>
      <BatchOverviewPage
        {...(text === '' ? {} : { drawnNote: { text, drawn: <NoteMarkdown text={text} /> } })}
      />
    </QueryHydration>
  )
}
