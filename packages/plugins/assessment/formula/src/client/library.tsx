import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { Skeleton } from '@qualy/ui/skeleton'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { libraryStyles } from './library-styles.ts'

const skeletonStyles = stylex.create({
  // the middle columns are the ones the list itself drops on a phone; a
  // placeholder that keeps them would wrap into rows the list never has
  wide: { display: { default: 'block', [breakpoints.phone]: 'none' } },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 7 },
  end: { justifySelf: 'end' },
})

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

/**
 * The list before its answer, in the list's own shape.
 *
 * Same sheet, same column tracks, same row height and same header - so the
 * answer lands in the outline already on the screen instead of replacing a
 * grey slab with a table. It takes the page's own `columns` for that: two
 * lists with different columns cannot share one placeholder and still be
 * the shape of either.
 *
 * The bars run to about where the real words stop, and no further. A bar
 * spanning a whole column reads as a value that is merely wide, which is
 * the one thing a placeholder must not say.
 */
export function LibrarySkeleton({
  rows = 5,
  columns,
  middle = 1,
}: {
  readonly rows?: number
  /** the page's own grid tracks, so the outline is that page's list */
  readonly columns?: stylex.StyleXStyles
  /** how many columns sit between the name and the date */
  readonly middle?: number
}) {
  return (
    <div {...stylex.props(libraryStyles.sheet)} role="presentation" aria-hidden>
      <div {...stylex.props(libraryStyles.grid, libraryStyles.headRow, columns)}>
        <Skeleton height={9} width="4rem" radius={4} />
        {Array.from({ length: middle }, (_, index) => (
          <Skeleton key={index} height={9} width="3rem" radius={4} />
        ))}
        <Skeleton
          height={9}
          width="3rem"
          radius={4}
          className={stylex.props(skeletonStyles.end).className}
        />
        <span />
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          {...stylex.props(libraryStyles.grid, libraryStyles.row, libraryStyles.divided, columns)}
        >
          <span {...stylex.props(skeletonStyles.words)}>
            {/* an uneven run of names, because a column of identical bars
                reads as a loading bar rather than as a list */}
            <Skeleton height={13} width={`${[46, 62, 38, 54, 44][index % 5]!}%`} radius={4} />
            <Skeleton height={9} width={`${[64, 50, 72, 58, 68][index % 5]!}%`} radius={4} />
          </span>
          {Array.from({ length: middle }, (_, at) => (
            <Skeleton
              key={at}
              height={11}
              width="4.5rem"
              radius={4}
              className={stylex.props(skeletonStyles.wide).className}
            />
          ))}
          <Skeleton
            height={11}
            width="3.5rem"
            radius={4}
            className={stylex.props(skeletonStyles.wide, skeletonStyles.end).className}
          />
          <span />
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
