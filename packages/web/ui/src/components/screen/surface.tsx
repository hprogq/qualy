import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from 'react'
import { ChevronRightIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { breakpoints } from '../../theme/breakpoints.stylex.ts'
import { Checkbox } from '../checkbox.tsx'

// White panels on the page's own ground: the surfaces an administration
// screen is assembled from.
//
// The page is one shade off white and everything that can be read or
// pressed sits on a white card with a hairline ring. A card's head names
// it, a table's head is a strip of small grey words, rows are cut by the
// faintest rule, and a state is a small dot beside a word - never a
// coloured pill. The metrics here are the design's, written once, so a
// table on the roles page and a table on the audit log are the same table.

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`
const MONO = "'SFMono-Regular', ui-monospace, 'JetBrains Mono', Menlo, Consolas, monospace"

const styles = stylex.create({
  card: {
    display: 'flex',
    minWidth: 0,
    flexShrink: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  cardHead: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    minHeight: 42,
    paddingInline: 16,
    paddingBlock: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    flexWrap: { default: null, [breakpoints.phone]: 'wrap' },
  },
  cardTitleStack: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 1 },
  cardTitle: { flexShrink: 0, margin: 0, fontSize: 13, lineHeight: 1.4, fontWeight: 600 },
  cardNote: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: QUIET,
  },
  cardSub: { fontSize: 11.5, fontVariantNumeric: 'tabular-nums', color: QUIET },
  spacer: { flexGrow: 1, flexShrink: 1, flexBasis: '0%', minWidth: 4 },
  cardHint: {
    margin: 0,
    paddingInline: 16,
    paddingBottom: 12,
    fontSize: 11.5,
    lineHeight: 1.6,
    color: QUIET,
    textWrap: 'pretty',
  },
  cardHintTop: { paddingTop: 10 },
  cardFoot: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingInline: 16,
    paddingBlock: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    fontSize: 12,
    color: tokens.mutedForeground,
    flexWrap: 'wrap',
  },
  cardFootInset: { backgroundColor: tokens.surfaceInset },
  cardEmpty: {
    margin: 0,
    paddingInline: 16,
    paddingBlock: 14,
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  // ---- facts -----------------------------------------------------------
  factStrip: {
    display: 'grid',
    margin: 0,
    gap: 18,
    paddingInline: 16,
    paddingBlock: 14,
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.desktop]: 'repeat(5, minmax(0, 1fr))',
    },
  },
  factStripFour: {
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.desktop]: 'repeat(4, minmax(0, 1fr))',
    },
  },
  fact: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 3 },
  factLabel: { fontSize: 11, color: QUIET },
  factValue: { display: 'flex', minWidth: 0, alignItems: 'baseline', gap: 8, margin: 0 },
  factWord: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13.5,
    fontVariantNumeric: 'tabular-nums',
  },
  // ---- definition rows -------------------------------------------------
  defLine: {
    display: 'grid',
    gridTemplateColumns: '6rem minmax(0, 1fr)',
    columnGap: 12,
    alignItems: 'baseline',
    paddingInline: 16,
    paddingBlock: 9,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  defList: { display: 'flex', flexDirection: 'column', margin: 0 },
  defLabel: { fontSize: 12, color: tokens.mutedForeground },
  defValue: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 8,
    margin: 0,
    fontSize: 13,
  },
  // ---- tables ----------------------------------------------------------
  tableHead: {
    display: { default: 'grid', [breakpoints.phone]: 'none' },
    flexShrink: 0,
    columnGap: 16,
    alignItems: 'center',
    height: 32,
    paddingInline: 16,
    backgroundColor: tokens.surfaceInset,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  columns: (template: string) => ({
    gridTemplateColumns: { default: template, [breakpoints.phone]: 'none' },
  }),
  row: {
    // a table across; on a phone, a name on its own line and the facts
    // under it, which is how a row that cannot fit is still one row
    display: { default: 'grid', [breakpoints.phone]: 'flex' },
    flexWrap: { default: null, [breakpoints.phone]: 'wrap' },
    columnGap: { default: 16, [breakpoints.phone]: 12 },
    rowGap: { default: null, [breakpoints.phone]: 3 },
    alignItems: 'center',
    width: '100%',
    minWidth: 0,
    minHeight: 44,
    paddingInline: 16,
    paddingBlock: { default: 0, [breakpoints.phone]: 10 },
    margin: 0,
    borderWidth: 0,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
  },
  rowCompact: { minHeight: 42 },
  rowTight: { minHeight: 40 },
  rowLive: {
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
  },
  rowSelected: {
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted },
  },
  cell: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  cellLead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13.5,
    color: tokens.foreground,
    flexBasis: { default: null, [breakpoints.phone]: '100%' },
  },
  cellLeadWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  cellStrong: { fontWeight: 600 },
  cellPlain: { color: tokens.foreground },
  cellQuiet: { color: QUIET },
  cellWarn: { color: tokens.warningForeground },
  cellNumeric: { fontVariantNumeric: 'tabular-nums' },
  cellMono: { fontFamily: MONO, fontSize: 12 },
  cellEnd: { textAlign: { default: 'right', [breakpoints.phone]: 'start' } },
  chevron: {
    display: { default: 'inline-flex', [breakpoints.phone]: 'none' },
    justifySelf: 'end',
    color: QUIET,
  },
  chevronGlyph: { width: 13, height: 13 },
  // ---- states and tags -------------------------------------------------
  status: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  statusWord: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  statusWarn: { color: tokens.warningForeground },
  statusBad: { color: tokens.danger },
  dot: { width: 6, height: 6, flexShrink: 0, borderRadius: '9999px' },
  dotOk: { backgroundColor: tokens.success },
  dotWarn: { backgroundColor: tokens.warning },
  dotBad: { backgroundColor: tokens.danger },
  tag: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 20,
    paddingInline: 7,
    borderRadius: 5,
    backgroundColor: tokens.surfaceMuted,
    fontSize: 11,
    fontWeight: 400,
    whiteSpace: 'nowrap',
    color: tokens.surfaceMutedForeground,
  },
  tagOutline: {
    backgroundColor: 'transparent',
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    color: tokens.mutedForeground,
  },
  // ---- tick cells ------------------------------------------------------
  tickGrid: { display: 'grid', minWidth: 0, gap: 2, paddingInline: 12, paddingBlock: 10 },
  tickGridFlush: { paddingInline: 0, paddingBlock: 0 },
  tickOne: { gridTemplateColumns: 'minmax(0, 1fr)' },
  tickTwo: {
    columnGap: 10,
    gridTemplateColumns: {
      default: 'repeat(2, minmax(0, 1fr))',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
  },
  tickThree: {
    columnGap: 12,
    gridTemplateColumns: {
      default: 'repeat(3, minmax(0, 1fr))',
      [breakpoints.phone]: 'minmax(0, 1fr)',
      [breakpoints.tablet]: 'repeat(2, minmax(0, 1fr))',
    },
  },
  tick: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    minHeight: 30,
    paddingInline: 10,
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 400,
    userSelect: 'none',
    transitionProperty: 'background-color',
    transitionDuration: '120ms',
  },
  tickTall: { alignItems: 'flex-start', paddingInline: 8, paddingBlock: 6 },
  tickLive: {
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
  },
  tickOn: { backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted } },
  tickStill: { cursor: 'default', opacity: 0.7 },
  tickBoxSeat: { display: 'inline-flex', flexShrink: 0 },
  tickBoxLowered: { marginTop: 2 },
  tickWords: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 1 },
  tickName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tickNote: { fontSize: 11.5, lineHeight: 1.45, color: QUIET, textWrap: 'pretty' },
  tickTally: { flexShrink: 0, fontSize: 11, fontVariantNumeric: 'tabular-nums', color: QUIET },
  // ---- a row of words with a rule between them -------------------------
  metaLine: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 2,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: QUIET,
  },
  metaItem: { display: 'contents' },
  metaRule: {
    width: 1,
    height: 10,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
  },
})

/** one white panel; everything readable on an administration screen sits in one */
export function Card({
  xstyle,
  ...props
}: Omit<ComponentProps<'section'>, 'className' | 'style'> & { xstyle?: StyleXStyles }) {
  return <section {...props} {...stylex.props(styles.card, xstyle)} />
}

/** what the card is, what it rules or counts, and what can be done to all of it */
export function CardHead({
  title,
  note,
  sub,
  children,
}: {
  title: ReactNode
  /** said quietly beside the title: a rule, a count */
  note?: ReactNode
  /** said under the title instead, where the title is a name and this is its scope */
  sub?: ReactNode
  /** controls at the far end */
  children?: ReactNode
}) {
  return (
    <div {...stylex.props(styles.cardHead)}>
      {sub === undefined ? (
        <h2 {...stylex.props(styles.cardTitle)}>{title}</h2>
      ) : (
        <span {...stylex.props(styles.cardTitleStack)}>
          <h2 {...stylex.props(styles.cardTitle)}>{title}</h2>
          <span {...stylex.props(styles.cardSub)}>{sub}</span>
        </span>
      )}
      {note !== undefined && <span {...stylex.props(styles.cardNote)}>{note}</span>}
      <span {...stylex.props(styles.spacer)} />
      {children}
    </div>
  )
}

/** the small print under a card's content: what a control means, where else it is set */
export function CardHint({ children, top = false }: { children: ReactNode; top?: boolean }) {
  return <p {...stylex.props(styles.cardHint, top && styles.cardHintTop)}>{children}</p>
}

/** what a card says when it has nothing to list */
export function CardEmpty({ children }: { children: ReactNode }) {
  return <p {...stylex.props(styles.cardEmpty)}>{children}</p>
}

/** the strip a card ends on: a count and a way to more, or what is unsaved and the way to save it */
export function CardFoot({ children, inset = false }: { children: ReactNode; inset?: boolean }) {
  return <div {...stylex.props(styles.cardFoot, inset && styles.cardFootInset)}>{children}</div>
}

/** pushes what follows to the far end of a head or a foot */
export function Spacer() {
  return <span {...stylex.props(styles.spacer)} />
}

/**
 * What is true of the open thing, on one strip: a small grey word over the
 * fact it names, and beside the fact - where there is one - the way to change
 * it. The way on belongs there rather than in a toolbar: "change type" means
 * nothing until the type it would change is in front of you.
 */
export function FactStrip({
  items,
  columns = 5,
  testId,
}: {
  items: readonly { label: string; value: ReactNode; action?: ReactNode }[]
  columns?: 4 | 5
  testId?: string
}) {
  return (
    <Card>
      <dl {...stylex.props(styles.factStrip, columns === 4 && styles.factStripFour)} data-testid={testId}>
        {items.map((item) => (
          <div key={item.label} {...stylex.props(styles.fact)}>
            <dt {...stylex.props(styles.factLabel)}>{item.label}</dt>
            <dd {...stylex.props(styles.factValue)}>
              <span {...stylex.props(styles.factWord)}>{item.value}</span>
              {item.action}
            </dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

/** the list definition lines sit in */
export function DefList({ children }: { children: ReactNode }) {
  return <dl {...stylex.props(styles.defList)}>{children}</dl>
}

/** a label and what it says, one per line of a card */
export function DefLine({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div {...stylex.props(styles.defLine)}>
      <dt {...stylex.props(styles.defLabel)}>{label}</dt>
      <dd {...stylex.props(styles.defValue)}>{children}</dd>
    </div>
  )
}

const TableColumns = createContext<{ template: string; openable: boolean }>({
  template: 'minmax(0, 1fr)',
  openable: false,
})

/**
 * A table drawn as a grid, so that a row can be one pressable thing.
 *
 * `columns` is the grid template without the way-in column; a table whose
 * rows open something says so, and every row and the head get the same
 * narrow last column for the chevron.
 */
export function Table({
  columns,
  openable = false,
  children,
}: {
  columns: string
  openable?: boolean
  children: ReactNode
}) {
  const template = openable ? `${columns} 1.25rem` : columns
  return <TableColumns value={{ template, openable }}>{children}</TableColumns>
}

export function TableHead({ children }: { children: ReactNode }) {
  const { template, openable } = useContext(TableColumns)
  return (
    <div {...stylex.props(styles.tableHead, styles.columns(template))}>
      {children}
      {openable && <span />}
    </div>
  )
}

export function TableRow({
  onOpen,
  selected = false,
  height = 'regular',
  children,
  xstyle,
  ...rest
}: {
  onOpen?: (() => void) | undefined
  selected?: boolean
  height?: 'regular' | 'compact' | 'tight'
  children: ReactNode
  xstyle?: StyleXStyles
} & Omit<ComponentProps<'button'>, 'className' | 'style' | 'onClick' | 'type' | 'children'>) {
  const { template, openable } = useContext(TableColumns)
  const look = stylex.props(
    styles.row,
    styles.columns(template),
    height === 'compact' && styles.rowCompact,
    height === 'tight' && styles.rowTight,
    onOpen !== undefined && styles.rowLive,
    selected && styles.rowSelected,
    xstyle,
  )
  const body = (
    <>
      {children}
      {openable && (
        <span aria-hidden {...stylex.props(styles.chevron)}>
          <ChevronRightIcon {...stylex.props(styles.chevronGlyph)} />
        </span>
      )}
    </>
  )
  if (onOpen === undefined) {
    const { disabled: _disabled, ...divProps } = rest as Record<string, unknown>
    return (
      <div {...(divProps as ComponentProps<'div'>)} {...look} data-selected={selected}>
        {body}
      </div>
    )
  }
  return (
    <button type="button" {...rest} {...look} aria-current={selected || undefined} data-selected={selected} onClick={onOpen}>
      {body}
    </button>
  )
}

/**
 * One cell. The first of a row is its name and is said in full weight; the
 * rest are facts about it and are said quietly, so the eye finds the row by
 * its name and reads across only when it wants to.
 */
export function Cell({
  lead = false,
  strong = false,
  tone = 'muted',
  numeric = false,
  mono = false,
  end = false,
  title,
  children,
}: {
  lead?: boolean
  /** the row is the one open */
  strong?: boolean
  tone?: 'muted' | 'plain' | 'quiet' | 'warn'
  numeric?: boolean
  mono?: boolean
  end?: boolean
  title?: string | undefined
  children?: ReactNode
}) {
  if (lead) {
    return (
      <span {...stylex.props(styles.cell, styles.cellLead, strong && styles.cellStrong)} title={title}>
        {children}
      </span>
    )
  }
  return (
    <span
      {...stylex.props(
        styles.cell,
        tone === 'plain' && styles.cellPlain,
        tone === 'quiet' && styles.cellQuiet,
        tone === 'warn' && styles.cellWarn,
        numeric && styles.cellNumeric,
        mono && styles.cellMono,
        end && styles.cellEnd,
      )}
      title={title}
    >
      {children}
    </span>
  )
}

/** the words of a lead cell, which give way before the tags beside them do */
export function LeadWord({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.cellLeadWord)}>{children}</span>
}

/**
 * A state, as a word with a dot before it.
 *
 * Nothing is marked while nothing is wrong: `plain` is the word alone, so a
 * column of "enabled" stays quiet and the one "disabled" in it is what is
 * seen. Amber is for what wants attention, red for what is off or failed.
 */
export function Status({
  tone = 'plain',
  children,
  ...rest
}: {
  tone?: 'plain' | 'ok' | 'warn' | 'bad'
  children: ReactNode
} & Omit<ComponentProps<'span'>, 'className' | 'style' | 'children'>) {
  return (
    <span
      {...rest}
      data-tone={tone}
      {...stylex.props(styles.status, tone === 'warn' && styles.statusWarn, tone === 'bad' && styles.statusBad)}
    >
      {tone !== 'plain' && (
        <span
          aria-hidden
          {...stylex.props(
            styles.dot,
            tone === 'ok' && styles.dotOk,
            tone === 'warn' && styles.dotWarn,
            tone === 'bad' && styles.dotBad,
          )}
        />
      )}
      <span {...stylex.props(styles.statusWord)}>{children}</span>
    </span>
  )
}

/** a small word in a box: a kind, a provenance - never a state, which is a dot */
export function Tag({ outline = false, children }: { outline?: boolean; children: ReactNode }) {
  return <span {...stylex.props(styles.tag, outline && styles.tagOutline)}>{children}</span>
}

/** a few quiet words with a hairline between them, under a name */
export function MetaLine({ items }: { items: readonly ReactNode[] }) {
  const said = items.filter((item) => item !== null && item !== undefined && item !== '')
  return (
    <span {...stylex.props(styles.metaLine)}>
      {said.map((item, index) => (
        // eslint-disable-next-line react/no-array-index-key
        <span key={index} {...stylex.props(styles.metaItem)}>
          {index > 0 && <span aria-hidden {...stylex.props(styles.metaRule)} />}
          <span>{item}</span>
        </span>
      ))}
    </span>
  )
}

/** the grid tick cells sit in */
export function TickGrid({
  columns = 2,
  flush = false,
  label,
  children,
}: {
  columns?: 1 | 2 | 3
  /** inside something that already has its own padding */
  flush?: boolean
  /** spoken name of the group */
  label: string
  children: ReactNode
}) {
  return (
    <div
      role="group"
      aria-label={label}
      {...stylex.props(
        styles.tickGrid,
        flush && styles.tickGridFlush,
        columns === 1 && styles.tickOne,
        columns === 2 && styles.tickTwo,
        columns === 3 && styles.tickThree,
      )}
    >
      {children}
    </div>
  )
}

/**
 * One thing that is in or out: a tick box, its name, and at the far end how
 * much hangs on it. What is in is tinted, so the shape of the whole choice
 * can be read without reading the boxes.
 */
export function Tick({
  checked,
  onChange,
  disabled = false,
  label,
  note,
  tally,
  ...rest
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  label: string
  /** what it means, under the name */
  note?: ReactNode
  tally?: ReactNode
} & Omit<ComponentProps<'label'>, 'className' | 'style' | 'onChange' | 'children'>) {
  const tall = note !== undefined
  return (
    <label
      {...rest}
      data-picked={checked}
      {...stylex.props(
        styles.tick,
        tall && styles.tickTall,
        disabled ? styles.tickStill : styles.tickLive,
        checked && styles.tickOn,
      )}
    >
      <span {...stylex.props(styles.tickBoxSeat, tall && styles.tickBoxLowered)}>
        <Checkbox checked={checked} disabled={disabled} onCheckedChange={(next) => onChange(next === true)} />
      </span>
      <span {...stylex.props(styles.tickWords)}>
        <span {...stylex.props(styles.tickName)}>{label}</span>
        {note !== undefined && <span {...stylex.props(styles.tickNote)}>{note}</span>}
      </span>
      <span {...stylex.props(styles.spacer)} />
      {tally !== undefined && <span {...stylex.props(styles.tickTally)}>{tally}</span>}
    </label>
  )
}
