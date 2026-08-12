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

const useWhen = () => {
  const { locale } = useI18n()
  return {
    day: (at: number) => new Date(at).toLocaleDateString(locale, { month: 'long', day: 'numeric' }),
    moment: (at: number) =>
      new Date(at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
  }
}

function Marker({ status, className }: { status: FlowStage['status']; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border-2 bg-background',
        status === 'ended' && 'border-muted-foreground/40 bg-muted-foreground/40 text-background',
        status === 'current' && 'border-emerald-500 shadow-[0_0_0_3px] shadow-emerald-500/15',
        status === 'future' && 'border-muted-foreground/25',
        className,
      )}
    >
      {status === 'ended' && <CheckIcon className="size-2.5" strokeWidth={3} />}
      {status === 'current' && <span className="size-1.5 rounded-full bg-emerald-500" />}
    </span>
  )
}

/** the line for a stage, said the way that stage deserves */
function useSaid() {
  const { format } = useI18n()
  const when = useWhen()
  return (stage: FlowStage): string => {
    if (stage.status === 'current') {
      return stage.until !== null
        ? format(m.flowUntil, { when: when.moment(stage.until) })
        : format(m.flowNow)
    }
    if (stage.at !== null) {
      return stage.status === 'ended'
        ? format(m.flowFrom, { when: when.day(stage.at) })
        : format(m.flowExpected, { when: when.day(stage.at) })
    }
    // nothing fixed: what it waits for, or nothing at all
    return stage.note
  }
}

/** everything known about one stage, for whoever asks for it */
function StageDetail({ stage }: { stage: FlowStage }) {
  const { format } = useI18n()
  const when = useWhen()
  const said = useSaid()
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{stage.name}</p>
      <p className="text-xs text-muted-foreground">
        {format(
          stage.status === 'ended'
            ? m.flowStatusEnded
            : stage.status === 'current'
              ? m.flowStatusCurrent
              : m.flowStatusFuture,
        )}
        {said(stage) !== '' && ` · ${said(stage)}`}
      </p>
      {stage.at !== null && stage.status !== 'ended' && (
        <p className="text-xs text-muted-foreground">{when.moment(stage.at)}</p>
      )}
      {stage.description !== '' && <p className="text-sm">{stage.description}</p>}
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
    <ol className={cn('flex flex-col', className)}>
      {stages.map((stage, index) => (
        <li key={stage.id} className="flex gap-3">
          <div className="flex flex-col items-center pt-0.5">
            <Marker status={stage.status} />
            {/* the line belongs to the gap between two stages, so the last
                one ends rather than trailing off */}
            {index < stages.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'w-0.5 flex-1 rounded-full',
                  stage.status === 'ended' ? 'bg-muted-foreground/30' : 'bg-border',
                )}
              />
            )}
          </div>
          <Detailed stage={stage}>
            <div
              className={cn(
                'mb-1 min-w-0 flex-1 rounded-md px-2.5 py-1.5 text-left transition-colors',
                index === stages.length - 1 && 'mb-0',
                stage.status === 'current' ? 'bg-emerald-500/8' : 'hover:bg-muted/60',
              )}
            >
              <p
                className={cn(
                  'truncate text-sm',
                  stage.status === 'current' ? 'font-medium text-foreground' : 'text-foreground/85',
                )}
              >
                {stage.name}
              </p>
              {said(stage) !== '' && (
                <p className="mt-0.5 text-xs text-muted-foreground">{said(stage)}</p>
              )}
            </div>
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
          className={cn('flex snap-center flex-col', stage.status === 'current' ? 'w-40' : 'w-28')}
        >
          {/* the rail runs through the markers rather than under the words,
              so the row of them reads as one line and not as a row of cards */}
          <div className="flex items-center">
            <span
              aria-hidden
              className={cn(
                'h-0.5 flex-1 rounded-full',
                index === 0 && 'opacity-0',
                stage.status === 'ended' ? 'bg-muted-foreground/30' : 'bg-border',
              )}
            />
            <Marker status={stage.status} className="mx-1" />
            <span
              aria-hidden
              className={cn(
                'h-0.5 flex-1 rounded-full',
                index === stages.length - 1 && 'opacity-0',
                stage.status === 'ended' ? 'bg-muted-foreground/30' : 'bg-border',
              )}
            />
          </div>
          <div className="mt-2 px-2 text-center">
            <p
              className={cn(
                'truncate text-sm',
                stage.status === 'current' ? 'font-medium' : 'text-foreground/85',
              )}
            >
              {stage.name}
            </p>
            {/* only the stage in hand spends a second line: the rest are
                there to say where this one sits between them */}
            {stage.status === 'current' && said(stage) !== '' && (
              <p className="mt-0.5 text-xs text-muted-foreground">{said(stage)}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}
