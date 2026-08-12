import { useEffect, useRef, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { cn } from '@qualy/ui/cn'
import { Ticker } from '@qualy/ui/ticker'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { assessmentMessages as m } from '../i18n.ts'
import {
  displayKey,
  progressOf,
  spanMessage,
  tickOf,
  toneOf,
  type TimelineLike,
} from './progress.ts'

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
// Everything it draws is one line of text, with a small ring for how far
// through the stage is. The batch is the subject of the screen below; this
// only says where it has got to, so it is sized and coloured to be read after
// everything else - the colour arrives when the time does, not before.

// Only the clock takes a colour. The stage name is a fact that does not
// change when the time runs short, and a name that turns red says the stage
// itself is wrong.
const TONES = {
  calm: 'text-muted-foreground',
  soon: 'text-amber-600 dark:text-amber-400',
  urgent: 'text-destructive',
} as const

/**
 * How far through, as a ring rather than a bar.
 *
 * A bar under the line has to be as wide as the line, which makes a rule
 * across the top of the page out of a detail; a ring is the size of the text
 * beside it and stays a detail.
 */
function Ring({ fraction }: { fraction: number }) {
  const radius = 5
  const circumference = 2 * Math.PI * radius
  return (
    <svg viewBox="0 0 14 14" className="size-3 shrink-0 -rotate-90" aria-hidden>
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        opacity="0.2"
      />
      <circle
        cx="7"
        cy="7"
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - fraction)}
      />
    </svg>
  )
}

export function BatchProgress({
  timeline,
  showStage = false,
  dense = false,
  className,
}: {
  timeline: readonly TimelineLike[]
  /** the bar names the stage; a card has already said it on the line above */
  showStage?: boolean
  /** one unit, whatever the window: the row it sits in is out of room */
  dense?: boolean
  className?: string
}) {
  const { format, locale } = useI18n()
  // One threshold: under a tablet the bar has no room for the stage, so the
  // stage goes and the clock takes its name instead - "3 hours left in stage"
  // rather than a number beside nothing.
  const tight = useIsBelow(768)
  const form = dense || tight ? 'bare' : 'full'
  const [now, setNow] = useState(() => Date.now())
  const progress = progressOf(timeline, now)
  const tick = tickOf(progress)
  // the clock is read on the interval; the component is only told about it
  // when the reading would look different
  const shown = useRef(displayKey(progress))
  useEffect(() => {
    const timer = setInterval(() => {
      const at = Date.now()
      const key = displayKey(progressOf(timeline, at))
      if (key === shown.current) return
      shown.current = key
      setNow(at)
    }, tick)
    return () => clearInterval(timer)
  }, [tick, timeline])

  const current = timeline.find((entry) => entry.status === 'current')
  const stage = showStage ? (current?.displayName ?? null) : null

  const said =
    progress.kind === 'until' || progress.kind === 'since'
      ? // one call, not two: it is pure, but it is also called on every tick
        // of every card in the list
        ((span) => format(span.message as never, span.values as never))(
          spanMessage(m, progress, form),
        )
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
    <span className={cn('inline-flex min-w-0 items-center gap-3 max-sm:gap-1.5', className)}>
      {stage !== null && (
        // "审核期" on its own is a word, not a fact about this batch: whoever
        // reads it has to already know that the bar names the stage the batch
        // is in. The label is narrower than the name it introduces, so it is
        // the first thing dropped when the bar runs out of room.
        <span
          data-slot="stage"
          className="inline-flex min-w-0 items-baseline gap-1.5 max-md:hidden"
        >
          <span className="shrink-0 text-xs text-muted-foreground max-lg:hidden">
            {format(m.currentStage)}
          </span>
          <Badge
            variant="secondary"
            className="relative max-w-full min-w-0 overflow-hidden bg-muted/70 px-2 py-0.5 text-[0.8125rem] font-medium text-foreground"
          >
            {/* it breathes only once the time is short: an animation that never
                stops is decoration, and decoration is what people stop seeing */}
            {toneOf(progress) === 'urgent' && (
              <span
                aria-hidden
                className="absolute inset-0 animate-pulse rounded-full bg-foreground/10 [animation-duration:2.8s] motion-reduce:hidden"
              />
            )}
            <span className="relative truncate">{stage}</span>
          </Badge>
        </span>
      )}
      {stage !== null && said !== null && (
        // a rule rather than more space: the two halves answer different
        // questions, and at a glance the gap alone read as one long phrase
        <span aria-hidden className="h-3.5 w-px shrink-0 bg-border max-md:hidden" />
      )}
      {said !== null && (
        <span className={cn('inline-flex shrink-0 items-center gap-1.5 font-medium', tone)}>
          {filled !== null && <Ring fraction={filled} />}
          {progress.kind === 'starts' && (
            <span className="text-muted-foreground">{format(m.plannedStart)}</span>
          )}
          <Ticker value={said} />
        </span>
      )}
    </span>
  )
}
