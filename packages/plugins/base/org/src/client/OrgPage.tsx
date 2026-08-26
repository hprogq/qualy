import type { Effect } from 'effect'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import {
  Building2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  LockIcon,
  PlusIcon,
  SearchIcon,
  ShapesIcon,
} from 'lucide-react'
import { PageLink, useApi, useRunApi, useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog, Feedback } from '@qualy/ui/admin'
import {
  Barred,
  Blank,
  DefRow,
  EditorSkeleton,
  Facts,
  RailSkeleton,
  Screen,
  SectionHead,
  Segmented,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import type { ApiResult } from '@qualy/web-runtime/api'
import { orgMessages as m } from './i18n.ts'
import { orgApi } from './api.ts'

// The organization, with two faces over one skeleton.
//
// Structure is a tree and the unit it has open: where that unit sits, what
// stands under it, and what may be created there. Types is the grammar the
// structure obeys - asked as "what may a college contain", because that is
// the question somebody has, rather than as a list of parent-child pairs
// nobody thinks in.
//
// Sections are separated by a rule and nothing else. Mutation controls only
// render on what the server marked manageable; the server enforces anyway.

type OrgTreeNodeDto = ApiResult<typeof orgApi, 'org', 'getTree'>['nodes'][number]
type OrgTypeDto = ApiResult<typeof orgApi, 'org', 'listTypes'>['types'][number]
type OrgRuleDto = ApiResult<typeof orgApi, 'org', 'listRules'>['rules'][number]
type Api = ReturnType<typeof useApi>
type Run = (work: Effect.Effect<unknown, unknown>) => Promise<unknown>

interface OrgShape {
  nodes: readonly OrgTreeNodeDto[]
  byId: ReadonlyMap<string, OrgTreeNodeDto>
  childrenOf: ReadonlyMap<string, readonly OrgTreeNodeDto[]>
  roots: readonly OrgTreeNodeDto[]
  types: readonly OrgTypeDto[]
  rules: readonly OrgRuleDto[]
  nodesOfType: ReadonlyMap<string, number>
}

const listJoin = (names: readonly string[]) => names.join('，')

const styles = stylex.create({
  split: {
    display: 'grid',
    alignItems: 'start',
    gap: 24,
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 1024px)': '19rem minmax(0, 1fr)',
    },
  },
  typesSplit: {
    display: 'grid',
    alignItems: 'start',
    gap: 24,
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 1024px)': '17rem minmax(0, 1fr) 16rem',
    },
  },
  quietNote: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  quietNoteInset: {
    paddingInline: 8,
    paddingBlock: 6,
  },
  quietNoteRoomy: {
    paddingInline: 16,
    paddingBlock: 12,
  },
  smallNote: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  railPane: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
  },
  railTools: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  searchSeat: {
    position: 'relative',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  searchGlass: {
    pointerEvents: 'none',
    position: 'absolute',
    top: '50%',
    left: 12,
    width: 14,
    height: 14,
    transform: 'translateY(-50%)',
    color: tokens.mutedForeground,
  },
  indentedInput: {
    paddingLeft: 36,
  },
  pinned: {
    flexShrink: 0,
  },
  widthFit: {
    width: 'fit-content',
  },
  box: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  // the tree owns its own scroll; the page keeps the footer line in sight
  treeScroll: {
    maxHeight: '60vh',
    minHeight: 0,
    overflow: 'auto',
    padding: 4,
  },
  railFoot: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 10,
    paddingBlock: 8,
  },
  footNote: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  footNoteEnd: {
    minWidth: 0,
    flexShrink: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  nodeRow: {
    display: 'flex',
    height: 32,
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    borderRadius: tokens.radiusMd,
    paddingRight: 8,
    textAlign: 'left',
    transitionProperty: 'color, background-color, border-color',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  nodeRowOpen: {
    backgroundColor: {
      default: tokens.surfaceMuted,
      ':hover': tokens.surfaceMuted,
    },
  },
  rowGlyph: {
    width: 12,
    height: 12,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  rowGlyphSeat: {
    width: 12,
    height: 12,
    flexShrink: 0,
  },
  rowName: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  rowNameOpen: {
    fontWeight: 500,
  },
  rowTally: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  panel: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 20,
  },
  panelTight: {
    gap: 16,
  },
  panelIntro: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
  },
  headRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
  },
  headName: {
    flexShrink: 0,
    fontSize: '1rem',
    lineHeight: '1.5rem',
    fontWeight: 600,
  },
  headChip: {
    flexShrink: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 8,
    paddingBlock: 2,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
  },
  headCount: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  inlineForm: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  nameInput: {
    maxWidth: '18rem',
  },
  section: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 16,
  },
  sectionRoomy: {
    gap: 12,
  },
  childRow: {
    display: 'grid',
    minWidth: 0,
    gridTemplateColumns: 'minmax(0, 1fr) 5rem 5rem 3.5rem',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 10,
    textAlign: 'left',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  childName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  childKind: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  childTally: {
    textAlign: 'right',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  childOpen: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  childOpenGlyph: {
    width: 12,
    height: 12,
  },
  createRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 8,
  },
  // the empty seat a new unit would fill, said with a dashed edge
  draftInput: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    borderStyle: 'dashed',
  },
  peopleLink: {
    width: 'fit-content',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
    textDecoration: {
      default: 'none',
      ':hover': 'underline',
    },
  },
  typeRow: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 10,
    textAlign: 'left',
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  typeRowOpen: {
    backgroundColor: {
      default: tokens.surfaceMuted,
      ':hover': tokens.surfaceMuted,
    },
  },
  typeRowHead: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  typeRowName: {
    flexShrink: 0,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  typeRowNameOpen: {
    fontWeight: 600,
  },
  typeRowMeta: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  ruleSection: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
  },
  ruleGrid: {
    display: 'grid',
    minWidth: 0,
    gap: 8,
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 640px)': 'repeat(2, minmax(0, 1fr))',
    },
  },
  ruleCell: {
    display: 'flex',
    minWidth: 0,
    cursor: 'pointer',
    alignItems: 'center',
    gap: 8,
    borderRadius: tokens.radiusMd,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 8,
    backgroundColor: {
      default: null,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  ruleName: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  ruleTally: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  smallBox: {
    width: 16,
    height: 16,
  },
  ladderPane: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 10,
  },
  ladderBox: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    paddingInline: 12,
    paddingBlock: 12,
  },
  ladderRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  ladderTick: {
    color: tokens.mutedForeground,
  },
  ladderName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  ladderNameTop: {
    fontWeight: 500,
  },
  smallGlyph: {
    width: 12,
    height: 12,
  },
  compactInput: {
    width: '10rem',
  },
  moveField: {
    maxWidth: '24rem',
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  kindField: {
    width: '9rem',
    flexShrink: 0,
  },
})

