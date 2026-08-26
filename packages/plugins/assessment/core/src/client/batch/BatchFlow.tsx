import { useEffect, useRef, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import {
  ChevronsLeftIcon,
  ChevronsRightIcon,
  LocateFixedIcon,
  MoreVerticalIcon,
} from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Badge } from '@qualy/ui/badge'
import { cn } from '@qualy/ui/cn'
import {
  Timeline,
  TimelineContent,
  TimelineDate,
  TimelineHeader,
  TimelineIndicator,
  TimelineItem,
  TimelineSeparator,
  TimelineTitle,
} from '@qualy/ui/timeline'
import { assessmentMessages as m } from '../i18n.ts'
import { stagesOf, type FlowEntry, type FlowStage } from './flow.ts'
import { useWhen } from './when.ts'

// The stages of the round, drawn twice.
//
// A wide screen has spare width and no spare height, so the flow takes a
// column beside the page and runs down it. A phone has the opposite: height
// is what the reader is spending, and sideways scrolling is cheap - so the
// same timeline turns on its side and opens on the stage the round is
// actually in, rather than at the beginning of a history nobody asked for.
//
// Everything a stage has to say is on the page: when it runs, or what it is
// waiting for, and whatever prose was written about it. Nothing waits behind
// a hover - a touch screen has no pointer to rest, and a detail worth writing
// down is worth reading without asking for it.
//
// The timeline parts keep their utility-class overrides: the rail component
// styles itself by orientation data attributes, and overrides into it ride
// the same cascade layer. The elements this file owns are StyleX.

// a mark that keeps moving, because this is the one stage that is happening
// rather than recorded
const ping = stylex.keyframes({
  '75%': { transform: 'scale(2)', opacity: 0 },
  '100%': { transform: 'scale(2)', opacity: 0 },
})

const styles = stylex.create({
  pulse: {
    position: 'absolute',
    width: 10,
    height: 10,
    display: {
      default: 'block',
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    borderRadius: '9999px',
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 25%, transparent)`,
    animationName: ping,
    animationDuration: '2.6s',
    animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)',
    animationIterationCount: 'infinite',
  },
  dot: {
    position: 'relative',
    borderRadius: '9999px',
  },
  dotEnded: {
    width: 8,
    height: 8,
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 25%, transparent)`,
  },
  dotCurrent: {
    width: 10,
    height: 10,
    backgroundColor: tokens.foreground,
  },
  dotFuture: {
    width: 8,
    height: 8,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
    backgroundColor: tokens.background,
  },
  // the word, not only the dot: three shades of grey on a rail are a legend
  // nobody was given
  stageBadge: {
    flexShrink: 0,
    paddingInline: 6,
    paddingBlock: 0,
    fontSize: 10,
    fontWeight: 400,
  },
  // what is over is drawn faintest of the three: next to a solid mark for
  // the stage in hand, a grey that is nearly as dark reads as another live
  // one
  stageBadgeEnded: {
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  stageBadgeFuture: {
    backgroundColor: 'transparent',
    color: tokens.mutedForeground,
    boxShadow: `0 0 0 1px ${tokens.border}`,
  },
  quietNote: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  foldIcon: {
    width: 14,
    height: 14,
  },
  foldButton: {
    marginTop: -2,
    textAlign: 'left',
    fontSize: 12,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    textDecorationLine: {
      default: 'none',
      ':hover': 'underline',
    },
    textUnderlineOffset: 2,
  },
  // room under the rail for the way-back button to hang in: floating it over
  // the stages would cover the line it is offering to take you to
  strip: {
    position: 'relative',
    paddingBottom: 28,
  },
  // the arrows are a hint, not a control: they say which way the rail still
  // has stages, and a thumb is already the way to go there
  edgeHint: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '50%',
    zIndex: 10,
    width: 14,
    height: 14,
    transform: 'translateY(-50%)',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
    transitionProperty: 'opacity',
    opacity: 0,
  },
  edgeHintStart: {
    left: 0,
  },
  edgeHintEnd: {
    right: 0,
  },
  edgeHintShown: {
    opacity: 1,
  },
  // the transform is one declaration for both axes: a transition animates
  // only properties it names, so composing the translate from two sources
  // moved one axis in a step - the few pixels of jump just as the rail came
  // back to centre
  wayBack: {
    position: 'absolute',
    bottom: 0,
    left: '50%',
    zIndex: 10,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    paddingInline: 10,
    paddingBlock: 4,
    fontSize: 12,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    boxShadow: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    transitionProperty: 'opacity, transform',
    transitionDuration: '200ms',
    opacity: 0,
    transform: 'translate(-50%, 4px)',
    pointerEvents: 'none',
  },
  wayBackShown: {
    opacity: 1,
    transform: 'translate(-50%, 0)',
    pointerEvents: 'auto',
  },
  wayBackIcon: {
    width: 14,
    height: 14,
  },
  track: {
    scrollSnapType: 'x mandatory',
    overflowX: 'auto',
    scrollbarWidth: 'none',
    '::-webkit-scrollbar': {
      display: 'none',
    },
  },
  rail: {
    width: 'max-content',
  },
})

