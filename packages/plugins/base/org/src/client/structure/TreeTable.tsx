import { useState, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsDownUpIcon,
  ChevronsUpDownIcon,
  EllipsisIcon,
  LockIcon,
  PlusIcon,
} from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { Card, CardEmpty, CardHead, SearchField } from '@qualy/ui/screen'
import { orgMessages as m } from '../i18n.ts'
import type { OrgShape, OrgTreeNodeDto } from '../shape.ts'
import type { NodeTask } from './NodeDialogs.tsx'

// The whole structure, the whole width of the page.
//
// It used to be a narrow column beside a panel about whichever unit was open,
// and the panel had five facts and a short list to say - most of the page
// was the smaller half of it. A unit's name, its kind, who stands there and
// what is under it fit on its own row, so the tree is the page, read across
// like a table, and a unit opens beside it only when somebody asks for one.

const QUIET = `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`
const COLUMNS = 'minmax(0, 1fr) 8rem 6rem 6rem 4.5rem'
const INDENT = 22
/** narrow, a level costs less, because the name is what is left of the row */
const INDENT_NARROW = 12

const styles = stylex.create({
  // Two marks side by side read as a pair to a pointer. On a phone they
  // are two more targets in a head that already holds a name, two counts
  // and a search field - and folding a whole tree is not what somebody
  // opened this page on a phone to do. They fold away; the twistie on each
  // branch still folds that branch.
  folds: {
    display: { default: 'inline-flex', [breakpoints.phone]: 'none' },
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
  },
  tools: { width: { default: '16rem', [breakpoints.phone]: '100%' } },
  // A card is a sheet laid on the page to say "this much is one thing". On a
  // phone the tree is the whole of the page, so the sheet says nothing and
  // costs two margins and a rule on each side of every name.
  bare: {
    borderRadius: { default: 14, [breakpoints.phone]: 0 },
    backgroundColor: { default: tokens.surface, [breakpoints.phone]: 'transparent' },
    boxShadow: {
      default: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
      [breakpoints.phone]: 'none',
    },
    marginInline: { default: null, [breakpoints.phone]: -16 },
  },
  // its own name, where the band above it has not already said it
  cardWord: { display: { default: 'inline', [breakpoints.phone]: 'none' } },
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
    gridTemplateColumns: {
      default: COLUMNS,
      // A floor, widened once for the whole list by the measurement below:
      // each row is its own grid, so `auto` sized every row to its own
      // content and a column of kinds and counts came out ragged.
      [breakpoints.phone]: 'minmax(0, 1fr) auto auto',
    },
    alignItems: 'center',
    columnGap: { default: 16, [breakpoints.phone]: 10 },
    // A tree's row is one line and a name: it needs a thumb's width, not a
    // thumb's height twice over.
    minHeight: { default: 40, [breakpoints.phone]: 44 },
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
  /** the letters that were typed, inside the name they were found in */
  hit: { fontWeight: 600, color: tokens.foreground },
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
  // A unit's kind, which a phone keeps: names five levels down a structure
  // repeat - every college has a 2301 班 - and the kind is what tells two
  // of them apart at a glance. It shrinks away rather than pushing the
  // name, because the name is what somebody is looking for.
  kindPhone: { display: 'block', minWidth: 0, fontSize: 12 },
  none: { color: QUIET },
  // What can be done to a unit, at the end of its own row. Quiet until the
  // row is pointed at or holds the focus, so forty rows are not forty sets of
  // buttons; always there on a screen with nothing to point with.
  acts: {
    // Narrow, the row is a way into the unit and nothing else: what can be
    // done to it is in the panel the row opens, where it has room for a
    // word rather than a glyph. Left here it reserved a column, and the
    // name - the thing somebody is looking for - was the column that gave
    // way for it.
    display: { default: 'inline-flex', [breakpoints.phone]: 'none' },
    justifySelf: 'end',
    alignItems: 'center',
    gap: 2,
    opacity: {
      default: 0,
      [stylex.when.ancestor(':hover')]: 1,
      [stylex.when.ancestor(':focus-within')]: 1,
      '@media (hover: none)': 1,
    },
    transitionProperty: 'opacity',
    transitionDuration: '120ms',
  },
  actsShown: { opacity: 1 },
  barred: { opacity: 0.35, cursor: 'not-allowed' },
})