export default function OrgPage() {
  const api = useApi(orgApi)
  const runApi = useRunApi()
  const query = useApiQuery(orgApi)
  const { format, formatError } = useI18n()
  const queryClient = useQueryClient()
  const [view, setView] = usePageQueryState('view')
  const [selectedId, setSelectedId] = usePageQueryState('node')
  const [selectedTypeId, setSelectedTypeId] = usePageQueryState('type')
  const [feedback, setFeedback] = useState<string | null>(null)

  const treeQuery = useQuery(query.org.getTree.queryOptions({ query: {} }))
  const typesQuery = useQuery(query.org.listTypes.queryOptions())
  const rulesQuery = useQuery(query.org.listRules.queryOptions())
  // how many people stand at each unit. Allowed to fail: reading people is a
  // grant of its own, and an organization administrator without it should
  // still get the tree
  const headcounts = useQuery({
    ...query.identity.getUserOptions.queryOptions({ query: {} }),
    retry: false,
  })
  const headcountOf = (orgNodeId: string) =>
    headcounts.data?.nodes.find((node) => node.orgNodeId === orgNodeId)?.userCount ?? 0

  // targeted invalidation: only this plugin's queries, never the whole cache
  const refresh = () => {
    setFeedback(null)
    return queryClient.invalidateQueries({ queryKey: query.org.key() })
  }
  // the one crossing from an effect to a promise on this screen; typed api
  // errors localize from their code, the english message is the last resort
  const run: Run = (work) =>
    runApi(work)
      .then(refresh)
      .catch((error: unknown) => {
        setFeedback(formatError(error))
        throw error
      })

  const shape = useMemo<OrgShape>(() => {
    const nodes = treeQuery.data?.nodes ?? []
    const byId = new Map(nodes.map((node) => [node.id, node]))
    const rootIds = new Set(treeQuery.data?.roots ?? [])
    const childrenOf = new Map<string, OrgTreeNodeDto[]>()
    for (const node of nodes) {
      // forest roots always render top-level, never nested under another
      // visible node (a bare self anchor can be the ancestor of a granted
      // subtree; both are roots of the forest)
      if (!node.parentId || rootIds.has(node.id) || !byId.has(node.parentId)) continue
      const siblings = childrenOf.get(node.parentId) ?? []
      siblings.push(node)
      childrenOf.set(node.parentId, siblings)
    }
    for (const siblings of childrenOf.values()) {
      siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    }
    const roots = (treeQuery.data?.roots ?? [])
      .map((id) => byId.get(id))
      .filter((node): node is OrgTreeNodeDto => node !== undefined)
    const nodesOfType = new Map<string, number>()
    for (const node of nodes) {
      nodesOfType.set(node.orgTypeId, (nodesOfType.get(node.orgTypeId) ?? 0) + 1)
    }
    return {
      nodes,
      byId,
      childrenOf,
      roots,
      types: typesQuery.data?.types ?? [],
      rules: rulesQuery.data?.rules ?? [],
      nodesOfType,
    }
  }, [treeQuery.data, typesQuery.data, rulesQuery.data])

  const selected = selectedId ? shape.byId.get(selectedId) : undefined
  const rootManageable = shape.nodes.some((node) => !node.parentId && node.manageable)
  const types = view === 'types'
  const openTypeId = selectedTypeId || shape.types[0]?.id || ''
  const openType = shape.types.find((type) => type.id === openTypeId)

  return (
    <Screen
      title={format(m.treeTitle)}
      description={format(types ? m.typesHint : m.structureHint)}
      actions={
        <>
          {/* before the view switch, never after it: an action only one
              face offers would otherwise shove the switch sideways every
              time the reader changes face */}
          {rootManageable && types && (
            <NewTypeButton api={api} run={run} onCreated={setSelectedTypeId} />
          )}
          <Segmented
            label={format(m.viewStructure)}
            value={types ? 'types' : 'structure'}
            onChange={(next) => setView(next === 'types' ? 'types' : '')}
            options={[
              { value: 'structure', label: format(m.viewStructure) },
              { value: 'types', label: format(m.viewTypes) },
            ]}
          />
        </>
      }
    >
      <Feedback message={feedback} />
      <AsyncSection
        pending={treeQuery.isPending || typesQuery.isPending || rulesQuery.isPending}
        error={
          treeQuery.isError || typesQuery.isError || rulesQuery.isError
            ? format(m.loadFailedHint)
            : null
        }
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void refresh()}
        skeleton={
          <div {...stylex.props(styles.split)}>
            <RailSkeleton rows={7} />
            <EditorSkeleton />
          </div>
        }
      >
        {types ? (
          <div {...stylex.props(styles.typesSplit)}>
            <TypeRail shape={shape} openId={openTypeId} onOpen={setSelectedTypeId} />
            {openType ? (
              <TypePanel
                key={openType.id}
                type={openType}
                shape={shape}
                api={api}
                run={run}
                canManage={rootManageable}
              />
            ) : (
              <Blank
                icon={<ShapesIcon />}
                title={format(m.pickTypeTitle)}
                description={format(m.pickTypeBody)}
              />
            )}
            <TypeLadder shape={shape} />
          </div>
        ) : (
          <div {...stylex.props(styles.split)}>
            <NodeRail
              shape={shape}
              openId={selected?.id ?? null}
              onOpen={setSelectedId}
              headcountOf={headcountOf}
            />
            {selected ? (
              <NodePanel
                key={selected.id}
                node={selected}
                shape={shape}
                api={api}
                run={run}
                onOpen={setSelectedId}
                headcount={headcountOf(selected.id)}
              />
            ) : (
              <Blank
                icon={<Building2Icon />}
                title={format(m.pickNodeTitle)}
                description={format(m.pickNodeBody)}
              />
            )}
          </div>
        )}
      </AsyncSection>
    </Screen>
  )
}

