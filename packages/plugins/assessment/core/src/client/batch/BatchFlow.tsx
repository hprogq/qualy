import { useEffect, useRef } from 'react'
import { CheckIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'
import { stagesOf, type FlowStage } from './flow.ts'
import type { TimelineLike } from './progress.ts'

// The round's stages, drawn twice.
//
// A wide screen has spare width and no spare height, so the flow takes a
// column beside the page and runs down it. A phone has the opposite: height
// is what the reader is spending, and sideways scrolling is cheap - so there
// the flow is one line, and it opens on the stage the round is actually in
// rather than at the beginning of a history nobody asked for.
//
// Both are read-only, and neither says a word about how the plan was made.

const useWhen = () => {
  const { locale } = useI18n()
  return {
    day: (at: number) => new Date(at).toLocaleDateString(locale, { month: 'long', day: 'numeric' }),
    moment: (at: number) =>
      new Date(at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }),
  }
}

function Marker({ status }: { status: FlowStage['status'] }) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-4 shrink-0 items-center justify-center rounded-full border',
        status === 'ended' && 'border-transparent bg-muted-foreground/30 text-background',
        status === 'current' && 'border-transparent bg-emerald-500 text-white',
        status === 'future' && 'border-muted-foreground/30 bg-background',
      )}
    >
      {status === 'ended' && <CheckIcon className="size-2.5" />}
      {status === 'current' && <span className="size-1.5 rounded-full bg-white" />}
    </span>
  )
}

/** the flow down a column, for a screen with width to spare */
export function BatchFlow({
  timeline,
  className,
}: {
  timeline: readonly TimelineLike[]
  className?: string
}) {
  const { format } = useI18n()
  const when = useWhen()
  const stages = stagesOf(timeline)
  if (stages.length === 0) {
    return <p className={cn('text-sm text-muted-foreground', className)}>{format(m.noStagesYet)}</p>
  }

  return (
    <ol className={cn('flex flex-col', className)}>
      {stages.map((stage, index) => (
        <li key={stage.id} className="flex gap-3">
          <div className="flex flex-col items-center">
            <Marker status={stage.status} />
            {/* the line belongs to the gap between two stages, so the last
                one ends rather than trailing off */}
            {index < stages.length - 1 && (
              <span
                aria-hidden
                className={cn(
                  'w-px flex-1',
                  stage.status === 'ended' ? 'bg-muted-foreground/30' : 'bg-border',
                )}
              />
            )}
          </div>
          <div className={cn('min-w-0 pb-5', index === stages.length - 1 && 'pb-0')}>
            <p
              className={cn(
                'text-sm leading-4',
                stage.status === 'current' ? 'font-medium text-foreground' : 'text-foreground/80',
              )}
            >
              {stage.name}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stage.status === 'current'
                ? stage.until !== null
                  ? format(m.flowUntil, { when: when.moment(stage.until) })
                  : format(m.flowNow)
                : stage.at !== null
                  ? stage.status === 'ended'
                    ? format(m.flowFrom, { when: when.day(stage.at) })
                    : format(m.flowExpected, { when: when.day(stage.at) })
                  : ''}
            </p>
          </div>
        </li>
      ))}
    </ol>
  )
}

/** the flow along one line, for a screen with height to spend */
export function BatchFlowStrip({
  timeline,
  className,
}: {
  timeline: readonly TimelineLike[]
  className?: string
}) {
  const { format } = useI18n()
  const when = useWhen()
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
        'flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {stages.map((stage) => (
        <li
          key={stage.id}
          ref={stage.status === 'current' ? here : undefined}
          className={cn(
            'flex snap-center flex-col gap-1.5 rounded-lg border px-3 py-2',
            stage.status === 'current' ? 'min-w-44 bg-emerald-500/5' : 'min-w-28',
          )}
        >
          <div className="flex items-center gap-2">
            <Marker status={stage.status} />
            <span
              className={cn(
                'truncate text-sm',
                stage.status === 'current' ? 'font-medium' : 'text-foreground/80',
              )}
            >
              {stage.name}
            </span>
          </div>
          {/* one line of detail, and only where it is worth the width */}
          {stage.status === 'current' ? (
            <span className="text-xs text-muted-foreground">
              {stage.until !== null
                ? format(m.flowUntil, { when: when.moment(stage.until) })
                : format(m.flowNow)}
            </span>
          ) : (
            stage.at !== null && (
              <span className="text-xs text-muted-foreground">{when.day(stage.at)}</span>
            )
          )}
        </li>
      ))}
    </ol>
  )
}
