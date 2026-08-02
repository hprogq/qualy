import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useApi, useApiQuery } from '@qualy/web-runtime'
import { Alert, AlertDescription, AlertTitle } from '@qualy/ui/alert'
import { Button } from '@qualy/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@qualy/ui/card'
import { Input } from '@qualy/ui/input'
import { Label } from '@qualy/ui/label'
import { Spinner } from '@qualy/ui/spinner'
import type { OrgTreeNodeDto, OrgTypeDto } from '@qualy/plugin-org/contract'

// minimal org management: tree with selection, node crud, parent-selector
// move and basic type/rule administration. Mutation controls only render on
// nodes the server marked manageable; the server enforces regardless.
export default function OrgPage() {
  const api = useApi()
  const orpc = useApiQuery()
  const queryClient = useQueryClient()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<string | null>(null)

  const treeQuery = useQuery(orpc.org.getTree.queryOptions({ input: {} }))
  const typesQuery = useQuery(orpc.org.listTypes.queryOptions())
  const rulesQuery = useQuery(orpc.org.listRules.queryOptions())

  // targeted invalidation: only this plugin's queries, never the whole
  // cache (me, manifest and other plugins are unaffected by org mutations)
  const refresh = () => {
    setFeedback(null)
    return queryClient.invalidateQueries({ queryKey: orpc.org.key() })
  }
  const run = (work: Promise<unknown>) =>
    work.then(refresh).catch((error: unknown) => {
      setFeedback(error instanceof Error ? error.message : '操作失败')
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
  const typeName = (id: string) => types.find((type) => type.id === id)?.name ?? '未知类型'
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
        <AlertTitle>组织数据加载失败</AlertTitle>
        <AlertDescription className="mt-2 space-y-3">
          <p>请检查网络或权限后重试。</p>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            重试
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
            <CardTitle>组织树</CardTitle>
          </CardHeader>
          <CardContent>
            {roots.length === 0 ? (
              <p className="text-sm text-muted-foreground">暂无可见的组织节点。</p>
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
                在左侧选择一个节点查看详情。
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
  nodes: OrgTreeNodeDto[]
  types: OrgTypeDto[]
  api: Api
  onAction: (work: Promise<unknown>) => Promise<unknown>
  onDeleted: () => void
}) {
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
          <p className="text-sm text-muted-foreground">你对该节点只有查看权限。</p>
        )}
        {node.manageable && (
          <>
            <div className="space-y-2">
              <Label htmlFor="org-node-name">名称</Label>
              <div className="flex gap-2">
                <Input
                  id="org-node-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
                <Button
                  size="sm"
                  disabled={name.trim() === '' || name === node.name}
                  onClick={() => void onAction(api.org.updateNode({ nodeId: node.id, name }))}
                >
                  重命名
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>节点类型</Label>
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
                    void onAction(api.org.changeNodeType({ nodeId: node.id, orgTypeId: newTypeId }))
                  }
                >
                  修改类型
                </Button>
              </div>
            </div>
            <div className="space-y-2">
              <Label>新建子节点</Label>
              <div className="flex flex-wrap gap-2">
                <Input
                  className="flex-1"
                  placeholder="名称"
                  value={childName}
                  onChange={(event) => setChildName(event.target.value)}
                />
                <select
                  className="h-9 rounded-md border bg-transparent px-2 text-sm"
                  value={childTypeId}
                  onChange={(event) => setChildTypeId(event.target.value)}
                >
                  <option value="">选择类型</option>
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
                      api.org
                        .createNode({ parentId: node.id, orgTypeId: childTypeId, name: childName })
                        .then(() => setChildName('')),
                    )
                  }
                >
                  创建
                </Button>
              </div>
            </div>
            {!isRoot && node.subtreeManageable && (
              <div className="space-y-2">
                <Label>移动到</Label>
                <div className="flex gap-2">
                  <select
                    className="h-9 flex-1 rounded-md border bg-transparent px-2 text-sm"
                    value={moveTargetId}
                    onChange={(event) => setMoveTargetId(event.target.value)}
                  >
                    <option value="">选择新的父节点</option>
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
                        api.org.moveNode({ nodeId: node.id, newParentId: moveTargetId }),
                      )
                    }
                  >
                    移动
                  </Button>
                </div>
              </div>
            )}
            {!isRoot && (
              <Button
                size="sm"
                variant="destructive"
                onClick={() =>
                  void onAction(api.org.deleteNode({ nodeId: node.id }).then(onDeleted))
                }
              >
                删除节点
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
  types: OrgTypeDto[]
  rules: { parentTypeId: string; childTypeId: string }[]
  api: Api
  onAction: (work: Promise<unknown>) => Promise<unknown>
}) {
  const [typeCode, setTypeCode] = useState('')
  const [typeName, setTypeName] = useState('')
  const [ruleParent, setRuleParent] = useState('')
  const [ruleChild, setRuleChild] = useState('')
  const nameOf = (id: string) => types.find((type) => type.id === id)?.name ?? id

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">组织类型</CardTitle>
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
                  onClick={() => void onAction(api.org.deleteType({ typeId: type.id }))}
                >
                  删除
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Input
              placeholder="code(小写连字符)"
              value={typeCode}
              onChange={(event) => setTypeCode(event.target.value)}
            />
            <Input
              placeholder="名称"
              value={typeName}
              onChange={(event) => setTypeName(event.target.value)}
            />
            <Button
              size="sm"
              disabled={typeCode.trim() === '' || typeName.trim() === ''}
              onClick={() =>
                void onAction(
                  api.org
                    .createType({ code: typeCode, name: typeName })
                    .then(() => {
                      setTypeCode('')
                      setTypeName('')
                    }),
                )
              }
            >
              新建
            </Button>
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">层级规则</CardTitle>
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
                      api.org.deleteRule({
                        parentTypeId: rule.parentTypeId,
                        childTypeId: rule.childTypeId,
                      }),
                    )
                  }
                >
                  删除
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
              <option value="">父类型</option>
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
              <option value="">子类型</option>
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
                  api.org.createRule({ parentTypeId: ruleParent, childTypeId: ruleChild }),
                )
              }
            >
              新建
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