export function TreeTable({
  shape,
  openId,
  onOpen,
  headcountOf,
  headcountKnown,
  narrow = false,
  onTask,
}: {
  shape: OrgShape
  openId: string | null
  onOpen: (id: string) => void
  headcountOf: (orgNodeId: string) => number
  headcountKnown: boolean
  /** the row is stacked rather than laid across, so a level costs less */
  narrow?: boolean
  /** a task started from a row: a unit under it, another name, another place */
  onTask: (task: NodeTask) => void
}) {
  const { format } = useI18n()
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const term = search.trim().toLowerCase()
  const matches =
    term === '' ? null : shape.nodes.filter((node) => node.name.toLowerCase().includes(term))
  const manageable = shape.nodes.filter((node) => node.manageable).length
  const typeName = (id: string) => shape.types.find((type) => type.id === id)?.name ?? ''
  // whether the grammar lets anything stand under a unit of this kind
  const canHold = (node: OrgTreeNodeDto) =>
    shape.rules.some((rule) => rule.parentTypeId === node.orgTypeId)
  const branches = shape.nodes.filter((node) => (shape.childrenOf.get(node.id) ?? []).length > 0)

  const rows: { node: OrgTreeNodeDto; depth: number }[] = []
  const walk = (node: OrgTreeNodeDto, depth: number) => {
    rows.push({ node, depth })
    if (collapsed.has(node.id)) return
    for (const child of shape.childrenOf.get(node.id) ?? []) walk(child, depth + 1)
  }
  for (const root of shape.roots) walk(root, 0)

  const shown = matches ?? rows.map((entry) => entry.node)
  // What the two narrow columns are worth, measured once over the rows on
  // screen rather than per row.
  //
  // Each row is a grid of its own - that is what keeps a row one hoverable,
  // pressable thing - so nothing lines their columns up for them, and `auto`
  // sized every row to its own content. The widest kind and the widest count
  // ON SHOW decide the width, in the size those cells are actually set at.
  // Both are capped: one unit named at length should lose its own end rather
  // than take a third of every other row's name.
  const widest = (lengths: readonly number[], most: number) =>
    Math.min(most, Math.max(1, ...lengths))
  const kindGlyphs = widest(
    shown.map((node) => typeName(node.orgTypeId).length),
    4,
  )
  const countGlyphs = headcountKnown
    ? widest(
        shown.map((node) => headcountOf(node.id).toLocaleString().length),
        5,
      )
    : 1
  // CJK glyphs are square at their own size; digits are about six tenths
  const narrowColumns = `minmax(0, 1fr) ${String(kindGlyphs * 12 + 2)}px ${String(Math.ceil(countGlyphs * 7.6) + 2)}px`

  // the typed letters wherever they occur in a name, and the rest as it was
  const found = (name: string) => {
    if (term === '') return name
    const parts: ReactNode[] = []
    let at = 0
    for (;;) {
      const hit = name.toLowerCase().indexOf(term, at)
      if (hit === -1) break
      if (hit > at) parts.push(name.slice(at, hit))
      parts.push(
        <span key={hit} {...stylex.props(styles.hit)}>
          {name.slice(hit, hit + term.length)}
        </span>,
      )
      at = hit + term.length
    }
    if (parts.length === 0) return name
    if (at < name.length) parts.push(name.slice(at))
    return parts
  }

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
        {...stylex.props(styles.row, openId === node.id && styles.rowOpen, stylex.defaultMarker())}
        style={narrow ? { gridTemplateColumns: narrowColumns } : undefined}
        onClick={(event) => {
          // a control on the row, or a menu it opened, answered for itself
          if ((event.target as HTMLElement).closest('button, [role="menu"]') !== null) return
          onOpen(node.id)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) onOpen(node.id)
        }}
      >
        <span {...stylex.props(styles.lead)}>
          <span
            aria-hidden
            style={{ width: depth * (narrow ? INDENT_NARROW : INDENT), flexShrink: 0 }}
          />
          {/* The seat under a fold control is there so names down a tree line
              up. A search result is not in a tree - there is nothing above
              or below it to line up with - so it starts where the row does. */}
          {folding &&
            (folds ? (
              <button
                type="button"
                aria-expanded={!collapsed.has(node.id)}
                aria-label={`${format(m.foldBranch)} ${node.name}`}
                {...stylex.props(styles.twistie)}
                onClick={(event) => {
                  const next = new Set(collapsed)
                  if (!next.delete(node.id)) next.add(node.id)
                  setCollapsed(next)
                  // A pressed button keeps the focus, and a row holding the
                  // focus keeps its actions on show - so every branch folded by
                  // mouse left its buttons standing for good. A press made with
                  // a pointer gives the focus back; one made from the keyboard
                  // keeps it, and that row's actions with it.
                  if (event.detail > 0) event.currentTarget.blur()
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
            ))}
          {/* A top-level unit is named in the weight its place deserves. A
              search result has no place in a tree, so the weight goes to the
              letters that were typed instead - which is what the reader is
              looking for in a list of names that all look alike. */}
          <span
            {...stylex.props(styles.name, folding && depth === 0 && styles.nameTop)}
            title={node.name}
          >
            {folding ? node.name : found(node.name)}
          </span>
          {!node.manageable && <LockIcon aria-hidden {...stylex.props(styles.lock)} />}
        </span>
        <span {...stylex.props(styles.cell, styles.kindPhone)}>{typeName(node.orgTypeId)}</span>
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
        <span {...stylex.props(styles.acts, openId === node.id && styles.actsShown)}>
          {node.manageable && (
            // always there, so the column of rows reads the same down the
            // tree; where the rules let nothing stand under this kind it is
            // dimmed and says why, rather than missing without a word
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={format(m.rowAdd, { name: node.name })}
              aria-disabled={!canHold(node) || undefined}
              title={
                canHold(node)
                  ? undefined
                  : format(m.rowAddBarred, { type: typeName(node.orgTypeId) })
              }
              data-row-action="create"
              data-barred={!canHold(node)}
              className={stylex.props(!canHold(node) && styles.barred).className}
              onClick={(event) => {
                if (canHold(node)) onTask({ kind: 'create', nodeId: node.id })
                if (event.detail > 0) event.currentTarget.blur()
              }}
            >
              <PlusIcon aria-hidden />
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={format(m.rowMore, { name: node.name })}
                data-row-action="more"
              >
                <EllipsisIcon aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onOpen(node.id)}>
                {format(m.rowOpen)}
              </DropdownMenuItem>
              {node.manageable && (
                <DropdownMenuItem onSelect={() => onTask({ kind: 'rename', nodeId: node.id })}>
                  {format(m.rename)}
                </DropdownMenuItem>
              )}
              {node.manageable && node.parentId !== null && node.subtreeManageable && (
                <DropdownMenuItem onSelect={() => onTask({ kind: 'move', nodeId: node.id })}>
                  {format(m.moveTo)}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      </div>
    )
  }

  return (
    <Card data-testid="org-tree" xstyle={styles.bare}>
      <CardHead
        title={<span {...stylex.props(styles.cardWord)}>{format(m.unitsTitle)}</span>}
        note={format(m.treeCounts, { total: shape.nodes.length, manageable })}
      >
        <SearchField
          name="org-search"
          value={search}
          onChange={setSearch}
          label={format(m.searchPlaceholder)}
          xstyle={styles.tools}
        />
        {/* two marks rather than two phrases: side by side the words read as
            a sentence, and the pair of chevrons is how every tree says this */}
        <span {...stylex.props(styles.folds)}>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={format(m.expandAll)}
            title={format(m.expandAll)}
            onClick={() => setCollapsed(new Set())}
          >
            <ChevronsUpDownIcon aria-hidden />
          </Button>
          <Button
            size="icon-sm"
            variant="outline"
            aria-label={format(m.collapseAll)}
            title={format(m.collapseAll)}
            onClick={() => setCollapsed(new Set(branches.map((node) => node.id)))}
          >
            <ChevronsDownUpIcon aria-hidden />
          </Button>
        </span>
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
