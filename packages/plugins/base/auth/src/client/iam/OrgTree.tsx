import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'

// The organization as somebody browsing it sees it: a tree of names.
//
// Nothing here selects anybody. It answers "where am I looking", and the
// pickers beside it answer what that means - a list of the people standing
// there, or a unit added to an import. Kept separate for that reason: the
// same tree serves both, and will serve the organization screen itself.

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
export const shapeOf = (nodes: readonly OrgTreeNode[]): Shape => {
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
  className,
}: {
  nodes: readonly OrgTreeNode[]
  emptyLabel: string
  expandLabel: string
  selected?: string | null
  onSelect: (node: OrgTreeNode) => void
  marked?: ReadonlySet<string>
  meta?: (node: OrgTreeNode) => ReactNode
  flat?: boolean
  className?: string
}) {
  const shape = shapeOf(nodes)
  if (nodes.length === 0) {
    return <p className="p-2 text-sm text-muted-foreground">{emptyLabel}</p>
  }
  if (flat === true) {
    return (
      <ul className={cn('flex flex-col gap-0.5', className)}>
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
    <ul className={cn('flex flex-col gap-0.5', className)}>
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

/** the pressable part of a row: the whole width of it, indent included */
function Name({
  node,
  depth,
  selected,
  onSelect,
  marked,
  meta,
}: {
  node: OrgTreeNode
  depth: number
  selected: string | null
  onSelect: (node: OrgTreeNode) => void
  marked?: ReadonlySet<string>
  meta?: (node: OrgTreeNode) => ReactNode
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-2 rounded-md py-1.5 pr-2 text-left text-sm outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
        selected === node.id && 'bg-accent',
        marked?.has(node.id) === true && 'font-medium',
      )}
      style={{ paddingLeft: `${String(depth * 0.75 + 1.75)}rem` }}
      onClick={() => onSelect(node)}
    >
      <span className="min-w-0 truncate">{node.name}</span>
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

  // The row is one button, with the indentation inside it, and the chevron
  // sits on top of its left edge. Laying them out side by side left the
  // indentation belonging to the container, so the further down the tree a
  // node was, the wider the strip in front of its name that looked pressable
  // and was not.
  const indent = depth * 0.75

  return (
    <li>
      <div className="relative">
        <Name
          node={node}
          depth={depth}
          selected={selected}
          onSelect={onSelect}
          marked={marked}
          {...(meta !== undefined ? { meta } : {})}
        />
        {children.length > 0 && (
          <Button
            size="icon"
            variant="ghost"
            className="absolute top-1/2 size-6 -translate-y-1/2 text-muted-foreground"
            style={{ left: `${String(indent)}rem` }}
            aria-label={expandLabel}
            aria-expanded={open}
            onClick={() => setOpen((was) => !was)}
          >
            <ChevronRightIcon
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            />
          </Button>
        )}
      </div>
      {open && children.length > 0 && (
        <ul className="flex flex-col gap-0.5">
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
