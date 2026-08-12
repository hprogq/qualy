import { useEffect, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { Ticker } from '@qualy/ui/ticker'
import { assessmentMessages as m } from '../i18n.ts'
import { progressOf, spanMessage, tickOf, toneOf, type TimelineLike } from './progress.ts'

// Where a batch is right now, in one line: the stage it is in, and how long
// until the next one - or, when nothing follows it yet, how long it has been
// running.
//
// It re-reads the clock rather than the server: nothing about the answer
// depends on anything the server would say differently a second later, and a
// bar that polls once a second to tell you a second has passed is a bar that
// costs a request per second. The interval follows the unit shown, so days
// tick by the minute and seconds by the second.
//
// The pill fills as the stage runs out and warms as the time does, so the
// answer to "how long" is legible before the words are read. The tide behind
// the fill is the part that says the clock is still running: a still bar and
// a stopped bar look the same.

const TONES = {
  calm: {
    shell: 'border-border/70 text-muted-foreground',
    fill: 'bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--color-foreground)_12%,transparent),transparent),linear-gradient(90deg,transparent,color-mix(in_oklch,var(--color-foreground)_7%,transparent),transparent)]',
  },
  soon: {
    shell:
      'border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-300 [&_.stage]:text-amber-800 dark:[&_.stage]:text-amber-200',
    fill: 'bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--color-amber-500)_28%,transparent),transparent),linear-gradient(90deg,transparent,color-mix(in_oklch,var(--color-amber-500)_16%,transparent),transparent)]',
  },
  urgent: {
    shell:
      'border-destructive/45 bg-destructive/5 text-destructive [&_.stage]:text-destructive/90 dark:[&_.stage]:text-destructive',
    fill: 'bg-[linear-gradient(90deg,transparent,color-mix(in_oklch,var(--color-destructive)_28%,transparent),transparent),linear-gradient(90deg,transparent,color-mix(in_oklch,var(--color-destructive)_16%,transparent),transparent)]',
  },
} as const

export function BatchProgress({
  timeline,
  showStage = false,
  className,
}: {
  timeline: readonly TimelineLike[]
  /** the bar names the stage; a card has already said it on the line above */
  showStage?: boolean
  className?: string
}) {
  const { format, locale } = useI18n()
  const [now, setNow] = useState(() => Date.now())
  const progress = progressOf(timeline, now)
  const tick = tickOf(progress)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), tick)
    return () => clearInterval(timer)
  }, [tick])

  const current = timeline.find((entry) => entry.status === 'current')
  const stage = showStage ? (current?.displayName ?? null) : null

  const said =
    progress.kind === 'until' || progress.kind === 'since'
      ? format(spanMessage(m, progress).message as never, spanMessage(m, progress).values as never)
      : progress.kind === 'starts'
        ? new Date(progress.at).toLocaleString(locale, {
            dateStyle: 'medium',
            timeStyle: 'short',
          })
        : null

  if (stage === null && said === null) return null

  const tone = TONES[toneOf(progress)]
  const filled = progress.kind === 'until' ? progress.fraction : null

  return (
    <span
      className={cn(
        'relative isolate overflow-hidden rounded-full border px-3 py-1 text-sm transition-colors',
        tone.shell,
        className,
      )}
    >
      {filled !== null && (
        <span
          aria-hidden
          data-tide
          className={cn(
            'absolute inset-y-0 left-0 -z-10 bg-[length:55%_100%,35%_100%] bg-repeat-x [animation:qualy-tide_11s_linear_infinite]',
            tone.fill,
          )}
          style={{ width: `${String(Math.round(filled * 100))}%` }}
        />
      )}
      {stage !== null && <span className="stage text-foreground">{stage}</span>}
      {said !== null && (
        <>
          {stage !== null && (
            <span aria-hidden className="mx-2 opacity-40">
              |
            </span>
          )}
          {progress.kind === 'starts' && (
            <span className="mr-1 text-muted-foreground">{format(m.plannedStart)}</span>
          )}
          <Ticker value={said} />
        </>
      )}
    </span>
  )
}
