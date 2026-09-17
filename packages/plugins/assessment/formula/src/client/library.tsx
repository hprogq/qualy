import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { Skeleton } from '@qualy/ui/skeleton'
import { libraryStyles } from './library-styles.ts'

// The pieces of the two library lists that are components; their styles and
// the date words they share live in ./library-styles.ts.

/** a formula's parameters, as the names a source file gives them */
export function ParameterChips({ names }: { readonly names: readonly string[] }) {
  return (
    <span {...stylex.props(libraryStyles.chips)}>
      {names.map((name) => (
        <span key={name} {...stylex.props(libraryStyles.chip)}>
          {name}
        </span>
      ))}
    </span>
  )
}

/** the list before its answer, in the list's own shape */
export function LibrarySkeleton({ rows = 4 }: { readonly rows?: number }) {
  return (
    <div {...stylex.props(libraryStyles.sheet)} aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          {...stylex.props(
            libraryStyles.grid,
            libraryStyles.skeletonRow,
            index > 0 && libraryStyles.divided,
          )}
        >
          <Skeleton height={14} width="32%" radius={4} />
          <Skeleton height={10} width="52%" radius={4} />
        </div>
      ))}
    </div>
  )
}

export function LibraryMasthead({
  title,
  hint,
  titleRef,
  actions,
}: {
  readonly title: string
  readonly hint: string
  readonly titleRef?: (node: HTMLElement | null) => void
  readonly actions?: ReactNode
}) {
  return (
    <div {...stylex.props(libraryStyles.masthead)}>
      <div {...stylex.props(libraryStyles.heading)}>
        <h1 ref={titleRef} {...stylex.props(libraryStyles.title)}>
          {title}
        </h1>
        <p {...stylex.props(libraryStyles.hint)}>{hint}</p>
      </div>
      {actions}
    </div>
  )
}
