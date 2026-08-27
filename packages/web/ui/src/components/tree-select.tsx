import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { clsx } from 'clsx'
import * as stylex from '@stylexjs/stylex'

import { tokens } from '../theme/tokens.stylex.ts'
import {
  coverOf,
  hasSelectedDescendant,
  shapeOf,
  toggleNode,
  type TreeSelectionNode,
  type TreeShape,
} from '../lib/tree-selection.ts'
import { Button } from './button.tsx'
import { Checkbox } from './checkbox.tsx'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './collapsible.tsx'

// A picker over a node hierarchy whose result is a minimal non-nested set:
// ticking a node covers its whole subtree, and unticking one child of a
// covered subtree splits the cover into the siblings around it (see
// tree-selection.ts, which owns and tests that arithmetic). The tree arrives
// flat, each node naming its parent; all words arrive as props.

export type TreeSelectNode = TreeSelectionNode

const styles = stylex.create({
  empty: {
    fontSize: 14,
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  // the chevron turns with the branch it opens
  chevron: {
    transitionProperty: 'transform',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  chevronOpen: {
    transform: 'rotate(90deg)',
  },
  label: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
    gap: 8,
    borderRadius: tokens.radiusMd,
    paddingInline: 8,
    paddingBlock: 6,
    fontSize: 14,
    lineHeight: '1.25rem',
    whiteSpace: 'nowrap',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  // the row still fills its width, but the mark stays next to the name rather
  // than being pushed to the far edge away from what it marks
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  branch: {
    marginLeft: 12,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    borderLeftWidth: 1,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
    paddingLeft: 12,
  },
  gutter: {
    width: 32,
    height: 32,
    flexShrink: 0,
  },
  list: {
    display: 'flex',
    width: 'max-content',
    minWidth: '100%',
    flexDirection: 'column',
    gap: 2,
  },
})

export function TreeSelect({
  value,
  onChange,
  nodes,
  emptyLabel,
  meta,
  className,
}: {
  value: readonly string[]
  onChange: (next: string[]) => void
  nodes: readonly TreeSelectNode[]
  emptyLabel: string
  /** something to show at the end of a row - what kind of thing it is, say */
  meta?: (node: TreeSelectNode) => ReactNode
  className?: string
}) {
  const shape = shapeOf(nodes)
  const selection = new Set(value)
  if (shape.roots.length === 0) {
    return <p {...stylex.props(styles.empty)}>{emptyLabel}</p>
  }
  return (
    // wider than its box when the tree is deep, so the box scrolls sideways
    // rather than truncating every name to an ellipsis
    <ul className={clsx(stylex.props(styles.list).className, className)}>
      {shape.roots.map((root) => (
        <TreeRow
          key={root.id}
          node={root}
          shape={shape}
          selection={selection}
          {...(meta !== undefined ? { meta } : {})}
          onToggle={(node) => onChange([...toggleNode(shape, selection, node)])}
        />
      ))}
    </ul>
  )
}

function TreeRow({
  node,
  shape,
  selection,
  meta,
  onToggle,
}: {
  node: TreeSelectNode
  shape: TreeShape
  selection: ReadonlySet<string>
  meta?: (node: TreeSelectNode) => ReactNode
  onToggle: (node: TreeSelectNode) => void
}) {
  const [open, setOpen] = useState(true)
  const children = shape.childrenOf.get(node.id) ?? []
  const checked = coverOf(shape, selection, node) !== undefined
  const indeterminate = !checked && hasSelectedDescendant(shape, selection, node)

  const row = (trigger: boolean) => (
    <div {...stylex.props(styles.row)}>
      {trigger ? (
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm">
            <ChevronRightIcon
              aria-hidden
              {...stylex.props(styles.chevron, open && styles.chevronOpen)}
            />
          </Button>
        </CollapsibleTrigger>
      ) : (
        <span aria-hidden {...stylex.props(styles.gutter)} />
      )}
      <label {...stylex.props(styles.label)}>
        <Checkbox
          checked={indeterminate ? 'indeterminate' : checked}
          onCheckedChange={() => onToggle(node)}
        />
        <span>{node.name}</span>
        {meta?.(node)}
        {/* the row still fills its width, but the mark stays next to the name
            rather than being pushed to the far edge away from what it marks */}
        <span {...stylex.props(styles.spacer)} />
      </label>
    </div>
  )

  if (children.length === 0) return <li>{row(false)}</li>
  return (
    <li>
      <Collapsible open={open} onOpenChange={setOpen}>
        {row(true)}
        <CollapsibleContent>
          {/* the line ends with the group it belongs to; run to the bottom of
              the box it reads as a rule under an empty half */}
          <ul {...stylex.props(styles.branch)}>
            {children.map((child) => (
              <TreeRow
                key={child.id}
                node={child}
                shape={shape}
                selection={selection}
                {...(meta !== undefined ? { meta } : {})}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
