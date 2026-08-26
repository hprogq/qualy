import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { MessageDescriptor } from '@qualy/i18n-contract'
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

export const PART_LABEL: Record<WorkbenchPart, MessageDescriptor> = {
  flow: m.reviewPrior,
  filing: m.reviewPayloadTitle,
  about: m.reviewAboutSection,
}

const belowLg = '@media (max-width: 1023.98px)'
const lg = '@media (min-width: 1024px)'

const styles = stylex.create({
  // The root stays `relative` either way - an absolutely positioned
  // descendant must belong to its pane, or it stretches the shell's scroll
  // area from wherever it happens to sit. Below lg the pane is one whole
  // page of the pager; beside, its own column.
  pane: {
    position: 'relative',
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    minHeight: {
      default: null,
      [lg]: 0,
    },
    height: {
      default: null,
      [belowLg]: '100%',
    },
    width: {
      default: null,
      [belowLg]: '100%',
    },
    flexShrink: {
      default: null,
      [belowLg]: 0,
    },
    scrollSnapAlign: {
      default: null,
      [belowLg]: 'start',
    },
  },
  scroller: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  column: {
    display: 'flex',
    flexDirection: 'column',
  },
})

/**
 * One workbench pane. It scrolls inside itself at every width - beside the
 * other columns and as one page of the pager alike - behind an overlay
 * scrollbar (the native track sat as a grey band between the columns), so
 * leaving a face and returning finds a reading where it was left.
 */
export function Pane({
  as: As,
  part,
  xstyle,
  innerXstyle,
  footer,
  children,
}: {
  as: 'main' | 'section' | 'aside'
  /** which part of the workbench this is, for the strip that anchors to it */
  part: WorkbenchPart
  /** the pane frame: width, borders */
  xstyle?: stylex.StyleXStyles
  /** the content column: padding and gap */
  innerXstyle?: stylex.StyleXStyles
  /** pinned to the pane's floor, outside the scroll */
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <As data-workbench-part={part} {...stylex.props(styles.pane, xstyle)}>
      <ScrollArea className={stylex.props(styles.scroller).className}>
        <div {...stylex.props(styles.column, innerXstyle)}>{children}</div>
      </ScrollArea>
      {footer}
    </As>
  )
}
