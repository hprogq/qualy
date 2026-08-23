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
import { cn } from '@qualy/ui/cn'
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

export default function OrgPage() {
  const api = useApi(orgApi)
  const runApi = useRunApi()
  const orpc = useApiQuery(orgApi)
  const { format, formatError } = useI18n()
  const queryClient = useQueryClient()
  const [view, setView] = usePageQueryState('view')
  const [selectedId, setSelectedId] = usePageQueryState('node')
  const [selectedTypeId, setSelectedTypeId] = usePageQueryState('type')
  const [feedback, setFeedback] = useState<string | null>(null)

  const treeQuery = useQuery(orpc.org.getTree.queryOptions({ query: {} }))
  const typesQuery = useQuery(orpc.org.listTypes.queryOptions())
  const rulesQuery = useQuery(orpc.org.listRules.queryOptions())
  // how many people stand at each unit. Allowed to fail: reading people is a
  // grant of its own, and an organization administrator without it should
  // still get the tree
  const headcounts = useQuery({
    ...orpc.identity.getUserOptions.queryOptions({ query: {} }),
    retry: false,
  })
  const headcountOf = (orgNodeId: string) =>
    headcounts.data?.nodes.find((node) => node.orgNodeId === orgNodeId)?.userCount ?? 0

  // targeted invalidation: only this plugin's queries, never the whole cache
  const refresh = () => {
    setFeedback(null)
    return queryClient.invalidateQueries({ queryKey: orpc.org.key() })
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
          <div className="grid items-start gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
            <RailSkeleton rows={7} />
            <EditorSkeleton />
          </div>
        }
      >
        {types ? (
          <div className="grid items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)_16rem]">
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
          <div className="grid items-start gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
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
    <div className="flex min-w-0 flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            value={search}
            placeholder={format(m.searchPlaceholder)}
            aria-label={format(m.searchPlaceholder)}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={() => setCollapsed(new Set())}
        >
          {format(m.expandAll)}
        </Button>
      </div>
      <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
        <div className="max-h-[60vh] min-h-0 overflow-auto p-1">
          {matches !== null ? (
            // what a search leaves is a set of matches, not a tree: the
            // branches that would lead to them are not part of the answer
            matches.length === 0 ? (
              <p className="px-2 py-1.5 text-sm text-muted-foreground">{format(m.searchEmpty)}</p>
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
            <p className="px-2 py-1.5 text-sm text-muted-foreground">{format(m.treeEmpty)}</p>
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
        <div className="flex shrink-0 items-center gap-2 border-t px-2.5 py-2">
          <span className="shrink-0 text-xs text-muted-foreground">
            {format(m.unitCount, { count: shape.nodes.length })}
          </span>
          <span className="flex-1" />
          <span className="min-w-0 truncate text-xs text-muted-foreground">
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
      className={cn(
        'flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md pr-2 text-left transition-colors hover:bg-accent/70',
        open && 'bg-accent',
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      {expandable ? (
        collapsed === true ? (
          <ChevronRightIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronDownIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
        )
      ) : (
        <span aria-hidden className="size-3 shrink-0" />
      )}
      <span className={cn('min-w-0 flex-1 truncate text-sm', open && 'font-medium')}>
        {node.name}
      </span>
      {!node.manageable && (
        <LockIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      )}
      <span
        className="shrink-0 text-xs tabular-nums text-muted-foreground"
        data-headcount={headcount}
      >
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
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <h2 className="shrink-0 text-base font-semibold">{node.name}</h2>
          <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 text-xs font-medium">
            {typeName(node.orgTypeId)}
          </span>
          <span className="flex-1" />
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
            className="flex items-center gap-2"
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
              className="max-w-72"
            />
            <Button size="sm" type="submit" disabled={name.trim() === '' || name === node.name}>
              {format(m.save)}
            </Button>
          </form>
        )}
        {moving && (
          <form
            className="flex items-center gap-2"
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
              <SelectTrigger aria-label={format(m.moveTo)} className="max-w-96 flex-1">
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

        {!node.manageable && <p className="text-sm text-muted-foreground">{format(m.readOnly)}</p>}

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

      <div className="flex min-w-0 flex-col gap-2.5 border-t pt-4">
        <SectionHead
          title={format(m.childrenTitle)}
          count={children.length}
          aside={
            allowedChildTypes.length === 0
              ? format(m.noChildrenAllowed)
              : format(m.allowedHere, { types: listJoin(allowedChildTypes.map((t) => t.name)) })
          }
        />
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
          {children.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{format(m.childrenEmpty)}</p>
          ) : (
            children.map((child) => (
              <button
                key={child.id}
                type="button"
                onClick={() => onOpen(child.id)}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)_5rem_5rem_3.5rem] items-center gap-3 border-t px-4 py-2.5 text-left first:border-t-0 hover:bg-accent/70"
              >
                <span className="min-w-0 truncate text-sm font-medium">{child.name}</span>
                <span className="text-xs text-muted-foreground">{typeName(child.orgTypeId)}</span>
                <span className="text-right text-xs tabular-nums text-muted-foreground">
                  {format(m.childCount, { count: (shape.childrenOf.get(child.id) ?? []).length })}
                </span>
                <span className="inline-flex items-center justify-end gap-0.5 text-xs text-muted-foreground">
                  {format(m.open)}
                  <ChevronRightIcon aria-hidden className="size-3" />
                </span>
              </button>
            ))
          )}
          {node.manageable && allowedChildTypes.length > 0 && (
            <form
              className="flex min-w-0 items-center gap-2 border-t px-4 py-2"
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
                className="flex-1 border-dashed"
              />
              <Select value={childTypeId} onValueChange={setChildTypeId}>
                <SelectTrigger aria-label={format(m.selectType)} className="w-36 shrink-0">
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
                className="shrink-0"
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
      <div className="flex min-w-0 flex-col gap-2.5 border-t pt-4">
        <SectionHead
          title={format(m.peopleTitle)}
          count={format(m.peopleCount, { count: headcount })}
        />
        <PageLink
          page="auth/users"
          search={{ anchor: node.id, scope: 'self' }}
          className="w-fit text-sm font-medium hover:underline"
          unavailable={null}
        >
          {format(m.peopleOpen)}
        </PageLink>
      </div>

      {node.manageable && !isRoot && (
        <div className="flex min-w-0 flex-col gap-3 border-t pt-4">
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
            className="w-fit"
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
    return <p className="text-sm text-muted-foreground">{format(m.typeListEmpty)}</p>
  }
  return (
    <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
      {shape.types.map((type) => {
        const held = childNames(type.id)
        return (
          <button
            key={type.id}
            type="button"
            aria-current={type.id === openId}
            onClick={() => onOpen(type.id)}
            className={cn(
              'flex min-w-0 flex-col gap-0.5 border-t px-3 py-2.5 text-left first:border-t-0 hover:bg-accent/70',
              type.id === openId && 'bg-accent',
            )}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={cn(
                  'shrink-0 text-sm',
                  type.id === openId ? 'font-semibold' : 'font-medium',
                )}
              >
                {type.name}
              </span>
              <span className="flex-1" />
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {format(m.typeNodeCount, { count: shape.nodesOfType.get(type.id) ?? 0 })}
              </span>
            </span>
            <span className="min-w-0 truncate text-xs text-muted-foreground">
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
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-center gap-2.5">
        <h2 className="shrink-0 text-base font-semibold">{type.name}</h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {format(m.typeNodeCount, { count: inUse })}
        </span>
        <span className="flex-1" />
        {canManage && (
          <Button size="sm" variant="outline" onClick={() => setRenaming((current) => !current)}>
            {format(m.rename)}
          </Button>
        )}
      </div>
      {renaming && (
        <form
          className="flex items-center gap-2"
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
            className="max-w-72"
          />
          <Button size="sm" type="submit" disabled={name.trim() === '' || name === type.name}>
            {format(m.save)}
          </Button>
        </form>
      )}

      <div className="flex min-w-0 flex-col gap-2.5">
        <SectionHead
          title={format(m.allowedChildrenTitle)}
          aside={format(m.chosenCount, { count: draft.size })}
        />
        <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          {shape.types.map((candidate) => (
            <label
              key={candidate.id}
              className="flex min-w-0 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 hover:bg-accent/70"
            >
              <Checkbox
                className="size-4"
                checked={draft.has(candidate.id)}
                disabled={!canManage}
                onCheckedChange={(checked) => {
                  const next = new Set(draft)
                  if (checked === true) next.add(candidate.id)
                  else next.delete(candidate.id)
                  setDraft(next)
                }}
              />
              <span className="min-w-0 flex-1 truncate text-sm">{candidate.name}</span>
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {shape.nodesOfType.get(candidate.id) ?? 0}
              </span>
            </label>
          ))}
        </div>
        {canManage && (
          <Button size="sm" className="w-fit" disabled={!dirty} onClick={saveRules}>
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
              className="shrink-0"
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
    <div className="flex min-w-0 flex-col gap-2.5">
      <SectionHead title={format(m.ladderTitle)} />
      <div className="flex min-w-0 flex-col gap-1 overflow-hidden rounded-lg border bg-muted/40 px-3 py-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{format(m.ladderEmpty)}</p>
        ) : (
          rows.map((row, at) => (
            <div
              key={`${row.name}-${at}`}
              className="flex min-w-0 items-center gap-1.5 text-sm"
              style={{ paddingLeft: row.depth * 14 }}
            >
              {row.depth > 0 && <span className="text-muted-foreground">└</span>}
              <span className={cn('min-w-0 truncate', row.depth === 0 && 'font-medium')}>
                {row.name}
              </span>
            </div>
          ))
        )}
      </div>
      <p className="text-xs text-muted-foreground">
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
        <PlusIcon aria-hidden className="size-3" />
        {format(m.newTypeTitle)}
      </Button>
    )
  }
  return (
    <form
      className="flex items-center gap-2"
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
        className="w-40"
      />
      <Button size="sm" type="submit" disabled={name.trim() === ''}>
        {format(m.create)}
      </Button>
    </form>
  )
}
