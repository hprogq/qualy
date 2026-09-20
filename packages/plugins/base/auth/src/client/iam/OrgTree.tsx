import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import type { StyleXStyles } from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// The organization as somebody browsing it sees it: a tree of names.
//
// Nothing here selects anybody. It answers "where am I looking", and the
// pickers beside it answer what that means - a list of the people standing
// there, or a unit added to an import. Kept separate for that reason: the
// same tree serves both, and will serve the organization screen itself.

const styles = stylex.create({
  emptyNote: {
    padding: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  list: {
    display: 'flex',
    width: 'max-content',
    minWidth: '100%',
    flexDirection: 'column',
    gap: 2,
  },
  branch: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  // The row is the seat; the two controls inside it are what answer. It
  // carries the hover and the current tint so that a pointer anywhere along
  // it lights the whole line, the way a single button used to.
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    borderRadius: tokens.radiusMd,
    whiteSpace: 'nowrap',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  rowCurrent: {
    backgroundColor: {
      default: tokens.surfaceMuted,
      ':hover': tokens.surfaceMuted,
    },
  },
  // no truncation: five levels in, a truncated name is an ellipsis and
  // nothing else. The box scrolls sideways instead, which at least
  // leaves the name readable by moving to it.
  nameButton: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'center',
    gap: 6,
    borderRadius: tokens.radiusMd,
    paddingBlock: 6,
    paddingRight: 8,
    textAlign: 'left',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    whiteSpace: 'nowrap',
    outline: 'none',
    boxShadow: {
      default: 'none',
      ':focus-visible': `0 0 0 2px ${tokens.focusRing}`,
    },
  },
  rowMarked: {
    fontWeight: 500,
  },
  // a place that may not be chosen: no hover, and said in a lighter voice
  rowOff: { backgroundColor: { default: 'transparent', ':hover': 'transparent' } },
  nameOff: {
    cursor: 'not-allowed',
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  radio: {
    display: 'inline-flex',
    width: 15,
    height: 15,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 9999,
    boxShadow: `inset 0 0 0 1.5px color-mix(in oklab, ${tokens.foreground} 45%, transparent)`,
    backgroundColor: tokens.surface,
  },
  radioOn: { boxShadow: `inset 0 0 0 1.5px ${tokens.foreground}` },
  radioOff: {
    boxShadow: `inset 0 0 0 1.5px ${tokens.border}`,
    backgroundColor: tokens.surfaceMuted,
  },
  radioDot: { width: 7, height: 7, borderRadius: 9999, backgroundColor: tokens.foreground },
  // Its own control, sized for a pointer rather than for the 14px glyph it
  // draws - and seated at the indent so that the strip in front of a deep
  // name belongs to the name, not to this.
  twistie: {
    display: 'flex',
    width: 20,
    height: 20,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radiusSm,
    color: {
      default: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
      ':hover': tokens.foreground,
    },
    backgroundColor: { default: null, ':hover': tokens.surfaceMuted },
    outline: 'none',
    boxShadow: {
      default: 'none',
      ':focus-visible': `0 0 0 2px ${tokens.focusRing}`,
    },
  },
  glyph: {
    width: 14,
    height: 14,
    transitionProperty: 'transform',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  glyphOpen: {
    transform: 'rotate(90deg)',
  },
  glyphSeat: {
    width: 20,
    height: 20,
    flexShrink: 0,
  },
})

export interface OrgTreeNode {
  id: string
  name: string
  parentId: string | null
  manageable?: boolean
}

interface Shape {
  childrenOf: ReadonlyMap<string, readonly OrgTreeNode[]>
  roots: readonly OrgTreeNode[]
}

/** a node whose parent is absent is a root here: a reader may start midway down */
const shapeOf = (nodes: readonly OrgTreeNode[]): Shape => {
  const known = new Set(nodes.map((node) => node.id))
  const childrenOf = new Map<string, OrgTreeNode[]>()
  const roots: OrgTreeNode[] = []
  for (const node of nodes) {
    if (node.parentId !== null && known.has(node.parentId)) {
      childrenOf.set(node.parentId, [...(childrenOf.get(node.parentId) ?? []), node])
    } else {
      roots.push(node)
    }
  }
  return { childrenOf, roots }
}

export function OrgTree({
  nodes,
  emptyLabel,
  expandLabel,
  selected,
  onSelect,
  /** a mark beside a node, for pickers that add whole units */
  marked,
  /** something at the end of a row - what kind of unit it is, say */
  meta,
  /**
   * One flat list instead of a tree.
   *
   * What a search or a filter leaves is a set of matches, and the branches
   * that would lead to them are not part of the answer.
   */
  flat,
  radio,
  barred,
  xstyle,
}: {
  /**
   * A radio mark in front of every row.
   *
   * For choosing where something goes out of places that mostly may not be
   * chosen: a highlighted row says which one is picked, but only a mark on
   * every row says which ones can be - and a hollow circle that will not fill
   * is the plainest way a row can say it cannot.
   */
  radio?: boolean
  /** rows that are shown and may not be chosen */
  barred?: ReadonlySet<string>
  nodes: readonly OrgTreeNode[]
  emptyLabel: string
  expandLabel: string
  selected?: string | null
  onSelect: (node: OrgTreeNode) => void
  marked?: ReadonlySet<string>
  meta?: (node: OrgTreeNode) => ReactNode
  flat?: boolean
  xstyle?: StyleXStyles
}) {
  const shape = shapeOf(nodes)
  if (nodes.length === 0) {
    return <p {...stylex.props(styles.emptyNote)}>{emptyLabel}</p>
  }
  if (flat === true) {
    return (
      <ul {...stylex.props(styles.list, xstyle)}>
        {nodes.map((node) => (
          <li key={node.id}>
            <Name
              node={node}
              depth={0}
              selected={selected ?? null}
              onSelect={onSelect}
              marked={marked}
              radio={radio === true}
              barred={barred}
              {...(meta !== undefined ? { meta } : {})}
            />
          </li>
        ))}
      </ul>
    )
  }
  return (
    <ul {...stylex.props(styles.list, xstyle)}>
      {shape.roots.map((root) => (
        <Row
          key={root.id}
          node={root}
          shape={shape}
          depth={0}
          expandLabel={expandLabel}
          selected={selected ?? null}
          onSelect={onSelect}
          marked={marked}
          radio={radio === true}
          barred={barred}
          {...(meta !== undefined ? { meta } : {})}
        />
      ))}
    </ul>
  )
}

/**
 * A row: the twistie and the name, which answer different questions.
 *
 * They used to be one button that did both, and pressing a branch to look at
 * what is under it collapsed the branch instead - the one thing the reader
 * was certainly not asking for. So the twistie owns opening and closing, and
 * the name owns choosing.
 *
 * Choosing may still open, and never closes. Nothing the reader can see is
 * taken away by picking something, and a branch they deliberately shut stays
 * shut until they press the twistie again.
 *
 * The indent belongs to the name, not to the twistie: that was the original
 * complaint against a separate control, and it is answered by where the
 * padding sits rather than by merging the two.
 */
function Name({
  node,
  depth,
  selected,
  onSelect,
  onToggle,
  marked,
  meta,
  open,
  hasChildren,
  expandLabel,
  radio = false,
  barred,
}: {
  radio?: boolean
  barred?: ReadonlySet<string> | undefined
  node: OrgTreeNode
  depth: number
  selected: string | null
  onSelect: (node: OrgTreeNode) => void
  onToggle?: () => void
  marked?: ReadonlySet<string>
  meta?: (node: OrgTreeNode) => ReactNode
  open?: boolean
  hasChildren?: boolean
  expandLabel?: string
}) {
  const off = barred?.has(node.id) === true
  return (
    <div
      {...stylex.props(styles.row, selected === node.id && styles.rowCurrent, off && styles.rowOff)}
      data-tree-row={node.id}
      data-barred={off}
    >
      <span aria-hidden style={{ width: `${String(depth * 0.75 + 0.25)}rem`, flexShrink: 0 }} />
      {hasChildren === true && onToggle !== undefined ? (
        <button
          type="button"
          aria-expanded={open === true}
          aria-label={`${expandLabel ?? ''} ${node.name}`.trim()}
          {...stylex.props(styles.twistie)}
          onClick={onToggle}
        >
          <ChevronRightIcon
            aria-hidden
            {...stylex.props(styles.glyph, open === true && styles.glyphOpen)}
          />
        </button>
      ) : (
        <span aria-hidden {...stylex.props(styles.glyphSeat)} />
      )}
      <button
        type="button"
        {...(radio
          ? { role: 'radio', 'aria-checked': selected === node.id }
          : { 'aria-current': selected === node.id })}
        aria-disabled={off || undefined}
        {...stylex.props(
          styles.nameButton,
          marked?.has(node.id) === true && styles.rowMarked,
          off && styles.nameOff,
        )}
        onClick={() => {
          if (!off) onSelect(node)
        }}
      >
        {radio && (
          <span
            aria-hidden
            {...stylex.props(
              styles.radio,
              selected === node.id && styles.radioOn,
              off && styles.radioOff,
            )}
          >
            {selected === node.id && <span {...stylex.props(styles.radioDot)} />}
          </span>
        )}
        <span>{node.name}</span>
        {meta?.(node)}
      </button>
    </div>
  )
}

function Row({
  node,
  shape,
  depth,
  expandLabel,
  selected,
  onSelect,
  marked,
  meta,
  radio,
  barred,
}: {
  radio?: boolean
  barred?: ReadonlySet<string> | undefined
  node: OrgTreeNode
  shape: Shape
  depth: number
  expandLabel: string
  selected: string | null
  onSelect: (node: OrgTreeNode) => void
  marked?: ReadonlySet<string>
  meta?: (node: OrgTreeNode) => ReactNode
}) {
  const children = shape.childrenOf.get(node.id) ?? []
  // the first two levels open, because a tree that starts closed makes the
  // reader click before it has told them anything
  const [open, setOpen] = useState(depth < 2)

  return (
    <li>
      <Name
        node={node}
        depth={depth}
        selected={selected}
        expandLabel={expandLabel}
        hasChildren={children.length > 0}
        open={open}
        onToggle={() => setOpen((was) => !was)}
        // opens, never closes: choosing a branch is a reason to see what is
        // under it, and never a reason to hide what already is
        onSelect={(picked) => {
          if (children.length > 0) setOpen(true)
          onSelect(picked)
        }}
        marked={marked}
        radio={radio === true}
        barred={barred}
        {...(meta !== undefined ? { meta } : {})}
      />
      {open && children.length > 0 && (
        <ul {...stylex.props(styles.branch)}>
          {children.map((child) => (
            <Row
              key={child.id}
              node={child}
              shape={shape}
              depth={depth + 1}
              expandLabel={expandLabel}
              selected={selected}
              onSelect={onSelect}
              marked={marked}
              radio={radio === true}
              barred={barred}
              {...(meta !== undefined ? { meta } : {})}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
