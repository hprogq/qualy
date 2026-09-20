import type { HTMLAttributes, ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, GripVerticalIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

// The one row grammar every list in the editor speaks: a name, what it
// takes, and what feeds or requires it. A parameter, a determination and a
// form field are different things, but a reader moving between the three
// lists should never have to learn a new column. What differs is only the
// seats at the edges: a list that is reordered has a handle, a list whose
// rows open has a chevron, and the parameter list - whose rows hold their
// own controls - has neither.
//
// Weight comes from three things and nothing else: a name at 600, a type as
// a small grey tag, and a range of numbers in the fixed-width face. What
// describes is 12px grey. A row that still waits is not tinted; a row that
// is wrong says so in one red line under the thing that is wrong.

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"

const styles = stylex.create({
  section: { display: 'flex', flexDirection: 'column', gap: 12 },
  sectionHead: { display: 'flex', alignItems: 'flex-end', gap: 12, minWidth: 0 },
  sectionWords: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 3 },
  sectionTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
  sectionHint: { margin: 0, fontSize: 12, color: tokens.mutedForeground, textWrap: 'pretty' },
  sectionSpacer: { flexGrow: 1 },
  sectionAside: { flexShrink: 0, fontSize: 12, whiteSpace: 'nowrap' },
  asideError: { color: tokens.danger },
  asidePending: { display: 'inline-flex', alignItems: 'center', gap: 6, color: tokens.warningForeground },
  card: {
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: tokens.background,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  grid: { display: 'grid', columnGap: 16, paddingInline: 16 },
  // parameter | type and range | value: the value column holds two controls
  gridValues: {
    columnGap: 20,
    gridTemplateColumns: {
      default: 'minmax(0, 1.3fr) minmax(0, 1fr) minmax(0, 1.2fr)',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
  },
  // name | type and range | third | chevron
  gridOpen: {
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1.3fr) 1rem',
      [breakpoints.phone]: 'minmax(0, 1fr) auto 1rem',
    },
  },
  // handle | name | type and range | third | chevron
  gridDrag: {
    gridTemplateColumns: {
      default: '1.25rem minmax(0, 1fr) minmax(0, 1.5fr) minmax(0, 1.3fr) 1rem',
      [breakpoints.phone]: '1.25rem minmax(0, 1fr) auto 1rem',
    },
  },
  head: {
    alignItems: 'center',
    height: 32,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 11.5,
    fontWeight: 600,
    letterSpacing: '0.04em',
    color: tokens.mutedForeground,
    display: { default: 'grid', [breakpoints.phone]: 'none' },
  },
  row: {
    alignItems: 'center',
    minHeight: 54,
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
  // a row that holds controls: three cells from the top, the words lowered
  // by seven so they sit on the centre line of a 34px control
  rowValues: { alignItems: 'start', paddingBlock: 12, rowGap: 8 },
  wordsLowered: { paddingTop: { default: 7, [breakpoints.phone]: 0 } },
  pressable: {
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
  },
  lifted: { backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 80%, transparent)` },
  markBefore: { boxShadow: `inset 0 2px 0 0 ${tokens.primary}` },
  markAfter: { boxShadow: `inset 0 -2px 0 0 ${tokens.primary}` },
  cell: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cellWrap: { minWidth: 0 },
  // on a phone a row folds to two lines: the name over its type and range
  foldUnder: {
    gridColumn: { default: null, [breakpoints.phone]: '2 / 3' },
    gridRow: { default: null, [breakpoints.phone]: '2' },
  },
  foldUnderFirst: {
    gridColumn: { default: null, [breakpoints.phone]: '1 / 2' },
    gridRow: { default: null, [breakpoints.phone]: '2' },
  },
  foldSide: { gridRow: { default: null, [breakpoints.phone]: '1 / span 2' }, alignSelf: 'center' },
  nameColumn: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 3 },
  name: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 },
  nameText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  nameUnset: { color: tokens.mutedForeground, fontWeight: 500 },
  described: {
    fontSize: 12,
    lineHeight: 1.5,
    color: tokens.mutedForeground,
    textWrap: 'pretty',
    overflowWrap: 'anywhere',
  },
  takes: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  takesWrap: { flexWrap: 'wrap', rowGap: 4, columnGap: 6 },
  typeTag: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 20,
    paddingInline: 7,
    borderRadius: 5,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 11.5,
    fontWeight: 500,
    color: tokens.foreground,
    whiteSpace: 'nowrap',
  },
  range: {
    flexShrink: 0,
    fontFamily: MONO,
    fontSize: 12,
    color: tokens.foreground,
    whiteSpace: 'nowrap',
  },
  note: { flexShrink: 0, fontSize: 12, color: tokens.mutedForeground, whiteSpace: 'nowrap' },
  names: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  namesWrap: { whiteSpace: 'normal', overflow: 'visible', fontSize: 12 },
  count: {
    flexShrink: 0,
    fontFamily: MONO,
    fontSize: 11,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 75%, transparent)`,
  },
  third: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
  problemLine: { fontSize: 12, lineHeight: 1.4, color: tokens.danger, overflowWrap: 'anywhere' },
  quiet: { fontSize: 13, color: tokens.mutedForeground, fontVariantNumeric: 'tabular-nums' },
  handle: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
    cursor: { default: 'grab', ':active': 'grabbing' },
  },
  chevron: { justifySelf: 'end', width: 14, height: 14, color: tokens.mutedForeground },
  tag: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 5,
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
  },
  tagTall: { height: 22, paddingInline: 8, borderRadius: 6, fontSize: 11.5 },
  dot: { width: 6, height: 6, flexShrink: 0, borderRadius: '9999px' },
  dotOk: { backgroundColor: tokens.success },
  dotPending: { backgroundColor: tokens.warning },
  dotError: { backgroundColor: tokens.danger },
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
    minHeight: 54,
    paddingInline: 16,
    fontSize: 13,
    color: tokens.mutedForeground,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  icon12: { width: 12, height: 12 },
})

