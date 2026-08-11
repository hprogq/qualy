import type { ComponentProps } from 'react'
import { cn } from '../lib/utils.ts'

// How wide a page is allowed to be.
//
// One width for the whole product is wrong in both directions: a form at
// 1600px is a line of text nobody can follow back to its start, and a table
// of participants at 1100px wraps columns that had room to spare. So the page
// says which kind it is, and the shell stays out of it.

const widths = {
  /** reading and filling in: a form, a summary, one thing being described */
  default: 'max-w-5xl',
  /** looking across: a table with several columns, a plan, a queue */
  wide: 'max-w-[1600px]',
  /** whatever there is: a tree, a canvas, a split view */
  full: 'max-w-none',
} as const

export function PageContainer({
  size = 'default',
  className,
  ...props
}: ComponentProps<'div'> & { size?: keyof typeof widths }) {
  return (
    <div
      data-slot="page-container"
      className={cn('mx-auto w-full px-6 py-6', widths[size], className)}
      {...props}
    />
  )
}
