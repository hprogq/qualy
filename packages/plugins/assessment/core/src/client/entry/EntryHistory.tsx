import { useQuery } from '@tanstack/react-query'
import { useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, SidePanel } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { AttachmentLink } from './AttachmentLink.tsx'
import { fieldsOf } from './model.ts'
import { reviewEventMessage, reviewOutcomeMessage } from '../review/events.ts'

// The whole account of one claim, oldest first: every version as written,
// every round it went through, and what was said in them. A rejection's
// suggestion shows here read-only - advice to act on, never a button.

export function EntryHistory({
  open,
  entryId,
  onClose,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  entryId: string
  onClose: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const history = useQuery(query.assessment.getEntryHistory.queryOptions({ params: { entryId } }))
  const data = history.data

  return (
    <SidePanel open={open} title={format(m.entryHistoryTitle)} onClose={onClose}>
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
                <PayloadLines payload={revision.payload} formConfig={revision.formConfig} />
                {revision.note !== null && (
                  <p className="pt-1 text-muted-foreground">{revision.note}</p>
                )}
                {revision.attachments.length > 0 && (
                  <ul className="flex flex-col gap-1 pt-2">
                    {revision.attachments.map((attachment) => (
                      <li key={attachment.attachmentId}>
                        <AttachmentLink attachmentId={attachment.attachmentId} />
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
                  {round.outcome !== null && (
                    <Badge variant="outline">{format(reviewOutcomeMessage(round.outcome))}</Badge>
                  )}
                </p>
                <ul className="flex flex-col gap-2 pt-2">
                  {round.events.map((event, index) => {
                    const said = reviewEventMessage(event.kind)
                    return (
                      <li key={index}>
                        <p>
                          {format(
                            said.message,
                            said.needsActor
                              ? { who: event.actorName ?? format(m.eventSomebody) }
                              : {},
                          )}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(event.at).toLocaleString()}
                        </p>
                        {event.comment !== null && <p className="pt-0.5">{event.comment}</p>}
                        {event.suggestedPayload != null && (
                          <div className="mt-1 rounded-md bg-muted/50 p-2">
                            <p className="text-xs font-medium">{format(m.entrySuggestionTitle)}</p>
                            <p className="pb-1 text-xs text-muted-foreground">
                              {format(m.entrySuggestionHint)}
                            </p>
                            <PayloadLines
                              payload={event.suggestedPayload}
                              formConfig={
                                data.revisions.find(
                                  (candidate) => candidate.id === round.revisionId,
                                )?.formConfig
                              }
                            />
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </AsyncSection>
    </SidePanel>
  )
}

/**
 * Business data as the person filed it, under the names they answered.
 *
 * The account is of what was filed, so every value in the payload gets a
 * row: a form edited afterwards no longer names some of them, and those
 * stand under their raw handle rather than leaving the history short. Only
 * labels are free text - the keys are what the form guarantees unique.
 */
function PayloadLines({ payload, formConfig }: { payload: unknown; formConfig?: unknown }) {
  const { format } = useI18n()
  if (typeof payload !== 'object' || payload === null) return null
  const record = payload as Record<string, unknown>
  const fields = fieldsOf(formConfig ?? null)
  const named = fields.filter((field) => field.type !== 'attachment')
  const labels = new Map(named.map((field) => [field.key, field.label]))
  // cited files are listed as files, not as a line of ids
  const cited = new Set(
    fields.filter((field) => field.type === 'attachment').map((field) => field.key),
  )
  const keys = [
    ...named.map((field) => field.key),
    ...Object.keys(record).filter((key) => !labels.has(key) && !cited.has(key)),
  ]
  const rows = keys.flatMap((key) => {
    const value = record[key]
    // a field somebody filled and then cleared is part of what they filed:
    // the row stands and says it is empty, rather than reading as a field
    // that was never there
    return typeof value === 'string' ? [{ key, label: labels.get(key) ?? key, value }] : []
  })
  if (rows.length === 0) return null
  return (
    <dl className="pt-1">
      {rows.map((row) => (
        <div key={row.key} className="flex gap-2">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className={row.value === '' ? 'text-muted-foreground' : undefined}>
            {row.value === '' ? format(m.entryFieldCleared) : row.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
