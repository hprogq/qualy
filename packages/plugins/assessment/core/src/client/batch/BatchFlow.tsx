import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { MoreVerticalIcon } from 'lucide-react'
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
      {status === 'current' && (
        // a mark that keeps moving, because this is the one stage that is
        // happening rather than recorded
        <span
          aria-hidden
          className="absolute size-2.5 animate-ping rounded-full bg-foreground/25 [animation-duration:2.6s] motion-reduce:hidden"
        />
      )}
      <span
        className={cn(
          'relative rounded-full',
          status === 'ended' && 'size-2 bg-muted-foreground/40',
          status === 'current' && 'size-2.5 bg-foreground',
          status === 'future' && 'size-2 border border-muted-foreground/40 bg-background',
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
  return (
    <>
      <Marker status={stage.status} />
      {/* a hairline, not a bar: at two pixels the rail read as a ruled
          margin down the page and out-shouted the words beside it */}
      <TimelineSeparator className="w-px bg-border/70 group-data-completed/timeline-item:bg-border" />
      <TimelineHeader className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <TimelineTitle
          className={cn(
            stage.status === 'current' && 'text-foreground',
            stage.status !== 'current' && 'font-normal text-muted-foreground',
          )}
        >
          {stage.name}
        </TimelineTitle>
        {/* the word, not only the dot: three shades of grey on a rail are a
            legend nobody was given */}
        <Badge
          variant={stage.status === 'current' ? 'default' : 'secondary'}
          className={cn(
            'shrink-0 px-1.5 py-0 text-[10px] font-normal',
            stage.status === 'future' && 'bg-transparent text-muted-foreground ring-1 ring-border',
          )}
        >
          {format(STATUS[stage.status])}
        </Badge>
      </TimelineHeader>
      <TimelineDate className="mt-1 mb-0 font-normal tabular-nums">{said(stage)}</TimelineDate>
      {/* what it waits on first, then what it is for: one is about now and
          the other is about the stage whenever it happens */}
      {stage.note !== '' && (
        <TimelineContent className="mt-1 text-xs">{stage.note}</TimelineContent>
      )}
      {stage.description !== '' && (
        <TimelineContent className="mt-1 text-xs">{stage.description}</TimelineContent>
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
  className,
}: {
  timeline: readonly FlowEntry[]
  /** how many finished stages to keep above the one in hand */
  keepPast?: number
  className?: string
}) {
  const { format } = useI18n()
  const [opened, setOpened] = useState(false)
  const stages = stagesOf(timeline)
  if (stages.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{format(m.noStagesYet)}</p>
  }

  const here = stages.findIndex((stage) => stage.status === 'current')
  // folding one row saves a row and costs a control, so it starts at two
  const folded = opened || keepPast === undefined || here === -1 ? 0 : Math.max(0, here - keepPast)
  const shown = folded > 1 ? stages.slice(folded) : stages

  return (
    <Timeline value={reachedIn(stages)} className={className}>
      {folded > 1 && (
        <TimelineItem step={0} className="ms-6 pb-4">
          <TimelineIndicator className="flex items-center justify-center border-0 bg-background text-muted-foreground/50">
            <MoreVerticalIcon className="size-3.5" />
          </TimelineIndicator>
          <button
            type="button"
            className="-mt-0.5 text-left text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            onClick={() => setOpened(true)}
          >
            {format(m.flowEarlier, { count: folded })}
          </button>
        </TimelineItem>
      )}
      {shown.map((stage, index) => (
        <TimelineItem
          key={stage.id}
          step={folded + index + 1}
          className={cn('ms-6 wrap-anywhere', stage.status === 'current' && 'isolate')}
        >
          {/* the box reaches back past the rail so it holds the dot too: a
              frame that starts after the mark would say the mark belongs to
              the stage above */}
          {stage.status === 'current' && (
            <span
              aria-hidden
              className="pointer-events-none absolute -inset-y-2 -left-8 -right-2 -z-10 rounded-lg border bg-muted/40"
            />
          )}
          <Stage stage={stage} />
        </TimelineItem>
      ))}
    </Timeline>
  )
}

/** the same timeline on its side, for a screen with height to spend */
export function BatchFlowStrip({
  timeline,
  className,
}: {
  timeline: readonly FlowEntry[]
  className?: string
}) {
  const { format } = useI18n()
  const stages = stagesOf(timeline)
  const track = useRef<HTMLDivElement>(null)
  const here = useRef<HTMLDivElement>(null)
  // which ends have something beyond them, which is what the fade says
  const [more, setMore] = useState({ before: false, after: false })

  const measure = () => {
    const rail = track.current
    if (!rail) return
    setMore({
      before: rail.scrollLeft > 4,
      after: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4,
    })
  }

  // opens where the round is, not where it began: the stage somebody is in
  // is the one they came to check, and the ones behind it are history
  useEffect(() => {
    const rail = track.current
    const node = here.current
    if (!rail) return
    if (node) rail.scrollTo({ left: node.offsetLeft - (rail.clientWidth - node.clientWidth) / 2 })
    measure()
  }, [timeline])

  if (stages.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{format(m.noStagesYet)}</p>
  }

  return (
    <div
      ref={track}
      onScroll={measure}
      // the fade is the scrollbar this rail does not have: an end with more
      // beyond it dissolves, and an end with nothing beyond it stays sharp,
      // so the edge itself says which way there is anything to find
      style={{
        maskImage: more.before || more.after ? edgeMask(more) : undefined,
      }}
      className={cn(
        'snap-x snap-mandatory overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      <Timeline orientation="horizontal" value={reachedIn(stages)} className="w-max">
        {stages.map((stage, index) => (
          <TimelineItem
            key={stage.id}
            step={index + 1}
            ref={stage.status === 'current' ? here : undefined}
            // flex-none, or the timeline's own flex-1 basis of zero shrinks
            // every stage to the width of one character
            className={cn(
              'w-56 flex-none snap-center wrap-anywhere',
              stage.status === 'current' && 'isolate',
            )}
          >
            {stage.status === 'current' && (
              <span
                aria-hidden
                className="pointer-events-none absolute -top-8 -right-2 -bottom-2 -left-2 -z-10 rounded-lg border bg-muted/40"
              />
            )}
            <Stage stage={stage} />
          </TimelineItem>
        ))}
      </Timeline>
    </div>
  )
}
