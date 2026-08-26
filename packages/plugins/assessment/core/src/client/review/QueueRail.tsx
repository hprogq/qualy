import { memo } from 'react'
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { assessmentMessages as m } from '../i18n.ts'
import { useDayClock, type InboxItemDto } from './model.ts'

/**
 * What is still to do in this run, down the left.
 *
 * A filing leaves the list the moment its disposition is staged, not when
 * the five seconds are up: from the reviewer's side it is dealt with, and a
 * row that lingers greyed out for five seconds reads as one that did not
 * take. Taking it back with ⌘Z puts it back, because then it really was not
 * dealt with.
 */
// The four panes are memoized: the root re-renders on every keystroke in
// the decision bar and on every overlay opening or closing, and each of
// those re-rendered three columns and a queue for nothing - the sibling
// dialog's entrance visibly lost its first frames to that commit.
export const QueueRail = memo(function QueueRail({
  rows,
  currentId,
  remainingCount,
  open,
  onToggle,
  onOpen,
  onBack,
}: {
  rows: readonly InboxItemDto[]
  currentId: string
  remainingCount: number
  /** whether the column is showing its list, or folded to a strip */
  open: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  onBack: () => void
}) {
  const { format } = useI18n()
  const dayClock = useDayClock()
  return (
    // The rail is always its full width; the aside around it is what
    // narrows and clips. Animating the contents' own layout warped every
    // row mid-flight - the shell's rail solved this the same way, and the
    // two folds should feel like one mechanism.
    <aside
      className={cn(
        'relative hidden min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-linear min-[84rem]:flex',
        open ? 'w-56' : 'w-11',
      )}
    >
      <nav
        {...(!open ? { inert: true, 'aria-hidden': true } : {})}
        className={cn(
          'flex h-full w-56 shrink-0 flex-col transition-opacity duration-150',
          !open && 'opacity-0',
        )}
      >
        <div className="flex shrink-0 items-center gap-1 border-b py-2 pr-1.5 pl-1">
          {/* the way out: a workbench with no door back is a dead end */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={format(m.reviewBackToQueue)}
            onClick={onBack}
          >
            <ArrowLeftIcon aria-hidden />
          </Button>
          <p className="min-w-0 truncate text-sm font-semibold">{format(m.reviewQueueTitle)}</p>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {remainingCount}
          </span>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={format(m.reviewQueueFold)}
            onClick={onToggle}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-px p-1.5">
            {rows.map((row) => {
              const current = row.instanceId === currentId
              return (
                <li key={row.instanceId}>
                  <button
                    type="button"
                    onClick={() => onOpen(row.instanceId)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors',
                      current
                        ? 'border-l-foreground bg-accent'
                        : 'border-l-transparent hover:bg-accent/50',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className={cn('truncate text-sm', current && 'font-semibold')}>
                        {row.participantName}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {row.itemTitle}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {dayClock(row.submittedAt)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </nav>
      {/* Folded, the rail is a handle and a number - nothing more. It used
          to keep a column of grey faces, which at 32px against a dark ring
          read like a wall of memorial portraits; who is waiting is the open
          list's answer, and folded only "how many" fits honestly. */}
      <div
        {...(open ? { inert: true, 'aria-hidden': true } : {})}
        className={cn(
          'absolute inset-y-0 left-0 flex w-11 flex-col items-center gap-1.5 py-2 transition-opacity duration-150',
          open && 'pointer-events-none opacity-0',
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={format(m.reviewQueueUnfold)}
          onClick={onToggle}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={format(m.reviewBackToQueue)}
          onClick={onBack}
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
        <span aria-hidden className="my-0.5 h-px w-5 bg-border" />
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
          {remainingCount}
        </span>
      </div>
    </aside>
  )
})
