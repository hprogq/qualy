import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { InboxIcon } from 'lucide-react'

import { tokens } from '../theme/tokens.stylex.ts'
import { seatOf } from '../lib/xstyle.ts'

// One line where a table's rows would have been.
//
// For a question that has no rows - a filter with nothing in it, a search
// that matched nothing - where the way back is the control that asked, so
// nothing here offers one. An outline glyph and the sentence, centred in
// the room the rows would have taken, inside whatever card the rows sit in.
// No illustration: in a system with one colour, a drawing with a character
// of its own is the loudest thing on the page, for a state seen a few times
// a year. Zero copy: the caller says the sentence.

const styles = stylex.create({
  row: {
    display: 'flex',
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    margin: 0,
    paddingInline: 20,
    fontSize: 13,
    color: tokens.mutedForeground,
    textAlign: 'center',
  },
  glyph: {
    display: 'inline-flex',
    flexShrink: 0,
  },
})

function EmptyRow({
  icon,
  className,
  xstyle,
  children,
  ...props
}: Omit<React.ComponentProps<'p'>, 'style'> & {
  /** the glyph before the sentence; an inbox unless the caller has a truer one */
  icon?: React.ReactNode
  xstyle?: StyleXStyles
}) {
  return (
    <p data-slot="empty-row" {...props} {...seatOf(stylex.props(styles.row, xstyle), className)}>
      <span aria-hidden {...stylex.props(styles.glyph)}>
        {icon ?? <InboxIcon size={16} />}
      </span>
      <span>{children}</span>
    </p>
  )
}

export { EmptyRow }
