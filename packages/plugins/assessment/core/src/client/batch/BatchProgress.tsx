import { useEffect, useState } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { Ticker } from '@qualy/ui/ticker'
import { assessmentMessages as m } from '../i18n.ts'
import { progressOf, spanMessage, tickOf, type TimelineLike } from './progress.ts'

// Where a batch is right now, in one line: the stage it is in, and how long
// until the next one - or, when nothing follows it yet, how long it has been
// running.
//
// It re-reads the clock rather than the server: nothing about the answer
// depends on anything the server would say differently a second later, and a
// bar that polls once a second to tell you a second has passed is a bar that
// costs a request per second. The interval follows the unit shown, so days
// tick by the minute and seconds by the second.
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

  return (
    <span className={className}>
      {stage !== null && <span className="text-foreground">{stage}</span>}
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
