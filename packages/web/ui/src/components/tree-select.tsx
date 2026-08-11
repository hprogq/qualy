import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { cn } from '../lib/cn.ts'
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
    // at least as tall as the box it sits in, so the guide line of the last
    // open branch runs to the bottom instead of stopping short and leaving a
    // white strip under it
    <ul className={cn('flex min-h-full flex-col gap-0.5', className)}>
      {shape.roots.map((root, at) => (
        <TreeRow
          key={root.id}
          last={at === shape.roots.length - 1}
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
  last,
  onToggle,
}: {
  node: TreeSelectNode
  shape: TreeShape
  selection: ReadonlySet<string>
  meta?: (node: TreeSelectNode) => ReactNode
  /** the last row of its group, and so the one whose line reaches the floor */
  last?: boolean
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
      <label className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50">
        <Checkbox
          checked={indeterminate ? 'indeterminate' : checked}
          onCheckedChange={() => onToggle(node)}
        />
        <span className="min-w-0 truncate">{node.name}</span>
        {meta?.(node)}
        {/* the row still fills its width, but the mark stays next to the name
            rather than being pushed to the far edge away from what it marks */}
        <span className="flex-1" />
      </label>
    </div>
  )

  if (children.length === 0) return <li className={cn(last === true && 'flex-1')}>{row(false)}</li>
  return (
    <li className={cn('flex flex-col', last === true && 'min-h-0 flex-1')}>
      <Collapsible defaultOpen className="flex min-h-0 flex-1 flex-col">
        {row(true)}
        <CollapsibleContent className="flex min-h-0 flex-1 flex-col">
          <ul className="ml-3 flex min-h-full flex-1 flex-col gap-0.5 border-l pl-3">
            {children.map((child, at) => (
              <TreeRow
                key={child.id}
                node={child}
                shape={shape}
                selection={selection}
                {...(meta !== undefined ? { meta } : {})}
                last={at === children.length - 1}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
