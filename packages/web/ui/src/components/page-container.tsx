import type { ComponentProps } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStylesWithout } from '@stylexjs/stylex'
import { breakpoints } from '../theme/breakpoints.stylex.ts'

// How wide a page is allowed to be.
//
// One width for the whole product is wrong in both directions: a form at
// 1600px is a line of text nobody can follow back to its start, and a table
// of participants at 1100px wraps columns that had room to spare. So the page
// says which kind it is, and the shell stays out of it.

const styles = stylex.create({
  root: {
    marginInline: 'auto',
    width: '100%',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    // A phone gives back what it cannot spare: at 375px, 24 on each side is
    // an eighth of the screen spent on nothing, and the rows inside are
    // already the narrow thing. The top of a tablet page gets a little more
    // room than its sides, since the bars above it are tighter there.
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingBlock: 24,
    paddingTop: { default: null, [breakpoints.tablet]: 32 },
  },
  /** reading and filling in: a form, a summary, a table of a few columns */
  default: { maxWidth: '72rem' },
  /** looking across: a queue, a wide grid, several panes side by side */
  wide: { maxWidth: 1440 },
  /** whatever there is: a tree, a canvas, a split view */
  full: {},
})

export function PageContainer({
  size = 'default',
  xstyle,
  ...props
}: Omit<ComponentProps<'div'>, 'style' | 'className'> & {
  size?: 'default' | 'wide' | 'full'
  /**
   * The standard StyleX extension seat - except for the width contract,
   * which is the `size` prop's whole reason to exist.
   */
  xstyle?: StyleXStylesWithout<{ width: never; maxWidth: never; marginInline: never }>
}) {
  return (
    <div
      data-slot="page-container"
      {...props}
      {...stylex.props(styles.root, size !== 'full' && styles[size], xstyle)}
    />
  )
}
