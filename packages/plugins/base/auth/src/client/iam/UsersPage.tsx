import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { usersPageActions, type UsersPageActionsContext } from '@qualy/ui-contract'
import { useEffect, useMemo, useState } from 'react'
import { PlusIcon } from 'lucide-react'
import {
  useApi,
  useRunApi,
  useApiQuery,
  usePageQueryState,
  cursorPages,
  UiSlot,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
  CardFoot,
  CardHead,
  Cell,
  Screen,
  SearchField,
  Segmented,
  Spacer,
  Status,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Spinner } from '@qualy/ui/spinner'
import { useLingering } from '@qualy/ui/use-lingering'
import { iamMessages as m } from '../i18n.ts'
import { NewUserForm } from './NewUserForm.tsx'
import { PersonSheet } from './users/PersonSheet.tsx'
import { UnitTree, type UnitNode } from './users/UnitTree.tsx'
import { authApi } from '../api.ts'

// People are administered where they stand, so the screen reads left to
// right: the unit you are looking at, and the people standing there. The
// roster's own heading says which unit and how many, so the two halves never
// have to be read against each other to know what the list is a list of.
//
// Opening somebody looks at them beside the roster and changes nothing;
// everything that can be done to a person is done on their own page.
//
// The unit, the scope, the filters and the open person all live in the query
// string: exactly the state somebody wants back after a reload, or in a link
// sent to a colleague.
// radix refuses an empty select value, and "every type" is a real choice
// rather than the absence of one
const ALL_TYPES = 'all'

const styles = stylex.create({
  emptyNote: { margin: 0, fontSize: 14, color: tokens.mutedForeground },
  split: {
    display: 'grid',
    alignItems: 'start',
    gap: 20,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [breakpoints.desktop]: '300px minmax(0, 1fr)',
    },
  },
  searchBox: { width: { default: '13rem', [breakpoints.phone]: '100%' } },
  typeFilter: { width: '8.5rem', flexShrink: 0 },
  away: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
})

