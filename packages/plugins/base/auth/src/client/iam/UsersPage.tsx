import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { usersPageActions, type UsersPageActionsContext } from '@qualy/ui-contract'
import { useEffect, useMemo, useState } from 'react'
import { ArrowUpRightIcon, InfoIcon, PlusIcon } from 'lucide-react'
import {
  PageLink,
  useApi,
  useRunApi,
  useApiQuery,
  usePageHref,
  usePageNavigate,
  usePageQueryState,
  usePageQueryUpdate,
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
  ResizableSplit,
  Screen,
  SearchField,
  Status,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Checkbox } from '@qualy/ui/checkbox'
import { Pager } from '@qualy/ui/pager'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Spinner } from '@qualy/ui/spinner'
import { useLingering } from '@qualy/ui/use-lingering'
import { iamMessages as m } from '../i18n.ts'
import { NewUserForm } from './NewUserForm.tsx'
import { PersonSheet } from './users/PersonSheet.tsx'
import { UnitPath } from './users/UnitPath.tsx'
import { UserJump } from './users/UserJump.tsx'
import { UnitTree, type UnitNode } from './users/UnitTree.tsx'
import { rememberRoster } from './users/roster-address.ts'
import { authApi } from '../api.ts'

// People are administered where they stand, so the screen reads left to
// right: the unit you are looking at, and the people standing there. The
// roster's own heading says which unit and how many, so the two halves never
// have to be read against each other to know what the list is a list of.
//
// A row is the way to the person's own page, which is where anything is done
// to them; the mark at its end looks at them beside the roster instead, for
// the reader who only wants to check who this is. The roster is walked by
// page number, because somebody administering a thousand people goes to the
// last page and back, and "load more" fifty at a time is not going anywhere.
//
// The unit, the scope, the filters and the open person all live in the query
// string: exactly the state somebody wants back after a reload, or in a link
// sent to a colleague.
// radix refuses an empty select value, and "every type" is a real choice
// rather than the absence of one
const ALL_TYPES = 'all'

/** people to a page */
const PAGE_SIZE = 50

const styles = stylex.create({
  emptyNote: { margin: 0, fontSize: 14, color: tokens.mutedForeground },
  searchBox: { width: { default: '13rem', [breakpoints.phone]: '100%' } },
  typeFilter: { width: '8.5rem', flexShrink: 0 },
  away: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
  removed: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    color: tokens.surfaceMutedForeground,
    cursor: 'pointer',
  },
  unitLink: {
    display: 'inline-flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 4,
    color: 'inherit',
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
  },
  unitLinkIcon: { width: 13, height: 13, flexShrink: 0, color: tokens.mutedForeground },
  look: { display: 'flex', justifyContent: 'flex-end' },
})

