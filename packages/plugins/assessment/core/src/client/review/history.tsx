import { useEffect, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentMessages as m } from '../i18n.ts'
import { reviewOutcomeMessage } from './events.ts'
import { timeLabel, useEntryHistory, type HistoryRevision } from './model.ts'

// Choosing which version of a filing to read the judged one against.
//
// The account itself is not here: a claim has one story, and both the person
// who filed it and whoever is judging it read the same rendering of it
// (entry/EntryHistory). This is the other half of that - the list of what
// there is to compare against, which only a reviewer ever needs.

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
 * Which earlier version the filing is being read against (1j).
 *
 * Every version is listed, the one under judgement included: leaving it out
 * made the list disagree with the count above it, and a reader looking for
 * "which one am I reading" found nothing. It is not selectable - comparing a
 * filing against itself says nothing, and comparing forward would read it
 * against something that came after it - so it stands marked instead.
 *
 * Choosing is two steps rather than one. A press that both picks and closes
 * cannot be corrected without reopening, and what each version was is only
 * legible with the others beside it.
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
  const revisions = data?.revisions ?? []
  const [chosen, setChosen] = useState<string | null>(null)
  // reopened against a different comparison than last time: the list starts
  // where the screen behind it actually is
  useEffect(() => {
    if (open) setChosen(comparingId)
  }, [open, comparingId])
  // The screen behind says 'previous' rather than naming a version - the
  // default comparison exists before the history has loaded. Resolved here,
  // derived rather than stored: resolving into state would race the fetch,
  // and until it resolves the list showed no selection at all - every row
  // alike, the confirm button dead, nothing saying which version the
  // comparison on screen was reading.
  const previousId =
    [...revisions].reverse().find((one) => one.revisionNo < judgedRevisionNo)?.id ?? null
  const chosenId = chosen === 'previous' ? previousId : chosen

  /**
   * How the round that judged this version ended, in one phrase.
   *
   * A list of dates cannot be chosen from. What a reader is looking for is
   * "the one that came back", and that is a fact about the round, not the
   * version - so it is read off the rounds and shown on the version they
   * judged.
   */
  const outcomeOf = (revisionId: string) => {
    const round = [...(data?.rounds ?? [])]
      .reverse()
      .find((one) => one.revisionId === revisionId && one.outcome !== null)
    if (round === undefined) return null
    const said = [...round.events]
      .reverse()
      .find((event) => event.kind === 'rejected' || event.kind === 'approved')
    return { outcome: round.outcome!, who: said?.actorName ?? null }
  }

  const picked = revisions.find((one) => one.id === chosenId)

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-md">
        <SheetHeader className="border-b">
          <SheetTitle className="text-sm">{format(m.reviewVersionsTitle)}</SheetTitle>
          <p className="text-xs text-muted-foreground">
            {format(m.reviewVersionsSubtitle, {
              name: participantName,
              item: itemTitle,
              count: revisions.length,
            })}
          </p>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4">
            <AsyncSection
              pending={history.isPending}
              error={history.error ? formatError(history.error) : null}
              loadingLabel={format(commonMessages.loading)}
              retryLabel={format(commonMessages.retry)}
              onRetry={() => void history.refetch()}
              skeleton={<Skeleton className="h-32 w-full" />}
            >
              {revisions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{format(m.reviewCompareBlank)}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {[...revisions].reverse().map((revision) => {
                    const judged = revision.revisionNo === judgedRevisionNo
                    const ended = outcomeOf(revision.id)
                    return (
                      <li key={revision.id}>
                        {/* Three states a glance apart: the judged version is
                          greyed and refuses the cursor - it is what the
                          comparison reads, not something to read against;
                          the one being compared stands marked; the rest
                          offer themselves. */}
                        <button
                          type="button"
                          disabled={judged}
                          onClick={() => setChosen(revision.id)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                            judged
                              ? 'cursor-not-allowed border-transparent bg-muted/40 text-muted-foreground'
                              : revision.id === chosenId
                                ? 'cursor-pointer border-foreground bg-accent/60'
                                : 'cursor-pointer hover:bg-accent/50',
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
                          {judged ? (
                            <Badge variant="outline">{format(m.reviewVersionJudged)}</Badge>
                          ) : revision.id === chosenId ? (
                            <Badge>{format(m.reviewVersionComparing)}</Badge>
                          ) : (
                            ended !== null && (
                              <Badge variant="outline" className="font-normal">
                                {format(reviewOutcomeMessage(ended.outcome))}
                                {ended.who !== null && `　${ended.who}`}
                              </Badge>
                            )
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </AsyncSection>
          </div>
        </ScrollArea>
        <div className="flex items-center gap-3 border-t p-3">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground">
            {format(m.reviewVersionsFoot)}
          </p>
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.close)}
          </Button>
          <Button
            disabled={picked === undefined}
            onClick={() => picked !== undefined && onPick(picked.id)}
          >
            {picked === undefined
              ? format(m.reviewVersionsConfirmNone)
              : format(m.reviewVersionsConfirm, { no: picked.revisionNo })}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
