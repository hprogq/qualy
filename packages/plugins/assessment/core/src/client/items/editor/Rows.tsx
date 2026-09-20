import type { HTMLAttributes, ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, GripVerticalIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// The one row grammar every list in the editor speaks: a handle seat, a
// name, what it takes, what feeds or requires it, and a chevron seat. A
// parameter, a determination and a form field are different things, but a
// reader moving between the three lists should never have to learn a new
// column.

const styles = stylex.create({
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  sectionWords: { display: 'flex', flexDirection: 'column', gap: 4 },
  sectionTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
  sectionHint: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  card: {
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '1.25rem minmax(0, 1.1fr) minmax(0, 1.2fr) minmax(0, 1.3fr) 1rem',
    columnGap: 16,
    alignItems: 'center',
    paddingInline: 16,
  },
  head: {
    height: 32,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  row: {
    minHeight: 52,
    paddingBlock: 8,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    width: '100%',
    textAlign: 'start',
    fontFamily: 'inherit',
    backgroundColor: 'transparent',
    borderWidth: 0,
    color: 'inherit',
  },
  pressable: {
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
  },
  lifted: {
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 80%, transparent)`,
  },
  markBefore: { boxShadow: `inset 0 2px 0 0 ${tokens.primary}` },
  markAfter: { boxShadow: `inset 0 -2px 0 0 ${tokens.primary}` },
  cell: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cellWrap: { minWidth: 0 },
  name: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 500 },
  nameText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  quiet: { fontSize: 13, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  plain: { fontSize: 13 },
  pair: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, minWidth: 0 },
  handle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
    cursor: { default: 'grab', ':active': 'grabbing' },
  },
  chevron: {
    justifySelf: 'end',
    width: 14,
    height: 14,
    color: tokens.mutedForeground,
  },
  tag: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 18,
    paddingInline: 6,
    borderRadius: 5,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.foreground,
    whiteSpace: 'nowrap',
  },
  tagOutline: {
    backgroundColor: 'transparent',
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    fontWeight: 400,
  },
  tagTall: { height: 20, paddingInline: 7 },
  dot: { width: 6, height: 6, flexShrink: 0, borderRadius: '9999px' },
  dotOk: { backgroundColor: tokens.success },
  dotPending: { backgroundColor: tokens.warning },
  dotQuiet: { backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)` },
  pending: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    fontSize: 12,
    color: tokens.warningForeground,
    whiteSpace: 'nowrap',
  },
  footerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingInline: 16,
    width: '100%',
    fontFamily: 'inherit',
    fontSize: 13,
    fontWeight: 500,
    color: tokens.foreground,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
    borderWidth: 0,
    cursor: 'pointer',
    textAlign: 'start',
  },
  emptyRow: {
    display: 'flex',
    alignItems: 'center',
    minHeight: 52,
    paddingInline: 16,
    fontSize: 13,
    color: tokens.mutedForeground,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  icon14: { width: 14, height: 14 },
  icon12: { width: 12, height: 12 },
})

export function EditorSection({
  title,
  hint,
  children,
  testId,
}: {
  title: string
  hint?: string | undefined
  children: ReactNode
  testId?: string
}) {
  return (
    <section {...stylex.props(styles.section)} data-testid={testId}>
      <div {...stylex.props(styles.sectionWords)}>
        <h2 {...stylex.props(styles.sectionTitle)}>{title}</h2>
        {hint !== undefined && hint !== '' && <p {...stylex.props(styles.sectionHint)}>{hint}</p>}
      </div>
      {children}
    </section>
  )
}

export function ListCard({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div {...stylex.props(styles.card)} data-testid={testId}>
      {children}
    </div>
  )
}

