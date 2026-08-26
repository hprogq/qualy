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
  xstyle,
  className,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  /** the standard StyleX seat; `className` is the legacy escape hatch */
  xstyle?: StyleXStyles
  className?: string
}) {
  return (
    <Empty xstyle={[styles.shape, xstyle]} className={className}>
      <EmptyHeader>
        {icon !== undefined && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description !== undefined && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action}
    </Empty>
  )
}
