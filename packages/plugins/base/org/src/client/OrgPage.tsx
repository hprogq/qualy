import type { Effect } from 'effect'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState, type ReactNode } from 'react'
import { ChevronRightIcon, LockIcon } from 'lucide-react'
import { useApi, useRunApi, useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog, Feedback, Field, PageHeader } from '@qualy/ui/admin'
import { PageContainer } from '@qualy/ui/page-container'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Card, CardContent } from '@qualy/ui/card'
import { Checkbox } from '@qualy/ui/checkbox'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { NativeSelect } from '@qualy/ui/native-select'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { cn } from '@qualy/ui/cn'
import type { ApiResult } from '@qualy/web-runtime/api'
import { orgMessages as m } from './i18n.ts'
import { orgApi } from './api.ts'

// The organization, on one screen with two faces.
//
// The structure face is a master-detail: the tree on the left is for finding
// a unit, everything about the chosen unit - its place, its children, what
// may be created under it - lives on the right. The types face administers
// the grammar the structure follows: which kind of unit may hold which,
// edited per type rather than as a bare list of parent-child pairs, because
// "what may a college contain" is the question somebody actually has.
//
// Mutation controls only render on what the server marked manageable; the
// server enforces regardless.

type OrgTreeNodeDto = ApiResult<typeof orgApi, 'org', 'getTree'>['nodes'][number]
type OrgTypeDto = ApiResult<typeof orgApi, 'org', 'listTypes'>['types'][number]
type OrgRuleDto = ApiResult<typeof orgApi, 'org', 'listRules'>['rules'][number]
type Api = ReturnType<typeof useApi>

/** everything both faces read, computed once from the three queries */
interface OrgShape {
  nodes: readonly OrgTreeNodeDto[]
  byId: ReadonlyMap<string, OrgTreeNodeDto>
  childrenOf: ReadonlyMap<string, readonly OrgTreeNodeDto[]>
  roots: readonly OrgTreeNodeDto[]
  types: readonly OrgTypeDto[]
  rules: readonly OrgRuleDto[]
  /** how many units stand on each type, for the counts beside the checkboxes */
  nodesOfType: ReadonlyMap<string, number>
}

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

  // targeted invalidation: only this plugin's queries, never the whole cache
  const refresh = () => {
    setFeedback(null)
    return queryClient.invalidateQueries({ queryKey: orpc.org.key() })
  }
  // the one crossing from an effect to a promise on this screen; typed api
  // errors localize from their code, the english message is the last resort
  const run = (work: Effect.Effect<unknown, unknown>) =>
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
    const types = typesQuery.data?.types ?? []
    const nodesOfType = new Map<string, number>()
    for (const node of nodes) {
      nodesOfType.set(node.orgTypeId, (nodesOfType.get(node.orgTypeId) ?? 0) + 1)
    }
    return {
      nodes,
      byId,
      childrenOf,
      roots,
      types,
      rules: rulesQuery.data?.rules ?? [],
      nodesOfType,
    }
  }, [treeQuery.data, typesQuery.data, rulesQuery.data])

  const selected = selectedId ? shape.byId.get(selectedId) : undefined
  const rootManageable = shape.nodes.some((node) => !node.parentId && node.manageable)
  const showingTypes = view === 'types'

  return (
    <PageContainer size="wide" className="space-y-5">
      <PageHeader
        title={format(m.treeTitle)}
        description={format(showingTypes ? m.typesHint : m.structureHint)}
        actions={
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={0}
            value={showingTypes ? 'types' : 'structure'}
            aria-label={format(m.viewStructure)}
            onValueChange={(next) => next !== '' && setView(next === 'types' ? 'types' : '')}
          >
            <ToggleGroupItem value="structure">{format(m.viewStructure)}</ToggleGroupItem>
            <ToggleGroupItem value="types">{format(m.viewTypes)}</ToggleGroupItem>
          </ToggleGroup>
        }
      />
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
      >
        {showingTypes ? (
          <TypesFace
            shape={shape}
            api={api}
            run={run}
            canManage={rootManageable}
            selectedTypeId={selectedTypeId}
            onSelectType={setSelectedTypeId}
          />
        ) : (
          <StructureFace
            shape={shape}
            api={api}
            run={run}
            selected={selected}
            onSelect={(id) => {
              setSelectedId(id)
              setFeedback(null)
            }}
          />
        )}
      </AsyncSection>
    </PageContainer>
  )
}

// --- the structure face ---

