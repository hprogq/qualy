import { memo } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Kbd } from '@qualy/ui/kbd'
import { assessmentMessages as m } from '../i18n.ts'
import { reviewEventMessage } from './events.ts'
import { timeLabel, type ReviewDto } from './model.ts'
import { useFinePointer } from './pointer.ts'
import { EscalationNotice } from './EscalationNotice.tsx'
import { Pane } from './Pane.tsx'

/**
 * How the filing got here and what has been said about it.
 *
 * Its own column beside the filing rather than a section above it: reading
 * the second meant scrolling past the first, and a reviewer checking a
 * resubmission against what was asked of it last time needs both at once.
 * This one is short enough to fit a screen; the filing beside it is what
 * scrolls.
 */

export const FlowColumn = memo(function FlowColumn({
  review,
  onTrail,
  lifted,
}: {
  review: ReviewDto
  onTrail: () => void
  /** whether the escalation notice stands outside the pager instead of here */
  lifted: boolean
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const previous = review.context?.previous ?? null
  const earlier = review.context?.earlier ?? []
  // A withdrawal is not a refusal: nobody judged anything, and dressing it
  // in the refusal card's words would invent a verdict that never happened.
  // Nor is a policy re-route - the round ended without a word on the
  // merits, and the card says that instead of borrowing a verdict.
  const withdrawn = previous?.kind === 'cancelled-by-submitter'
  const rerouted = previous?.kind === 'rerouted'
  // an appeal round carries its grounds in its own opening event, and the
  // grounds are the one thing this judge must read first
  const appealed = review.events.find((event) => event.kind === 'appealed')
  const spoken =
    previous === null ? null : reviewEventMessage(previous.kind, previous.actorName !== null)
  const said =
    spoken === null || previous === null
      ? ''
      : format(
          spoken.message,
          spoken.needsActor ? { who: previous.actorName ?? format(m.eventSomebody) } : {},
        )
  return (
    <Pane as="section" part="flow" inner="gap-4 p-5">
      <section className="flex flex-col gap-3">
        {/* Only beside the other columns. Stacked, the anchor strip already
            says which part this is and which round it is on, and a second
            heading under it read as a third voice saying the same thing. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b pb-2 max-lg:hidden">
          <h3 className="shrink-0 text-sm font-semibold whitespace-nowrap">
            {format(m.reviewPrior)}
          </h3>
          <Badge variant="secondary" className="shrink-0">
            {format(m.reviewStateRound, { round: review.roundNo })}
          </Badge>
          <span className="flex-1" />
          {/* What this round says is only the last part of the story, and the
              rest of it decides how to read this part. The key alone was not
              a way in: nobody finds H without being told. */}
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs whitespace-nowrap"
            onClick={onTrail}
          >
            {format(m.reviewTrailFullOpen)}
            {fine && <Kbd>H</Kbd>}
          </Button>
        </div>
        {/* the notice the reviewer must not scroll past, in the column
            where the desk keeps the whole story; below lg it stands over
            the pager instead, where no page can hide it */}
        {!lifted && <EscalationNotice review={review} />}
        {previous !== null && (
          <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3.5">
            {/* Wrap, never squeeze - and by the column's own width, not the
                window's: pinning the badge and the time to the title's line
                left the title min-content wide in a narrow column, which
                set a long sentence one character per line. The title keeps
                at least its basis and the datum pair drops below when the
                line cannot hold all three. */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="min-w-0 flex-1 basis-44 text-sm font-semibold text-pretty">
                {format(
                  withdrawn
                    ? m.reviewPreviousWithdrawn
                    : rerouted
                      ? m.reviewPreviousRerouted
                      : previous.kind === 'approved'
                        ? m.reviewPreviousApproved
                        : m.reviewPreviousTitle,
                )}
              </p>
              <span className="flex shrink-0 items-baseline gap-2">
                <Badge variant="secondary" className="bg-background">
                  {format(m.reviewStateRound, { round: previous.roundNo })}
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {timeLabel(previous.at)}
                </span>
              </span>
            </div>
            {/* One line, and the name gives way first. A reviewer's full
                title runs long, and left to wrap it pushed the reason onto a
                third line and the card into the space the comment needed;
                the reason is the shorter and the more useful of the two, so
                it keeps its width and the name ellipses. Both carry their
                full text as a tooltip. */}
            {/* the verdict chips only where a verdict exists: the withdrawn
                and re-routed cards' titles already say the whole of it */}
            {!withdrawn && !rerouted && (
              <div className="flex min-w-0 items-center gap-2">
                {/* what was done, in the colour of what it was: a refusal read
                    in the same ink as a note is one a tired reader scrolls past */}
                <Badge
                  variant="outline"
                  title={said}
                  className="min-w-0 bg-background text-destructive"
                >
                  <span className="truncate">{said}</span>
                </Badge>
                {previous.reason !== null && (
                  <Badge
                    variant="outline"
                    title={previous.reason}
                    className="min-w-0 max-w-[55%] shrink bg-background"
                  >
                    <span className="truncate">{previous.reason}</span>
                  </Badge>
                )}
              </div>
            )}
            {previous.comment !== null && (
              <p className="border-l-2 border-muted-foreground/30 pl-3 text-sm leading-relaxed">
                {previous.comment}
              </p>
            )}
            {/* the rounds before that, a line each: whether the same thing
                has been asked for three times is not answerable from the
                latest round alone */}
            {earlier.length > 0 && (
              <div className="flex flex-col gap-1 border-t pt-2">
                <div className="flex items-baseline gap-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {format(m.reviewEarlierRounds)}
                  </p>
                  <span className="flex-1" />
                  <p className="text-xs text-muted-foreground">
                    {format(m.reviewEarlierCount, { count: earlier.length })}
                  </p>
                </div>
                {/* Round, grounds, time - never who. This list answers
                    "where has this been getting stuck", and the grounds
                    answer that directly; a name only matters when tracing
                    responsibility, which is the full trail's job. A
                    withdrawal has no grounds to show and must not be
                    dressed in one: nobody ruled, so the line goes grey and
                    says exactly what happened. */}
                {earlier.map((one, index) => {
                  const took = one.kind === 'cancelled-by-submitter'
                  const grounds = took
                    ? format(m.reviewEarlierWithdrawn)
                    : (one.reason ?? format(m.reviewEarlierReturned))
                  return (
                    // Wrap by the column's own width, never squeeze: the
                    // grounds are the row's point and keep a floor of their
                    // own; when the line cannot also hold the clock, the
                    // clock drops to its own line instead of erasing the
                    // grounds or running out of the card.
                    <span
                      key={index}
                      data-testid="earlier-row"
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                    >
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format(m.reviewStateRound, { round: one.roundNo })}
                      </span>
                      <span
                        title={grounds}
                        className={cn(
                          'min-w-0 flex-1 basis-36 truncate',
                          took && 'text-muted-foreground',
                        )}
                      >
                        {grounds}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                        {timeLabel(one.at)}
                      </span>
                    </span>
                  )
                })}
              </div>
            )}
            {!withdrawn && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {format(m.reviewPreviousHint)}
              </p>
            )}
          </div>
        )}
        {/* What has happened since this round opened, told apart from the
            history above it: the card is why it came back, these are what
            has been said about the answer to that. The rule draws only
            where there IS history - a first round has nothing to be told
            apart from, and the pane's own header already drew a line. */}
        <div
          className={cn(
            'flex items-baseline gap-2 max-lg:hidden',
            previous !== null && 'border-t pt-2',
          )}
        >
          <p className="text-xs font-semibold text-muted-foreground">{format(m.reviewThisRound)}</p>
          <span className="flex-1" />
          {review.state !== 'completed' && review.capabilities.canDecide && (
            <p className="text-xs text-muted-foreground">{format(m.reviewAwaitingYou)}</p>
          )}
        </div>
        {review.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          // A timeline, not a numbered list: dots on one thread, the last
          // solid because it is where the round stands now. The two lines of
          // an event are told apart by weight and colour - the name of what
          // happened in ink, the words said about it in grey - so the quote
          // bar the comment used to carry has nothing left to add.
          <ol className="flex flex-col">
            {review.events.map((event, index) => {
              const said = reviewEventMessage(event.kind, event.actorName !== null)
              // the submission names the version it carried in - the round
              // judges exactly one, and the trail should say which
              const title =
                event.kind === 'submitted'
                  ? format(m.entryTrailSubmittedBy, {
                      who: event.actorName ?? format(m.eventSomebody),
                      no: review.revision.revisionNo,
                    })
                  : format(
                      said.message,
                      said.needsActor ? { who: event.actorName ?? format(m.eventSomebody) } : {},
                    )
              const last = index === review.events.length - 1
              return (
                <li key={index} className="flex gap-2.5 pb-3 last:pb-0">
                  <span className="relative flex w-4 shrink-0 justify-center">
                    {!last && (
                      <span aria-hidden className="absolute top-3.5 bottom-0 w-px bg-border" />
                    )}
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        last ? 'bg-foreground' : 'bg-muted-foreground/45',
                      )}
                    />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="text-sm font-medium">{title}</p>
                      {event.reason !== null && <Badge variant="outline">{event.reason}</Badge>}
                      <span className="flex-1" />
                      <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {timeLabel(event.at)}
                      </p>
                    </div>
                    {event.comment !== null && (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {event.comment}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {/* the stacked page's way into the whole story, sitting where the
            story just ended; beside the columns the heading row carries it */}
        <button
          type="button"
          onClick={onTrail}
          className="flex items-center gap-1 self-start pl-[26px] text-xs text-muted-foreground lg:hidden"
        >
          {format(m.reviewTrailFullOpen)}
          {earlier.length > 0 && (
            <span className="tabular-nums">
              {format(m.reviewEarlierCount, { count: earlier.length })}
            </span>
          )}
          <ChevronRightIcon aria-hidden className="size-3" />
        </button>
      </section>
    </Pane>
  )
})
