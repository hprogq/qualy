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
// Everything it draws is one line of text and one hairline under it. The
// batch is the subject of the screen below; this only says where it has got
// to, so it is sized and coloured to be read after everything else.

const TONES = {
  calm: { text: 'text-muted-foreground', rule: 'bg-foreground/35' },
  soon: { text: 'text-amber-600 dark:text-amber-400', rule: 'bg-amber-500/70' },
  urgent: { text: 'text-destructive', rule: 'bg-destructive/70' },
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
    <span className={cn('inline-flex min-w-0 flex-col gap-1', className)}>
      <span className="inline-flex min-w-0 items-baseline gap-2 truncate">
        {stage !== null && <span className="truncate text-foreground">{stage}</span>}
        {stage !== null && said !== null && (
          <span aria-hidden className="text-muted-foreground/50">
            ·
          </span>
        )}
        {said !== null && (
          <span className={cn('shrink-0 tabular-nums', tone.text)}>
            {progress.kind === 'starts' && (
              <span className="mr-1 text-muted-foreground">{format(m.plannedStart)}</span>
            )}
            <Ticker value={said} />
          </span>
        )}
      </span>
      {/* the stage running out, under the words rather than around them: a
          hairline says the same thing as a filled capsule and asks for none
          of the attention the sentence below it needs */}
      {filled !== null && (
        <span aria-hidden className="h-px w-full overflow-hidden rounded-full bg-border">
          <span
            className={cn('block h-px transition-[width] duration-1000 ease-linear', tone.rule)}
            style={{ width: `${String(Math.round(filled * 100))}%` }}
          />
        </span>
      )}
    </span>
  )
}
