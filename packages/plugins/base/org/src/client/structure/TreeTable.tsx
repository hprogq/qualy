import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronDownIcon, ChevronRightIcon, LockIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Card, CardEmpty, CardHead, SearchField } from '@qualy/ui/screen'
import { orgMessages as m } from '../i18n.ts'
import type { OrgShape, OrgTreeNodeDto } from '../shape.ts'

// The whole structure, the whole width of the page.
//
// It used to be a narrow column beside a panel about whichever unit was open,
// and the panel had five facts and a short list to say - most of the page
// was the smaller half of it. A unit's name, its kind, who stands there and
// what is under it fit on its own row, so the tree is the page, read across
// like a table, and a unit opens beside it only when somebody asks for one.

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`
const COLUMNS = 'minmax(0, 1fr) 8rem 6rem 6rem 1.25rem'
const INDENT = 22

const styles = stylex.create({
  tools: { width: { default: '16rem', [breakpoints.phone]: '100%' } },
  head: {
    display: { default: 'grid', [breakpoints.phone]: 'none' },
    gridTemplateColumns: COLUMNS,
    alignItems: 'center',
    columnGap: 16,
    height: 32,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  end: { textAlign: 'right' },
  row: {
    display: 'grid',
    gridTemplateColumns: { default: COLUMNS, [breakpoints.phone]: 'minmax(0, 1fr) auto 1.25rem' },
    alignItems: 'center',
    columnGap: 16,
    minHeight: 40,
    paddingInline: 16,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    cursor: 'pointer',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
  },
  rowOpen: { backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted } },
  lead: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 4 },
  twistie: {
    display: 'flex',
    width: 22,
    height: 22,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  twistieSeat: { width: 22, height: 22, flexShrink: 0 },
  glyph: { width: 13, height: 13 },
  name: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13.5,
  },
  nameTop: { fontWeight: 600 },
  lock: { width: 12, height: 12, flexShrink: 0, color: tokens.mutedForeground },
  cell: {
    display: { default: 'block', [breakpoints.phone]: 'none' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12.5,
    color: tokens.mutedForeground,
  },
  figure: { textAlign: 'right', fontVariantNumeric: 'tabular-nums' },
  // the one figure a phone keeps beside the name
  figurePhone: { display: 'block' },
  none: { color: QUIET },
  way: { display: 'inline-flex', justifySelf: 'end', color: QUIET },
})

export function TreeTable({
  shape,
  openId,
  onOpen,
  headcountOf,
  headcountKnown,
}: {
  shape: OrgShape
  openId: string | null
  onOpen: (id: string) => void
  headcountOf: (orgNodeId: string) => number
  headcountKnown: boolean
}) {
  const { format } = useI18n()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const term = search.trim().toLowerCase()
  const matches =
    term === '' ? null : shape.nodes.filter((node) => node.name.toLowerCase().includes(term))
  const manageable = shape.nodes.filter((node) => node.manageable).length
  const typeName = (id: string) => shape.types.find((type) => type.id === id)?.name ?? ''
  const branches = shape.nodes.filter((node) => (shape.childrenOf.get(node.id) ?? []).length > 0)

  const rows: { node: OrgTreeNodeDto; depth: number }[] = []
  const walk = (node: OrgTreeNodeDto, depth: number) => {
    rows.push({ node, depth })
    if (collapsed.has(node.id)) return
    for (const child of shape.childrenOf.get(node.id) ?? []) walk(child, depth + 1)
  }
  for (const root of shape.roots) walk(root, 0)

  const row = (node: OrgTreeNodeDto, depth: number, folding: boolean) => {
    const under = (shape.childrenOf.get(node.id) ?? []).length
    const folds = folding && under > 0
    const people = headcountOf(node.id)
    return (
      <div
        key={node.id}
        role="link"
        tabIndex={0}
        aria-current={openId === node.id || undefined}
        data-testid="tree-row"
        data-node-name={node.name}
        data-depth={depth}
        data-people={headcountKnown ? people : 'unknown'}
        data-children={under}
        {...stylex.props(styles.row, openId === node.id && styles.rowOpen)}
        onClick={(event) => {
          if ((event.target as HTMLElement).closest('button') !== null) return
          onOpen(node.id)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(node.id)
        }}
      >
        <span {...stylex.props(styles.lead)}>
          <span aria-hidden style={{ width: depth * INDENT, flexShrink: 0 }} />
          {folds ? (
            <button
              type="button"
              aria-expanded={!collapsed.has(node.id)}
              aria-label={`${format(m.foldBranch)} ${node.name}`}
              {...stylex.props(styles.twistie)}
              onClick={() => {
                const next = new Set(collapsed)
                if (!next.delete(node.id)) next.add(node.id)
                setCollapsed(next)
              }}
            >
              {collapsed.has(node.id) ? (
                <ChevronRightIcon aria-hidden {...stylex.props(styles.glyph)} />
              ) : (
                <ChevronDownIcon aria-hidden {...stylex.props(styles.glyph)} />
              )}
            </button>
          ) : (
            <span aria-hidden {...stylex.props(styles.twistieSeat)} />
          )}
          <span {...stylex.props(styles.name, depth === 0 && styles.nameTop)} title={node.name}>
            {node.name}
          </span>
          {!node.manageable && <LockIcon aria-hidden {...stylex.props(styles.lock)} />}
        </span>
        <span {...stylex.props(styles.cell)}>{typeName(node.orgTypeId)}</span>
        <span
          {...stylex.props(
            styles.cell,
            styles.figure,
            styles.figurePhone,
            (!headcountKnown || people === 0) && styles.none,
          )}
        >
          {headcountKnown ? people.toLocaleString() : '—'}
        </span>
        <span {...stylex.props(styles.cell, styles.figure, under === 0 && styles.none)}>
          {under.toLocaleString()}
        </span>
        <span aria-hidden {...stylex.props(styles.way)}>
          <ChevronRightIcon {...stylex.props(styles.glyph)} />
        </span>
      </div>
    )
  }

  return (
    <Card data-testid="org-tree">
      <CardHead
        title={format(m.unitsTitle)}
        note={format(m.treeCounts, { total: shape.nodes.length, manageable })}
      >
        <SearchField
          name="org-search"
          value={search}
          onChange={setSearch}
          label={format(m.searchPlaceholder)}
          xstyle={styles.tools}
        />
        <Button size="xs" variant="ghost" onClick={() => setCollapsed(new Set())}>
          {format(m.expandAll)}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => setCollapsed(new Set(branches.map((node) => node.id)))}
        >
          {format(m.collapseAll)}
        </Button>
      </CardHead>
      <div {...stylex.props(styles.head)}>
        <span>{format(m.nameLabel)}</span>
        <span>{format(m.typeColumn)}</span>
        <span {...stylex.props(styles.end)}>{format(m.peopleHere)}</span>
        <span {...stylex.props(styles.end)}>{format(m.childrenColumn)}</span>
        <span />
      </div>
      {matches !== null ? (
        // what a search leaves is a set of matches, not a tree: the branches
        // that would lead to them are not part of the answer
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
    </Card>
  )
}
