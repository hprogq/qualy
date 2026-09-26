'use client'

import { Pagination } from '@mantine/core'
import * as stylex from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../theme/tokens.stylex.ts'

// Pages by number, at the foot of a list somebody walks around in: first,
// last, the ones either side of here. It draws nothing for a list that fits
// on one page - a lone "1" is a control that does nothing.
//
// The words are the caller's: this is a primitive, and it carries no copy.

const styles = stylex.create({
  seat: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  summary: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  spacer: { flexGrow: 1 },
  controls: { display: 'flex', alignItems: 'center', gap: 8 },
  // the page being read, drawn as the numbered strip draws its own and
  // pointing at nothing
  here: { cursor: 'default', userSelect: 'none' },
  // A page number is a quiet key, and the page being read wears the tint
  // the product gives a chosen option. The widget's own current page was
  // the primary filled behind a hard-coded white: a black block at the foot
  // of every list in the light scheme, and white on near-white in the dark,
  // where the primary is paper. Secondary navigation should be neither.
  control: {
    borderColor: {
      default: 'transparent',
      '[data-active]': tokens.selectedBorder,
    },
    backgroundColor: {
      default: 'transparent',
      ':hover:not([data-active]):not(:disabled):not([data-disabled])': tokens.hoverSurface,
      '[data-active]': tokens.selectedSurface,
    },
    color: {
      default: tokens.mutedForeground,
      ':hover:not(:disabled):not([data-disabled])': tokens.foreground,
      '[data-active]': tokens.foreground,
    },
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: { default: 400, '[data-active]': 600 },
    transitionProperty: 'background-color, color',
    transitionDuration: { default: '120ms', '@media (prefers-reduced-motion: reduce)': '0s' },
    transitionTimingFunction: 'ease-out',
  },
  dots: { color: tokens.mutedForeground },
})

/** the look both strips hand the widget for its keys */
const controlClassNames = {
  control: stylex.props(styles.control).className ?? '',
  dots: stylex.props(styles.dots).className ?? '',
}

/** the names the two arrows are spoken by, where the caller has given them */
const edgeLabels =
  (previousLabel: string | undefined, nextLabel: string | undefined) =>
  (control: 'first' | 'previous' | 'last' | 'next') =>
    control === 'previous' && previousLabel !== undefined
      ? { 'aria-label': previousLabel }
      : control === 'next' && nextLabel !== undefined
        ? { 'aria-label': nextLabel }
        : {}

export function Pager({
  page,
  pageSize,
  total,
  onPage,
  summary,
  label,
  previousLabel,
  nextLabel,
  compact = false,
  disabled = false,
  testId,
}: {
  /** counted from one */
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  /** said at the start of the strip: how many there are, which of them are shown */
  summary?: string
  /** spoken name of the navigation */
  label: string
  /** spoken names of the two arrows */
  previousLabel?: string
  nextLabel?: string
  /**
   * Only the page being read between the first and the last, for a strip
   * that shares a narrow foot with something else.
   */
  compact?: boolean
  disabled?: boolean
  testId?: string
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <div
      {...stylex.props(styles.seat)}
      data-testid={testId}
      data-page={page}
      data-pages={pages}
      data-total={total}
    >
      {summary !== undefined && <span {...stylex.props(styles.summary)}>{summary}</span>}
      <span {...stylex.props(styles.spacer)} />
      {pages > 1 && (
        <Pagination
          aria-label={label}
          size="sm"
          radius="md"
          siblings={compact ? 0 : 1}
          boundaries={1}
          total={pages}
          value={Math.min(page, pages)}
          onChange={onPage}
          disabled={disabled}
          withEdges={false}
          getControlProps={edgeLabels(previousLabel, nextLabel)}
          classNames={controlClassNames}
        />
      )}
    </div>
  )
}

/**
 * The same strip over a list read forwards, a page at a time.
 *
 * A list walked by cursor does not know how many pages it has - only
 * whether there is a next one - so it offers the way back, the page being
 * read, and the way on: the numbered strip's own controls, so the two kinds
 * of list look like one.
 */
export function CursorPager({
  page,
  hasNext,
  onPrevious,
  onNext,
  summary,
  label,
  previousLabel,
  nextLabel,
  disabled = false,
  testId,
}: {
  /** counted from one */
  page: number
  hasNext: boolean
  onPrevious: () => void
  onNext: () => void
  summary?: string
  /** spoken name of the navigation */
  label: string
  previousLabel: string
  nextLabel: string
  disabled?: boolean
  testId?: string
}) {
  const known = page + (hasNext ? 1 : 0)
  return (
    <div
      {...stylex.props(styles.seat)}
      data-testid={testId}
      data-page={page}
      data-has-next={hasNext}
    >
      {summary !== undefined && <span {...stylex.props(styles.summary)}>{summary}</span>}
      <span {...stylex.props(styles.spacer)} />
      {known > 1 && (
        <Pagination.Root
          aria-label={label}
          size="sm"
          radius="md"
          total={known}
          value={page}
          disabled={disabled}
          onChange={(next) => (next > page ? onNext() : onPrevious())}
          classNames={controlClassNames}
        >
          <div {...stylex.props(styles.controls)}>
            <Pagination.Previous aria-label={previousLabel} />
            {/* Where the reader is, in the numbered strip's own look. It is
                not a way anywhere, so it is not a button: a control that
                does nothing when pressed is still announced as one to
                press. */}
            <span
              aria-current="page"
              data-active
              data-with-padding
              data-disabled={disabled || undefined}
              className={clsx(
                Pagination.classes.control,
                stylex.props(styles.control, styles.here).className,
              )}
            >
              {page}
            </span>
            <Pagination.Next aria-label={nextLabel} />
          </div>
        </Pagination.Root>
      )}
    </div>
  )
}
