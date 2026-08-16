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
import { reviewEventMessage, reviewOriginMessage, reviewOutcomeMessage } from '../review/events.ts'

// The whole account of one claim, told the way it happened: each version as
// written, and under it the rounds that judged that version - a round is a
// judgement of one version, so it belongs to it, not to a separate list the
// reader has to collate by hand. A rejection's suggestion shows read-only -
// advice to act on, never a button.

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
            {[...data.revisions].reverse().map((revision) => {
              const judged = data.rounds.filter((round) => round.revisionId === revision.id)
              return (
                <section key={revision.id} className="flex flex-col gap-2 rounded-xl border p-3.5">
                  <p className="font-medium">
                    {format(m.entryHistoryRevision, { no: revision.revisionNo })}
                    <span className="pl-2 text-xs font-normal text-muted-foreground tabular-nums">
                      {new Date(revision.createdAt).toLocaleString()}
                    </span>
                  </p>
                  <PayloadLines payload={revision.payload} formConfig={revision.formConfig} />
                  {revision.note !== null && (
                    <p className="text-muted-foreground">{revision.note}</p>
                  )}
                  {revision.attachments.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {revision.attachments.map((attachment) => (
                        <li key={attachment.attachmentId}>
                          <AttachmentLink attachmentId={attachment.attachmentId} variant="line" />
                        </li>
                      ))}
                    </ul>
                  )}
                  {judged.map((round) => (
                    <Round key={round.id} round={round} formConfig={revision.formConfig} />
                  ))}
                </section>
              )
            })}
            {/* What happened to the claim that no round explains. Kept apart
                from the rounds rather than dressed up as one: nobody judged
                the evidence here, the question changed under it. */}
            {data.events.map((event, index) => {
              const said = reviewEventMessage(event.kind)
              return (
                <section key={`own:${index}`} className="rounded-xl border p-3.5">
                  <p className="flex items-baseline gap-2">
                    <span>
                      {format(
                        said.message,
                        said.needsActor ? { who: event.actorName ?? format(m.eventSomebody) } : {},
                      )}
                    </span>
                    <span className="flex-1" />
                    <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                      {new Date(event.at).toLocaleString()}
                    </span>
                  </p>
                  {event.reason !== null && <p className="pt-0.5">{event.reason}</p>}
                </section>
              )
            })}
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

/** one round, under the version it judged, with where it came from named */
function Round({
  round,
  formConfig,
}: {
  round: {
    id: string
    roundNo: number
    outcome: string | null
    origin: string
    events: readonly {
      kind: string
      actorName: string | null
      reason?: string | null
      comment: string | null
      suggestedPayload: unknown
      at: string
    }[]
  }
  formConfig?: unknown
}) {
  const { format } = useI18n()
  const origin = reviewOriginMessage(round.origin)
  return (
    <div className="flex flex-col gap-2 rounded-lg bg-muted/50 p-3">
      <p className="flex flex-wrap items-center gap-2 text-xs font-medium">
        {format(m.entryHistoryRound, { round: round.roundNo })}
        {origin !== null && <Badge variant="outline">{format(origin)}</Badge>}
        {round.outcome !== null && (
          <Badge variant="outline">{format(reviewOutcomeMessage(round.outcome))}</Badge>
        )}
      </p>
      <ul className="flex flex-col gap-2">
        {round.events.map((event, index) => {
          const said = reviewEventMessage(event.kind)
          return (
            <li key={index}>
              <p className="flex items-baseline gap-2">
                <span>
                  {format(
                    said.message,
                    said.needsActor ? { who: event.actorName ?? format(m.eventSomebody) } : {},
                  )}
                </span>
                {event.reason != null && <Badge variant="outline">{event.reason}</Badge>}
                <span className="flex-1" />
                <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                  {new Date(event.at).toLocaleString()}
                </span>
              </p>
              {/* a wordless event is one line; an empty quotation says less
                  than nothing */}
              {event.comment !== null && event.comment !== '' && (
                <p className="border-l-2 border-border pl-2 pt-0.5">{event.comment}</p>
              )}
              {event.suggestedPayload != null && (
                <div className="mt-1 rounded-md bg-background p-2">
                  <p className="text-xs font-medium">{format(m.entrySuggestionTitle)}</p>
                  <p className="pb-1 text-xs text-muted-foreground">
                    {format(m.entrySuggestionHint)}
                  </p>
                  <PayloadLines payload={event.suggestedPayload} formConfig={formConfig} />
                </div>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
