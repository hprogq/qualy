import type * as React from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { InboxIcon } from 'lucide-react'

import { tokens } from '../theme/tokens.stylex.ts'

// What a field that picks from a set shows when the set is empty: a tree of
// units with no unit in it, a group of checkboxes with nothing to tick.
//
// It stands where the choices would have stood, as a box of the field's own
// measure, so the form keeps its shape and the reader sees at once that the
// field is there and has nothing to offer. A stray line of small grey type
// under the label read as a note about the field rather than as its answer.
// It says what is missing in the field's own type, may say why and what to
// do about it underneath, and may carry the way out. Zero copy: the words
// are the caller's.
//
// A field whose caller already draws the box - a tree kept in a scrolling
// frame, say - takes that box for its own (`framed={false}`): a second
// border four pixels inside the first read as a box within a box, with the
// frame's height left empty under it. Unframed it stands in the middle of
// whatever height the frame gives it.
//
// Its title is set in the body's weight, so the label above it stays the
// heading and this line reads as the answer under it.

const styles = stylex.create({
  root: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 10,
    minHeight: 44,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    paddingBlock: 10,
    paddingInline: 12,
  },
  // the caller's frame is the box: no edge or ground of its own, and the
  // words in the middle of the height it is given
  bare: {
    height: '100%',
    justifyContent: 'center',
    alignContent: 'center',
    borderWidth: 0,
    backgroundColor: 'transparent',
  },
  said: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '12rem',
    alignItems: 'flex-start',
    gap: 10,
  },
  // in the middle, as one group with its way out
  saidBare: {
    flexGrow: 0,
    flexBasis: 'auto',
  },
  glyph: {
    display: 'inline-flex',
    flexShrink: 0,
    // centred on the title's first line
    marginTop: 2,
    color: tokens.mutedForeground,
  },
  words: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  title: {
    margin: 0,
    fontSize: 14,
    lineHeight: '1.25rem',
    fontWeight: 400,
    color: tokens.foreground,
    overflowWrap: 'anywhere',
  },
  hint: {
    margin: 0,
    fontSize: 13,
    lineHeight: '1.125rem',
    color: tokens.mutedForeground,
    overflowWrap: 'anywhere',
  },
  action: {
    display: 'flex',
    flexShrink: 0,
    marginLeft: 'auto',
  },
  actionBare: {
    marginLeft: 0,
  },
})

function EmptyField({
  title,
  hint,
  action,
  icon,
  framed = true,
  xstyle,
}: {
  /** what is missing, said in the field's own type */
  title: React.ReactNode
  /** why, and what to do about it */
  hint?: React.ReactNode
  /** the way out: a button or a link that goes to where the set is filled */
  action?: React.ReactNode
  /** the glyph before the words; an inbox unless the caller has a truer one */
  icon?: React.ReactNode
  /** false where the caller already draws the field's box around it */
  framed?: boolean
  xstyle?: StyleXStyles
}) {
  return (
    <div
      data-slot="empty-field"
      data-framed={framed}
      {...stylex.props(styles.root, !framed && styles.bare, xstyle)}
    >
      <div {...stylex.props(styles.said, !framed && styles.saidBare)}>
        <span aria-hidden data-slot="empty-field-icon" {...stylex.props(styles.glyph)}>
          {icon ?? <InboxIcon size={16} />}
        </span>
        <div {...stylex.props(styles.words)}>
          <p data-slot="empty-field-title" {...stylex.props(styles.title)}>
            {title}
          </p>
          {hint !== undefined && (
            <p data-slot="empty-field-hint" {...stylex.props(styles.hint)}>
              {hint}
            </p>
          )}
        </div>
      </div>
      {action !== undefined && (
        <div {...stylex.props(styles.action, !framed && styles.actionBare)}>{action}</div>
      )}
    </div>
  )
}

export { EmptyField }
