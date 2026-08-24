import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Building2Icon, PlusIcon, SearchIcon, UserRoundIcon } from 'lucide-react'
import { PageLink, useApi, useRunApi, useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import { Blank, RailSkeleton, Screen, SectionHead, Segmented } from '@qualy/ui/screen'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { initialsOf } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { Spinner } from '@qualy/ui/spinner'
import { cn } from '@qualy/ui/cn'
import { iamMessages as m } from '../i18n.ts'
import { NewUserForm } from './NewUserForm.tsx'
import { NodePicker, type PickableNode } from './NodePicker.tsx'
import { OrgTree } from './OrgTree.tsx'
import { authApi } from '../api.ts'

// People are administered where they stand, so the screen reads left to
// right: the unit you are looking at, the people standing there, and the one
// you have open. Three columns rather than a list and a route, because
// checking who somebody is should not cost the roster you were reading.
//
// The unit, the scope, the filters and the open person all live in the query
// string: exactly the state somebody wants back after a reload, or in a link
// sent to a colleague.
// radix refuses an empty select value, and "every type" is a real choice
// rather than the absence of one
const ALL_TYPES = 'all'

export default function UsersPage() {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const orpc = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const [anchor, setAnchor] = usePageQueryState('anchor')
  const [scope, setScope] = usePageQueryState('scope', 'subtree')
  const [typeFilter, setTypeFilter] = usePageQueryState('type')
  const [search, setSearch] = usePageQueryState('q')
  const [openUserId, setOpenUserId] = usePageQueryState('user')
  const [view, setView] = usePageQueryState('view')
  const [draft, setDraft] = useState(search)
  const [treeSearch, setTreeSearch] = useState('')
  const [creating, setCreating] = useState(false)

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

  const filter = {
    orgNodeId: active?.orgNodeId ?? '',
    scope: scope === 'self' ? ('self' as const) : ('subtree' as const),
    ...(view === 'deleted' ? { status: 'deleted' as const } : {}),
    ...(search ? { search } : {}),
    ...(typeFilter ? { userTypeId: typeFilter } : {}),
  }
  const users = useInfiniteQuery({
    queryKey: [...orpc.identity.listUsers.key({ query: filter }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.identity.listUsers({
          query: { ...filter, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
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
    <Screen
      title={format(m.usersTitle)}
      description={format(m.usersHint)}
      size="wide"
      actions={
        active?.manageable && (
          <Button size="sm" onClick={() => setCreating(true)}>
            <PlusIcon aria-hidden />
            {format(m.newUser)}
          </Button>
        )
      }
    >
      {options.isError && <Feedback message={formatError(options.error)} />}
      {!options.isPending && nodes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{format(m.noAnchors)}</p>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="relative">
              <SearchIcon
                aria-hidden
                className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                value={treeSearch}
                placeholder={format(m.treeSearch)}
                aria-label={format(m.treeSearch)}
                onChange={(event) => setTreeSearch(event.target.value)}
                className="pl-9"
              />
            </div>
            <div className="max-h-[60vh] overflow-auto rounded-lg border p-1">
              <OrgTree
                nodes={treeMatches}
                flat={treeTerm !== ''}
                emptyLabel={format(treeTerm === '' ? m.noAnchors : m.treeSearchEmpty)}
                expandLabel={format(commonMessages.loading)}
                selected={active?.orgNodeId ?? null}
                onSelect={(node) => setAnchor(node.id)}
              />
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="w-full sm:max-w-52"
                value={draft}
                placeholder={format(m.searchPlaceholder)}
                aria-label={format(m.searchPlaceholder)}
                onChange={(event) => setDraft(event.target.value)}
              />
              <Segmented
                label={format(m.scopeLabel)}
                value={scope === 'self' ? 'self' : 'subtree'}
                onChange={setScope}
                options={[
                  { value: 'self', label: format(m.scopeSelf) },
                  { value: 'subtree', label: format(m.scopeSubtree) },
                ]}
              />
              <Segmented
                label={format(m.viewLabel)}
                value={view === 'deleted' ? 'deleted' : 'living'}
                onChange={(next) => setView(next === 'deleted' ? 'deleted' : '')}
                options={[
                  { value: 'living', label: format(m.viewLiving) },
                  { value: 'deleted', label: format(m.viewDeleted) },
                ]}
              />
              <Select
                value={typeFilter === '' ? ALL_TYPES : typeFilter}
                onValueChange={(next) => setTypeFilter(next === ALL_TYPES ? '' : next)}
              >
                <SelectTrigger aria-label={format(m.typeFilterLabel)} className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>{format(m.typeFilterAll)}</SelectItem>
                  {userTypes.map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {users.isFetching && !users.isPending && (
                <Spinner aria-label={format(commonMessages.loading)} className="ml-auto size-4" />
              )}
            </div>

            <AsyncSection
              pending={options.isPending || (users.isPending && active !== undefined)}
              error={users.isError ? formatError(users.error) : null}
              loadingLabel={format(commonMessages.loading)}
              retryLabel={format(commonMessages.retry)}
              onRetry={() => void users.refetch()}
            >
              <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
                <div className="grid grid-cols-[minmax(0,1.3fr)_7rem_5rem_minmax(0,1.2fr)_3.5rem] items-center gap-3 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
                  <span>{format(m.columnName)}</span>
                  <span>{format(m.columnBusinessNo)}</span>
                  <span>{format(m.columnType)}</span>
                  <span>{format(m.columnUnit)}</span>
                  <span className="text-right">{format(m.columnStatus)}</span>
                </div>
                {rows.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-muted-foreground">{format(m.usersEmpty)}</p>
                ) : (
                  rows.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      aria-current={user.id === openUserId}
                      data-user-status={user.status}
                      onClick={() => setOpenUserId(user.id === openUserId ? '' : user.id)}
                      className={cn(
                        'grid min-w-0 grid-cols-[minmax(0,1.3fr)_7rem_5rem_minmax(0,1.2fr)_3.5rem] items-center gap-3 border-t px-4 py-2.5 text-left first:border-t-0 hover:bg-accent/70',
                        user.id === openUserId && 'bg-accent',
                      )}
                    >
                      <span className="min-w-0 truncate text-sm font-medium">
                        {user.displayName}
                      </span>
                      <span className="truncate text-xs tabular-nums text-muted-foreground">
                        {user.businessNo ?? '—'}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {user.userType?.name ?? '—'}
                      </span>
                      <span className="min-w-0 truncate text-xs text-muted-foreground">
                        {user.primaryOrgNode?.name ?? '—'}
                      </span>
                      <span
                        className={cn(
                          'text-right text-xs',
                          user.status === 'disabled' ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {format(
                          user.status === 'deleted'
                            ? m.deletedBadge
                            : user.status === 'disabled'
                              ? m.disabledBadge
                              : m.statusActive,
                        )}
                      </span>
                    </button>
                  ))
                )}
                <div className="flex items-center gap-3 border-t px-4 py-2">
                  <span
                    className="min-w-0 truncate text-xs text-muted-foreground"
                    data-testid="roster-count"
                    data-count={rows.length}
                  >
                    {active !== undefined &&
                      `${pathOf(active.orgNodeId)} · ${format(m.loadedCount, { count: rows.length })}`}
                  </span>
                  <span className="flex-1" />
                  {users.hasNextPage && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0"
                      disabled={users.isFetchingNextPage}
                      onClick={() => void users.fetchNextPage()}
                    >
                      {format(m.loadMore)}
                    </Button>
                  )}
                </div>
              </div>
            </AsyncSection>
          </div>

          <PersonPane userId={openUserId} nodes={nodes} />
        </div>
      )}

      {active?.manageable && (
        // only the kinds of person this unit may hold: the api refuses the
        // rest, and a picker offering them turns a rule into an error message
        <NewUserForm
          open={creating}
          onClose={() => setCreating(false)}
          orgNodeId={active.orgNodeId}
          userTypes={userTypes.filter(
            (type) =>
              type.placementPolicy.mode === 'unrestricted' ||
              type.placementPolicy.orgTypeIds.includes(active.orgTypeId),
          )}
        />
      )}
    </Screen>
  )
}

/**
 * Who the open row is, beside the roster rather than instead of it.
 *
 * Enough to recognise somebody and act on them; everything else is a click
 * away on their own page, which is where editing lives.
 */
function PersonPane({ userId, nodes }: { userId: string; nodes: readonly PickableNode[] }) {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const orpc = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [destination, setDestination] = useState('')
  const [moveError, setMoveError] = useState<string | null>(null)
  const detail = useQuery({
    ...orpc.identity.getUser.queryOptions({ params: { userId } }),
    enabled: userId !== '',
  })
  const move = useMutation({
    mutationFn: (primaryOrgNodeId: string) =>
      runApi(
        api.identity.setUserPlacement({
          params: { userId },
          payload: { primaryOrgNodeId, version: detail.data?.user.version ?? 1 },
        }),
      ),
    onMutate: () => setMoveError(null),
    onSuccess: async () => {
      setDestination('')
      await queryClient.invalidateQueries({ queryKey: orpc.identity.key() })
    },
    onError: (error: unknown) => setMoveError(formatError(error)),
  })
  // the destination is reset by the person, not by the render: opening
  // somebody else must not carry the previous pick over to them
  useEffect(() => {
    setDestination('')
    setMoveError(null)
  }, [userId])

  if (userId === '') {
    return (
      <Blank
        icon={<UserRoundIcon />}
        title={format(m.pickSomeoneTitle)}
        description={format(m.pickSomeone)}
        className="max-lg:hidden"
      />
    )
  }
  if (detail.isError) {
    return <Feedback message={formatError(detail.error)} />
  }
  const person = detail.data
  if (person === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-10 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    )
  }

  // only somewhere else, and only somewhere this caller administers
  const movable = nodes.filter(
    (node) => node.manageable && node.orgNodeId !== person.orgPath.at(-1)?.id,
  )

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="rounded-lg">
          <AvatarFallback className="rounded-lg bg-primary text-xs font-medium text-primary-foreground">
            {initialsOf(person.user.displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{person.user.displayName}</p>
          <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <span className="truncate tabular-nums">{person.user.businessNo ?? '—'}</span>
            <span className={cn(person.user.status !== 'active' && 'text-destructive')}>
              {format(
                person.user.status === 'deleted'
                  ? m.deletedBadge
                  : person.user.status === 'disabled'
                    ? m.disabledBadge
                    : m.statusActive,
              )}
            </span>
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 border-t pt-3">
        <SectionHead title={format(m.userTypeLabel)} />
        <p className="text-sm">{person.user.userType?.name ?? '—'}</p>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 border-t pt-3">
        <SectionHead title={format(m.placementSection)} />
        <p className="text-sm text-pretty">{person.orgPath.map((node) => node.name).join(' / ')}</p>
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 border-t pt-3">
        <SectionHead title={format(m.rolesLabel)} count={person.roles.length} />
        {person.roles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{format(m.rolesNone)}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {person.roles.map((role) => (
              <li key={role.grantId} className="flex min-w-0 items-baseline gap-2 text-sm">
                <span className="min-w-0 truncate">{role.roleName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {role.orgNodeName ?? format(m.personRoleTenantWide)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-1.5 border-t pt-3">
        <SectionHead title={format(m.accountsLabel)} />
        <p
          className={cn('text-sm', person.user.identityCount === 0 && 'text-destructive')}
          data-accounts={person.user.identityCount}
        >
          {person.user.identityCount === 0
            ? format(m.accountNone)
            : format(m.accountCount, { count: person.user.identityCount })}
        </p>
      </div>

      {/* moving somebody is the one edit worth having here: it is the answer
          to what a reader just looked up, and the rules that refuse it belong
          to the destination rather than to this form */}
      {person.user.manageable && movable.length > 0 && (
        <div className="flex min-w-0 flex-col gap-2 border-t pt-3">
          <SectionHead title={format(m.moveLabel)} />
          <NodePicker
            label={format(m.moveLabel)}
            nodes={movable}
            value={destination}
            onChange={setDestination}
            placeholder={format(m.movePick)}
          />
          <Feedback message={moveError} />
          <Button
            size="sm"
            variant="outline"
            className="w-fit"
            disabled={destination === '' || move.isPending}
            onClick={() => move.mutate(destination)}
          >
            {format(m.moveAction)}
          </Button>
        </div>
      )}

      <div className="border-t pt-3">
        <Button size="sm" asChild>
          <PageLink page="auth/user-detail" params={{ userId }}>
            {format(m.fullProfile)}
          </PageLink>
        </Button>
      </div>
    </div>
  )
}