function StructureFace({
  shape,
  api,
  run,
  selected,
  onSelect,
}: {
  shape: OrgShape
  api: Api
  run: (work: Effect.Effect<unknown, unknown>) => Promise<unknown>
  selected: OrgTreeNodeDto | undefined
  onSelect: (id: string) => void
}) {
  const { format } = useI18n()
  const [search, setSearch] = useState('')
  const term = search.trim().toLowerCase()
  const matches =
    term === '' ? null : shape.nodes.filter((node) => node.name.toLowerCase().includes(term))

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <Card className="lg:sticky lg:top-20">
        <CardContent className="space-y-3 pt-5">
          <Input
            value={search}
            placeholder={format(m.searchPlaceholder)}
            aria-label={format(m.searchPlaceholder)}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className="max-h-[60vh] overflow-auto">
            {matches !== null ? (
              // what a search leaves is a set of matches, not a tree: the
              // branches that would lead to them are not part of the answer
              matches.length === 0 ? (
                <p className="p-1 text-sm text-muted-foreground">{format(m.searchEmpty)}</p>
              ) : (
                <ul className="flex flex-col gap-0.5">
                  {matches.map((node) => (
                    <li key={node.id}>
                      <TreeName
                        node={node}
                        depth={0}
                        selected={selected?.id === node.id}
                        childCount={(shape.childrenOf.get(node.id) ?? []).length}
                        onSelect={() => onSelect(node.id)}
                      />
                    </li>
                  ))}
                </ul>
              )
            ) : shape.roots.length === 0 ? (
              <p className="p-1 text-sm text-muted-foreground">{format(m.treeEmpty)}</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {shape.roots.map((root) => (
                  <TreeBranch
                    key={root.id}
                    node={root}
                    depth={0}
                    shape={shape}
                    selectedId={selected?.id ?? null}
                    onSelect={onSelect}
                  />
                ))}
              </ul>
            )}
          </div>
          <p className="border-t pt-2 text-xs text-muted-foreground">
            {format(m.unitCount, { count: shape.nodes.length })}
          </p>
        </CardContent>
      </Card>

      {selected ? (
        <NodePanel
          key={selected.id}
          node={selected}
          shape={shape}
          api={api}
          run={run}
          onOpen={onSelect}
        />
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {format(m.selectHint)}
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function TreeBranch({
  node,
  depth,
  shape,
  selectedId,
  onSelect,
}: {
  node: OrgTreeNodeDto
  depth: number
  shape: OrgShape
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const children = shape.childrenOf.get(node.id) ?? []
  // the first two levels open by themselves: a reader lands on the school
  // and its colleges, and digs from there
  const [open, setOpen] = useState(depth < 2)
  return (
    <li>
      <div className="flex items-center">
        {children.length > 0 ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((current) => !current)}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent"
            style={{ marginLeft: depth * 16 }}
          >
            <ChevronRightIcon
              className={cn('size-3.5 transition-transform', open && 'rotate-90')}
            />
          </button>
        ) : (
          <span className="size-6 shrink-0" style={{ marginLeft: depth * 16 }} />
        )}
        <TreeName
          node={node}
          depth={0}
          selected={selectedId === node.id}
          childCount={children.length}
          onSelect={() => onSelect(node.id)}
        />
      </div>
      {open && children.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {children.map((child) => (
            <TreeBranch
              key={child.id}
              node={child}
              depth={depth + 1}
              shape={shape}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

function TreeName({
  node,
  depth,
  selected,
  childCount,
  onSelect,
}: {
  node: OrgTreeNodeDto
  depth: number
  selected: boolean
  childCount: number
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      aria-current={selected}
      data-node-name={node.name}
      onClick={onSelect}
      className={cn(
        'flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-accent',
        selected && 'bg-accent font-medium',
      )}
      style={depth > 0 ? { marginLeft: depth * 16 } : undefined}
    >
      <span className="min-w-0 flex-1 truncate">{node.name}</span>
      {!node.manageable && (
        <LockIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
      )}
      {childCount > 0 && (
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{childCount}</span>
      )}
    </button>
  )
}

function NodePanel({
  node,
  shape,
  api,
  run,
  onOpen,
}: {
  node: OrgTreeNodeDto
  shape: OrgShape
  api: Api
  run: (work: Effect.Effect<unknown, unknown>) => Promise<unknown>
  onOpen: (id: string) => void
}) {
  const { format } = useI18n()
  const [name, setName] = useState(node.name)
  const [childName, setChildName] = useState('')
  const [childTypeId, setChildTypeId] = useState('')
  const [moveTargetId, setMoveTargetId] = useState('')
  const [newTypeId, setNewTypeId] = useState(node.orgTypeId)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const isRoot = !node.parentId
  const children = shape.childrenOf.get(node.id) ?? []
  const typeName = (id: string) =>
    shape.types.find((type) => type.id === id)?.name ?? format(m.unknownType)

  // the kinds of unit this unit may hold, by the rules as they stand: the
  // create control offers only what the api would accept
  const allowedChildTypes = shape.rules
    .filter((rule) => rule.parentTypeId === node.orgTypeId)
    .map((rule) => shape.types.find((type) => type.id === rule.childTypeId))
    .filter((type): type is OrgTypeDto => type !== undefined)

  // the position, spelled from the top: a class name alone says which class
  // but never whose
  const path: OrgTreeNodeDto[] = []
  for (let at: OrgTreeNodeDto | undefined = node; at;) {
    path.unshift(at)
    at = at.parentId ? shape.byId.get(at.parentId) : undefined
  }
  const siblings = node.parentId ? (shape.childrenOf.get(node.parentId) ?? []) : shape.roots
  const rank = siblings.findIndex((sibling) => sibling.id === node.id) + 1

  // legal new parents only: manageable, outside this subtree, and of a type
  // the rules allow to hold this unit
  const descendants = new Set<string>()
  const collect = (id: string) => {
    descendants.add(id)
    for (const child of shape.childrenOf.get(id) ?? []) collect(child.id)
  }
  collect(node.id)
  const parentTypesAllowed = new Set(
    shape.rules
      .filter((rule) => rule.childTypeId === node.orgTypeId)
      .map((rule) => rule.parentTypeId),
  )
  const moveTargets = shape.nodes.filter(
    (candidate) =>
      candidate.manageable &&
      !descendants.has(candidate.id) &&
      candidate.id !== node.parentId &&
      parentTypesAllowed.has(candidate.orgTypeId),
  )

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-5 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 text-base font-semibold">
              {node.name}
              <Badge variant="secondary">{typeName(node.orgTypeId)}</Badge>
            </h2>
          </div>
          <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <MetaRow label={format(m.parentLabel)}>
              {node.parentId ? (shape.byId.get(node.parentId)?.name ?? '—') : '—'}
            </MetaRow>
            <MetaRow label={format(m.rankLabel)}>
              {rank > 0 ? format(m.siblingRank, { rank, total: siblings.length }) : '—'}
            </MetaRow>
            <MetaRow label={format(m.pathLabel)}>
              <span className="min-w-0 truncate">{path.map((step) => step.name).join(' / ')}</span>
            </MetaRow>
          </dl>
          {!node.manageable && (
            <p className="text-sm text-muted-foreground">{format(m.readOnly)}</p>
          )}
          {node.manageable && (
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <Field label={format(m.nameLabel)}>
                {(id) => (
                  <div className="flex gap-2">
                    <Input id={id} value={name} onChange={(event) => setName(event.target.value)} />
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0"
                      disabled={name.trim() === '' || name === node.name}
                      onClick={() =>
                        void run(
                          api.org.updateNode({ params: { nodeId: node.id }, payload: { name } }),
                        )
                      }
                    >
                      {format(m.rename)}
                    </Button>
                  </div>
                )}
              </Field>
              <Field label={format(m.nodeType)}>
                {(id) => (
                  <div className="flex gap-2">
                    <NativeSelect
                      id={id}
                      className="flex-1"
                      value={newTypeId}
                      onChange={(event) => setNewTypeId(event.target.value)}
                    >
                      {shape.types.map((type) => (
                        <option key={type.id} value={type.id}>
                          {type.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0"
                      disabled={newTypeId === node.orgTypeId}
                      onClick={() =>
                        void run(
                          api.org.changeNodeType({
                            params: { nodeId: node.id },
                            payload: { orgTypeId: newTypeId },
                          }),
                        )
                      }
                    >
                      {format(m.changeType)}
                    </Button>
                  </div>
                )}
              </Field>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-sm font-semibold">
              {format(m.childrenTitle)}
              <span className="ml-2 font-normal text-muted-foreground">{children.length}</span>
            </h3>
            {node.manageable && allowedChildTypes.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {format(m.allowedHere, {
                  types: allowedChildTypes.map((type) => type.name).join('，'),
                })}
              </p>
            )}
          </div>
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {format(allowedChildTypes.length === 0 ? m.noChildrenAllowed : m.childrenEmpty)}
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {children.map((child) => (
                <li key={child.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{child.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {typeName(child.orgTypeId)}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {format(m.childCount, {
                      count: (shape.childrenOf.get(child.id) ?? []).length,
                    })}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => onOpen(child.id)}>
                    {format(m.open)}
                    <ChevronRightIcon />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {node.manageable && allowedChildTypes.length > 0 && (
            <form
              className="flex flex-wrap items-center gap-2"
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
                className="w-56 flex-1"
                placeholder={format(m.namePlaceholder)}
                aria-label={format(m.namePlaceholder)}
                value={childName}
                onChange={(event) => setChildName(event.target.value)}
              />
              <NativeSelect
                aria-label={format(m.selectType)}
                value={childTypeId}
                onChange={(event) => setChildTypeId(event.target.value)}
              >
                <option value="">{format(m.selectType)}</option>
                {allowedChildTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.name}
                  </option>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                type="submit"
                disabled={childName.trim() === '' || childTypeId === ''}
              >
                {format(m.create)}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {node.manageable && !isRoot && (
        <Card>
          <CardContent className="space-y-4 pt-5">
            {node.subtreeManageable && (
              <Field label={format(m.moveTo)}>
                {(id) => (
                  <div className="flex gap-2">
                    <NativeSelect
                      id={id}
                      className="flex-1 sm:max-w-96"
                      value={moveTargetId}
                      onChange={(event) => setMoveTargetId(event.target.value)}
                    >
                      <option value="">{format(m.selectParent)}</option>
                      {moveTargets.map((candidate) => (
                        <option key={candidate.id} value={candidate.id}>
                          {candidate.name}
                        </option>
                      ))}
                    </NativeSelect>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0"
                      disabled={moveTargetId === ''}
                      onClick={() =>
                        void run(
                          api.org.setNodePlacement({
                            params: { nodeId: node.id },
                            payload: { parentId: moveTargetId },
                          }),
                        )
                      }
                    >
                      {format(m.move)}
                    </Button>
                  </div>
                )}
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={children.length > 0}
                onClick={() => setConfirmingDelete(true)}
              >
                {format(m.deleteNode)}
              </Button>
              {children.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  {format(m.deleteBlockedChildren, { count: children.length })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
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

function MetaRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 gap-2">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center">{children}</dd>
    </div>
  )
}

// --- the types face ---

function TypesFace({
  shape,
  api,
  run,
  canManage,
  selectedTypeId,
  onSelectType,
}: {
  shape: OrgShape
  api: Api
  run: (work: Effect.Effect<unknown, unknown>) => Promise<unknown>
  canManage: boolean
  selectedTypeId: string
  onSelectType: (id: string) => void
}) {
  const { format } = useI18n()
  const [newTypeName, setNewTypeName] = useState('')
  const selected = shape.types.find((type) => type.id === selectedTypeId) ?? shape.types[0]
  const childNames = (typeId: string) =>
    shape.rules
      .filter((rule) => rule.parentTypeId === typeId)
      .map((rule) => shape.types.find((type) => type.id === rule.childTypeId)?.name)
      .filter((name): name is string => name !== undefined)

  return (
    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <Card className="lg:sticky lg:top-20">
        <CardContent className="space-y-3 pt-5">
          {shape.types.length === 0 ? (
            <p className="text-sm text-muted-foreground">{format(m.typeListEmpty)}</p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {shape.types.map((type) => {
                const held = childNames(type.id)
                return (
                  <li key={type.id}>
                    <button
                      type="button"
                      aria-current={selected?.id === type.id}
                      onClick={() => onSelectType(type.id)}
                      className={cn(
                        'flex w-full flex-col gap-0.5 rounded-md px-2.5 py-2 text-left hover:bg-accent',
                        selected?.id === type.id && 'bg-accent',
                      )}
                    >
                      <span className="flex items-baseline justify-between gap-2 text-sm font-medium">
                        {type.name}
                        <span className="font-normal text-muted-foreground tabular-nums">
                          {format(m.typeNodeCount, { count: shape.nodesOfType.get(type.id) ?? 0 })}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {held.length === 0
                          ? format(m.noChildrenAllowed)
                          : format(m.allowedHere, { types: held.join('，') })}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {canManage && (
            <form
              className="flex items-center gap-2 border-t pt-3"
              onSubmit={(event) => {
                event.preventDefault()
                void run(api.org.createType({ payload: { name: newTypeName } })).then(() =>
                  setNewTypeName(''),
                )
              }}
            >
              <Input
                placeholder={format(m.newTypeTitle)}
                aria-label={format(m.newTypeTitle)}
                value={newTypeName}
                onChange={(event) => setNewTypeName(event.target.value)}
              />
              <Button size="sm" type="submit" disabled={newTypeName.trim() === ''}>
                {format(m.create)}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      {selected ? (
        <TypePanel
          key={selected.id}
          type={selected}
          shape={shape}
          api={api}
          run={run}
          canManage={canManage}
        />
      ) : (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {format(m.typeListEmpty)}
          </CardContent>
        </Card>
      )}
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
  run: (work: Effect.Effect<unknown, unknown>) => Promise<unknown>
  canManage: boolean
}) {
  const { format } = useI18n()
  const [name, setName] = useState(type.name)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const inUse = shape.nodesOfType.get(type.id) ?? 0

  // the rules as stored, and the rules as edited: saving writes the diff,
  // one put or delete per changed pair
  const storedChildren = useMemo(
    () =>
      new Set(
        shape.rules.filter((rule) => rule.parentTypeId === type.id).map((rule) => rule.childTypeId),
      ),
    [shape.rules, type.id],
  )
  const [draftChildren, setDraftChildren] = useState<ReadonlySet<string>>(storedChildren)
  const dirty =
    draftChildren.size !== storedChildren.size ||
    [...draftChildren].some((id) => !storedChildren.has(id))

  const allowedUnder = shape.rules
    .filter((rule) => rule.childTypeId === type.id)
    .map((rule) => shape.types.find((candidate) => candidate.id === rule.parentTypeId)?.name)
    .filter((held): held is string => held !== undefined)

  const saveRules = () => {
    const adds = [...draftChildren].filter((id) => !storedChildren.has(id))
    const removals = [...storedChildren].filter((id) => !draftChildren.has(id))
    // sequential on purpose: each pair is its own resource, and a failure
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
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-5 pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2.5 text-base font-semibold">
              {type.name}
              <span className="text-sm font-normal text-muted-foreground tabular-nums">
                {format(m.typeNodeCount, { count: inUse })}
              </span>
            </h2>
          </div>
          {canManage && (
            <Field label={format(m.nameLabel)}>
              {(id) => (
                <div className="flex gap-2">
                  <Input
                    id={id}
                    className="sm:max-w-72"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-9 shrink-0"
                    disabled={name.trim() === '' || name === type.name}
                    onClick={() =>
                      void run(
                        api.org.updateType({ params: { typeId: type.id }, payload: { name } }),
                      )
                    }
                  >
                    {format(m.rename)}
                  </Button>
                </div>
              )}
            </Field>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 pt-5">
          <div>
            <h3 className="text-sm font-semibold">{format(m.allowedChildrenTitle)}</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">{format(m.allowedChildrenHint)}</p>
          </div>
          <ul className="grid gap-2 sm:grid-cols-2">
            {shape.types.map((candidate) => (
              <li key={candidate.id}>
                <Label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm has-[[data-state=checked]]:border-foreground/40">
                  <Checkbox
                    checked={draftChildren.has(candidate.id)}
                    disabled={!canManage}
                    onCheckedChange={(checked) => {
                      const next = new Set(draftChildren)
                      if (checked === true) next.add(candidate.id)
                      else next.delete(candidate.id)
                      setDraftChildren(next)
                    }}
                  />
                  <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {shape.nodesOfType.get(candidate.id) ?? 0}
                  </span>
                </Label>
              </li>
            ))}
          </ul>
          {canManage && (
            <Button size="sm" disabled={!dirty} onClick={saveRules}>
              {format(m.saveRules)}
            </Button>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 pt-5">
          <div className="flex flex-wrap gap-2 text-sm">
            <span className="text-muted-foreground">{format(m.allowedUnder)}</span>
            <span>
              {allowedUnder.length === 0 ? format(m.allowedUnderNone) : allowedUnder.join('，')}
            </span>
          </div>
          {canManage && (
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button
                size="sm"
                variant="outline"
                className="text-destructive"
                disabled={inUse > 0}
                onClick={() => setConfirmingDelete(true)}
              >
                {format(m.delete)}
              </Button>
              {inUse > 0 && (
                <p className="text-xs text-muted-foreground">
                  {format(m.typeInUseHint, { count: inUse })}
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

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
