import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, SidePanel } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { attachmentContentUrl } from './model.ts'

// The whole account of one claim, oldest first: every version as written,
// every round it went through, and what was said in them. A rejection's
// suggestion shows here read-only - advice to act on, never a button.

export function EntryHistory({ entryId, onClose }: { entryId: string; onClose: () => void }) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const history = useQuery(query.assessment.getEntryHistory.queryOptions({ params: { entryId } }))
  const data = history.data

  return (
    <SidePanel open title={format(m.entryHistoryTitle)} onClose={onClose}>
      <AsyncSection
        pending={history.isPending}
        error={history.error ? formatError(history.error) : null}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void history.refetch()}
        skeleton={<Skeleton className="h-40 w-full" />}
      >
        {data !== undefined && (
          <div className="flex flex-col gap-5 text-sm">
            {data.revisions.map((revision) => (
              <section key={revision.id} className="rounded-md border p-3">
                <p className="font-medium">
                  {format(m.entryHistoryRevision, { no: revision.revisionNo })}
                  <span className="pl-2 text-xs font-normal text-muted-foreground">
                    {new Date(revision.createdAt).toLocaleString()}
                  </span>
                </p>
                <PayloadLines payload={revision.payload} />
                {revision.note !== null && (
                  <p className="pt-1 text-muted-foreground">{revision.note}</p>
                )}
                {revision.attachments.length > 0 && (
                  <ul className="pt-2">
                    {revision.attachments.map((attachment) => (
                      <li key={attachment.attachmentId}>
                        <a
                          className="text-primary underline-offset-2 hover:underline"
                          href={attachmentContentUrl(attachment.attachmentId)}
                          download
                        >
                          {format(m.reviewDownload)}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
            {data.rounds.map((round) => (
              <section key={round.id} className="rounded-md border p-3">
                <p className="flex items-center gap-2 font-medium">
                  {format(m.entryHistoryRound, { round: round.roundNo })}
                  {round.outcome !== null && <Badge variant="outline">{round.outcome}</Badge>}
                </p>
                <ul className="flex flex-col gap-2 pt-2">
                  {round.events.map((event, index) => (
                    <li key={index}>
                      <p className="text-xs text-muted-foreground">
                        {event.kind} · {new Date(event.at).toLocaleString()}
                      </p>
                      {event.comment !== null && <p>{event.comment}</p>}
                      {event.suggestedPayload != null && (
                        <div className="mt-1 rounded-md bg-muted/50 p-2">
                          <p className="text-xs font-medium">{format(m.entrySuggestionTitle)}</p>
                          <p className="pb-1 text-xs text-muted-foreground">
                            {format(m.entrySuggestionHint)}
                          </p>
                          <PayloadLines payload={event.suggestedPayload} />
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </AsyncSection>
    </SidePanel>
  )
}

/** business data as the person typed it: keys and values, nothing invented */
function PayloadLines({ payload }: { payload: unknown }) {
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const keys = Object.keys(record).filter((key) => typeof record[key] === 'string')
  if (keys.length === 0) return null
  return (
    <dl className="pt-1">
      {keys.map((key) => (
        <div key={key} className="flex gap-2">
          <dt className="text-muted-foreground">{key}</dt>
          <dd>{String(record[key])}</dd>
        </div>
      ))}
    </dl>
  )
}
