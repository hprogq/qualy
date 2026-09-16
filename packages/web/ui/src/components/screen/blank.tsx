import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../empty.tsx'

const styles = stylex.create({
  // tall enough to be an answer, and visibly an edge: the empty state
  // leaves its border to callers, and this one wants it
  shape: {
    minHeight: '22rem',
    borderWidth: 1,
  },
  // Beside a rail, it takes the rail's height rather than its own.
  //
  // The minimum is a floor for a screen with three units in it; on a real
  // organization the rail runs to the bottom of the window and a panel that
  // stopped at 22rem left a third of the page empty under it, which reads as
  // the page having failed to load rather than as nothing being chosen.
  // `stretch` because these grids align their items to the start, so a panel
  // has to ask for the row's full height.
  filling: {
    alignSelf: 'stretch',
    height: '100%',
  },
})

/**
 * What a screen shows before anything is open.
 *
 * Tall enough to be the answer to "what is this half of the page for" rather
 * than a stray sentence floating at the top of a column. The copy names the
 * action that fills the space, because a reader arriving here has not done
 * anything wrong - there is simply nothing chosen yet.
 */
export function Blank({
  icon,
  title,
  description,
  action,
  fill = false,
  xstyle,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  /** take the full height of the row, for a panel that sits beside a rail */
  fill?: boolean
  xstyle?: StyleXStyles
}) {
  return (
    <Empty xstyle={[styles.shape, fill && styles.filling, xstyle]}>
      <EmptyHeader>
        {icon !== undefined && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description !== undefined && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action}
    </Empty>
  )
}
