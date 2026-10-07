import { useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { EllipsisIcon } from 'lucide-react'
import { Button } from '@qualy/ui/button'
import { Collapsible, CollapsibleContent } from '@qualy/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { Card, CardEmpty, CardHead, SearchField, TreeRow } from '@qualy/ui/screen'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import * as m from '#messages'

// This batch's visible units, rather than the current directory. A parent
// outside the reader's reach is absent, so its visible children begin here.
interface Unit {
  readonly id: string
  readonly name: string
  readonly parentId: string | null
}

const styles = stylex.create({
  card: { minHeight: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  bare: { display: 'flex', minHeight: 0, flexGrow: 1, flexDirection: 'column' },
  tools: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    paddingInline: 12,
    paddingBlock: 10,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  toolsBare: { paddingInline: 0, paddingTop: 0 },
  search: { width: '100%', minWidth: 0, flexGrow: 1 },
  list: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    padding: 6,
  },
  listBare: { paddingInline: 0 },
  loading: { display: 'flex', flexDirection: 'column', gap: 16, padding: 10 },
})

export function RosterUnitTree({
  units,
  selected,
  scope,
  loading,
  bare,
  onSelect,
  onScope,
}: {
  units: readonly Unit[]
  selected: string
  scope: 'self' | 'subtree'
  loading: boolean
  bare: boolean
  onSelect: (unit: string) => void
  onScope: (scope: 'self' | 'subtree') => void
}) {
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const term = search.trim().toLowerCase()
  const { tops, children } = useMemo(() => {
    const known = new Set(units.map((unit) => unit.id))
    const tops: Unit[] = []
    const children = new Map<string, Unit[]>()
    for (const unit of units) {
      if (unit.parentId === null || !known.has(unit.parentId)) tops.push(unit)
      else children.set(unit.parentId, [...(children.get(unit.parentId) ?? []), unit])
    }
    return { tops, children }
  }, [units])
  const matches = units.filter((unit) => unit.name.toLowerCase().includes(term))
  const row = (unit: Unit, depth: number) => (
    <TreeRow
      key={unit.id}
      name={unit.name}
      depth={depth}
      found={term}
      open={selected === unit.id}
      expandable={term === '' && children.has(unit.id)}
      collapsed={collapsed.has(unit.id)}
      expandLabel={m.roster_unitsFold()}
      onToggle={() => {
        const next = new Set(collapsed)
        if (!next.delete(unit.id)) next.add(unit.id)
        setCollapsed(next)
      }}
      onOpen={() => onSelect(selected === unit.id ? '' : unit.id)}
    />
  )
  const branch = (unit: Unit, depth: number): React.ReactNode => {
    const descendants = children.get(unit.id)
    if (descendants === undefined) return row(unit, depth)
    const open = !collapsed.has(unit.id)
    return (
      <Collapsible key={unit.id} open={open}>
        {row(unit, depth)}
        <CollapsibleContent>
          <div inert={!open}>{descendants.map((child) => branch(child, depth + 1))}</div>
        </CollapsibleContent>
      </Collapsible>
    )
  }
  const menu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={m.roster_unitsMenu()}>
          <EllipsisIcon aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{m.roster_unitsScope()}</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={scope}
          onValueChange={(value) => onScope(value === 'self' ? 'self' : 'subtree')}
        >
          <DropdownMenuRadioItem value="subtree" data-testid="roster-scope-subtree">
            {m.roster_unitsSubtree()}
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="self" data-testid="roster-scope-self">
            {m.roster_unitsSelf()}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setCollapsed(new Set())}>
          {m.roster_unitsExpandAll()}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setCollapsed(new Set(children.keys()))}>
          {m.roster_unitsCollapseAll()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const content = (
    <>
      {!bare && (
        <CardHead
          title={m.roster_units()}
          note={(scope === 'self' ? m.roster_unitsSelf : m.roster_unitsSubtree)()}
        >
          {menu}
        </CardHead>
      )}
      <div {...stylex.props(styles.tools, bare && styles.toolsBare)}>
        <SearchField
          name="roster-unit-search"
          value={search}
          onChange={setSearch}
          label={m.roster_unitsSearch()}
          xstyle={styles.search}
        />
        {bare && menu}
      </div>
      <div data-testid="roster-unit-scroll" {...stylex.props(styles.list, bare && styles.listBare)}>
        {loading ? (
          <div aria-hidden {...stylex.props(styles.loading)}>
            {['72%', '60%', '80%', '56%'].map((width) => (
              <Skeleton key={width} width={width} height={14} />
            ))}
          </div>
        ) : (
          <>
            {term === '' && (
              <TreeRow
                name={m.roster_unitsAll()}
                depth={0}
                open={selected === ''}
                expandLabel={m.roster_unitsFold()}
                onOpen={() => onSelect('')}
              />
            )}
            {term === ''
              ? tops.map((unit) => branch(unit, 0))
              : matches.map((unit) => row(unit, 0))}
            {matches.length === 0 && <CardEmpty>{m.roster_unitsEmpty()}</CardEmpty>}
          </>
        )}
      </div>
    </>
  )
  return bare ? (
    <div data-testid="roster-unit-tree" data-scope={scope} {...stylex.props(styles.bare)}>
      {content}
    </div>
  ) : (
    <Card data-testid="roster-unit-tree" data-scope={scope} xstyle={styles.card}>
      {content}
    </Card>
  )
}
