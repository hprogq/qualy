import type { ComponentProps, ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { clsx } from 'clsx'
import { tokens } from '../../theme/tokens.stylex.ts'
import { Skeleton } from '../skeleton.tsx'

const styles = stylex.create({
  rail: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  row: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 8,
    textAlign: 'left',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  rowSelected: {
    backgroundColor: {
      default: tokens.surfaceMuted,
      ':hover': tokens.surfaceMuted,
    },
  },
  rowHead: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
  },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  nameSelected: {
    fontWeight: 600,
  },
  badge: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  badgeAlert: {
    color: tokens.danger,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  tally: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  metaLine: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  metaAlert: {
    color: tokens.danger,
  },
  skeletonRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 12,
  },
  lineWide: { height: 16, width: '40%' },
  lineNarrow: { height: 12, width: '60%' },
  editorSkeleton: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 16,
  },
  editorTitleLine: { height: 24, width: 192 },
  editorBlock: { height: 80, width: '100%', borderRadius: tokens.radiusLg },
  editorGrid: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
      '@media (min-width: 1024px)': 'repeat(3, minmax(0, 1fr))',
    },
  },
  editorCell: { height: 44, width: '100%', borderRadius: tokens.radiusLg },
})

/** the bordered column a screen selects from: one box, one hairline per row */
export function Rail({
  children,
  className,
  ...props
}: { children: ReactNode; className?: string } & Omit<
  ComponentProps<'div'>,
  'children' | 'className'
>) {
  const sx = stylex.props(styles.rail)
  return (
    <div {...sx} {...props} className={clsx(sx.className, className)}>
      {children}
    </div>
  )
}

/**
 * One entry in a rail: what it is called, what is true of it, and how much of
 * it there is.
 *
 * Two lines of meta at most. A rail entry answers "is this the one I want",
 * not "what is this" - the editor beside it answers that.
 */
export function RailRow({
  name,
  badges,
  tally,
  meta,
  selected,
  onSelect,
}: {
  name: string
  badges?: readonly { label: string; tone?: 'quiet' | 'alert' }[]
  tally?: ReactNode
  /** at most two short lines; a tone marks the one that is a problem */
  meta?: readonly { text: string; tone?: 'quiet' | 'alert' }[]
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-current={selected}
      onClick={onSelect}
      {...stylex.props(styles.row, selected && styles.rowSelected)}
    >
      <span {...stylex.props(styles.rowHead)}>
        <span {...stylex.props(styles.name, selected && styles.nameSelected)}>{name}</span>
        {badges?.map((badge) => (
          <span
            key={badge.label}
            {...stylex.props(styles.badge, badge.tone === 'alert' && styles.badgeAlert)}
          >
            {badge.label}
          </span>
        ))}
        <span {...stylex.props(styles.spacer)} />
        {tally !== undefined && <span {...stylex.props(styles.tally)}>{tally}</span>}
      </span>
      {meta?.map((line) => (
        <span
          key={line.text}
          {...stylex.props(styles.metaLine, line.tone === 'alert' && styles.metaAlert)}
        >
          {line.text}
        </span>
      ))}
    </button>
  )
}

/**
 * The shape of a rail while its rows are still being fetched.
 *
 * A box the size of the answer, so the column does not collapse and then
 * shove the rest of the screen sideways when the rows land.
 */
export function RailSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <Rail aria-hidden>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} {...stylex.props(styles.skeletonRow)}>
          <Skeleton className={stylex.props(styles.lineWide).className} />
          <Skeleton className={stylex.props(styles.lineNarrow).className} />
        </div>
      ))}
    </Rail>
  )
}

/** the shape of an editor while the thing it edits is still being fetched */
export function EditorSkeleton() {
  return (
    <div {...stylex.props(styles.editorSkeleton)} aria-hidden>
      <Skeleton className={stylex.props(styles.editorTitleLine).className} />
      <Skeleton className={stylex.props(styles.editorBlock).className} />
      <div {...stylex.props(styles.editorGrid)}>
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className={stylex.props(styles.editorCell).className} />
        ))}
      </div>
    </div>
  )
}
