import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { clsx } from 'clsx'
import * as stylex from '@stylexjs/stylex'
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
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>
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
  const children = shape.childrenOf.get(node.id) ?? []
  const checked = coverOf(shape, selection, node) !== undefined
  const indeterminate = !checked && hasSelectedDescendant(shape, selection, node)

  const row = (trigger: boolean) => (
    <div className="flex items-center gap-1">
      {trigger ? (
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="group">
            <ChevronRightIcon
              aria-hidden
              className="transition-transform group-data-[state=open]:rotate-90"
            />
          </Button>
        </CollapsibleTrigger>
      ) : (
        <span aria-hidden className="size-8 shrink-0" />
      )}
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap hover:bg-muted/50">
        <Checkbox
          checked={indeterminate ? 'indeterminate' : checked}
          onCheckedChange={() => onToggle(node)}
        />
        <span>{node.name}</span>
        {meta?.(node)}
        {/* the row still fills its width, but the mark stays next to the name
            rather than being pushed to the far edge away from what it marks */}
        <span className="flex-1" />
      </label>
    </div>
  )

  if (children.length === 0) return <li>{row(false)}</li>
  return (
    <li>
      <Collapsible defaultOpen>
        {row(true)}
        <CollapsibleContent>
          {/* the line ends with the group it belongs to; run to the bottom of
              the box it reads as a rule under an empty half */}
          <ul className="ml-3 flex flex-col gap-0.5 border-l pl-3">
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
