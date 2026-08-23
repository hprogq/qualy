import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { PageLink, useApi, useRunApi, useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback, PageHeader } from '@qualy/ui/admin'
import { PageContainer } from '@qualy/ui/page-container'
import { Button } from '@qualy/ui/button'
import { Card, CardContent } from '@qualy/ui/card'
import { Input } from '@qualy/ui/input'
import { NativeSelect } from '@qualy/ui/native-select'
import { Spinner } from '@qualy/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@qualy/ui/toggle-group'
import { iamMessages as m } from '../i18n.ts'
import { NewUserForm } from './NewUserForm.tsx'
import { OrgTree } from './OrgTree.tsx'
import { authApi } from '../api.ts'

// People are administered where they stand, so the screen is the
// organization first: the tree on the left says where you are looking, the
// roster on the right says who stands there. The anchor, the scope and the
// search term live in the query string - exactly the state someone wants
// back after a reload or in a link sent to a colleague.
export default function UsersPage() {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const orpc = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const [anchor, setAnchor] = usePageQueryState('anchor')
  const [scope, setScope] = usePageQueryState('scope', 'subtree')
  const [typeFilter, setTypeFilter] = usePageQueryState('type')
  const [search, setSearch] = usePageQueryState('q')
  const [draft, setDraft] = useState(search)
  const [treeSearch, setTreeSearch] = useState('')

  // one call gives the units this caller may see, the types they may hand
  // out, and the tree the left pane draws - no permission beyond its own
  const options = useQuery(orpc.identity.getUserOptions.queryOptions({ query: {} }))
  const nodes = useMemo(() => options.data?.nodes ?? [], [options.data])
  const active = nodes.find((entry) => entry.orgNodeId === anchor) ?? nodes[0]
  const userTypes = options.data?.userTypes ?? []

  // typing should not fire a request per keystroke
  useEffect(() => {
    const timer = setTimeout(() => setSearch(draft), 300)
    return () => clearTimeout(timer)
  }, [draft, setSearch])

  const filterQuery = {
    orgNodeId: active?.orgNodeId ?? '',
    scope: scope === 'self' ? ('self' as const) : ('subtree' as const),
    ...(search ? { search } : {}),
    ...(typeFilter ? { userTypeId: typeFilter } : {}),
  }
  const users = useInfiniteQuery({
    queryKey: [...orpc.identity.listUsers.key({ query: filterQuery }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.identity.listUsers({
          query: { ...filterQuery, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: active !== undefined,
  })
  const rows = useMemo(() => users.data?.pages.flatMap((page) => page.items) ?? [], [users.data])

  // the tree filters client side: the units are already here, and a search
  // answers with the matches rather than the branches leading to them
  const treeTerm = treeSearch.trim().toLowerCase()
  const treeNodes = useMemo(
    () =>
      nodes.map((entry) => ({
        id: entry.orgNodeId,
        name: entry.name,
        parentId: entry.parentId,
        manageable: entry.manageable,
      })),
    [nodes],
  )
  const treeMatches =
    treeTerm === ''
      ? treeNodes
      : treeNodes.filter((node) => node.name.toLowerCase().includes(treeTerm))

  const pathOf = (nodeId: string): string => {
    const byId = new Map(nodes.map((entry) => [entry.orgNodeId, entry]))
    const names: string[] = []
    for (let at = byId.get(nodeId); at; at = at.parentId ? byId.get(at.parentId) : undefined) {
      names.unshift(at.name)
    }
    return names.join(' / ')
  }

  return (
    <PageContainer size="wide" className="space-y-5">
      <PageHeader title={format(m.usersTitle)} description={format(m.usersHint)} />
      {options.isError && <Feedback message={formatError(options.error)} />}
      {!options.isPending && nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{format(m.noAnchors)}</p>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
          <Card className="lg:sticky lg:top-20">
            <CardContent className="space-y-3 pt-5">
              <Input
                value={treeSearch}
                placeholder={format(m.treeSearch)}
                aria-label={format(m.treeSearch)}
                onChange={(event) => setTreeSearch(event.target.value)}
              />
              <div className="max-h-[60vh] overflow-auto">
                <OrgTree
                  nodes={treeMatches}
                  flat={treeTerm !== ''}
                  emptyLabel={format(treeTerm === '' ? m.noAnchors : m.treeSearchEmpty)}
                  expandLabel={format(commonMessages.loading)}
                  selected={active?.orgNodeId ?? null}
                  onSelect={(node) => setAnchor(node.id)}
                />
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-4 pt-5">
                <div className="flex flex-wrap items-center gap-2.5">
                  <Input
                    className="w-full sm:max-w-56"
                    value={draft}
                    placeholder={format(m.searchPlaceholder)}
                    aria-label={format(m.searchPlaceholder)}
                    onChange={(event) => setDraft(event.target.value)}
                  />
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={0}
                    value={scope === 'self' ? 'self' : 'subtree'}
                    aria-label={format(m.scopeLabel)}
                    onValueChange={(next) => next !== '' && setScope(next)}
                  >
                    <ToggleGroupItem value="self">{format(m.scopeSelf)}</ToggleGroupItem>
                    <ToggleGroupItem value="subtree">{format(m.scopeSubtree)}</ToggleGroupItem>
                  </ToggleGroup>
                  <NativeSelect
                    aria-label={format(m.typeFilterLabel)}
                    value={typeFilter}
                    onChange={(event) => setTypeFilter(event.target.value)}
                  >
                    <option value="">{format(m.typeFilterAll)}</option>
                    {userTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </NativeSelect>
                  {users.isFetching && !users.isPending && (
                    <Spinner
                      aria-label={format(commonMessages.loading)}
                      className="ml-auto size-4"
                    />
                  )}
                </div>

                <AsyncSection
                  pending={options.isPending || (users.isPending && active !== undefined)}
                  error={users.isError ? formatError(users.error) : null}
                  loadingLabel={format(commonMessages.loading)}
                  retryLabel={format(commonMessages.retry)}
                  onRetry={() => void users.refetch()}
                >
                  {rows.length === 0 ? (
                    <p className="py-4 text-sm text-muted-foreground">{format(m.usersEmpty)}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="py-2 pr-3 font-normal">{format(m.columnName)}</th>
                            <th className="py-2 pr-3 font-normal">{format(m.columnBusinessNo)}</th>
                            <th className="py-2 pr-3 font-normal">{format(m.columnType)}</th>
                            <th className="py-2 pr-3 font-normal">{format(m.columnUnit)}</th>
                            <th className="py-2 font-normal">{format(m.columnStatus)}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {rows.map((user) => (
                            <tr key={user.id} data-user-status={user.status}>
                              <td className="py-2 pr-3 font-medium">
                                <PageLink page="auth/user-detail" params={{ userId: user.id }}>
                                  {user.displayName}
                                </PageLink>
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground tabular-nums">
                                {user.businessNo ?? '—'}
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground">
                                {user.userType.name}
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground">
                                {user.primaryOrgNode.name}
                              </td>
                              <td className="py-2">
                                {user.status === 'disabled' ? (
                                  <span className="text-destructive">
                                    {format(m.disabledBadge)}
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground">
                                    {format(m.statusActive)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-3 pt-1">
                    <p
                      className="text-xs text-muted-foreground"
                      data-testid="roster-count"
                      data-count={rows.length}
                    >
                      {active !== undefined &&
                        `${pathOf(active.orgNodeId)} · ${format(m.loadedCount, { count: rows.length })}`}
                    </p>
                    {users.hasNextPage && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={users.isFetchingNextPage}
                        onClick={() => void users.fetchNextPage()}
                      >
                        {format(m.loadMore)}
                      </Button>
                    )}
                  </div>
                </AsyncSection>
              </CardContent>
            </Card>

            {active?.manageable && (
              // only the kinds of person this unit may hold: the api refuses
              // the rest, and a picker offering them turns a rule into an
              // error message
              <NewUserForm
                orgNodeId={active.orgNodeId}
                userTypes={userTypes.filter(
                  (type) =>
                    type.placementPolicy.mode === 'unrestricted' ||
                    type.placementPolicy.orgTypeIds.includes(active.orgTypeId),
                )}
              />
            )}
          </div>
        </div>
      )}
    </PageContainer>
  )
}
