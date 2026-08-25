import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'

/**
 * What a page is, above what it shows.
 *
 * The shell says which application and which object; the page still has to
 * say which of that object's pages this is. Without it a section opens on
 * its own controls, which reads as a fragment of a screen rather than a
 * screen.
 */
export function PageHeader({
  title,
  description,
  actions,
  variant = 'plain',
}: {
  /**
   * Usually the page's name. Takes a node so a heading that has something to
   * say beside the name - a standing, a chip - is still this heading rather
   * than a second one built to look like it: two headings assembled
   * separately drift apart by a few pixels, and in a band that hands over
   * from one to the other those pixels are a jump.
   */
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /**
   * The heading of a band that spans the content area, rather than a line of
   * text above it.
   *
   * Only the rhythm differs here - the band itself belongs to whoever draws
   * it edge to edge, because a header inset inside the page's own width is a
   * card pretending to be a header.
   */
  variant?: 'plain' | 'banner'
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-x-4 gap-y-2',
        variant === 'banner' && 'py-1',
      )}
    >
      <div className="min-w-0 space-y-1">
        <h1 className="flex min-w-0 items-center gap-2.5 text-lg font-semibold tracking-tight">
          {title}
        </h1>
        {description !== undefined && description !== '' && (
          <p className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      {/* capped at the header's own width so what a page puts here wraps
          instead of running off the edge: a flex item that may not shrink is
          sized to its content, and its own wrapping never gets a chance */}
      {actions && (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  )
}

/**
 * One part of a screen: a heading, what it says, and what it holds.
 *
 * A rule above it and nothing else. It used to be a card, and a screen of
 * five settings then read as five unrelated objects stacked on a page -
 * boxes inside a box, each with its own edge competing with the edges of the
 * rows inside it. What separates two parts of one thing is a line.
 */
export function Panel({
  title,
  description,
  actions,
  children,
}: {
  title: string
  description?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="text-xs text-muted-foreground">{description}</p>}
        </div>
        {actions}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  )
}