/** the column names; the first and last seats are the handle and the chevron */
export function ListHead({ columns }: { columns: readonly [string, string, string] }) {
  return (
    <div {...stylex.props(styles.grid, styles.head)} aria-hidden>
      <span />
      {columns.map((column) => (
        <span key={column} {...stylex.props(styles.cell)}>
          {column}
        </span>
      ))}
      <span />
    </div>
  )
}

export function ListRow({
  name,
  tag,
  takes,
  third,
  onOpen,
  handle,
  chevron = onOpen !== undefined,
  lifted = false,
  mark = null,
  testId,
  data,
  dragProps,
}: {
  name: string
  tag?: ReactNode
  /** the type-and-range column */
  takes: ReactNode
  /** the third column: what feeds it, what requires it, what it links to */
  third: ReactNode
  onOpen?: (() => void) | undefined
  /** whether the row shows a drag handle in its first seat */
  handle?: ReactNode
  chevron?: boolean
  lifted?: boolean
  mark?: 'before' | 'after' | null
  testId?: string
  data?: Record<string, string | boolean | undefined>
  dragProps?: HTMLAttributes<HTMLElement>
}) {
  const attributes = Object.fromEntries(
    Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value === undefined ? undefined : String(value)]),
  )
  const body = (
    <>
      <span {...stylex.props(styles.cellWrap)}>{handle}</span>
      <span {...stylex.props(styles.name)}>
        <span {...stylex.props(styles.nameText)}>{name}</span>
        {tag}
      </span>
      <span {...stylex.props(styles.cell, styles.quiet)}>{takes}</span>
      <span {...stylex.props(styles.cellWrap)}>{third}</span>
      {chevron ? (
        <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
      ) : (
        <span />
      )}
    </>
  )
  const seat = stylex.props(
    styles.grid,
    styles.row,
    onOpen !== undefined && styles.pressable,
    lifted && styles.lifted,
    mark === 'before' && styles.markBefore,
    mark === 'after' && styles.markAfter,
  )
  // a row with controls of its own inside the third column cannot be a
  // button: nested interactive content is what a screen reader refuses. So
  // a pressable row is one button and holds no controls, and a row holding
  // controls is a plain row that opens nothing.
  return onOpen !== undefined ? (
    <button type="button" onClick={onOpen} {...seat} {...attributes} {...dragProps} data-testid={testId}>
      {body}
    </button>
  ) : (
    <div {...seat} {...attributes} {...dragProps} data-testid={testId}>
      {body}
    </div>
  )
}

export function DragHandle({ onPress, onRelease }: { onPress: () => void; onRelease: () => void }) {
  return (
    <span
      aria-hidden
      onPointerDown={onPress}
      onPointerUp={onRelease}
      {...stylex.props(styles.handle)}
    >
      <GripVerticalIcon {...stylex.props(styles.icon12)} />
    </span>
  )
}

export function Tag({
  children,
  outline = false,
  tall = false,
  testId,
}: {
  children: ReactNode
  outline?: boolean
  tall?: boolean
  testId?: string
}) {
  return (
    <span
      {...stylex.props(styles.tag, outline && styles.tagOutline, tall && styles.tagTall)}
      data-testid={testId}
    >
      {children}
    </span>
  )
}

export function Dot({ tone }: { tone: 'ok' | 'pending' | 'quiet' }) {
  return (
    <span
      aria-hidden
      {...stylex.props(
        styles.dot,
        tone === 'ok' ? styles.dotOk : tone === 'pending' ? styles.dotPending : styles.dotQuiet,
      )}
    />
  )
}

/** the amber words beside a control that still waits for an answer */
export function PendingMark({ children }: { children: ReactNode }) {
  return (
    <span {...stylex.props(styles.pending)}>
      <Dot tone="pending" />
      {children}
    </span>
  )
}

export function FooterAction({
  icon,
  label,
  onClick,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button type="button" {...stylex.props(styles.footerRow)} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

export function EmptyRow({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div {...stylex.props(styles.emptyRow)} data-testid={testId}>
      {children}
    </div>
  )
}
