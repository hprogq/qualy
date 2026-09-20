import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Card, CardEmpty, CardHead, SearchField, TreeRow } from '@qualy/ui/screen'
import { orgMessages as m } from '../i18n.ts'
import type { OrgShape, OrgTreeNodeDto } from '../shape.ts'

// The tree, as one card: what it holds and how much of it this reader may
// change said at its top, the way to search it under that, and the tree
// itself scrolling under a head that stays put.

const styles = stylex.create({
  searchRow: {
    flexShrink: 0,
    paddingInline: 12,
    paddingBlock: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  searchBox: { width: '100%' },
  scroll: { maxHeight: '62vh', minHeight: 0, overflowY: 'auto', padding: 6 },
})

export function NodeTree({
  shape,
  openId,
  onOpen,
  headcountOf,
}: {
  shape: OrgShape
  openId: string | null
  onOpen: (id: string) => void
  headcountOf: (orgNodeId: string) => number
}) {
  const { format } = useI18n()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const term = search.trim().toLowerCase()
  const matches =
    term === '' ? null : shape.nodes.filter((node) => node.name.toLowerCase().includes(term))
  const manageable = shape.nodes.filter((node) => node.manageable).length
  const typeName = (id: string) => shape.types.find((type) => type.id === id)?.name ?? ''

  const rows: { node: OrgTreeNodeDto; depth: number }[] = []
  const walk = (node: OrgTreeNodeDto, depth: number) => {
    rows.push({ node, depth })
    if (collapsed.has(node.id)) return
    for (const child of shape.childrenOf.get(node.id) ?? []) walk(child, depth + 1)
  }
  for (const root of shape.roots) walk(root, 0)

  const row = (node: OrgTreeNodeDto, depth: number, folding: boolean) => {
    const headcount = headcountOf(node.id)
    return (
      <TreeRow
        key={node.id}
        name={node.name}
        depth={depth}
        open={openId === node.id}
        kind={typeName(node.orgTypeId)}
        tally={headcount > 0 ? headcount.toLocaleString() : ''}
        locked={!node.manageable}
        expandable={folding && (shape.childrenOf.get(node.id) ?? []).length > 0}
        collapsed={collapsed.has(node.id)}
        expandLabel={format(m.foldBranch)}
        onToggle={() => {
          const next = new Set(collapsed)
          if (!next.delete(node.id)) next.add(node.id)
          setCollapsed(next)
        }}
        onOpen={() => onOpen(node.id)}
      />
    )
  }

  return (
    <Card data-testid="org-tree">
      <CardHead
        title={format(m.unitsTitle)}
        note={format(m.treeCounts, { total: shape.nodes.length, manageable })}
      >
        <Button size="xs" variant="ghost" onClick={() => setCollapsed(new Set())}>
          {format(m.expandAll)}
        </Button>
      </CardHead>
      <div {...stylex.props(styles.searchRow)}>
        <SearchField
          name="org-search"
          value={search}
          onChange={setSearch}
          label={format(m.searchPlaceholder)}
          xstyle={styles.searchBox}
        />
      </div>
      <div {...stylex.props(styles.scroll)}>
        {matches !== null ? (
          // what a search leaves is a set of matches, not a tree: the
          // branches that would lead to them are not part of the answer
          matches.length === 0 ? (
            <CardEmpty>{format(m.searchEmpty)}</CardEmpty>
          ) : (
            matches.map((node) => row(node, 0, false))
          )
        ) : rows.length === 0 ? (
          <CardEmpty>{format(m.treeEmpty)}</CardEmpty>
        ) : (
          rows.map(({ node, depth }) => row(node, depth, true))
        )}
      </div>
    </Card>
  )
}