export default function UsersPage() {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const [anchor, setAnchor] = usePageQueryState('anchor')
  const [scope, setScope] = usePageQueryState('scope', 'subtree')
  const [typeFilter, setTypeFilter] = usePageQueryState('type')
  const [search, setSearch] = usePageQueryState('q')
  const [openUserId, setOpenUserId] = usePageQueryState('user')
  const [view, setView] = usePageQueryState('view')
  const [draft, setDraft] = useState(search)
  const [creating, setCreating] = useState(false)
  const shownUserId = useLingering(openUserId === '' ? null : openUserId)

  // one call gives the units this caller may see, the types they may hand
  // out, and the tree the left pane draws - no permission beyond its own
  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
  const nodes = useMemo(() => options.data?.nodes ?? [], [options.data])
  // the first unit stands open until another is picked: a roster of nobody,
  // waiting to be told whose, says nothing
  const active = nodes.find((entry) => entry.orgNodeId === anchor) ?? nodes[0]
  const userTypes = options.data?.userTypes ?? []
  const within: 'self' | 'subtree' = scope === 'self' ? 'self' : 'subtree'

  // typing should not fire a request per keystroke
  useEffect(() => {
    const timer = setTimeout(() => setSearch(draft), 300)
    return () => clearTimeout(timer)
  }, [draft, setSearch])

  const filter = {
    orgNodeId: active?.orgNodeId ?? '',
    scope: within,
    ...(view === 'deleted' ? { status: 'deleted' as const } : {}),
    ...(search ? { search } : {}),
    ...(typeFilter ? { userTypeId: typeFilter } : {}),
  }
  const users = useInfiniteQuery({
    queryKey: [...query.identity.listUsers.key({ query: filter }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.identity.listUsers({
          query: { ...filter, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        }),
      ),
    ...cursorPages,
    enabled: active !== undefined,
  })
  const rows = useMemo(() => users.data?.pages.flatMap((page) => page.items) ?? [], [users.data])

  // each unit with what kind it is and how many it holds, alone and with
  // everything under it: the tree shows whichever reading the scope asks for
  const units = useMemo((): readonly UnitNode[] => {
    const kindOf = new Map((options.data?.orgTypes ?? []).map((type) => [type.id, type.name]))
    const under = new Map<string, string[]>()
    for (const entry of nodes) {
      if (entry.parentId !== null) {
        under.set(entry.parentId, [...(under.get(entry.parentId) ?? []), entry.orgNodeId])
      }
    }
    const own = new Map(nodes.map((entry) => [entry.orgNodeId, entry.userCount]))
    const totals = new Map<string, number>()
    const totalOf = (id: string): number => {
      const known = totals.get(id)
      if (known !== undefined) return known
      const total =
        (own.get(id) ?? 0) + (under.get(id) ?? []).reduce((sum, child) => sum + totalOf(child), 0)
      totals.set(id, total)
      return total
    }
    return nodes.map((entry) => ({
      id: entry.orgNodeId,
      name: entry.name,
      parentId: entry.parentId,
      kind: kindOf.get(entry.orgTypeId) ?? '',
      own: entry.userCount,
      total: totalOf(entry.orgNodeId),
    }))
  }, [nodes, options.data?.orgTypes])
  const activeUnit = units.find((unit) => unit.id === active?.orgNodeId)

  const namesTo = (nodeId: string): string[] => {
    const byId = new Map(nodes.map((entry) => [entry.orgNodeId, entry]))
    const names: string[] = []
    for (let at = byId.get(nodeId); at; at = at.parentId ? byId.get(at.parentId) : undefined) {
      names.unshift(at.name)
    }
    return names
  }
  // The end of a path says where somebody is; the middle only says how to
  // get there. So a long one keeps its first step and its last two, and the
  // whole of it is on the cell's title.
  const pathOf = (nodeId: string) => {
    const names = namesTo(nodeId)
    const whole = names.join(' / ')
    const short =
      names.length <= 3 ? whole : [names[0], '…', ...names.slice(-2)].join(' / ')
    return { whole, short }
  }

  return (
    <Screen
      title={format(m.usersTitle)}
      description={format(m.usersHint)}
      size="broad"
      actions={
        <>
          {/* whatever else can be done with people as a whole, by whoever
              offers it: an import, an export */}
          <UiSlot
            token={usersPageActions}
            context={{ anchorNodeId: active?.orgNodeId ?? null } satisfies UsersPageActionsContext}
          />
          {active?.manageable && (
            <Button onClick={() => setCreating(true)}>
              <PlusIcon aria-hidden />
              {format(m.newUser)}
            </Button>
          )}
        </>
      }
    >
      {options.isError && <Feedback message={formatError(options.error)} />}
      {!options.isPending && nodes.length === 0 ? (
        <p {...stylex.props(styles.emptyNote)}>{format(m.noAnchors)}</p>
      ) : (
        <div {...stylex.props(styles.split)}>
          <UnitTree
            units={units}
            openId={active?.orgNodeId ?? null}
            scope={within}
            onOpen={setAnchor}
            onScope={setScope}
          />

          <Card data-testid="roster">
            <CardHead
              title={active?.name ?? ''}
              sub={
                activeUnit === undefined ? undefined : (
                  <span
                    data-testid="roster-scope"
                    data-scope={within}
                    data-people={within === 'self' ? activeUnit.own : activeUnit.total}
                  >
                    {format(within === 'self' ? m.rosterWithinSelf : m.rosterWithinSubtree, {
                      count: within === 'self' ? activeUnit.own : activeUnit.total,
                    })}
                  </span>
                )
              }
            >
              {users.isFetching && !users.isPending && (
                <Spinner
                  aria-label={format(commonMessages.loading)}
                  className={stylex.props(styles.away).className}
                />
              )}
              <SearchField
                name="users-search"
                value={draft}
                onChange={setDraft}
                label={format(m.searchPeople, { businessNo })}
                xstyle={styles.searchBox}
              />
              <Select
                value={typeFilter === '' ? ALL_TYPES : typeFilter}
                onValueChange={(next) => setTypeFilter(next === ALL_TYPES ? '' : next)}
              >
                <SelectTrigger aria-label={format(m.typeFilterLabel)} xstyle={styles.typeFilter}>
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
              <Segmented
                label={format(m.viewLabel)}
                value={view === 'deleted' ? 'deleted' : 'living'}
                onChange={(next) => setView(next === 'deleted' ? 'deleted' : '')}
                options={[
                  { value: 'living', label: format(m.viewLiving) },
                  { value: 'deleted', label: format(m.viewDeleted) },
                ]}
              />
            </CardHead>

            <AsyncSection
              pending={options.isPending || (users.isPending && active !== undefined)}
              error={users.isError ? formatError(users.error) : null}
              loadingLabel={format(commonMessages.loading)}
              retryLabel={format(commonMessages.retry)}
              onRetry={() => void users.refetch()}
            >
              <Table columns="8.5rem minmax(0, 0.8fr) 5.5rem minmax(0, 1.4fr) 4.5rem" openable>
                <TableHead>
                  <span>{businessNo}</span>
                  <span>{format(m.columnName)}</span>
                  <span>{format(m.columnType)}</span>
                  <span>{format(m.columnUnit)}</span>
                  <span>{format(m.columnStatus)}</span>
                </TableHead>
                {rows.length === 0 ? (
                  <CardEmpty>{format(m.usersEmpty)}</CardEmpty>
                ) : (
                  rows.map((user) => (
                    <TableRow
                      key={user.id}
                      height="compact"
                      selected={user.id === openUserId}
                      onOpen={() => setOpenUserId(user.id === openUserId ? '' : user.id)}
                      data-testid="roster-row"
                      data-user-status={user.status}
                      data-accounts={user.identityCount}
                    >
                      <Cell lead numeric tone={user.businessNo === null ? 'quiet' : 'plain'}>
                        {user.businessNo ?? format(m.personNoBusinessNo, { businessNo })}
                      </Cell>
                      <Cell strong={user.id === openUserId} tone="plain">
                        {user.displayName}
                      </Cell>
                      <Cell>{user.userType?.name ?? '—'}</Cell>
                      {user.primaryOrgNode === null ? (
                        <Cell>—</Cell>
                      ) : (
                        <Cell title={pathOf(user.primaryOrgNode.id).whole || undefined}>
                          {pathOf(user.primaryOrgNode.id).short || user.primaryOrgNode.name}
                        </Cell>
                      )}
                      <Status tone={user.status === 'active' ? 'plain' : 'bad'}>
                        {format(
                          user.status === 'deleted'
                            ? m.deletedBadge
                            : user.status === 'disabled'
                              ? m.disabledBadge
                              : m.statusActive,
                        )}
                      </Status>
                    </TableRow>
                  ))
                )}
              </Table>
              <CardFoot>
                <span data-testid="roster-count" data-count={rows.length}>
                  {format(m.loadedCount, { count: rows.length })}
                </span>
                <Spacer />
                {users.hasNextPage && (
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={users.isFetchingNextPage}
                    onClick={() => void users.fetchNextPage()}
                  >
                    {format(m.loadMore)}
                  </Button>
                )}
              </CardFoot>
            </AsyncSection>
          </Card>
        </div>
      )}

      {shownUserId !== null && (
        <PersonSheet
          open={openUserId !== ''}
          userId={shownUserId}
          onClose={() => setOpenUserId('')}
        />
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