export type ListLayout = 'values' | 'open' | 'drag'

const gridOf = (layout: ListLayout) =>
  layout === 'values' ? styles.gridValues : layout === 'open' ? styles.gridOpen : styles.gridDrag

/** what a block of the editor says about itself at its far end: how many are wrong, or how many wait */
export function SectionCount({ tone, children }: { tone: 'error' | 'pending'; children: ReactNode }) {
  return tone === 'error' ? (
    <span {...stylex.props(styles.sectionAside, styles.asideError)} data-tone="error">
      {children}
    </span>
  ) : (
    <span {...stylex.props(styles.sectionAside, styles.asidePending)} data-tone="pending">
      <Dot tone="pending" />
      {children}
    </span>
  )
}

export function EditorSection({
  title,
  hint,
  aside,
  children,
  testId,
  block,
}: {
  title: string
  hint?: string | undefined
  /** said at the far end of the heading: a count of what is wrong or waiting */
  aside?: ReactNode
  children: ReactNode
  testId?: string
  /** which block this is, so a press on "go" can find it */
  block?: string
}) {
  return (
    <section {...stylex.props(styles.section)} data-testid={testId} data-block={block}>
      <div {...stylex.props(styles.sectionHead)}>
        <div {...stylex.props(styles.sectionWords)}>
          <h2 {...stylex.props(styles.sectionTitle)}>{title}</h2>
          {hint !== undefined && hint !== '' && <p {...stylex.props(styles.sectionHint)}>{hint}</p>}
        </div>
        <span {...stylex.props(styles.sectionSpacer)} />
        {aside}
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

/** the column names, over whichever seats the list has at its edges */
export function ListHead({
  columns,
  layout = 'open',
}: {
  columns: readonly [string, string, string]
  layout?: ListLayout
}) {
  return (
    <div {...stylex.props(styles.grid, gridOf(layout), styles.head)} aria-hidden>
      {layout === 'drag' && <span />}
      {columns.map((column) => (
        <span key={column} {...stylex.props(styles.cell)}>
          {column}
        </span>
      ))}
      {layout !== 'values' && <span />}
    </div>
  )
}

/**
 * What a row takes: the kind as a tag, then numbers in the fixed-width face,
 * a quiet note, or a run of names. Names are cut with an ellipsis rather
 * than wrapped - the whole list is in the row's title, and in the panel the
 * row opens - and a run that has been narrowed says how far, as kept over
 * offered, which stays readable however long the names are.
 */
export function TakesCell({
  kind,
  range,
  note,
  names,
  separator,
  count,
  wrap = false,
}: {
  kind: string
  range?: string | undefined
  note?: string | undefined
  names?: readonly string[] | undefined
  /** what stands between two names in this language */
  separator: string
  /** kept over offered, for a run that was narrowed */
  count?: string | undefined
  /** let the cell wrap onto a second line, for a row that is tall anyway */
  wrap?: boolean
}) {
  const said = names === undefined || names.length === 0 ? undefined : names.join(separator)
  return (
    <span {...stylex.props(styles.takes, wrap && styles.takesWrap)} title={said}>
      <span {...stylex.props(styles.typeTag)} data-testid="type-tag">
        {kind}
      </span>
      {range !== undefined && <span {...stylex.props(styles.range)}>{range}</span>}
      {note !== undefined && <span {...stylex.props(styles.note)}>{note}</span>}
      {said !== undefined && (
        <span {...stylex.props(styles.names, wrap && styles.namesWrap)} data-testid="takes-names">
          {said}
        </span>
      )}
      {count !== undefined && (
        <span {...stylex.props(styles.count)} data-testid="takes-count">
          {count}
        </span>
      )}
    </span>
  )
}

export function ListRow({
  layout = 'open',
  name,
  unnamed = false,
  description,
  tag,
  takes,
  third,
  problem,
  onOpen,
  handle,
  lifted = false,
  mark = null,
  testId,
  data,
  dragProps,
}: {
  layout?: ListLayout
  name: string
  /** the name is a stand-in for one nobody has given yet */
  unnamed?: boolean
  /** what the thing is, said under its name: a property of it, not of its value */
  description?: string | undefined
  tag?: ReactNode
  /** the type-and-range column */
  takes: ReactNode
  /** the third column: what feeds it, what requires it, what it links to */
  third: ReactNode
  /** what is wrong with this row, said in one red line where the third column ends */
  problem?: string | undefined
  onOpen?: (() => void) | undefined
  /** a drag handle, for a list that is reordered */
  handle?: ReactNode
  lifted?: boolean
  mark?: 'before' | 'after' | null
  testId?: string
  data?: Record<string, string | boolean | undefined>
  dragProps?: HTMLAttributes<HTMLElement>
}) {
  const attributes = Object.fromEntries(
    Object.entries(data ?? {}).map(([key, value]) => [`data-${key}`, value === undefined ? undefined : String(value)]),
  )
  const values = layout === 'values'
  const body = (
    <>
      {layout === 'drag' && <span {...stylex.props(styles.cellWrap, styles.foldSide)}>{handle}</span>}
      <span {...stylex.props(styles.nameColumn, values && styles.wordsLowered)}>
        <span {...stylex.props(styles.name)}>
          <span {...stylex.props(styles.nameText, unnamed && styles.nameUnset)}>{name}</span>
          {tag}
        </span>
        {description !== undefined && description !== '' && (
          <span {...stylex.props(styles.described)} data-testid="row-description">
            {description}
          </span>
        )}
      </span>
      <span
        {...stylex.props(
          styles.cellWrap,
          values && styles.wordsLowered,
          !values && (layout === 'drag' ? styles.foldUnder : styles.foldUnderFirst),
        )}
      >
        {takes}
      </span>
      <span {...stylex.props(styles.third, !values && styles.foldSide)}>
        {third}
        {problem !== undefined && (
          <span {...stylex.props(styles.problemLine)} role="alert" data-testid="row-problem">
            {problem}
          </span>
        )}
      </span>
      {layout !== 'values' &&
        (onOpen !== undefined ? (
          <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron, styles.foldSide)} />
        ) : (
          <span />
        ))}
    </>
  )
  const seat = stylex.props(
    styles.grid,
    gridOf(layout),
    styles.row,
    values && styles.rowValues,
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
    <button
      type="button"
      onClick={onOpen}
      {...seat}
      {...attributes}
      {...dragProps}
      data-testid={testId}
      data-invalid={problem === undefined ? undefined : true}
    >
      {body}
    </button>
  ) : (
    <div
      {...seat}
      {...attributes}
      {...dragProps}
      data-testid={testId}
      data-invalid={problem === undefined ? undefined : true}
    >
      {body}
    </div>
  )
}

export function DragHandle({ onPress, onRelease }: { onPress: () => void; onRelease: () => void }) {
  return (
    <span aria-hidden onPointerDown={onPress} onPointerUp={onRelease} {...stylex.props(styles.handle)}>
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

export function Dot({ tone }: { tone: 'ok' | 'pending' | 'error' | 'quiet' }) {
  return (
    <span
      aria-hidden
      data-tone={tone}
      {...stylex.props(
        styles.dot,
        tone === 'ok'
          ? styles.dotOk
          : tone === 'pending'
            ? styles.dotPending
            : tone === 'error'
              ? styles.dotError
              : styles.dotQuiet,
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
