import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { Building2Icon, PlusIcon, SearchIcon, UserRoundIcon } from 'lucide-react'
import { PageLink, useApi, useRunApi, useApiQuery, usePageQueryState } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import { Blank, RailSkeleton, Screen, SectionHead, Segmented } from '@qualy/ui/screen'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Button } from '@qualy/ui/button'
import { Input } from '@qualy/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { initialsOf } from '@qualy/ui/person'
import { Skeleton } from '@qualy/ui/skeleton'
import { Spinner } from '@qualy/ui/spinner'
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

const rosterColumns = 'minmax(0, 1.3fr) 7rem 5rem minmax(0, 1.2fr) 3.5rem'

const styles = stylex.create({
  emptyNote: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  threePane: {
    display: 'grid',
    alignItems: 'start',
    gap: 24,
    gridTemplateColumns: {
      default: 'none',
      '@media (min-width: 1024px)': '15rem minmax(0, 1fr) 19rem',
    },
  },
  pane: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
  },
  searchSeat: {
    position: 'relative',
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
  treeBox: {
    maxHeight: '60vh',
    overflow: 'auto',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    padding: 4,
  },
  filterRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  rosterSearch: {
    width: '100%',
    maxWidth: {
      default: 'none',
      '@media (min-width: 640px)': '13rem',
    },
  },
  awaySpinner: {
    marginLeft: 'auto',
  },
  rosterBox: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  rosterHead: {
    display: 'grid',
    gridTemplateColumns: rosterColumns,
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    paddingInline: 16,
    paddingBlock: 8,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  headEnd: {
    textAlign: 'right',
  },
  rosterEmpty: {
    paddingInline: 16,
    paddingBlock: 16,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  row: {
    display: 'grid',
    minWidth: 0,
    gridTemplateColumns: rosterColumns,
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
  rowOpen: {
    backgroundColor: {
      default: tokens.surfaceMuted,
      ':hover': tokens.surfaceMuted,
    },
  },
  cellName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  cellQuiet: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  cellNo: {
    fontVariantNumeric: 'tabular-nums',
  },
  cellStatus: {
    textAlign: 'right',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  alert: {
    color: tokens.danger,
  },
  footerRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 8,
  },
  countNote: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  pinned: {
    flexShrink: 0,
  },
  typeFilter: {
    width: '9rem',
  },
  // the empty detail seat only earns its room on the wide layout
  deskOnly: {
    display: {
      default: 'none',
      '@media (min-width: 1024px)': 'flex',
    },
  },
})

export default function UsersPage() {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
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
  const options = useQuery(query.identity.getUserOptions.queryOptions({ query: {} }))
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
    queryKey: [...query.identity.listUsers.key({ query: filter }), 'infinite'],
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
        <p {...stylex.props(styles.emptyNote)}>{format(m.noAnchors)}</p>
      ) : (
        <div {...stylex.props(styles.threePane)}>
          <div {...stylex.props(styles.pane)}>
            <div {...stylex.props(styles.searchSeat)}>
              <SearchIcon aria-hidden {...stylex.props(styles.searchGlass)} />
              <Input
                name="tree-search"
                value={treeSearch}
                placeholder={format(m.treeSearch)}
                aria-label={format(m.treeSearch)}
                onChange={(event) => setTreeSearch(event.target.value)}
                className={stylex.props(styles.indentedInput).className}
              />
            </div>
            <div {...stylex.props(styles.treeBox)}>
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

          <div {...stylex.props(styles.pane)}>
            <div {...stylex.props(styles.filterRow)}>
              <Input
                name="users-search"
                wrapperClassName={stylex.props(styles.rosterSearch).className}
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
              {users.isFetching && !users.isPending && (
                <Spinner
                  aria-label={format(commonMessages.loading)}
                  className={stylex.props(styles.awaySpinner).className}
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
              <div {...stylex.props(styles.rosterBox)}>
                <div {...stylex.props(styles.rosterHead)}>
                  <span>{format(m.columnName)}</span>
                  <span>{format(m.columnBusinessNo)}</span>
                  <span>{format(m.columnType)}</span>
                  <span>{format(m.columnUnit)}</span>
                  <span {...stylex.props(styles.headEnd)}>{format(m.columnStatus)}</span>
                </div>
                {rows.length === 0 ? (
                  <p {...stylex.props(styles.rosterEmpty)}>{format(m.usersEmpty)}</p>
                ) : (
                  rows.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      aria-current={user.id === openUserId}
                      data-user-status={user.status}
                      onClick={() => setOpenUserId(user.id === openUserId ? '' : user.id)}
                      {...stylex.props(styles.row, user.id === openUserId && styles.rowOpen)}
                    >
                      <span {...stylex.props(styles.cellName)}>{user.displayName}</span>
                      <span {...stylex.props(styles.cellQuiet, styles.cellNo)}>
                        {user.businessNo ?? '—'}
                      </span>
                      <span {...stylex.props(styles.cellQuiet)}>{user.userType?.name ?? '—'}</span>
                      <span {...stylex.props(styles.cellQuiet)}>
                        {user.primaryOrgNode?.name ?? '—'}
                      </span>
                      <span
                        {...stylex.props(
                          styles.cellStatus,
                          user.status === 'disabled' && styles.alert,
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
                <div {...stylex.props(styles.footerRow)}>
                  <span
                    {...stylex.props(styles.countNote)}
                    data-testid="roster-count"
                    data-count={rows.length}
                  >
                    {active !== undefined &&
                      `${pathOf(active.orgNodeId)} · ${format(m.loadedCount, { count: rows.length })}`}
                  </span>
                  <span {...stylex.props(styles.spacer)} />
                  {users.hasNextPage && (
                    <Button
                      size="sm"
                      variant="outline"
                      className={stylex.props(styles.pinned).className}
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

const paneStyles = stylex.create({
  stack: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 16,
  },
  headRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 12,
  },
  frame: {
    borderRadius: tokens.radiusLg,
  },
  monogram: {
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
  },
  nameCol: {
    minWidth: 0,
  },
  personName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 600,
  },
  personMeta: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  metaNo: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
  },
  alert: {
    color: tokens.danger,
  },
  section: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 12,
  },
  sectionRoomy: {
    gap: 8,
  },
  plainText: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  pathText: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    textWrap: 'pretty',
  },
  quietText: {
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
  roleList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  roleRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  roleName: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  roleWhere: {
    flexShrink: 0,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  widthFit: {
    width: 'fit-content',
  },
  skeletonStack: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  lineTitle: { height: 40, width: 160 },
  lineFull: { height: 16, width: '100%' },
  linePart: { height: 16, width: '66%' },
})

/**
 * Who the open row is, beside the roster rather than instead of it.
 *
 * Enough to recognise somebody and act on them; everything else is a click
 * away on their own page, which is where editing lives.
 */
function PersonPane({ userId, nodes }: { userId: string; nodes: readonly PickableNode[] }) {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [destination, setDestination] = useState('')
  const [moveError, setMoveError] = useState<string | null>(null)
  const detail = useQuery({
    ...query.identity.getUser.queryOptions({ params: { userId } }),
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
      await queryClient.invalidateQueries({ queryKey: query.identity.key() })
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
        xstyle={styles.deskOnly}
      />
    )
  }
  if (detail.isError) {
    return <Feedback message={formatError(detail.error)} />
  }
  const person = detail.data
  if (person === undefined) {
    return (
      <div {...stylex.props(paneStyles.skeletonStack)}>
        <Skeleton className={stylex.props(paneStyles.lineTitle).className} />
        <Skeleton className={stylex.props(paneStyles.lineFull).className} />
        <Skeleton className={stylex.props(paneStyles.linePart).className} />
      </div>
    )
  }

  // only somewhere else, and only somewhere this caller administers
  const movable = nodes.filter(
    (node) => node.manageable && node.orgNodeId !== person.orgPath.at(-1)?.id,
  )

  return (
    <div {...stylex.props(paneStyles.stack)}>
      <div {...stylex.props(paneStyles.headRow)}>
        <Avatar className={stylex.props(paneStyles.frame).className}>
          <AvatarFallback className={stylex.props(paneStyles.monogram).className}>
            {initialsOf(person.user.displayName)}
          </AvatarFallback>
        </Avatar>
        <div {...stylex.props(paneStyles.nameCol)}>
          <p {...stylex.props(paneStyles.personName)}>{person.user.displayName}</p>
          <p {...stylex.props(paneStyles.personMeta)}>
            <span {...stylex.props(paneStyles.metaNo)}>{person.user.businessNo ?? '—'}</span>
            <span {...stylex.props(person.user.status !== 'active' && paneStyles.alert)}>
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

      <div {...stylex.props(paneStyles.section)}>
        <SectionHead title={format(m.userTypeLabel)} />
        <p {...stylex.props(paneStyles.plainText)}>{person.user.userType?.name ?? '—'}</p>
      </div>

      <div {...stylex.props(paneStyles.section)}>
        <SectionHead title={format(m.placementSection)} />
        <p {...stylex.props(paneStyles.pathText)}>
          {person.orgPath.map((node) => node.name).join(' / ')}
        </p>
      </div>

      <div {...stylex.props(paneStyles.section)}>
        <SectionHead title={format(m.rolesLabel)} count={person.roles.length} />
        {person.roles.length === 0 ? (
          <p {...stylex.props(paneStyles.quietText)}>{format(m.rolesNone)}</p>
        ) : (
          <ul {...stylex.props(paneStyles.roleList)}>
            {person.roles.map((role) => (
              <li key={role.grantId} {...stylex.props(paneStyles.roleRow)}>
                <span {...stylex.props(paneStyles.roleName)}>{role.roleName}</span>
                <span {...stylex.props(paneStyles.roleWhere)}>
                  {role.orgNodeName ?? format(m.personRoleTenantWide)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div {...stylex.props(paneStyles.section)}>
        <SectionHead title={format(m.accountsLabel)} />
        <p
          {...stylex.props(
            paneStyles.plainText,
            person.user.identityCount === 0 && paneStyles.alert,
          )}
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
        <div {...stylex.props(paneStyles.section, paneStyles.sectionRoomy)}>
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
            className={stylex.props(paneStyles.widthFit).className}
            disabled={destination === '' || move.isPending}
            onClick={() => move.mutate(destination)}
          >
            {format(m.moveAction)}
          </Button>
        </div>
      )}

      <div {...stylex.props(paneStyles.section)}>
        <Button size="sm" asChild>
          <PageLink page="auth/user-detail" params={{ userId }}>
            {format(m.fullProfile)}
          </PageLink>
        </Button>
      </div>
    </div>
  )
}
