import { useState, type ReactNode } from 'react'
import { ChevronRightIcon } from 'lucide-react'
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
      <ul className={cn('flex w-max min-w-full flex-col gap-0.5', className)}>
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
    <ul className={cn('flex w-max min-w-full flex-col gap-0.5', className)}>
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
      className={cn(
        // no truncation: five levels in, a truncated name is an ellipsis and
        // nothing else. The box scrolls sideways instead, which at least
        // leaves the name readable by moving to it.
        'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm whitespace-nowrap transition-colors outline-none hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring',
        selected === node.id && 'bg-accent',
        marked?.has(node.id) === true && 'font-medium',
      )}
      style={{ paddingLeft: `${String(depth * 0.75 + 0.5)}rem` }}
      onClick={() => onSelect(node)}
    >
      {hasChildren === true ? (
        <ChevronRightIcon
          aria-hidden
          className={cn(
            'size-3.5 shrink-0 text-muted-foreground transition-transform',
            open === true && 'rotate-90',
          )}
        />
      ) : (
        <span aria-hidden className="size-3.5 shrink-0" />
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
