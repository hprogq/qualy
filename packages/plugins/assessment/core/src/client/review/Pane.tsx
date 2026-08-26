import type { ReactNode } from 'react'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { cn } from '@qualy/ui/cn'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { assessmentMessages as m } from '../i18n.ts'

/**
 * The three parts of a workbench, in reading order: what has been said about
 * the filing, the filing itself, and the terms it is judged under. Beside
 * each other they are columns; stacked they are sections of one page, and
 * the strip under the header anchors to them by these names.
 */
export type WorkbenchPart = 'flow' | 'filing' | 'about'

export const WORKBENCH_PARTS: readonly WorkbenchPart[] = ['flow', 'filing', 'about']

/**
 * The seam between two stacked parts: a shallow full-bleed band rather than
 * a hairline. Three sections of one page need more than a border to stop
 * reading as one; when a section runs short the band is still only 10px, so
 * it never turns into a field of nothing. Beside the columns there is no
 * seam to draw - the grid drops it entirely.
 */
export const PART_LABEL: Record<WorkbenchPart, MessageDescriptor> = {
  flow: m.reviewPrior,
  filing: m.reviewPayloadTitle,
  about: m.reviewAboutSection,
}

/** the reading order: what was said, what was filed, what backs it up */
/**
 * One workbench pane. Side by side it scrolls behind an overlay scrollbar
 * (the native track sat as a grey band between the columns); stacked it is
 * a section of the page and the page scrolls. ScrollArea's viewport always
 * clips, so the stacked case renders no ScrollArea at all rather than a
 * pane that swallows its own height. The root stays `relative` either way -
 * an absolutely positioned descendant must belong to its pane, or it
 * stretches the shell's scroll area from wherever it happens to sit.
 */
export function Pane({
  as: As,
  part,
  className,
  inner,
  footer,
  children,
}: {
  as: 'main' | 'section' | 'aside'
  /** which part of the workbench this is, for the strip that anchors to it */
  part: WorkbenchPart
  /** the pane frame: width, borders */
  className?: string
  /** the content column: padding and gap */
  inner: string
  /** pinned to the pane's floor, outside the scroll */
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <As
      data-workbench-part={part}
      className={cn(
        'relative flex min-w-0 flex-col lg:min-h-0',
        // one whole page of the pager below lg; its own column beside
        'max-lg:h-full max-lg:w-full max-lg:shrink-0 max-lg:snap-start',
        className,
      )}
    >
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn('flex flex-col', inner)}>{children}</div>
      </ScrollArea>
      {footer}
    </As>
  )
}
