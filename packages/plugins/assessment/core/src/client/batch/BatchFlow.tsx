import { useEffect, useRef } from 'react'
import { CheckIcon } from 'lucide-react'
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

// Times are said in full, to the minute. Two stages of one round can begin
// and end on the same day, and a flow that says only "September 5" leaves its
// reader to guess which of them they are looking at.
const useWhen = () => {
  const { locale } = useI18n()
  const moment = (at: number) =>
    new Date(at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  return {
    moment,
    /** the two edges of a stage, with the second dropped when it is unknown */
    span: (from: number | null, to: number | null) =>
      from === null ? null : to === null ? moment(from) : `${moment(from)} — ${moment(to)}`,
  }
}

/**
 * When a stage runs, or what it is waiting for instead.
 *
 * One or the other, never both: a stage with times has answered the question
 * the note was standing in for, and the server stops sending the note then.
 */
const useSaid = () => {
  const when = useWhen()
  return (stage: FlowStage): string => when.span(stage.at, stage.until) ?? stage.note
}

/** done, doing, and not yet - as the marker rather than as a word */
function Marker({ status }: { status: FlowStage['status'] }) {
  return (
    <TimelineIndicator className="flex items-center justify-center border-0 bg-background">
      {status === 'ended' ? (
        <span className="flex size-4 items-center justify-center rounded-full bg-muted-foreground/25 text-muted-foreground">
          <CheckIcon className="size-2.5" strokeWidth={3} />
        </span>
      ) : status === 'current' ? (
        <span className="size-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
      ) : (
        <span className="size-3 rounded-full border border-muted-foreground/35" />
      )}
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
        {said(stage) !== '' && (
          <TimelineDate className="font-normal tabular-nums">{said(stage)}</TimelineDate>
        )}
        <TimelineTitle
          className={cn(
            stage.status === 'current' && 'text-foreground',
            stage.status === 'ended' && 'font-normal text-muted-foreground',
          )}
        >
          {stage.name}
        </TimelineTitle>
      </TimelineHeader>
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
