import { useState } from 'react'
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

  return (
    <>
      <div
        className={cn(
          'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border bg-muted/30 px-3 py-2 text-sm',
          className,
        )}
      >
        <span className="text-xs text-muted-foreground">{format(m.currentStage)}</span>
        <span className="min-w-0 truncate font-medium">
          {stage?.name ?? format(m.notStartedYet)}
        </span>
        {stage !== undefined && (
          <>
            <span aria-hidden className="h-3.5 w-px bg-border max-sm:hidden" />
            <span className="text-muted-foreground tabular-nums">
              {stage.until === null
                ? format(m.flowEndPending)
                : format(m.flowUntil, { when: when.moment(stage.until) })}
            </span>
          </>
        )}
        {/* the same countdown the bar above the rail shows, so the two never
            disagree about how long is left */}
        <BatchProgress timeline={timeline} className="text-sm" />
        <Button
          variant="ghost"
          size="sm"
          className="ms-auto shrink-0 text-muted-foreground"
          onClick={() => setOpen(true)}
        >
          {format(m.viewFullFlow)}
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