/**
 * When a stage runs.
 *
 * Every stage says something here, including the ones nobody has scheduled:
 * a blank where a date belongs reads as a screen that failed rather than as
 * a decision still to be made. What the stage is waiting for is a separate
 * sentence, and the server only sends it while there is no time to say.
 */
const useSaid = () => {
  const when = useWhen()
  const { format } = useI18n()
  return (stage: FlowStage): string => {
    if (stage.at === null) return format(m.flowPending)
    return (
      when.span(stage.at, stage.until) ?? format(m.flowFromPending, { when: when.moment(stage.at) })
    )
  }
}

/**
 * Done, doing, and not yet - as one mark in three weights.
 *
 * No tick and no colour: the three states differ in how solid the dot is,
 * which is enough to read a rail by and leaves the page's one accent for
 * things a reader has to act on.
 */
function Marker({ status }: { status: FlowStage['status'] }) {
  return (
    <TimelineIndicator
      className={cn(
        'flex items-center justify-center border-0 bg-background',
        // the dot's middle on the stage name's middle: at the top of the box
        // it sat above the word it belongs to, which reads as a bullet for
        // the whole item rather than a mark on the line
        'group-data-[orientation=vertical]/timeline:top-2.5 group-data-[orientation=vertical]/timeline:-translate-y-1/2',
      )}
    >
      {status === 'current' && <span aria-hidden {...stylex.props(styles.pulse)} />}
      <span
        {...stylex.props(
          styles.dot,
          status === 'ended' && styles.dotEnded,
          status === 'current' && styles.dotCurrent,
          status === 'future' && styles.dotFuture,
        )}
      />
    </TimelineIndicator>
  )
}

/** the gradient that dissolves whichever end has more beyond it */
const edgeMask = ({ before, after }: { before: boolean; after: boolean }) =>
  `linear-gradient(to right, ${before ? 'transparent, black 2.5rem' : 'black 0'}, ${
    after ? 'black calc(100% - 2.5rem), transparent' : 'black 100%'
  })`

/** how many stages are behind the reader, which is what a timeline colours */
const reachedIn = (stages: readonly FlowStage[]) => {
  const at = stages.findIndex((stage) => stage.status === 'current')
  return at === -1 ? stages.filter((stage) => stage.status === 'ended').length : at + 1
}

const STATUS = {
  ended: m.flowStatusEnded,
  current: m.flowStatusCurrent,
  future: m.flowStatusFuture,
} as const