/** how wide a name reads: a han character is one em, anything else a little over half */
const emsOf = (text: string) =>
  [...text].reduce((sum, char) => sum + (/[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(char) ? 1 : 0.58), 0)

export default function UsersPage() {
  const api = useApi(authApi)
  const runApi = useRunApi()
  const query = useApiQuery(authApi)
  const { format, formatError } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const [anchor] = usePageQueryState('anchor')
  const [scope] = usePageQueryState('scope', 'subtree')
  const [typeFilter] = usePageQueryState('type')
  const [search] = usePageQueryState('q')
  const [openUserId, setOpenUserId] = usePageQueryState('user')
  // whether the removed are listed among the living
  const [removed] = usePageQueryState('removed')
  const [pageParam, setPageParam] = usePageQueryState('page')
  const page = Math.max(1, Number.parseInt(pageParam, 10) || 1)
  const navigate = usePageNavigate()
  const write = usePageQueryUpdate()
  const structureHref = usePageHref('org/page')
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
    const timer = setTimeout(() => {
      if (draft !== search) write({ q: draft, page: '' })
    }, 300)
    return () => clearTimeout(timer)
  }, [draft, search, write])

  const filter = {
    orgNodeId: active?.orgNodeId ?? '',
    scope: within,
    ...(removed === '1' ? { status: 'any' as const } : {}),
    ...(search ? { search } : {}),
    ...(typeFilter ? { userTypeId: typeFilter } : {}),
    page: String(page),
    limit: String(PAGE_SIZE),
  }
  const users = useQuery({
    ...query.identity.listUsers.queryOptions({ query: filter }),
    enabled: active !== undefined,
    // the rows of the page being left stay up until the next one arrives, so
    // turning a page does not blank the table
    placeholderData: keepPreviousData,
  })
  const rows = users.data?.items ?? []
  const total = users.data?.total ?? 0
  // A different question starts at its first page. Both keys go in one write:
  // two address writes from one press race, and the second drops the first.
  const asking = (key: 'anchor' | 'scope' | 'type' | 'removed') => (value: string) =>
    write({ [key]: key === 'scope' && value === 'subtree' ? '' : value, page: '' })

  // where this roster is, for the way back from somebody's own page
  useEffect(() => rememberRoster(window.location.search), [anchor, scope, typeFilter, search, removed, pageParam])

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

  // Where somebody stands, relative to the unit on show: the roster is
  // already about that unit, so repeating everything above it on every row
  // only pushes the part that differs off the end of the cell. Somebody
  // standing at the unit itself is said to stand there.
  const byId = useMemo(() => new Map(nodes.map((entry) => [entry.orgNodeId, entry])), [nodes])
  const stepsTo = (nodeId: string) => {
    const steps: { id: string; name: string }[] = []
    for (let at = byId.get(nodeId); at; at = at.parentId ? byId.get(at.parentId) : undefined) {
      if (at.orgNodeId === active?.orgNodeId && steps.length > 0) break
      steps.unshift({ id: at.orgNodeId, name: at.name })
    }
    return steps
  }
  // as wide as the longest name on this page and no wider
  const nameWidth = `${String(
    Math.min(14, Math.max(4, ...rows.map((user) => emsOf(user.displayName)))) * 0.79 + 0.4,
  )}rem`

  return (
    <Screen
      title={format(m.usersTitle)}
      description={format(m.usersHint)}
      size="broad"
      actions={
        <>
          <UserJump
            rootNodeId={(nodes.find((entry) => entry.parentId === null) ?? nodes[0])?.orgNodeId}
            businessNo={businessNo}
          />
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
        <ResizableSplit
          storageKey="qualy.users.tree-width"
          handleLabel={format(m.resizeTree)}
          side={
            <UnitTree
              units={units}
              openId={active?.orgNodeId ?? null}
              scope={within}
              onOpen={asking('anchor')}
              onScope={asking('scope')}
            />
          }
        >

          <Card data-testid="roster">
            <CardHead
              title={
                structureHref === undefined || active === undefined ? (
                  (active?.name ?? '')
                ) : (
                  <PageLink
                    page="org/page"
                    search={{ node: active.orgNodeId }}
                    title={format(m.openInStructure)}
                    className={stylex.props(styles.unitLink).className}
                  >
                    {active.name}
                    <ArrowUpRightIcon aria-hidden {...stylex.props(styles.unitLinkIcon)} />
                  </PageLink>
                )
              }
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
                onValueChange={(next) => asking('type')(next === ALL_TYPES ? '' : next)}
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
              <label {...stylex.props(styles.removed)} data-testid="show-removed">
                <Checkbox
                  checked={removed === '1'}
                  onCheckedChange={(next) => asking('removed')(next ? '1' : '')}
                />
                {format(m.showRemoved)}
              </label>
            </CardHead>

            <AsyncSection
              pending={options.isPending || (users.isPending && active !== undefined)}
              error={users.isError ? formatError(users.error) : null}
              loadingLabel={format(commonMessages.loading)}
              retryLabel={format(commonMessages.retry)}
              onRetry={() => void users.refetch()}
            >
              <Table columns={`8.5rem ${nameWidth} 5.5rem minmax(0, 1fr) 4.5rem 1.75rem`}>
                <TableHead>
                  <span>{businessNo}</span>
                  <span>{format(m.columnName)}</span>
                  <span>{format(m.columnType)}</span>
                  <span>{format(m.columnUnit)}</span>
                  <span>{format(m.columnStatus)}</span>
                  <span />
                </TableHead>
                {rows.length === 0 ? (
                  <CardEmpty>{format(m.usersEmpty)}</CardEmpty>
                ) : (
                  rows.map((user) => (
                    <TableRow
                      key={user.id}
                      height="compact"
                      nested
                      selected={user.id === openUserId}
                      onOpen={() => navigate('auth/user-detail', { params: { userId: user.id } })}
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
                        <UnitPath
                          steps={
                            stepsTo(user.primaryOrgNode.id).length > 0
                              ? stepsTo(user.primaryOrgNode.id)
                              : [{ id: user.primaryOrgNode.id, name: user.primaryOrgNode.name }]
                          }
                          pickLabel={format(m.pickUnit)}
                          onPick={asking('anchor')}
                        />
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
                      <span {...stylex.props(styles.look)}>
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={format(m.lookAt, { name: user.displayName })}
                          data-testid="roster-look"
                          onClick={() => setOpenUserId(user.id === openUserId ? '' : user.id)}
                        >
                          <InfoIcon aria-hidden />
                        </Button>
                      </span>
                    </TableRow>
                  ))
                )}
              </Table>
              <CardFoot>
                <Pager
                  testId="roster-pager"
                  label={format(m.pagerLabel)}
                  page={users.data?.page ?? page}
                  pageSize={PAGE_SIZE}
                  total={total}
                  disabled={users.isFetching}
                  summary={format(m.pageSummary, {
                    from: total === 0 ? 0 : ((users.data?.page ?? page) - 1) * PAGE_SIZE + 1,
                    to: ((users.data?.page ?? page) - 1) * PAGE_SIZE + rows.length,
                    total,
                  })}
                  onPage={(next) => setPageParam(next === 1 ? '' : String(next))}
                />
              </CardFoot>
            </AsyncSection>
          </Card>
        </ResizableSplit>
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
