import type { Effect } from 'effect'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useApi, useRunApi, useApiQuery } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Alert, AlertDescription, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@qualy/ui/card'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { Spinner } from '@qualy/ui/spinner'
import { commonMessages } from '@qualy/web-i18n/messages'
import type { ApiResult } from '@qualy/api-client/effect'

// the rows as the api answers them, not a copy that can drift from it
type OrgTreeNodeDto = ApiResult<'org', 'getTree'>['nodes'][number]
type OrgTypeDto = ApiResult<'org', 'listTypes'>['types'][number]
import { orgMessages as m } from './i18n.ts'

// minimal org management: tree with selection, node crud, parent-selector
// move and basic type/rule administration. Mutation controls only render on
// nodes the server marked manageable; the server enforces regardless.
export default function OrgPage() {
  const api = useApi()
  const runApi = useRunApi()
  const orpc = useApiQuery()
  const { format, formatError } = useI18n()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const treeQuery = useQuery(orpc.org.getTree.queryOptions({ query: {} }))
  const typesQuery = useQuery(orpc.org.listTypes.queryOptions())
  const rulesQuery = useQuery(orpc.org.listRules.queryOptions())

  // targeted invalidation: only this plugin's queries, never the whole
  // cache (me, manifest and other plugins are unaffected by org mutations)
  const refresh = () => {
    setFeedback(null)
    return queryClient.invalidateQueries({ queryKey: orpc.org.key() })
  }
  // typed api errors localize from their code and data; the backend's
  // english message is only the last resort
  // the one crossing from an effect to a promise on this screen
  const run = (work: Effect.Effect<unknown, unknown>) =>
    runApi(work)
      .then(refresh)
      .catch((error: unknown) => {
        setFeedback(formatError(error))
      })

  const nodes = useMemo(() => treeQuery.data?.nodes ?? [], [treeQuery.data])
  const byId = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const rootIds = useMemo(() => new Set(treeQuery.data?.roots ?? []), [treeQuery.data])
  const children = useMemo(() => {
    const map = new Map<string, OrgTreeNodeDto[]>()
    for (const node of nodes) {
      // forest roots always render top-level, never nested under another
      // visible node (a bare self anchor can be the ancestor of a granted
      // subtree; both are roots of the forest)
      if (!node.parentId || rootIds.has(node.id) || !byId.has(node.parentId)) continue
      const siblings = map.get(node.parentId) ?? []
      siblings.push(node)
      map.set(node.parentId, siblings)
    }
    for (const siblings of map.values()) {
      siblings.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    }
    return map
  }, [nodes, byId, rootIds])
  const types = typesQuery.data?.types ?? []
  const typeName = (id: string) => types.find((type) => type.id === id)?.name ?? format(m.unknownType)
  const selected = selectedId ? byId.get(selectedId) : undefined
  const rootManageable = nodes.some((node) => !node.parentId && node.manageable)

  if (treeQuery.isPending || typesQuery.isPending || rulesQuery.isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (treeQuery.isError || typesQuery.isError || rulesQuery.isError) {
    return (
      <Alert variant="destructive">
        <AlertTitle>{format(m.loadFailedTitle)}</AlertTitle>
        <AlertDescription className="mt-2 space-y-3">
          <p>{format(m.loadFailedHint)}</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {format(commonMessages.retry)}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  const renderNode = (node: OrgTreeNodeDto): React.ReactNode => (
    <li key={node.id}>
      <button
        type="button"
        onClick={() => {
          setSelectedId(node.id)
          setFeedback(null)
        }}
        className={`w-full rounded px-2 py-1 text-left text-sm hover:bg-accent ${
          node.id === selectedId ? 'bg-accent font-medium' : ''
        }`}
      >
        {node.name}
        <span className="ml-2 text-xs text-muted-foreground">{typeName(node.orgTypeId)}</span>
      </button>
      {(children.get(node.id) ?? []).length > 0 && (
        <ul className="ml-4 border-l pl-2">{children.get(node.id)!.map(renderNode)}</ul>
      )}
    </li>
  )
  const roots = treeQuery.data.roots.map((id) => byId.get(id)).filter(Boolean) as OrgTreeNodeDto[]

  return (
    <div className="space-y-4 p-4">
      {feedback && (
        <Alert variant="destructive">
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{format(m.treeTitle)}</CardTitle>
          </CardHeader>
          <CardContent>
            {roots.length === 0 ? (
              <p className="text-sm text-muted-foreground">{format(m.treeEmpty)}</p>
            ) : (
              <ul className="space-y-1">{roots.map(renderNode)}</ul>
            )}
          </CardContent>
        </Card>
        <div className="space-y-4">
          {selected ? (
            <NodePanel
              key={selected.id}
              node={selected}
              nodes={nodes}
              types={types}
              onAction={run}
              api={api}
              onDeleted={() => setSelectedId(null)}
            />
          ) : (
            <Card>
              <CardContent className="pt-6 text-sm text-muted-foreground">
                {format(m.selectHint)}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
      {rootManageable && (
        <TypeRuleAdmin
          types={types}
          rules={rulesQuery.data.rules}
          api={api}
          onAction={run}
        />
      )}
    </div>
  )
}

type Api = ReturnType<typeof useApi>

function NodePanel({
  node,
  nodes,
  types,
  api,
  onAction,
  onDeleted,
}: {
  node: OrgTreeNodeDto
  nodes: readonly OrgTreeNodeDto[]
  types: readonly OrgTypeDto[]
  api: Api
  onAction: (work: Effect.Effect<unknown, unknown>) => Promise<unknown>
  onDeleted: () => void
}) {
  const { format } = useI18n()
  const [name, setName] = useState(node.name)
  const [childName, setChildName] = useState('')
  const [childTypeId, setChildTypeId] = useState('')
  const [moveTargetId, setMoveTargetId] = useState('')
  const [newTypeId, setNewTypeId] = useState(node.orgTypeId)
  const isRoot = !node.parentId
  // valid move targets: manageable nodes outside this node's subtree; the
  // subtree relation is recomputed from parent pointers client-side
  const descendants = new Set<string>()
  const collect = (id: string) => {
    descendants.add(id)
    for (const child of nodes.filter((candidate) => candidate.parentId === id)) collect(child.id)
  }
  collect(node.id)
  const moveTargets = nodes.filter(
    (candidate) =>
      candidate.manageable && !descendants.has(candidate.id) && candidate.id !== node.parentId,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {node.name}
          {node.code && <span className="ml-2 text-xs text-muted-foreground">{node.code}</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!node.manageable && (
          <p className="text-sm text-muted-foreground">{format(m.readOnly)}</p>
        )}
        {node.manageable && (
          <>
            <div className="space-y-2">
              <Label htmlFor="org-node-name">{format(m.nameLabel)}</Label>
              <div className="flex gap-2">
                <Input
                  id="org-node-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button
                  size="sm"
                  disabled={name.trim() === '' || name === node.name}
                  onClick={() => void onAction(api.org.updateNode({ params: { nodeId: node.id }, payload: { name } }))}
                >
                  {format(m.rename)}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{format(m.nodeType)}</Label>
              <div className="flex gap-2">
                <select
                  className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
                  value={newTypeId}
                  onChange={(event) => setNewTypeId(event.target.value)}
                >
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={newTypeId === node.orgTypeId}
                  onClick={() =>
                    void onAction(api.org.changeNodeType({ params: { nodeId: node.id }, payload: { orgTypeId: newTypeId } }))
                  }
                >
                  {format(m.changeType)}
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{format(m.createChild)}</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="flex-1"
                  placeholder={format(m.namePlaceholder)}
                  value={childName}
                  onChange={(event) => setChildName(event.target.value)}
                />
                <select
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  value={childTypeId}
                  onChange={(event) => setChildTypeId(event.target.value)}
                >
                  <option value="">{format(m.selectType)}</option>
                  {types.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.name}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={childName.trim() === '' || childTypeId === ''}
                  onClick={() =>
                    void onAction(
                      api.org.createNode({
                        payload: { parentId: node.id, orgTypeId: childTypeId, name: childName },
                      }),
                    ).then(() => setChildName(''),
                    )
                  }
                >
                  {format(m.create)}
                </Button>
              </div>
            </div>
            {!isRoot && node.subtreeManageable && (
              <div className="space-y-2">
                <Label>{format(m.moveTo)}</Label>
                <div className="flex gap-2">
                  <select
                    className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
                    value={moveTargetId}
                    onChange={(event) => setMoveTargetId(event.target.value)}
                  >
                    <option value="">{format(m.selectParent)}</option>
                    {moveTargets.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={moveTargetId === ''}
                    onClick={() =>
                      void onAction(
                        api.org.setNodePlacement({ params: { nodeId: node.id }, payload: { parentId: moveTargetId } }),
                      )
                    }
                  >
                    {format(m.move)}
                  </Button>
                </div>
              </div>
            )}
            {!isRoot && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  void onAction(api.org.deleteNode({ params: { nodeId: node.id } })).then(onDeleted)
                }
              >
                {format(m.deleteNode)}
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TypeRuleAdmin({
  types,
  rules,
  api,
  onAction,
}: {
  types: readonly OrgTypeDto[]
  rules: readonly { readonly parentTypeId: string; readonly childTypeId: string }[]
  api: Api
  onAction: (work: Effect.Effect<unknown, unknown>) => Promise<unknown>
}) {
  const { format } = useI18n()
  const [typeCode, setTypeCode] = useState('')
  const [typeName, setTypeName] = useState('')
  const [ruleParent, setRuleParent] = useState('')
  const [ruleChild, setRuleChild] = useState('')
  const nameOf = (id: string) => types.find((type) => type.id === id)?.name ?? id

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{format(m.typesTitle)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1 text-sm">
            {types.map((type) => (
              <li key={type.id} className="flex items-center justify-between">
                <span>
                  {type.name}
                  <span className="ml-2 text-xs text-muted-foreground">{type.code}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => void onAction(api.org.deleteType({ params: { typeId: type.id } }))}
                >
                  {format(m.delete)}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              placeholder={format(m.codePlaceholder)}
              value={typeCode}
              onChange={(event) => setTypeCode(event.target.value)}
            />
            <Input
              placeholder={format(m.namePlaceholder)}
              value={typeName}
              onChange={(event) => setTypeName(event.target.value)}
            />
            <Button
              size="sm"
              disabled={typeCode.trim() === '' || typeName.trim() === ''}
              onClick={() =>
                void onAction(
                  api.org.createType({ payload: { code: typeCode, name: typeName } }),
                ).then(() => {
                  setTypeCode('')
                  setTypeName('')
                })
              }
            >
              {format(m.create)}
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{format(m.rulesTitle)}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <ul className="space-y-1 text-sm">
            {rules.map((rule) => (
              <li
                key={`${rule.parentTypeId}:${rule.childTypeId}`}
                className="flex items-center justify-between"
              >
                <span>
                  {nameOf(rule.parentTypeId)} → {nameOf(rule.childTypeId)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    void onAction(
                      api.org.deleteRule({ params: { parentTypeId: rule.parentTypeId, childTypeId: rule.childTypeId } }),
                    )
                  }
                >
                  {format(m.delete)}
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <select
              className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
              value={ruleParent}
              onChange={(event) => setRuleParent(event.target.value)}
            >
              <option value="">{format(m.parentType)}</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <select
              className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
              value={ruleChild}
              onChange={(event) => setRuleChild(event.target.value)}
            >
              <option value="">{format(m.childType)}</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
            <Button
              size="sm"
              disabled={ruleParent === '' || ruleChild === ''}
              onClick={() =>
                void onAction(
                  api.org.putRule({ params: { parentTypeId: ruleParent, childTypeId: ruleChild } }),
                )
              }
            >
              {format(m.create)}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
