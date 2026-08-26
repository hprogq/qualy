import type { ComponentProps } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { clsx } from 'clsx'

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
    paddingInline: 24,
    paddingBlock: 24,
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
  className,
  style,
  ...props
}: Omit<ComponentProps<'div'>, 'style'> & {
  size?: 'default' | 'wide' | 'full'
  /** StyleX overrides from product callers; legacy callers keep className */
  style?: StyleXStyles
}) {
  const sx = stylex.props(styles.root, size !== 'full' && styles[size], style)
  return (
    <div
      data-slot="page-container"
      {...props}
      {...sx}
      className={clsx(sx.className, className)}
    />
  )
}
