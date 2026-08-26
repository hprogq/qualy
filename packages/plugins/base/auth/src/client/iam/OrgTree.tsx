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
  // no truncation: five levels in, a truncated name is an ellipsis and
  // nothing else. The box scrolls sideways instead, which at least
  // leaves the name readable by moving to it.
  rowButton: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 6,
    borderRadius: tokens.radiusMd,
    paddingBlock: 6,
    paddingRight: 8,
    textAlign: 'left',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    whiteSpace: 'nowrap',
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    outline: 'none',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
    boxShadow: {
      default: 'none',
      ':focus-visible': `0 0 0 2px ${tokens.focusRing}`,
    },
  },
  rowCurrent: {
    backgroundColor: {
      default: tokens.surfaceMuted,
      ':hover': tokens.surfaceMuted,
    },
  },
  rowMarked: {
    fontWeight: 500,
  },
  glyph: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
    transitionProperty: 'transform',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  glyphOpen: {
    transform: 'rotate(90deg)',
  },
  glyphSeat: {
    width: 14,
    height: 14,
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
  xstyle,
}: {
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
          {...(meta !== undefined ? { meta } : {})}
        />
      ))}
    </ul>
  )
}

/**
 * A row, which is one button from edge to edge.
 *
 * The chevron is drawn inside it rather than laid over it: a separate
 * control on top of the left end meant that the further down the tree a node
 * sat, the wider the strip in front of its name that looked pressable and
 * did something else. Pressing a row with children opens it and selects it,
 * so no part of the row is dead and none of it surprises anybody.
 */
function Name({
  node,
  depth,
  selected,
  onSelect,
  marked,
  meta,
  open,
  hasChildren,
  expandLabel,
}: {
  node: OrgTreeNode
  depth: number
  selected: string | null
  onSelect: (node: OrgTreeNode) => void
  marked?: ReadonlySet<string>
  meta?: (node: OrgTreeNode) => ReactNode
  open?: boolean
  hasChildren?: boolean
  expandLabel?: string
}) {
  return (
    <button
      type="button"
      aria-current={selected === node.id}
      {...(hasChildren === true
        ? {
            'aria-expanded': open === true,
            'aria-label': `${node.name} ${expandLabel ?? ''}`.trim(),
          }
        : {})}
      {...stylex.props(
        styles.rowButton,
        selected === node.id && styles.rowCurrent,
        marked?.has(node.id) === true && styles.rowMarked,
      )}
      style={{ paddingLeft: `${String(depth * 0.75 + 0.5)}rem` }}
      onClick={() => onSelect(node)}
    >
      {hasChildren === true ? (
        <ChevronRightIcon
          aria-hidden
          {...stylex.props(styles.glyph, open === true && styles.glyphOpen)}
        />
      ) : (
        <span aria-hidden {...stylex.props(styles.glyphSeat)} />
      )}
      <span>{node.name}</span>
      {meta?.(node)}
    </button>
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
}: {
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
        onSelect={(picked) => {
          if (children.length > 0) setOpen((was) => !was)
          onSelect(picked)
        }}
        marked={marked}
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
              {...(meta !== undefined ? { meta } : {})}
            />
          ))}
        </ul>
      )}
    </li>
  )
}
