import { useQuery } from '@tanstack/react-query'
import { useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'

// The queue, oldest first. The server already decided whose work may appear
// here; this screen only shows this batch's share of it and opens one.

export default function ReviewInboxPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.reviewTab)} description={format(m.reviewHint)}>
      {(batch) => <Queue batchId={batch.id} />}
    </BatchScreen>
  )
}

function Queue({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const navigate = usePageNavigate()
  const { format, formatError } = useI18n()
  const inbox = useQuery({
    ...query.assessment.listReviewInbox.queryOptions({ query: {} }),
    refetchInterval: 30_000,
  })
  // the queue crosses rounds; this section of the workspace shows its own
  const rows = (inbox.data?.items ?? []).filter((item) => item.batchId === batchId)

  return (
    <AsyncSection
      pending={inbox.isPending}
      error={inbox.error ? formatError(inbox.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void inbox.refetch()}
      skeleton={<Skeleton className="h-32 w-full" />}
    >
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{format(m.reviewEmpty)}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <li
              key={row.instanceId}
              className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2"
            >
              <div className="text-sm">
                <p className="font-medium">{row.itemTitle}</p>
                <p className="text-muted-foreground">
                  {format(m.reviewSubmittedBy, { name: row.participantName, round: row.roundNo })}
                  <span className="pl-2">{new Date(row.submittedAt).toLocaleString()}</span>
                </p>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  navigate('assessment/review-instance', {
                    params: { batchId, instanceId: row.instanceId },
                  })
                }
              >
                {format(m.reviewOpen)}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </AsyncSection>
  )
}
