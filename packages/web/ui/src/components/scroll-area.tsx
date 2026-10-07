'use client'

import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import { ScrollArea as MScrollArea } from '@mantine/core'

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
})

type Seat = {
  /** the formal StyleX extension seat */
  xstyle?: stylex.StyleXStyles
  /** legacy interop hatch */
  className?: string
  style?: React.CSSProperties
}

function ScrollArea({
  className,
  style,
  xstyle,
  children,
  ...props
}: React.ComponentProps<typeof MScrollArea> & Seat) {
  return (
    <MScrollArea
      data-slot="scroll-area"
      scrollbarSize={10}
      // the viewport's name is part of this component's contract; the prop
      // type is a plain div's, which does not admit data attributes
      viewportProps={
        { 'data-slot': 'scroll-area-viewport' } as React.HTMLAttributes<HTMLDivElement>
      }
      classNames={{
        scrollbar: stylex.props(styles.bar).className,
        thumb: stylex.props(styles.thumb).className,
      }}
      {...props}
      {...seatOf(stylex.props(xstyle), className, style)}
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
  ...props
}: React.ComponentProps<typeof MScrollArea.Autosize> & Seat) {
  return (
    <MScrollArea.Autosize
      data-slot="scroll-area"
      scrollbarSize={10}
      viewportProps={
        { 'data-slot': 'scroll-area-viewport' } as React.HTMLAttributes<HTMLDivElement>
      }
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
