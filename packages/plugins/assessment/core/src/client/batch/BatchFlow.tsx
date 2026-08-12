import { useEffect, useRef } from 'react'
import { useI18n } from '@qualy/web-i18n'
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
    <TimelineIndicator className="flex items-center justify-center border-0 bg-background">
      <span
        className={cn(
          'rounded-full',
          status === 'ended' && 'size-2 bg-muted-foreground/40',
          status === 'current' && 'size-2.5 bg-foreground ring-[3px] ring-foreground/12',
          status === 'future' && 'size-2 border border-muted-foreground/40 bg-background',
        )}
      />
    </TimelineIndicator>
  )
}

/** how many stages are behind the reader, which is what a timeline colours */
const reachedIn = (stages: readonly FlowStage[]) => {
  const at = stages.findIndex((stage) => stage.status === 'current')
  return at === -1 ? stages.filter((stage) => stage.status === 'ended').length : at + 1
}

/** one stage, said the same way whichever direction the timeline runs */
function Stage({ stage }: { stage: FlowStage }) {
  const said = useSaid()
  return (
    <>
      <Marker status={stage.status} />
      <TimelineSeparator className="bg-border group-data-completed/timeline-item:bg-muted-foreground/25" />
      <TimelineHeader>
        <TimelineDate className="font-normal tabular-nums">{said(stage)}</TimelineDate>
        <TimelineTitle
          className={cn(
            stage.status === 'current' && 'text-foreground',
            stage.status === 'ended' && 'font-normal text-muted-foreground',
          )}
        >
          {stage.name}
        </TimelineTitle>
      </TimelineHeader>
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

/** the flow down a column, for a screen with width to spare */
export function BatchFlow({
  timeline,
  className,
}: {
  timeline: readonly FlowEntry[]
  className?: string
}) {
  const { format } = useI18n()
  const stages = stagesOf(timeline)
  if (stages.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{format(m.noStagesYet)}</p>
  }

  return (
    <Timeline value={reachedIn(stages)} className={className}>
      {stages.map((stage, index) => (
        <TimelineItem key={stage.id} step={index + 1} className="ms-6 wrap-anywhere">
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

  // opens where the round is, not where it began: the stage somebody is in
  // is the one they came to check, and the ones behind it are history
  useEffect(() => {
    const rail = track.current
    const node = here.current
    if (!rail || !node) return
    rail.scrollTo({ left: node.offsetLeft - (rail.clientWidth - node.clientWidth) / 2 })
  }, [timeline])

  if (stages.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{format(m.noStagesYet)}</p>
  }

  return (
    <div
      ref={track}
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
            className="w-52 shrink-0 snap-center wrap-anywhere"
          >
            <Stage stage={stage} />
          </TimelineItem>
        ))}
      </Timeline>
    </div>
  )
}
