import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

/**
 * A list with nothing in it, at the weight of a list.
 *
 * The shared `Empty` is built for a page that is empty - a 40px icon plate,
 * an 18px heading, a lot of air. Dropped into the sheet where rows would be,
 * it reads as an announcement about a screen that is otherwise working
 * fine. This is the same three things at the size of the thing they replace:
 * one line saying what is not there, one saying when it would be, and the
 * way to make it so.
 */

const styles = stylex.create({
  seat: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    paddingInline: 24,
    paddingBlock: 40,
    textAlign: 'center',
  },
  title: { fontSize: 14, fontWeight: 500 },
  said: {
    maxWidth: '26rem',
    fontSize: 13,
    lineHeight: 1.7,
    color: tokens.mutedForeground,
    textWrap: 'pretty',
  },
  act: { marginTop: 10 },
})

export function ListEmpty({
  title,
  said,
  children,
  testId,
}: {
  title: string
  said?: string
  /** the way out, when this reader has one */
  children?: ReactNode
  testId?: string
}) {
  return (
    <div {...stylex.props(styles.seat)} data-testid={testId}>
      <p {...stylex.props(styles.title)}>{title}</p>
      {said !== undefined && <p {...stylex.props(styles.said)}>{said}</p>}
      {children !== undefined && <div {...stylex.props(styles.act)}>{children}</div>}
    </div>
  )
}
