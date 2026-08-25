import type { ReactNode } from 'react'
import { cn } from '../../lib/cn.ts'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '../empty.tsx'

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
  className,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn('min-h-[22rem] rounded-lg border border-dashed', className)}>
      <EmptyHeader>
        {icon !== undefined && <EmptyMedia variant="icon">{icon}</EmptyMedia>}
        <EmptyTitle>{title}</EmptyTitle>
        {description !== undefined && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action}
    </Empty>
  )
}