/** one stage, said the same way whichever direction the timeline runs */
function Stage({ stage }: { stage: FlowStage }) {
  const said = useSaid()
  const { format } = useI18n()
  const faded = stage.status === 'ended' && 'text-muted-foreground/60'
  return (
    <>
      <Marker status={stage.status} />
      {/* a hairline, not a bar: at two pixels the rail read as a ruled
          margin down the page and out-shouted the words beside it */}
      <TimelineSeparator className="w-px bg-border/50 group-data-completed/timeline-item:bg-border/50" />
      <TimelineHeader className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <TimelineTitle
          className={cn(
            stage.status === 'current' && 'text-foreground',
            stage.status === 'future' && 'font-normal text-muted-foreground',
            stage.status === 'ended' && 'font-normal text-muted-foreground/70',
          )}
        >
          {stage.name}
        </TimelineTitle>
        <Badge
          variant={stage.status === 'current' ? 'default' : 'secondary'}
          className={
            stylex.props(
              styles.stageBadge,
              stage.status === 'ended' && styles.stageBadgeEnded,
              stage.status === 'future' && styles.stageBadgeFuture,
            ).className
          }
        >
          {format(STATUS[stage.status])}
        </Badge>
      </TimelineHeader>
      {/* the whole row fades together, not only its name: a finished stage
          with a full-strength date under a pale title reads as two stages */}
      <TimelineDate
        className={cn(
          'mt-1 mb-0 font-normal tabular-nums',
          stage.status === 'ended' && 'text-muted-foreground/60',
        )}
      >
        {said(stage)}
      </TimelineDate>
      {/* what it waits on first, then what it is for: one is about now and
          the other is about the stage whenever it happens */}
      {stage.note !== '' && (
        <TimelineContent className={cn('mt-1 text-xs', faded)}>{stage.note}</TimelineContent>
      )}
      {stage.description !== '' && (
        <TimelineContent className={cn('mt-1 text-xs', faded)}>{stage.description}</TimelineContent>
      )}
    </>
  )
}

/**
 * The flow down a column, for a screen with width to spare.
 *
 * `keepPast` folds the stages further back than that: a round of eight ends
 * with the stage in hand pushed off the bottom of the rail, and a reader who
 * has to scroll to find where the round is has been told nothing by a column
 * that exists to tell them exactly that. What is folded is always the past,
 * never what is still to come, and it opens in one click.
 */
export function BatchFlow({
  timeline,
  keepPast,
  xstyle,
}: {
  timeline: readonly FlowEntry[]
  /** how many finished stages to keep above the one in hand */
  keepPast?: number
  xstyle?: stylex.StyleXStyles
}) {
  const { format } = useI18n()
  const [opened, setOpened] = useState(false)
  const stages = stagesOf(timeline)
  if (stages.length === 0) {
    return <p {...stylex.props(styles.quietNote, xstyle)}>{format(m.noStagesYet)}</p>
  }

  const here = stages.findIndex((stage) => stage.status === 'current')
  // folding one row saves a row and costs a control, so it starts at two
  const folded = opened || keepPast === undefined || here === -1 ? 0 : Math.max(0, here - keepPast)
  const shown = folded > 1 ? stages.slice(folded) : stages

  return (
    <Timeline value={reachedIn(stages)} className={stylex.props(xstyle).className}>
      {folded > 1 && (
        <TimelineItem step={0} className="ms-6 pb-4">
          <TimelineIndicator className="flex items-center justify-center border-0 bg-background text-muted-foreground/50">
            <MoreVerticalIcon className={stylex.props(styles.foldIcon).className} />
          </TimelineIndicator>
          <TimelineSeparator className="w-px bg-border/50" />
          <button
            type="button"
            {...stylex.props(styles.foldButton)}
            onClick={() => setOpened(true)}
          >
            {format(m.flowEarlier, { count: folded })}
          </button>
        </TimelineItem>
      )}
      {shown.map((stage, index) => (
        <TimelineItem key={stage.id} step={folded + index + 1} className="ms-6 wrap-anywhere">
          <Stage stage={stage} />
        </TimelineItem>
      ))}
    </Timeline>
  )
}

