import { useEffect, useRef, type ReactNode } from 'react'
import { CheckIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@qualy/ui/hover-card'
import { assessmentMessages as m } from '../i18n.ts'
import { stagesOf, type FlowEntry, type FlowStage } from './flow.ts'

// The stages of the round, drawn twice.
//
// A wide screen has spare width and no spare height, so the flow takes a
// column beside the page and runs down it. A phone has the opposite: height
// is what the reader is spending, and sideways scrolling is cheap - so there
// the same rail turns on its side, and it opens on the stage the round is
// actually in rather than at the beginning of a history nobody asked for.
//
// Both are the same drawing: a line, a marker per stage, and what is known
// about each. Neither says a word about how the plan was made, and a stage
// with no time says what it is waiting for instead of naming its own absence.

// Times are said in full, to the minute. Two stages of the same round can
// begin and end on one day, and a flow that says only "September 5" leaves
// its reader to guess which of them they are looking at.
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

// The rail runs behind the markers, so each one is drawn on the page's own
// ground: a marker with a transparent middle would have a line through it.
function Marker({ status, className }: { status: FlowStage['status']; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full bg-background',
        className,
      )}
    >
      <span
        className={cn(
          'flex size-2.5 items-center justify-center rounded-full',
          status === 'ended' && 'size-4 bg-muted-foreground/25 text-foreground/60',
          status === 'current' && 'bg-emerald-500 ring-4 ring-emerald-500/15',
          status === 'future' && 'border border-muted-foreground/35 bg-background',
        )}
      >
        {status === 'ended' && <CheckIcon className="size-2.5" strokeWidth={3} />}
      </span>
    </span>
  )
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

const STATUS = {
  ended: m.flowStatusEnded,
  current: m.flowStatusCurrent,
  future: m.flowStatusFuture,
} as const

/** everything known about one stage, for whoever asks for it */
function StageDetail({ stage }: { stage: FlowStage }) {
  const { format } = useI18n()
  const when = useWhen()
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium">{stage.name}</p>
        <span className="shrink-0 text-xs text-muted-foreground">
          {format(STATUS[stage.status])}
        </span>
      </div>
      {stage.at !== null && (
        <p className="text-xs text-muted-foreground">
          {format(m.flowFrom, { when: when.moment(stage.at) })}
        </p>
      )}
      {stage.until !== null && (
        <p className="text-xs text-muted-foreground">
          {format(m.flowUntil, { when: when.moment(stage.until) })}
        </p>
      )}
      {stage.note !== '' && <p className="text-sm">{stage.note}</p>}
      {stage.description !== '' && (
        <p className="text-sm text-muted-foreground">{stage.description}</p>
      )}
    </div>
  )
}

function Detailed({ stage, children }: { stage: FlowStage; children: ReactNode }) {
  return (
    <HoverCard openDelay={120} closeDelay={80}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent className="w-64" align="start">
        <StageDetail stage={stage} />
      </HoverCardContent>
    </HoverCard>
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
  const said = useSaid()
  const stages = stagesOf(timeline)
  if (stages.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{format(m.noStagesYet)}</p>
  }

  return (
    // The marker is positioned rather than laid out beside the words: as a
    // flex item next to a paragraph it sat on that paragraph's baseline, and
    // the line box around a 14px word is taller than the word - which is the
    // gap that kept the first line hanging below the tick.
    <ol className={cn('flex flex-col', className)}>
      {stages.map((stage, index) => (
        <li key={stage.id} className="relative min-w-0 pl-7 last:pb-0 not-last:pb-6">
          <Marker status={stage.status} className="absolute top-0 left-0" />
          {index < stages.length - 1 && (
            <span
              aria-hidden
              className={cn(
                'absolute top-4 bottom-0 left-2 w-px -translate-x-1/2',
                stage.status === 'ended' ? 'bg-muted-foreground/25' : 'bg-border',
              )}
            />
          )}
          {/* time first and small, name under it: the column is read down the
              dates, and a name means nothing until you know when it happens */}
          {said(stage) !== '' && (
            <p className="text-[11px]/4 tracking-wide text-muted-foreground tabular-nums wrap-anywhere">
              {said(stage)}
            </p>
          )}
          <Detailed stage={stage}>
            <p
              className={cn(
                'mt-0.5 text-sm/5 wrap-anywhere',
                stage.status === 'current' && 'font-medium',
                stage.status === 'ended' && 'text-muted-foreground',
              )}
            >
              {stage.name}
            </p>
          </Detailed>
        </li>
      ))}
    </ol>
  )
}

/** the same rail on its side, for a screen with height to spend */
export function BatchFlowStrip({
  timeline,
  className,
}: {
  timeline: readonly FlowEntry[]
  className?: string
}) {
  const { format } = useI18n()
  const said = useSaid()
  const stages = stagesOf(timeline)
  const track = useRef<HTMLOListElement>(null)
  const here = useRef<HTMLLIElement>(null)

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
    <ol
      ref={track}
      className={cn(
        'flex snap-x snap-mandatory overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {stages.map((stage, index) => (
        <li
          key={stage.id}
          ref={stage.status === 'current' ? here : undefined}
          className={cn(
            'flex shrink-0 snap-center flex-col',
            stage.status === 'current' ? 'w-48' : 'w-40',
          )}
        >
          {/* the rail runs through the markers rather than under the words,
              so the row of them reads as one line and not as a row of cards */}
          <div className="flex items-center">
            <span
              aria-hidden
              className={cn(
                'h-px flex-1',
                index === 0 && 'opacity-0',
                stage.status === 'ended' ? 'bg-muted-foreground/25' : 'bg-border',
              )}
            />
            <Marker status={stage.status} />
            <span
              aria-hidden
              className={cn(
                'h-px flex-1',
                index === stages.length - 1 && 'opacity-0',
                // the segment after a stage belongs to what comes next
                stages[index + 1]?.status === 'ended' ? 'bg-muted-foreground/25' : 'bg-border',
              )}
            />
          </div>
          <div className="mt-2 px-2 text-center">
            <p
              className={cn(
                'text-sm/5 wrap-anywhere',
                stage.status === 'current' && 'font-medium',
                stage.status === 'ended' && 'text-muted-foreground',
              )}
            >
              {stage.name}
            </p>
            {said(stage) !== '' && (
              <p className="mt-0.5 text-[11px]/4 text-muted-foreground tabular-nums wrap-anywhere">
                {said(stage)}
              </p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
