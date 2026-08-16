import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentMessages as m } from '../i18n.ts'
import { reviewEventMessage } from './events.ts'
import { timeLabel, useEntryHistory, type HistoryRevision } from './model.ts'

// Everything that has happened to one claim, for whoever is judging it now.
//
// Two things read together, because a reviewer asking "what happened here"
// means both: the versions the participant filed, and what each round said
// about them. The server answers this on the entry - the reviewer's standing
// is the open round they hold - so this is one request, not a stitching of
// several.

/** the shape the entry-history endpoint answers with, as these screens read it */
type History = {
  revisions: readonly HistoryRevision[]
  rounds: readonly {
    id: string
    roundNo: number
    outcome: string | null
    revisionId: string
    submittedAt: string
    events: readonly {
      kind: string
      actorName: string | null
      reason: string | null
      comment: string | null
      at: string
    }[]
  }[]
}

/**
 * The claim's whole story, in a sheet beside the one being judged: the
 * rounds newest first, each with what was said in it, and which version it
 * was judging.
 */
export function HistorySheet({
  open,
  entryId,
  onClose,
}: {
  open: boolean
  entryId: string
  onClose: () => void
}) {
  const { format, formatError } = useI18n()
  const history = useEntryHistory(entryId, true)
  const data = history.data as History | undefined
  const revisionNo = new Map((data?.revisions ?? []).map((one) => [one.id, one.revisionNo]))

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-xl">
        <SheetHeader className="border-b">
          <SheetTitle className="text-sm">{format(m.reviewTrailTitle)}</SheetTitle>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <AsyncSection
            pending={history.isPending}
            error={history.error ? formatError(history.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void history.refetch()}
            skeleton={<Skeleton className="h-64 w-full" />}
          >
            <ol className="flex flex-col gap-5">
              {[...(data?.rounds ?? [])].reverse().map((round) => (
                <li key={round.id} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2 border-b pb-1.5">
                    <h4 className="text-sm font-semibold">
                      {format(m.reviewTrailRound, { no: round.roundNo })}
                    </h4>
                    <Badge variant="outline">
                      {format(m.reviewVersionName, {
                        no: revisionNo.get(round.revisionId) ?? '—',
                      })}
                    </Badge>
                    {round.outcome !== null && <Badge variant="secondary">{round.outcome}</Badge>}
                    <span className="flex-1" />
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {timeLabel(round.submittedAt)}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-2">
                    {round.events.map((event, index) => {
                      const said = reviewEventMessage(event.kind)
                      return (
                        <li key={index} className="flex flex-col gap-0.5">
                          <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
                            <span>
                              {format(
                                said.message,
                                said.needsActor
                                  ? { who: event.actorName ?? format(m.eventSomebody) }
                                  : {},
                              )}
                            </span>
                            {event.reason !== null && (
                              <Badge variant="outline">{event.reason}</Badge>
                            )}
                            <span className="flex-1" />
                            <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                              {timeLabel(event.at)}
                            </span>
                          </p>
                          {event.comment !== null && (
                            <p className="border-l-2 border-border pl-2.5 text-sm leading-relaxed">
                              {event.comment}
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </AsyncSection>
        </div>
      </SheetContent>
    </Sheet>
  )
}

/**
 * Which earlier version the filing is being read against (1j).
 *
 * Only versions older than the one under judgement: comparing forward would
 * be reading a filing against something that came after it.
 */
export function VersionPicker({
  open,
  entryId,
  judgedRevisionNo,
  comparingId,
  participantName,
  itemTitle,
  onPick,
  onClose,
}: {
  open: boolean
  entryId: string
  judgedRevisionNo: number
  comparingId: string | null
  participantName: string
  itemTitle: string
  onPick: (revisionId: string) => void
  onClose: () => void
}) {
  const { format, formatError } = useI18n()
  const history = useEntryHistory(entryId, open)
  const data = history.data as History | undefined
  const earlier = (data?.revisions ?? []).filter((one) => one.revisionNo < judgedRevisionNo)

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-sm">{format(m.reviewVersionsTitle)}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {format(m.reviewVersionsSubtitle, {
              name: participantName,
              item: itemTitle,
              count: (data?.revisions ?? []).length,
            })}
          </p>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <AsyncSection
            pending={history.isPending}
            error={history.error ? formatError(history.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void history.refetch()}
            skeleton={<Skeleton className="h-32 w-full" />}
          >
            {earlier.length === 0 ? (
              <p className="text-sm text-muted-foreground">{format(m.reviewCompareBlank)}</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {[...earlier].reverse().map((revision) => (
                  <li key={revision.id}>
                    <button
                      type="button"
                      onClick={() => onPick(revision.id)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                        revision.id === comparingId
                          ? 'border-foreground/30 bg-accent/60'
                          : 'hover:bg-accent/50',
                      )}
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-baseline gap-2">
                          <span className="text-sm font-medium">
                            {format(m.reviewVersionName, { no: revision.revisionNo })}
                          </span>
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {timeLabel(revision.createdAt)}
                          </span>
                        </span>
                        {revision.note !== null && (
                          <span className="min-w-0 truncate text-xs text-muted-foreground">
                            {revision.note}
                          </span>
                        )}
                      </span>
                      {revision.id === comparingId && (
                        <Badge variant="outline">{format(m.reviewVersionComparing)}</Badge>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </AsyncSection>
        </div>
        <div className="flex justify-end border-t p-3">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.close)}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