/** the same timeline on its side, for a screen with height to spend */
export function BatchFlowStrip({
  timeline,
  xstyle,
}: {
  timeline: readonly FlowEntry[]
  xstyle?: stylex.StyleXStyles
}) {
  const { format } = useI18n()
  const stages = stagesOf(timeline)
  const track = useRef<HTMLDivElement>(null)
  const here = useRef<HTMLDivElement>(null)
  // which ends have something beyond them, which is what the fade says
  const [more, setMore] = useState({ before: false, after: false })
  const [strayed, setStrayed] = useState(false)

  // Where the rail has to sit for the stage in hand to be as centred as it
  // can be - clamped, because the first and last stages cannot reach the
  // middle and a rail already as far as it goes has not strayed anywhere.
  const centreOf = (rail: HTMLDivElement, node: HTMLDivElement) =>
    Math.max(
      0,
      Math.min(
        node.offsetLeft - (rail.clientWidth - node.clientWidth) / 2,
        rail.scrollWidth - rail.clientWidth,
      ),
    )

  const measure = () => {
    const rail = track.current
    if (!rail) return
    const node = here.current
    setMore({
      before: rail.scrollLeft > 4,
      after: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4,
    })
    // far enough that the reader has gone looking somewhere else, not the
    // few pixels a snap leaves behind
    setStrayed(node !== null && Math.abs(rail.scrollLeft - centreOf(rail, node)) > 64)
  }

  // Opens where the round is, not where it began: the stage somebody is in
  // is the one they came to check, and the ones behind it are history.
  //
  // Centring is done again when the rail comes into view, not only on mount.
  // On a wide screen this whole strip is display:none, which measures zero -
  // so a window narrowed until the strip takes over would otherwise reveal it
  // parked at the first stage, having "centred" nothing.
  const seen = useRef(0)
  useEffect(() => {
    const rail = track.current
    if (!rail) return
    const centre = () => {
      const node = here.current
      if (node) rail.scrollTo({ left: centreOf(rail, node) })
      measure()
    }
    const observer = new ResizeObserver(() => {
      const width = rail.clientWidth
      const hidden = seen.current === 0
      seen.current = width
      // only on the way back into view: re-centring on every resize would
      // take the rail away from wherever the reader had scrolled it
      if (width > 0 && hidden) centre()
      else measure()
    })
    observer.observe(rail)
    centre()
    return () => observer.disconnect()
  }, [timeline])

  if (stages.length === 0) {
    return <p {...stylex.props(styles.quietNote, xstyle)}>{format(m.noStagesYet)}</p>
  }

  return (
    <div {...stylex.props(styles.strip, xstyle)}>
      <ChevronsLeftIcon
        aria-hidden
        className={
          stylex.props(styles.edgeHint, styles.edgeHintStart, more.before && styles.edgeHintShown)
            .className
        }
      />
      <ChevronsRightIcon
        aria-hidden
        className={
          stylex.props(styles.edgeHint, styles.edgeHintEnd, more.after && styles.edgeHintShown)
            .className
        }
      />
      {/* the way back, offered only to somebody who has gone looking: the
          rail opens on the stage in hand, so this appears when they leave it
          and takes them back the way they came, at the speed they went */}
      <button
        type="button"
        // inert rather than aria-hidden: this button hides itself the moment
        // it is pressed, and hiding an element from assistive technology
        // while it still holds focus is the one way to do that wrongly.
        // inert takes the focus with it.
        {...(strayed ? {} : { inert: true })}
        onClick={() => {
          const rail = track.current
          const node = here.current
          if (rail && node) rail.scrollTo({ left: centreOf(rail, node), behavior: 'smooth' })
        }}
        {...stylex.props(styles.wayBack, strayed && styles.wayBackShown)}
      >
        <LocateFixedIcon aria-hidden className={stylex.props(styles.wayBackIcon).className} />
        {format(m.flowBackToCurrent)}
      </button>
      <div
        ref={track}
        onScroll={measure}
        {...stylex.props(styles.track)}
        // the fade is the scrollbar this rail does not have: an end with more
        // beyond it dissolves, and an end with nothing beyond it stays sharp,
        // so the edge itself says which way there is anything to find
        style={{
          maskImage: more.before || more.after ? edgeMask(more) : undefined,
        }}
      >
        <Timeline
          orientation="horizontal"
          value={reachedIn(stages)}
          className={stylex.props(styles.rail).className}
        >
          {stages.map((stage, index) => (
            <TimelineItem
              key={stage.id}
              step={index + 1}
              ref={stage.status === 'current' ? here : undefined}
              // flex-none, or the timeline's own flex-1 basis of zero shrinks
              // every stage to the width of one character
              className="w-56 flex-none snap-center wrap-anywhere"
            >
              <Stage stage={stage} />
            </TimelineItem>
          ))}
        </Timeline>
      </div>
    </div>
  )
}
