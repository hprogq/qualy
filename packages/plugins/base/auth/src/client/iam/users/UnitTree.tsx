import { useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Card, CardEmpty, CardHead, SearchField, Segmented, TreeRow } from '@qualy/ui/screen'
import { iamMessages as m } from '../../i18n.ts'

// The units this reader may look into, as one card: how many there are, the
// way to search them, whether a unit means itself or everything under it,
// and the tree. Each row says what kind of unit it is and how many people
// the chosen reading of it holds.

const styles = stylex.create({
  tools: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    paddingInline: 12,
    paddingBlock: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  searchBox: { width: '100%' },
  scopeSeat: { display: 'flex', alignItems: 'center', gap: 8 },
  scroll: { maxHeight: '62vh', minHeight: 0, overflowY: 'auto', padding: 6 },
})

export interface UnitNode {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
  readonly kind: string
  /** people standing at this unit itself */
  readonly own: number
  /** and at it with everything under it */
  readonly total: number
}

export function UnitTree({
  units,
  openId,
  scope,
  onOpen,
  onScope,
}: {
  units: readonly UnitNode[]
  openId: string | null
  scope: 'self' | 'subtree'
  onOpen: (id: string) => void
  onScope: (next: 'self' | 'subtree') => void
}) {
  const { format } = useI18n()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const term = search.trim().toLowerCase()

  const { roots, childrenOf } = useMemo(() => {
    const known = new Set(units.map((unit) => unit.id))
    const under = new Map<string, UnitNode[]>()
    const tops: UnitNode[] = []
    for (const unit of units) {
      // a unit whose parent this reader cannot see is a top of what they can
      if (unit.parentId === null || !known.has(unit.parentId)) tops.push(unit)
      else under.set(unit.parentId, [...(under.get(unit.parentId) ?? []), unit])
    }
    return { roots: tops, childrenOf: under }
  }, [units])

  const rows: { unit: UnitNode; depth: number }[] = []
  const walk = (unit: UnitNode, depth: number) => {
    rows.push({ unit, depth })
    if (collapsed.has(unit.id)) return
    for (const child of childrenOf.get(unit.id) ?? []) walk(child, depth + 1)
  }
  for (const root of roots) walk(root, 0)
  const matches =
    term === '' ? null : units.filter((unit) => unit.name.toLowerCase().includes(term))

  const row = (unit: UnitNode, depth: number, folding: boolean) => {
    const people = scope === 'self' ? unit.own : unit.total
    return (
      <TreeRow
        key={unit.id}
        name={unit.name}
        depth={depth}
        open={openId === unit.id}
        kind={unit.kind}
        tally={people > 0 ? people.toLocaleString() : ''}
        expandable={folding && (childrenOf.get(unit.id) ?? []).length > 0}
        collapsed={collapsed.has(unit.id)}
        expandLabel={format(m.foldBranch)}
        onToggle={() => {
          const next = new Set(collapsed)
          if (!next.delete(unit.id)) next.add(unit.id)
          setCollapsed(next)
        }}
        onOpen={() => onOpen(unit.id)}
      />
    )
  }

  return (
    <Card data-testid="unit-tree">
      <CardHead title={format(m.unitsTitle)} note={format(m.unitsCount, { count: units.length })}>
        <Button size="xs" variant="ghost" onClick={() => setCollapsed(new Set())}>
          {format(m.expandAll)}
        </Button>
      </CardHead>
      <div {...stylex.props(styles.tools)}>
        <SearchField
          name="tree-search"
          value={search}
          onChange={setSearch}
          label={format(m.treeSearch)}
          xstyle={styles.searchBox}
        />
        <div {...stylex.props(styles.scopeSeat)}>
          <Segmented
            label={format(m.scopeLabel)}
            value={scope}
            onChange={onScope}
            options={[
              { value: 'self', label: format(m.scopeSelf) },
              { value: 'subtree', label: format(m.scopeSubtree) },
            ]}
          />
        </div>
      </div>
      <div {...stylex.props(styles.scroll)}>
        {matches !== null ? (
          matches.length === 0 ? (
            <CardEmpty>{format(m.treeSearchEmpty)}</CardEmpty>
          ) : (
            matches.map((unit) => row(unit, 0, false))
          )
        ) : rows.length === 0 ? (
          <CardEmpty>{format(m.noAnchors)}</CardEmpty>
        ) : (
          rows.map(({ unit, depth }) => row(unit, depth, true))
        )}
      </div>
    </Card>
  )
}
