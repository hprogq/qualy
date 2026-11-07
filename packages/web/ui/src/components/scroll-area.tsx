'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { ScrollArea as MScrollArea } from '@mantine/core'

import { breakpoints } from '../theme/breakpoints.stylex.ts'
import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// A scroll container with overlay scrollbars. The bookkeeping - measuring the
// overflow, mounting and hiding the bars, dragging the thumb - is the widget
// library's; the bar itself is the product's hairline rather than the
// library's own.
//
// The viewport keeps its name. It is the element that actually scrolls, and
// two screens reach for it by that name to put a row back in view, so it is
// part of this component's contract rather than an implementation detail.

const styles = stylex.create({
  // the bar is a guide, not furniture: it sits over the content instead of
  // taking a column of its own
  bar: {
    padding: 1,
    backgroundColor: 'transparent',
  },
  thumb: {
    backgroundColor: tokens.border,
  },
  // content at least the viewport tall, its children laid down a column, so
  // a pane that fills the room it scrolls in can say so with flex
  fill: {
    display: 'flex',
    minHeight: '100%',
    flexDirection: 'column',
  },
  // An area that scrolls by itself only from a desk's width: under it the
  // root clips nothing and the viewport is as tall as what it holds, so the
  // content is part of whatever scrolls around it, and a sticky part of it
  // pins to that.
  // Either way the room it is given reaches its content down a column, so a
  // pane that fills the room still fills it where the page scrolls instead.
  rootFromDesktop: {
    display: 'flex',
    flexDirection: 'column',
    overflow: { default: 'visible', [breakpoints.desktop]: 'hidden' },
  },
  viewportFromDesktop: {
    display: 'flex',
    flexGrow: 1,
    flexDirection: 'column',
    height: { default: 'auto', [breakpoints.desktop]: '100%' },
    overflowX: { default: 'visible', [breakpoints.desktop]: 'hidden' },
    overflowY: { default: 'visible', [breakpoints.desktop]: 'scroll' },
  },
  contentFromDesktop: { flexGrow: 1 },
})

type Seat = {
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

type Viewport = {
  /**
   * What the element that scrolls says of itself: its name for a test, its
   * label, its handlers. The viewport keeps its slot name beside them.
   */
  viewportProps?: React.HTMLAttributes<HTMLDivElement> & {
    readonly [data: `data-${string}`]: string | undefined
  }
}

/** the viewport's slot name, and whatever the caller adds to it */
const viewportOf = (given: Viewport['viewportProps']): React.HTMLAttributes<HTMLDivElement> =>
  // the prop type is a plain div's, which does not admit data attributes
  ({ ...given, 'data-slot': 'scroll-area-viewport' }) as React.HTMLAttributes<HTMLDivElement>

// The library writes the viewport's overflow on the element itself, which no
// stylesheet answers; an area that scrolls only from some width takes it
// back, so its media query can.
const NO_INLINE_OVERFLOW: React.CSSProperties = { overflowX: undefined, overflowY: undefined }

function ScrollArea({
  className,
  style,
  xstyle,
  children,
  viewportProps,
  fill = false,
  scrollsFrom,
  ...props
}: Omit<React.ComponentProps<typeof MScrollArea>, 'viewportProps'> &
  Seat &
  Viewport & {
    /** the content stands at least the viewport tall, as a column */
    fill?: boolean
    /**
     * under this width the area does not scroll: its content is part of the
     * page; either way the content stands as a column that fills the area
     */
    scrollsFrom?: 'desktop'
  }) {
  const narrowFlows = scrollsFrom === 'desktop'
  return (
    <MScrollArea
      data-slot="scroll-area"
      scrollbarSize={10}
      viewportProps={viewportOf(
        narrowFlows
          ? { ...viewportProps, style: { ...viewportProps?.style, ...NO_INLINE_OVERFLOW } }
          : viewportProps,
      )}
      classNames={{
        scrollbar: stylex.props(styles.bar).className,
        thumb: stylex.props(styles.thumb).className,
        ...(fill || narrowFlows
          ? {
              content: stylex.props(styles.fill, narrowFlows && styles.contentFromDesktop)
                .className,
            }
          : {}),
        ...(narrowFlows ? { viewport: stylex.props(styles.viewportFromDesktop).className } : {}),
      }}
      {...props}
      {...seatOf(stylex.props(narrowFlows && styles.rootFromDesktop, xstyle), className, style)}
    >
      {children}
    </MScrollArea>
  )
}

/**
 * The same scroll container for a box that is only as tall as its content,
 * up to the height its own seat allows.
 */
function ScrollAreaAutosize({
  className,
  style,
  xstyle,
  children,
  viewportProps,
  ...props
}: Omit<React.ComponentProps<typeof MScrollArea.Autosize>, 'viewportProps'> & Seat & Viewport) {
  return (
    <MScrollArea.Autosize
      data-slot="scroll-area"
      scrollbarSize={10}
      viewportProps={viewportOf(viewportProps)}
      classNames={{
        scrollbar: stylex.props(styles.bar).className,
        thumb: stylex.props(styles.thumb).className,
      }}
      // a box that scrolls only down keeps its rows to its own width
      styles={props.scrollbars === 'y' ? { content: { minWidth: '100%' } } : undefined}
      {...props}
      {...seatOf(stylex.props(xstyle), className, style)}
    >
      {children}
    </MScrollArea.Autosize>
  )
}

export { ScrollArea, ScrollAreaAutosize }
