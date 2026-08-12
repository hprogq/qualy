import { useEffect, useRef, useState } from 'react'
import { ClockIcon, RouteIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@qualy/ui/sheet'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchFlow } from './BatchFlow.tsx'
import { BatchProgress } from './BatchProgress.tsx'
import { currentOf, stagesOf, type FlowEntry } from './flow.ts'
import { useWhen } from './when.ts'

// One line at the top of a working screen: which stage the round is in, when
// it gives way to the next, and the way to the whole flow.
//
// It answers "why can I do this now" and nothing else. The whole plan is one
// click away rather than repeated above every screen - a reader who wants it
// asks for it, and a panel that is always there costs the page a column it
// needs for the work itself.

export function PhaseContextBar({
  timeline,
  className,
}: {
  timeline: readonly FlowEntry[]
  className?: string
}) {
  const { format } = useI18n()
  const when = useWhen()
  const [open, setOpen] = useState(false)
  const narrow = useIsBelow(640)
  const stage = currentOf(stagesOf(timeline))

  // What the row gives up first, and what it never gives up.
  //
  // The stage's name is the one thing here nobody can infer, so everything
  // else yields to it in turn: the hour it ends goes, then the words on the
  // button, then the second unit of the countdown. Decided from the row's own
  // width rather than the window's, because that is what actually runs out -
  // and the row is a block, so its width does not move with what it holds and
  // this cannot chase its own tail.
  const bar = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState(Number.POSITIVE_INFINITY)
  useEffect(() => {
    const node = bar.current
    if (!node) return
    const observer = new ResizeObserver(() => setRoom(node.clientWidth))
    observer.observe(node)
    setRoom(node.clientWidth)
    return () => observer.disconnect()
  }, [])
  const showDeadline = room >= 640
  const showLabel = room >= 460
  const dense = room < 380

  return (
    <>
      <div
        ref={bar}
        className={cn(
          // one line, whatever the width: this sits above somebody's work and
          // a second row of it would push the work down the page
          'flex items-center gap-2 overflow-hidden rounded-lg border bg-muted/30 px-3 py-2 text-sm sm:gap-3',
          className,
        )}
      >
        {/* A name with nothing in front of it was read as a page title: the
            dot that used to stand here said "happening" to whoever already
            knew what the line was about, which is not who needs the line. */}
        <span className="shrink-0 text-xs text-muted-foreground">{format(m.currentStage)}</span>
        <span className="min-w-0 flex-1 truncate font-medium">
          {stage?.name ?? format(m.notStartedYet)}
        </span>
        {stage !== undefined && showDeadline && (
          // the deadline as an hour with a clock beside it: the words "until"
          // and "current stage" are what a narrow bar can least afford
          <span className="flex shrink-0 items-center gap-1.5 text-muted-foreground">
            <ClockIcon aria-hidden className="size-3.5" />
            <span className="tabular-nums">
              {stage.until === null ? format(m.flowEndPending) : when.moment(stage.until)}
            </span>
          </span>
        )}
        {/* the same countdown the bar above the rail shows, so the two never
            disagree about how long is left */}
        <BatchProgress dense={dense} timeline={timeline} className="ms-auto shrink-0 text-sm" />
        <Button
          variant="ghost"
          size="sm"
          aria-label={format(m.viewFullFlow)}
          className={cn('shrink-0 text-muted-foreground', !showLabel && 'size-8 p-0')}
          onClick={() => setOpen(true)}
        >
          <RouteIcon aria-hidden />
          {showLabel ? format(m.viewFullFlow) : null}
        </Button>
      </div>

      <Sheet open={open} onOpenChange={setOpen}>
        {/* from the side where there is room, and from the bottom where the
            thumb is: the same panel, reached the way each screen expects */}
        <SheetContent side={narrow ? 'bottom' : 'right'} className="sm:max-w-sm">
          <SheetHeader>
            <SheetTitle>{format(m.flowTitle)}</SheetTitle>
          </SheetHeader>
          <div className="overflow-y-auto px-4 pb-6">
            <BatchFlow timeline={timeline} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}
