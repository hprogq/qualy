import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { Skeleton } from '../skeleton.tsx'

/** the bordered column a screen selects from: one box, one hairline per row */
export function Rail({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & Omit<
  ComponentProps<'div'>,
  'children' | 'className'
>) {
  return (
    <div
      className={cn('flex min-w-0 flex-col overflow-hidden rounded-lg border', className)}
      {...props}
    >
      {children}
    </div>
  )
}

/**
 * One entry in a rail: what it is called, what is true of it, and how much of
 * it there is.
 *
 * Two lines of meta at most. A rail entry answers "is this the one I want",
 * not "what is this" - the editor beside it answers that.
 */
export function RailRow({
  name,
  badges,
  tally,
  meta,
  selected,
  onSelect,
}: {
  name: string
  badges?: readonly { label: string; tone?: 'quiet' | 'alert' }[]
  tally?: ReactNode
  /** at most two short lines; a tone marks the one that is a problem */
  meta?: readonly { text: string; tone?: 'quiet' | 'alert' }[]
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-current={selected}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-col gap-0.5 border-t px-3 py-2 text-left first:border-t-0 hover:bg-accent/70',
        selected && 'bg-accent',
      )}
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span
          className={cn('min-w-0 truncate text-sm', selected ? 'font-semibold' : 'font-medium')}
        >
          {name}
        </span>
        {badges?.map((badge) => (
          <span
            key={badge.label}
            className={cn(
              'shrink-0 text-xs',
              badge.tone === 'alert' ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {badge.label}
          </span>
        ))}
        <span className="flex-1" />
        {tally !== undefined && (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tally}</span>
        )}
      </span>
      {meta?.map((line) => (
        <span
          key={line.text}
          className={cn(
            'min-w-0 truncate text-xs',
            line.tone === 'alert' ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {line.text}
        </span>
      ))}
    </button>
  )
}

/**
 * The shape of a rail while its rows are still being fetched.
 *
 * A box the size of the answer, so the column does not collapse and then
 * shove the rest of the screen sideways when the rows land.
 */
export function RailSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Rail aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex flex-col gap-2 border-t px-3 py-3 first:border-t-0">
          <Skeleton className="h-4 w-2/5" />
          <Skeleton className="h-3 w-3/5" />
        </div>
      ))}
    </Rail>
  )
}

/** the shape of an editor while the thing it edits is still being fetched */
export function EditorSkeleton() {
  return (
    <div className="flex min-w-0 flex-col gap-4" aria-hidden>
      <Skeleton className="h-6 w-48" />
      <Skeleton className="h-20 w-full rounded-lg" />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-11 w-full rounded-lg" />
        ))}
      </div>
    </div>
  )
}
