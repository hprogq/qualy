import { useEffect, useState } from 'react'
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
import { FormDialog } from './admin.tsx'

// A picker over a node hierarchy whose result is a minimal non-nested set:
// ticking a node covers its whole subtree, and unticking one child of a
// covered subtree splits the cover into the siblings around it (see
// tree-selection.ts, which owns and tests that arithmetic). The tree arrives
// flat with materialized paths; all words arrive as props.

export type TreeSelectNode = TreeSelectionNode

export function TreeSelectDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  cancelLabel,
  emptyLabel,
  nodes,
  value,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (next: string[]) => void
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
  emptyLabel: string
  nodes: readonly TreeSelectNode[]
  value: readonly string[]
}) {
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set(value))
  useEffect(() => {
    if (open) setSelection(new Set(value))
  }, [open, value])

  const shape = shapeOf(nodes)

  return (
    <FormDialog
      open={open}
      title={title}
      {...(description !== undefined ? { description } : {})}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button onClick={() => onConfirm([...selection])}>{confirmLabel}</Button>
        </>
      }
    >
      {shape.roots.length === 0 ? (
        <p className="text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {shape.roots.map((root) => (
            <TreeRow
              key={root.id}
              node={root}
              shape={shape}
              selection={selection}
              onToggle={(node) => setSelection(toggleNode(shape, selection, node))}
            />
          ))}
        </ul>
      )}
    </FormDialog>
  )
}

function TreeRow({
  node,
  shape,
  selection,
  onToggle,
}: {
  node: TreeSelectNode
  shape: TreeShape
  selection: ReadonlySet<string>
  onToggle: (node: TreeSelectNode) => void
}) {
  const children = shape.childrenOf.get(node.id) ?? []
  const checked = coverOf(shape, selection, node) !== undefined
  const indeterminate = !checked && hasSelectedDescendant(shape, selection, node)

  const row = (trigger?: boolean) => (
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
      <label
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted/50',
        )}
      >
        <Checkbox
          checked={indeterminate ? 'indeterminate' : checked}
          onCheckedChange={() => onToggle(node)}
        />
        <span className="truncate">{node.name}</span>
      </label>
    </div>
  )

  if (children.length === 0) return <li>{row(false)}</li>
  return (
    <li>
      <Collapsible defaultOpen>
        {row(true)}
        <CollapsibleContent>
          <ul className="ml-3 flex flex-col gap-0.5 border-l pl-3">
            {children.map((child) => (
              <TreeRow
                key={child.id}
                node={child}
                shape={shape}
                selection={selection}
                onToggle={onToggle}
              />
            ))}
          </ul>
        </CollapsibleContent>
      </Collapsible>
    </li>
  )
}
