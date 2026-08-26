import { memo } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Kbd } from '@qualy/ui/kbd'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { reviewEventMessage } from './events.ts'
import { timeLabel, type ReviewDto } from './model.ts'
import { useFinePointer } from './pointer.ts'
import { EscalationNotice } from './EscalationNotice.tsx'
import { Pane } from './Pane.tsx'

const belowLg = '@media (max-width: 1023.98px)'
const lg = '@media (min-width: 1024px)'

const paneStyles = stylex.create({
  inner: {
    gap: 16,
    padding: 20,
  },
})

const styles = stylex.create({
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  deskHead: {
    display: {
      default: 'flex',
      [belowLg]: 'none',
    },
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 4,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingBottom: 8,
  },
  heading: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 600,
    whiteSpace: 'nowrap',
  },
  noShrink: {
    flexShrink: 0,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  trailButton: {
    flexShrink: 0,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  prevCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    padding: 14,
  },
  prevHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
    rowGap: 4,
  },
  prevTitle: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 176,
    fontSize: 14,
    fontWeight: 600,
    textWrap: 'pretty',
  },
  prevWhen: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'baseline',
    gap: 8,
  },
  roundBadge: {
    backgroundColor: tokens.background,
  },
  time: {
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  verdictRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  verdictBadge: {
    minWidth: 0,
    backgroundColor: tokens.background,
    color: tokens.danger,
  },
  groundsBadge: {
    minWidth: 0,
    maxWidth: '55%',
    flexShrink: 1,
    backgroundColor: tokens.background,
  },
  truncate: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  comment: {
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
    paddingLeft: 12,
    fontSize: 14,
    lineHeight: 1.625,
  },
  earlier: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 8,
  },
  earlierHead: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: tokens.mutedForeground,
  },
  quiet: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  earlierRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
    rowGap: 2,
    fontSize: 14,
  },
  earlierNo: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  grounds: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 144,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  groundsTook: {
    color: tokens.mutedForeground,
  },
  earlierWhen: {
    marginLeft: 'auto',
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  hint: {
    fontSize: 12,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  thisRound: {
    display: {
      default: 'flex',
      [belowLg]: 'none',
    },
    alignItems: 'baseline',
    gap: 8,
  },
  thisRoundRule: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 8,
  },
  emptyMark: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
  },
  event: {
    display: 'flex',
    gap: 10,
    paddingBottom: {
      default: 12,
      ':last-child': 0,
    },
  },
  rail: {
    position: 'relative',
    display: 'flex',
    width: 16,
    flexShrink: 0,
    justifyContent: 'center',
  },
  railLine: {
    position: 'absolute',
    top: 14,
    bottom: 0,
    width: 1,
    backgroundColor: tokens.border,
  },
  dot: {
    marginTop: 6,
    width: 8,
    height: 8,
    flexShrink: 0,
    borderRadius: '9999px',
  },
  dotNow: {
    backgroundColor: tokens.foreground,
  },
  dotBefore: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 45%, transparent)`,
  },
  eventBody: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 2,
  },
  eventHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    columnGap: 8,
  },
  eventTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  eventWhen: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  eventComment: {
    fontSize: 14,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  trailDoor: {
    display: {
      default: 'flex',
      [lg]: 'none',
    },
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    paddingLeft: 26,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  nums: {
    fontVariantNumeric: 'tabular-nums',
  },
  chevron: {
    width: 12,
    height: 12,
  },
})

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
    <Pane as="section" part="flow" innerXstyle={paneStyles.inner}>
      <section {...stylex.props(styles.body)}>
        {/* Only beside the other columns. Stacked, the anchor strip already
            says which part this is and which round it is on, and a second
            heading under it read as a third voice saying the same thing. */}
        <div {...stylex.props(styles.deskHead)}>
          <h3 {...stylex.props(styles.heading)}>{format(m.reviewPrior)}</h3>
          <Badge variant="secondary" className={stylex.props(styles.noShrink).className}>
            {format(m.reviewStateRound, { round: review.roundNo })}
          </Badge>
          <span {...stylex.props(styles.spacer)} />
          {/* What this round says is only the last part of the story, and the
              rest of it decides how to read this part. The key alone was not
              a way in: nobody finds H without being told. */}
          <Button
            variant="ghost"
            size="sm"
            className={stylex.props(styles.trailButton).className}
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
          <div data-testid="prior-round-card" {...stylex.props(styles.prevCard)}>
            {/* Wrap, never squeeze - and by the column's own width, not the
                window's: pinning the badge and the time to the title's line
                left the title min-content wide in a narrow column, which
                set a long sentence one character per line. The title keeps
                at least its basis and the datum pair drops below when the
                line cannot hold all three. */}
            <div {...stylex.props(styles.prevHead)}>
              <p {...stylex.props(styles.prevTitle)}>
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
              <span {...stylex.props(styles.prevWhen)}>
                <Badge variant="secondary" className={stylex.props(styles.roundBadge).className}>
                  {format(m.reviewStateRound, { round: previous.roundNo })}
                </Badge>
                <span {...stylex.props(styles.time)}>{timeLabel(previous.at)}</span>
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
              <div {...stylex.props(styles.verdictRow)}>
                {/* what was done, in the colour of what it was: a refusal read
                    in the same ink as a note is one a tired reader scrolls past */}
                <Badge
                  variant="outline"
                  title={said}
                  className={stylex.props(styles.verdictBadge).className}
                >
                  <span {...stylex.props(styles.truncate)}>{said}</span>
                </Badge>
                {previous.reason !== null && (
                  <Badge
                    variant="outline"
                    title={previous.reason}
                    className={stylex.props(styles.groundsBadge).className}
                  >
                    <span {...stylex.props(styles.truncate)}>{previous.reason}</span>
                  </Badge>
                )}
              </div>
            )}
            {previous.comment !== null && (
              <p {...stylex.props(styles.comment)}>{previous.comment}</p>
            )}
            {/* the rounds before that, a line each: whether the same thing
                has been asked for three times is not answerable from the
                latest round alone */}
            {earlier.length > 0 && (
              <div {...stylex.props(styles.earlier)}>
                <div {...stylex.props(styles.earlierHead)}>
                  <p {...stylex.props(styles.sectionLabel)}>{format(m.reviewEarlierRounds)}</p>
                  <span {...stylex.props(styles.spacer)} />
                  <p {...stylex.props(styles.quiet)}>
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
                      {...stylex.props(styles.earlierRow)}
                    >
                      <span {...stylex.props(styles.earlierNo)}>
                        {format(m.reviewStateRound, { round: one.roundNo })}
                      </span>
                      <span
                        title={grounds}
                        {...stylex.props(styles.grounds, took && styles.groundsTook)}
                      >
                        {grounds}
                      </span>
                      <span {...stylex.props(styles.earlierWhen)}>{timeLabel(one.at)}</span>
                    </span>
                  )
                })}
              </div>
            )}
            {!withdrawn && <p {...stylex.props(styles.hint)}>{format(m.reviewPreviousHint)}</p>}
          </div>
        )}
        {/* What has happened since this round opened, told apart from the
            history above it: the card is why it came back, these are what
            has been said about the answer to that. The rule draws only
            where there IS history - a first round has nothing to be told
            apart from, and the pane's own header already drew a line. */}
        <div {...stylex.props(styles.thisRound, previous !== null && styles.thisRoundRule)}>
          <p {...stylex.props(styles.sectionLabel)}>{format(m.reviewThisRound)}</p>
          <span {...stylex.props(styles.spacer)} />
          {review.state !== 'completed' && review.capabilities.canDecide && (
            <p {...stylex.props(styles.quiet)}>{format(m.reviewAwaitingYou)}</p>
          )}
        </div>
        {review.events.length === 0 ? (
          <p {...stylex.props(styles.emptyMark)}>—</p>
        ) : (
          // A timeline, not a numbered list: dots on one thread, the last
          // solid because it is where the round stands now. The two lines of
          // an event are told apart by weight and colour - the name of what
          // happened in ink, the words said about it in grey - so the quote
          // bar the comment used to carry has nothing left to add.
          <ol {...stylex.props(styles.timeline)}>
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
                <li key={index} {...stylex.props(styles.event)}>
                  <span {...stylex.props(styles.rail)}>
                    {!last && <span aria-hidden {...stylex.props(styles.railLine)} />}
                    <span
                      aria-hidden
                      {...stylex.props(styles.dot, last ? styles.dotNow : styles.dotBefore)}
                    />
                  </span>
                  <div {...stylex.props(styles.eventBody)}>
                    <div {...stylex.props(styles.eventHead)}>
                      <p {...stylex.props(styles.eventTitle)}>{title}</p>
                      {event.reason !== null && <Badge variant="outline">{event.reason}</Badge>}
                      <span {...stylex.props(styles.spacer)} />
                      <p {...stylex.props(styles.eventWhen)}>{timeLabel(event.at)}</p>
                    </div>
                    {event.comment !== null && (
                      <p {...stylex.props(styles.eventComment)}>{event.comment}</p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {/* the stacked page's way into the whole story, sitting where the
            story just ended; beside the columns the heading row carries it */}
        <button type="button" onClick={onTrail} {...stylex.props(styles.trailDoor)}>
          {format(m.reviewTrailFullOpen)}
          {earlier.length > 0 && (
            <span {...stylex.props(styles.nums)}>
              {format(m.reviewEarlierCount, { count: earlier.length })}
            </span>
          )}
          <ChevronRightIcon aria-hidden className={stylex.props(styles.chevron).className} />
        </button>
      </section>
    </Pane>
  )
})