// --- structure ---

function NodeRail({
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

  const rows: { node: OrgTreeNodeDto; depth: number }[] = []
  const walk = (node: OrgTreeNodeDto, depth: number) => {
    rows.push({ node, depth })
    if (collapsed.has(node.id)) return
    for (const child of shape.childrenOf.get(node.id) ?? []) walk(child, depth + 1)
  }
  for (const root of shape.roots) walk(root, 0)

  return (
    <div {...stylex.props(styles.railPane)}>
      <div {...stylex.props(styles.railTools)}>
        <div {...stylex.props(styles.searchSeat)}>
          <SearchIcon aria-hidden {...stylex.props(styles.searchGlass)} />
          <Input
            name="org-search"
            value={search}
            placeholder={format(m.searchPlaceholder)}
            aria-label={format(m.searchPlaceholder)}
            onChange={(event) => setSearch(event.target.value)}
            className={stylex.props(styles.indentedInput).className}
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className={stylex.props(styles.pinned).className}
          onClick={() => setCollapsed(new Set())}
        >
          {format(m.expandAll)}
        </Button>
      </div>
      <div {...stylex.props(styles.box)}>
        <div {...stylex.props(styles.treeScroll)}>
          {matches !== null ? (
            // what a search leaves is a set of matches, not a tree: the
            // branches that would lead to them are not part of the answer
            matches.length === 0 ? (
              <p {...stylex.props(styles.quietNote, styles.quietNoteInset)}>
                {format(m.searchEmpty)}
              </p>
            ) : (
              matches.map((node) => (
                <NodeRow
                  key={node.id}
                  node={node}
                  depth={0}
                  open={openId === node.id}
                  childCount={(shape.childrenOf.get(node.id) ?? []).length}
                  headcount={headcountOf(node.id)}
                  onOpen={() => onOpen(node.id)}
                />
              ))
            )
          ) : rows.length === 0 ? (
            <p {...stylex.props(styles.quietNote, styles.quietNoteInset)}>{format(m.treeEmpty)}</p>
          ) : (
            rows.map(({ node, depth }) => (
              <NodeRow
                key={node.id}
                node={node}
                depth={depth}
                open={openId === node.id}
                childCount={(shape.childrenOf.get(node.id) ?? []).length}
                headcount={headcountOf(node.id)}
                collapsed={collapsed.has(node.id)}
                onToggle={() => {
                  const next = new Set(collapsed)
                  if (!next.delete(node.id)) next.add(node.id)
                  setCollapsed(next)
                }}
                onOpen={() => onOpen(node.id)}
              />
            ))
          )}
        </div>
        <div {...stylex.props(styles.railFoot)}>
          <span {...stylex.props(styles.footNote)}>
            {format(m.unitCount, { count: shape.nodes.length })}
          </span>
          <span {...stylex.props(styles.spacer)} />
          <span {...stylex.props(styles.footNote, styles.footNoteEnd)}>
            {format(m.manageableCount, { count: manageable })}
          </span>
        </div>
      </div>
    </div>
  )
}

/**
 * One unit in the rail: a single button from edge to edge.
 *
 * The chevron used to be a control of its own laid before the name, which
 * meant the indent and the arrow together formed a strip that looked
 * pressable and did something other than open the unit. Pressing a row now
 * opens it and expands it, so every pixel of the row does what it looks like.
 */
function NodeRow({
  node,
  depth,
  open,
  childCount,
  headcount,
  collapsed,
  onToggle,
  onOpen,
}: {
  node: OrgTreeNodeDto
  depth: number
  open: boolean
  childCount: number
  headcount: number
  collapsed?: boolean
  onToggle?: () => void
  onOpen: () => void
}) {
  const expandable = childCount > 0 && onToggle !== undefined
  return (
    <button
      type="button"
      aria-current={open}
      data-node-name={node.name}
      {...(expandable ? { 'aria-expanded': collapsed !== true } : {})}
      onClick={() => {
        if (expandable) onToggle()
        onOpen()
      }}
      {...stylex.props(styles.nodeRow, open && styles.nodeRowOpen)}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      {expandable ? (
        collapsed === true ? (
          <ChevronRightIcon aria-hidden {...stylex.props(styles.rowGlyph)} />
        ) : (
          <ChevronDownIcon aria-hidden {...stylex.props(styles.rowGlyph)} />
        )
      ) : (
        <span aria-hidden {...stylex.props(styles.rowGlyphSeat)} />
      )}
      <span {...stylex.props(styles.rowName, open && styles.rowNameOpen)}>{node.name}</span>
      {!node.manageable && <LockIcon aria-hidden {...stylex.props(styles.rowGlyph)} />}
      <span {...stylex.props(styles.rowTally)} data-headcount={headcount}>
        {headcount > 0 ? headcount : ''}
      </span>
    </button>
  )
}

function NodePanel({
  node,
  shape,
  api,
  run,
  onOpen,
  headcount,
}: {
  node: OrgTreeNodeDto
  shape: OrgShape
  api: Api
  run: Run
  onOpen: (id: string) => void
  /** people standing at this node, from whoever owns people */
  headcount: number
}) {
  const { format } = useI18n()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(node.name)
  const [moving, setMoving] = useState(false)
  const [moveTargetId, setMoveTargetId] = useState('')
  const [childName, setChildName] = useState('')
  const [childTypeId, setChildTypeId] = useState('')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isRoot = !node.parentId
  const children = shape.childrenOf.get(node.id) ?? []
  // both counts are read before the button is offered, so a refusal is not
  // the first a reader hears of a rule
  const removable = children.length === 0 && headcount === 0
  const typeName = (id: string) =>
    shape.types.find((type) => type.id === id)?.name ?? format(m.unknownType)

  // the kinds of unit this one may hold, by the rules as they stand: the
  // create control offers only what the api would accept
  const allowedChildTypes = shape.rules
    .filter((rule) => rule.parentTypeId === node.orgTypeId)
    .map((rule) => shape.types.find((type) => type.id === rule.childTypeId))
    .filter((type): type is OrgTypeDto => type !== undefined)

  // spelled from the top: a class name alone says which class but never whose
  const path: OrgTreeNodeDto[] = []
  for (let at: OrgTreeNodeDto | undefined = node; at;) {
    path.unshift(at)
    at = at.parentId ? shape.byId.get(at.parentId) : undefined
  }
  const siblings = node.parentId ? (shape.childrenOf.get(node.parentId) ?? []) : shape.roots
  const rank = siblings.findIndex((sibling) => sibling.id === node.id) + 1

  const descendants = new Set<string>()
  const collect = (id: string) => {
    descendants.add(id)
    for (const child of shape.childrenOf.get(id) ?? []) collect(child.id)
  }
  collect(node.id)
  const parentTypesAllowed = new Set(
    shape.rules.filter((rule) => rule.childTypeId === node.orgTypeId).map((r) => r.parentTypeId),
  )
  const moveTargets = shape.nodes.filter(
    (candidate) =>
      candidate.manageable &&
      !descendants.has(candidate.id) &&
      candidate.id !== node.parentId &&
      parentTypesAllowed.has(candidate.orgTypeId),
  )

  return (
    <div {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.panelIntro)}>
        <div {...stylex.props(styles.headRow)}>
          <h2 {...stylex.props(styles.headName)}>{node.name}</h2>
          <span {...stylex.props(styles.headChip)}>{typeName(node.orgTypeId)}</span>
          <span {...stylex.props(styles.spacer)} />
          {node.manageable && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRenaming((current) => !current)}
              >
                {format(m.rename)}
              </Button>
              {!isRoot && node.subtreeManageable && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setMoving((current) => !current)}
                >
                  {format(m.move)}
                </Button>
              )}
            </>
          )}
        </div>

        {renaming && (
          <form
            {...stylex.props(styles.inlineForm)}
            onSubmit={(event) => {
              event.preventDefault()
              void run(api.org.updateNode({ params: { nodeId: node.id }, payload: { name } })).then(
                () => setRenaming(false),
              )
            }}
          >
            <Input
              autoFocus
              value={name}
              aria-label={format(m.nameLabel)}
              onChange={(event) => setName(event.target.value)}
              wrapperClassName={stylex.props(styles.nameInput).className}
            />
            <Button size="sm" type="submit" disabled={name.trim() === '' || name === node.name}>
              {format(m.save)}
            </Button>
          </form>
        )}
        {moving && (
          <form
            {...stylex.props(styles.inlineForm)}
            onSubmit={(event) => {
              event.preventDefault()
              void run(
                api.org.setNodePlacement({
                  params: { nodeId: node.id },
                  payload: { parentId: moveTargetId },
                }),
              ).then(() => setMoving(false))
            }}
          >
            <Select value={moveTargetId} onValueChange={setMoveTargetId}>
              <SelectTrigger aria-label={format(m.moveTo)} xstyle={styles.moveField}>
                <SelectValue placeholder={format(m.selectParent)} />
              </SelectTrigger>
              <SelectContent>
                {moveTargets.map((candidate) => (
                  <SelectItem key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" type="submit" disabled={moveTargetId === ''}>
              {format(m.move)}
            </Button>
          </form>
        )}

        {!node.manageable && <p {...stylex.props(styles.quietNote)}>{format(m.readOnly)}</p>}

        <Facts
          items={[
            {
              label: format(m.parentLabel),
              value: node.parentId ? (shape.byId.get(node.parentId)?.name ?? '—') : '—',
            },
            { label: format(m.pathLabel), value: path.map((step) => step.name).join(' / ') },
            {
              label: format(m.rankLabel),
              value: rank > 0 ? format(m.siblingRank, { rank, total: siblings.length }) : '—',
            },
            { label: format(m.nodeType), value: typeName(node.orgTypeId) },
          ]}
        />
      </div>

      <div {...stylex.props(styles.section)}>
        <SectionHead
          title={format(m.childrenTitle)}
          count={children.length}
          aside={
            allowedChildTypes.length === 0
              ? format(m.noChildrenAllowed)
              : format(m.allowedHere, { types: listJoin(allowedChildTypes.map((t) => t.name)) })
          }
        />
        <div {...stylex.props(styles.box)}>
          {children.length === 0 ? (
            <p {...stylex.props(styles.quietNote, styles.quietNoteRoomy)}>
              {format(m.childrenEmpty)}
            </p>
          ) : (
            children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onOpen(child.id)}
                {...stylex.props(styles.childRow)}
              >
                <span {...stylex.props(styles.childName)}>{child.name}</span>
                <span {...stylex.props(styles.childKind)}>{typeName(child.orgTypeId)}</span>
                <span {...stylex.props(styles.childTally)}>
                  {format(m.childCount, { count: (shape.childrenOf.get(child.id) ?? []).length })}
                </span>
                <span {...stylex.props(styles.childOpen)}>
                  {format(m.open)}
                  <ChevronRightIcon aria-hidden {...stylex.props(styles.childOpenGlyph)} />
                </span>
              </button>
            ))
          )}
          {node.manageable && allowedChildTypes.length > 0 && (
            <form
              {...stylex.props(styles.createRow)}
              onSubmit={(event) => {
                event.preventDefault()
                void run(
                  api.org.createNode({
                    payload: { parentId: node.id, orgTypeId: childTypeId, name: childName },
                  }),
                ).then(() => setChildName(''))
              }}
            >
              <Input
                value={childName}
                placeholder={format(m.namePlaceholder)}
                aria-label={format(m.namePlaceholder)}
                onChange={(event) => setChildName(event.target.value)}
                wrapperClassName={stylex.props(styles.draftInput).className}
                className={stylex.props(styles.draftInput).className}
              />
              <Select value={childTypeId} onValueChange={setChildTypeId}>
                <SelectTrigger aria-label={format(m.selectType)} xstyle={styles.kindField}>
                  <SelectValue placeholder={format(m.selectType)} />
                </SelectTrigger>
                <SelectContent>
                  {allowedChildTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                type="submit"
                className={stylex.props(styles.pinned).className}
                disabled={childName.trim() === '' || childTypeId === ''}
              >
                {format(m.create)}
              </Button>
            </form>
          )}
        </div>
      </div>

      {/* how many stand here, and the way through to them. The roster
          belongs to the users screen; the number is what decides whether a
          unit may be removed, so the count comes with the tree */}
      <div {...stylex.props(styles.section)}>
        <SectionHead
          title={format(m.peopleTitle)}
          count={format(m.peopleCount, { count: headcount })}
        />
        <PageLink
          page="auth/users"
          search={{ anchor: node.id, scope: 'self' }}
          className={stylex.props(styles.peopleLink).className}
          unavailable={null}
        >
          {format(m.peopleOpen)}
        </PageLink>
      </div>

      {node.manageable && !isRoot && (
        <div {...stylex.props(styles.section, styles.sectionRoomy)}>
          <SectionHead title={format(m.deleteTitle)} />
          <Barred
            actions={[{ label: format(m.deleteNode), barred: !removable }]}
            {...(removable
              ? {}
              : {
                  reason: [
                    children.length > 0 ? format(m.childCount, { count: children.length }) : null,
                    headcount > 0 ? format(m.peopleCount, { count: headcount }) : null,
                  ]
                    .filter((line) => line !== null)
                    .join('，'),
                })}
          />
          <Button
            size="sm"
            variant="outline"
            className={stylex.props(styles.widthFit).className}
            disabled={!removable}
            onClick={() => setConfirmingDelete(true)}
          >
            {format(m.deleteNode)}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={format(m.confirmDeleteNode, { name: node.name })}
        description={format(m.confirmDeleteNodeBody)}
        confirmLabel={format(m.deleteNode)}
        cancelLabel={format(commonMessages.cancel)}
        onConfirm={() =>
          void run(api.org.deleteNode({ params: { nodeId: node.id } }))
            .then(() => setConfirmingDelete(false))
            .catch(() => setConfirmingDelete(false))
        }
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  )
}

// --- types ---

function TypeRail({
  shape,
  openId,
  onOpen,
}: {
  shape: OrgShape
  openId: string
  onOpen: (id: string) => void
}) {
  const { format } = useI18n()
  const childNames = (typeId: string) =>
    shape.rules
      .filter((rule) => rule.parentTypeId === typeId)
      .map((rule) => shape.types.find((type) => type.id === rule.childTypeId)?.name)
      .filter((name): name is string => name !== undefined)

  if (shape.types.length === 0) {
    return <p {...stylex.props(styles.quietNote)}>{format(m.typeListEmpty)}</p>
  }
  return (
    <div {...stylex.props(styles.box)}>
      {shape.types.map((type) => {
        const held = childNames(type.id)
        const openNow = type.id === openId
        return (
          <button
            key={type.id}
            type="button"
            aria-current={openNow}
            onClick={() => onOpen(type.id)}
            {...stylex.props(styles.typeRow, openNow && styles.typeRowOpen)}
          >
            <span {...stylex.props(styles.typeRowHead)}>
              <span {...stylex.props(styles.typeRowName, openNow && styles.typeRowNameOpen)}>
                {type.name}
              </span>
              <span {...stylex.props(styles.spacer)} />
              <span {...stylex.props(styles.rowTally)}>
                {format(m.typeNodeCount, { count: shape.nodesOfType.get(type.id) ?? 0 })}
              </span>
            </span>
            <span {...stylex.props(styles.typeRowMeta)}>
              {held.length === 0
                ? format(m.noChildrenAllowed)
                : format(m.allowedHere, { types: listJoin(held) })}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function TypePanel({
  type,
  shape,
  api,
  run,
  canManage,
}: {
  type: OrgTypeDto
  shape: OrgShape
  api: Api
  run: Run
  canManage: boolean
}) {
  const { format } = useI18n()
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(type.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const inUse = shape.nodesOfType.get(type.id) ?? 0

  // the rules as stored against the rules as edited: saving writes the diff,
  // one put or delete per changed pair
  const stored = useMemo(
    () =>
      new Set(
        shape.rules.filter((rule) => rule.parentTypeId === type.id).map((rule) => rule.childTypeId),
      ),
    [shape.rules, type.id],
  )
  const [draft, setDraft] = useState<ReadonlySet<string>>(stored)
  const dirty = draft.size !== stored.size || [...draft].some((id) => !stored.has(id))

  const allowedUnder = shape.rules
    .filter((rule) => rule.childTypeId === type.id)
    .map((rule) => shape.types.find((candidate) => candidate.id === rule.parentTypeId)?.name)
    .filter((held): held is string => held !== undefined)

  const saveRules = () => {
    const adds = [...draft].filter((id) => !stored.has(id))
    const removals = [...stored].filter((id) => !draft.has(id))
    // sequential on purpose: each pair is its own resource, so a failure
    // stops at the pair that refused with the rest untouched and refetched
    let work: Promise<unknown> = Promise.resolve()
    for (const childTypeId of adds) {
      work = work.then(() =>
        run(api.org.putRule({ params: { parentTypeId: type.id, childTypeId } })),
      )
    }
    for (const childTypeId of removals) {
      work = work.then(() =>
        run(api.org.deleteRule({ params: { parentTypeId: type.id, childTypeId } })),
      )
    }
    void work.catch(() => undefined)
  }

  return (
    <div {...stylex.props(styles.panel, styles.panelTight)}>
      <div {...stylex.props(styles.headRow)}>
        <h2 {...stylex.props(styles.headName)}>{type.name}</h2>
        <span {...stylex.props(styles.headCount)}>{format(m.typeNodeCount, { count: inUse })}</span>
        <span {...stylex.props(styles.spacer)} />
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setRenaming((current) => !current)}>
            {format(m.rename)}
          </Button>
        )}
      </div>
      {renaming && (
        <form
          {...stylex.props(styles.inlineForm)}
          onSubmit={(event) => {
            event.preventDefault()
            void run(api.org.updateType({ params: { typeId: type.id }, payload: { name } })).then(
              () => setRenaming(false),
            )
          }}
        >
          <Input
            autoFocus
            value={name}
            aria-label={format(m.nameLabel)}
            onChange={(event) => setName(event.target.value)}
            wrapperClassName={stylex.props(styles.nameInput).className}
          />
          <Button size="sm" type="submit" disabled={name.trim() === '' || name === type.name}>
            {format(m.save)}
          </Button>
        </form>
      )}

      <div {...stylex.props(styles.ruleSection)}>
        <SectionHead
          title={format(m.allowedChildrenTitle)}
          aside={format(m.chosenCount, { count: draft.size })}
        />
        <div {...stylex.props(styles.ruleGrid)}>
          {shape.types.map((candidate) => (
            <label key={candidate.id} {...stylex.props(styles.ruleCell)}>
              <Checkbox
                className={stylex.props(styles.smallBox).className}
                checked={draft.has(candidate.id)}
                disabled={!canManage}
                onCheckedChange={(checked) => {
                  const next = new Set(draft)
                  if (checked === true) next.add(candidate.id)
                  else next.delete(candidate.id)
                  setDraft(next)
                }}
              />
              <span {...stylex.props(styles.ruleName)}>{candidate.name}</span>
              <span {...stylex.props(styles.ruleTally)}>
                {shape.nodesOfType.get(candidate.id) ?? 0}
              </span>
            </label>
          ))}
        </div>
        {canManage && (
          <Button
            size="sm"
            className={stylex.props(styles.widthFit).className}
            disabled={!dirty}
            onClick={saveRules}
          >
            {format(m.save)}
          </Button>
        )}
      </div>

      <DefRow label={format(m.allowedUnder)}>
        {allowedUnder.length === 0 ? format(m.allowedUnderNone) : listJoin(allowedUnder)}
      </DefRow>

      {canManage && (
        <DefRow
          label={format(m.delete)}
          action={
            <Button
              size="sm"
              variant="outline"
              className={stylex.props(styles.pinned).className}
              disabled={inUse > 0}
              onClick={() => setConfirmingDelete(true)}
            >
              {format(m.delete)}
            </Button>
          }
        >
          <Barred
            actions={[{ label: format(m.delete), barred: inUse > 0 }]}
            {...(inUse > 0 ? { reason: format(m.typeInUseHint, { count: inUse }) } : {})}
          />
        </DefRow>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        title={format(m.confirmDeleteType, { name: type.name })}
        description={format(m.confirmDeleteTypeBody)}
        confirmLabel={format(m.delete)}
        cancelLabel={format(commonMessages.cancel)}
        onConfirm={() =>
          void run(api.org.deleteType({ params: { typeId: type.id } }))
            .then(() => setConfirmingDelete(false))
            .catch(() => setConfirmingDelete(false))
        }
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  )
}

/** the grammar as a shape rather than a list: which type sits under which */
function TypeLadder({ shape }: { shape: OrgShape }) {
  const { format } = useI18n()
  const childrenOfType = (id: string) =>
    shape.rules.filter((rule) => rule.parentTypeId === id).map((rule) => rule.childTypeId)
  const held = new Set(shape.rules.map((rule) => rule.childTypeId))
  const tops = shape.types.filter((type) => !held.has(type.id))
  const rows: { name: string; depth: number }[] = []
  const walk = (id: string, depth: number, seen: ReadonlySet<string>) => {
    const type = shape.types.find((candidate) => candidate.id === id)
    if (!type || seen.has(id) || depth > 5) return
    rows.push({ name: type.name, depth })
    const next = new Set(seen).add(id)
    for (const child of childrenOfType(id)) walk(child, depth + 1, next)
  }
  for (const top of tops) walk(top.id, 0, new Set())

  return (
    <div {...stylex.props(styles.ladderPane)}>
      <SectionHead title={format(m.ladderTitle)} />
      <div {...stylex.props(styles.ladderBox)}>
        {rows.length === 0 ? (
          <p {...stylex.props(styles.quietNote)}>{format(m.ladderEmpty)}</p>
        ) : (
          rows.map((row, at) => (
            <div
              key={`${row.name}-${at}`}
              {...stylex.props(styles.ladderRow)}
              style={{ paddingLeft: row.depth * 14 }}
            >
              {row.depth > 0 && <span {...stylex.props(styles.ladderTick)}>└</span>}
              <span {...stylex.props(styles.ladderName, row.depth === 0 && styles.ladderNameTop)}>
                {row.name}
              </span>
            </div>
          ))
        )}
      </div>
      <p {...stylex.props(styles.smallNote)}>
        {format(m.ruleCount, { count: shape.rules.length })}
      </p>
    </div>
  )
}

function NewTypeButton({
  api,
  run,
  onCreated,
}: {
  api: Api
  run: Run
  onCreated: (id: string) => void
}) {
  const { format } = useI18n()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <PlusIcon aria-hidden {...stylex.props(styles.smallGlyph)} />
        {format(m.newTypeTitle)}
      </Button>
    )
  }
  return (
    <form
      {...stylex.props(styles.inlineForm)}
      onSubmit={(event) => {
        event.preventDefault()
        void run(api.org.createType({ payload: { name } })).then((created) => {
          setName('')
          setOpen(false)
          const id = (created as { id?: string } | undefined)?.id
          if (id) onCreated(id)
        })
      }}
    >
      <Input
        autoFocus
        value={name}
        placeholder={format(m.newTypeTitle)}
        aria-label={format(m.newTypeTitle)}
        onChange={(event) => setName(event.target.value)}
        wrapperClassName={stylex.props(styles.compactInput).className}
      />
      <Button size="sm" type="submit" disabled={name.trim() === ''}>
        {format(m.create)}
      </Button>
    </form>
  )
}
