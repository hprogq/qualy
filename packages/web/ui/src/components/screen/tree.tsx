import type { ReactNode } from 'react'
import { ChevronDownIcon, ChevronRightIcon, LockIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'

// One unit in a tree of units: a twistie and a name, which answer different
// questions.
//
// They used to be one button that did both, and pressing a branch to read it
// folded the branch away instead - the one thing the reader was certainly
// not asking for. So the twistie owns folding and the name owns opening.
// Opening may unfold, and never folds: nothing the reader can see is taken
// away by choosing something, and a branch they deliberately shut stays shut
// until they press the twistie again.
//
// What kind of unit it is and how many stand in it sit at the far end in two
// columns that line up down the tree, so the shape of the place can be read
// without opening any of it. Neither column gives way: a tree whose kinds come
// and go with the length of the name beside them cannot be read down. Room
// for a long name comes from a small indent and from the column itself, which
// the reader can widen; the whole name stays on the row's title either way.

/** how far each level steps in; small, because a real tree is five or six deep */
const INDENT = 12

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`

const styles = stylex.create({
  // the seat both controls sit in; it carries the hover and the open tint so
  // a pointer anywhere along the line lights the whole line
  row: {
    display: 'flex',
    height: 32,
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
    borderRadius: 8,
    paddingLeft: 4,
    paddingRight: 10,
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  rowOpen: { backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted } },
  // sized for a pointer rather than for the glyph it draws
  twistie: {
    display: 'flex',
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  twistieSeat: { width: 20, height: 20, flexShrink: 0 },
  glyph: { width: 13, height: 13, flexShrink: 0 },
  name: {
    display: 'flex',
    height: '100%',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'center',
    gap: 8,
    padding: 0,
    paddingLeft: 4,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
    overflow: 'hidden',
  },
  word: {
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13.5,
    lineHeight: '1.25rem',
  },
  wordOpen: { fontWeight: 600 },
  lock: { width: 12, height: 12, flexShrink: 0, color: tokens.mutedForeground },
  spacer: { flexGrow: 1, flexShrink: 1, flexBasis: '0%', minWidth: 4 },
  kind: { flexShrink: 0, whiteSpace: 'nowrap', fontSize: 11, color: QUIET },
  tally: {
    flexShrink: 0,
    minWidth: '2.25rem',
    textAlign: 'right',
    fontSize: 11,
    fontVariantNumeric: 'tabular-nums',
    color: QUIET,
  },
})

export function TreeRow({
  name,
  depth,
  open,
  kind,
  tally,
  locked = false,
  expandable = false,
  collapsed = false,
  expandLabel,
  onToggle,
  onOpen,
}: {
  name: string
  depth: number
  /** this is the unit on show */
  open: boolean
  /** what kind of unit it is */
  kind?: string | undefined
  /** how many stand in it; nothing is drawn for none */
  tally?: ReactNode
  /** the reader may look and not change */
  locked?: boolean
  expandable?: boolean
  collapsed?: boolean
  /** spoken name of the twistie, before the unit's own name */
  expandLabel: string
  onToggle?: (() => void) | undefined
  onOpen: () => void
}) {
  const folds = expandable && onToggle !== undefined
  return (
    <div {...stylex.props(styles.row, open && styles.rowOpen)}>
      {/* the indent belongs to the row, not to a control: the deeper the unit,
          the wider the strip in front of it that must not look pressable */}
      <span aria-hidden style={{ width: depth * INDENT, flexShrink: 0 }} />
      {folds ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${expandLabel} ${name}`}
          {...stylex.props(styles.twistie)}
          onClick={onToggle}
        >
          {collapsed ? (
            <ChevronRightIcon aria-hidden {...stylex.props(styles.glyph)} />
          ) : (
            <ChevronDownIcon aria-hidden {...stylex.props(styles.glyph)} />
          )}
        </button>
      ) : (
        <span aria-hidden {...stylex.props(styles.twistieSeat)} />
      )}
      <button
        type="button"
        aria-current={open}
        data-node-name={name}
        title={kind !== undefined && kind !== '' ? `${name} ${kind}` : name}
        onClick={() => {
          if (folds && collapsed) onToggle()
          onOpen()
        }}
        {...stylex.props(styles.name)}
      >
        <span {...stylex.props(styles.word, open && styles.wordOpen)}>{name}</span>
        {locked && <LockIcon aria-hidden {...stylex.props(styles.lock)} />}
        <span {...stylex.props(styles.spacer)} />
        {kind !== undefined && kind !== '' && <span {...stylex.props(styles.kind)}>{kind}</span>}
        <span {...stylex.props(styles.tally)} data-tally>
          {tally}
        </span>
      </button>
    </div>
  )
}
