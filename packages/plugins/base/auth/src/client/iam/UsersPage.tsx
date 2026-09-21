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
  BandActions,
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
import { Pager } from '@qualy/ui/pager'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Spinner } from '@qualy/ui/spinner'
import { useLingering } from '@qualy/ui/use-lingering'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { ChevronRightIcon } from 'lucide-react'
import { DetailSheet } from '@qualy/ui/screen'
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
  // never squeezed to a square: the band it sits in holds a name, a count
  // and a filter or two, and a field that gave way to them stopped being a
  // field anybody could read what they had typed in
  go: {
    display: 'inline-flex',
    justifySelf: 'end',
    // the last two columns are its own now that the standing has moved up
    gridColumn: '2 / -1',
    gridRow: '1 / 3',
    alignItems: 'center',
    color: tokens.mutedForeground,
  },
  goGlyph: { width: 14, height: 14 },
  searchBox: {
    width: { default: '13rem', [breakpoints.phone]: '100%' },
    flexShrink: { default: 0, [breakpoints.phone]: 1 },
  },
  // On a phone the two filters share the line the search box left them, and
  // they take the whole of it: a pair of controls ending two thirds of the
  // way across reads as a row that failed to load the rest of itself.
  typeFilter: {
    width: { default: '8.5rem', [breakpoints.phone]: 'auto' },
    flexGrow: { default: 0, [breakpoints.phone]: 1 },
    flexShrink: 0,
    flexBasis: { default: null, [breakpoints.phone]: '0%' },
  },
  away: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
  // the third filter, drawn as one, taking its share of the line at a
  // phone's width
  removed: {
    width: { default: '9rem', [breakpoints.phone]: 'auto' },
    flexGrow: { default: 0, [breakpoints.phone]: 1 },
    flexShrink: 0,
    flexBasis: { default: null, [breakpoints.phone]: '0%' },
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
  unitSwitch: {
    display: 'flex',
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    gap: 10,
    paddingInline: 14,
    paddingBlock: 8,
    borderWidth: 0,
    borderRadius: 12,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
  },
  unitSwitchWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 1 },
  unitSwitchName: { fontSize: 14, fontWeight: 600 },
  unitSwitchNote: { fontSize: 11.5, color: tokens.mutedForeground },
  unitSwitchGo: { flexShrink: 0, fontSize: 13, color: tokens.surfaceMutedForeground },
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
  // Below the width where the tree and the roster sit side by side, the
  // tree is not a column - it is a line saying which unit the roster is of,
  // and a sheet to change it.
  //
  // The width is the ROSTER's, not the tree's. Measured from what the roster
  // holds: a name, a number, a unit path, a standing and a count, plus the
  // page's own gutters, want about a thousand pixels; the tree wants nearly
  // three hundred more. Between those two figures the split handed the tree
  // its column and squeezed everything else - "including everyone below,
  // 1004 people" set one character to a line, the standing column narrower
  // than its own word, and the mark at the end of each row pushed off the
  // table altogether.
  const phone = useIsBelow(1280)
  /** where a row becomes a name with its facts under it, as the table itself folds */
  const stacked = useIsBelow(768)
  const [pickingUnit, setPickingUnit] = useState(false)
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
        <BandActions
          moreLabel={format(m.moreActions)}
          primary={
            active?.manageable && (
              <Button onClick={() => setCreating(true)}>
                <PlusIcon aria-hidden />
                {format(m.newUser)}
              </Button>
            )
          }
          rest={
            <>
              <UserJump
                rootNodeId={(nodes.find((entry) => entry.parentId === null) ?? nodes[0])?.orgNodeId}
                businessNo={businessNo}
              />
              {/* whatever else can be done with people as a whole, by
                  whoever offers it: an import, an export */}
              <UiSlot
                token={usersPageActions}
                context={
                  { anchorNodeId: active?.orgNodeId ?? null } satisfies UsersPageActionsContext
                }
              />
            </>
          }
        />
      }
    >
      {options.isError && <Feedback message={formatError(options.error)} />}
      {!options.isPending && nodes.length === 0 ? (
        <p {...stylex.props(styles.emptyNote)}>{format(m.noAnchors)}</p>
      ) : (
        <ResizableSplit
          storageKey="qualy.users.tree-width"
          // the same width at which the tree folds to one line: below it the
          // two stack, or the line would sit in a column the roster needed
          from={1280}
          handleLabel={format(m.resizeTree)}
          side={
            phone ? (
              <button
                type="button"
                data-testid="unit-switch"
                {...stylex.props(styles.unitSwitch)}
                onClick={() => setPickingUnit(true)}
              >
                <span {...stylex.props(styles.unitSwitchWords)}>
                  <span {...stylex.props(styles.unitSwitchName)}>{active?.name ?? ''}</span>
                  {activeUnit !== undefined && (
                    <span {...stylex.props(styles.unitSwitchNote)}>
                      {format(within === 'self' ? m.rosterWithinSelf : m.rosterWithinSubtree, {
                        count: within === 'self' ? activeUnit.own : activeUnit.total,
                      })}
                    </span>
                  )}
                </span>
                <span {...stylex.props(styles.unitSwitchGo)}>{format(m.unitChange)}</span>
                <ChevronRightIcon aria-hidden {...stylex.props(styles.unitLinkIcon)} />
              </button>
            ) : (
              <UnitTree
                units={units}
                openId={active?.orgNodeId ?? null}
                scope={within}
                onOpen={asking('anchor')}
                onScope={asking('scope')}
              />
            )
          }
        >

          <Card data-testid="roster">
            <CardHead
              title={
                phone ? (
                  format(m.usersTitle)
                ) : structureHref === undefined || active === undefined ? (
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
                // on a phone the line above already says which unit and how many
                phone || activeUnit === undefined ? undefined : (
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
              {/* A filter beside a filter, saying which set is on show
                  rather than what a press would do - "show removed people"
                  reads the same whichever list you are looking at. */}
              <Select
                value={removed === '1' ? 'all' : 'living'}
                onValueChange={(next) => asking('removed')(next === 'all' ? '1' : '')}
              >
                <SelectTrigger
                  aria-label={format(m.showRemoved)}
                  data-testid="show-removed"
                  xstyle={styles.removed}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="living">{format(m.rosterScopeLiving)}</SelectItem>
                  <SelectItem value="all">{format(m.rosterScopeAll)}</SelectItem>
                </SelectContent>
              </Select>
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
                      {/* across a table the number leads, because that is what the
                          list is sorted by; stacked, a row is a name with
                          its facts under it */}
                      {stacked ? (
                        <>
                          {/* Most people are in good standing, so saying so
                              on every row says nothing - and it cost the row
                              a column. Only what is NOT ordinary is marked,
                              beside the name it is true of. */}
                          <Cell lead strong={user.id === openUserId}>
                            {user.displayName}
                            {user.status !== 'active' && (
                              <Status tone="bad">
                                {format(
                                  user.status === 'deleted' ? m.deletedBadge : m.disabledBadge,
                                )}
                              </Status>
                            )}
                          </Cell>
                          <Cell
                            numeric
                            unlabelled
                            tone={user.businessNo === null ? 'quiet' : 'muted'}
                          >
                            {user.businessNo ?? format(m.personNoBusinessNo, { businessNo })}
                          </Cell>
                        </>
                      ) : (
                        <>
                          <Cell lead numeric tone={user.businessNo === null ? 'quiet' : 'plain'}>
                            {user.businessNo ?? format(m.personNoBusinessNo, { businessNo })}
                          </Cell>
                          <Cell strong={user.id === openUserId} tone="plain">
                            {user.displayName}
                          </Cell>
                        </>
                      )}
                      {/* a student number, a kind of person and a unit read
                          as themselves wherever they appear; stacked, they
                          need no column word in front of them, only a
                          hairline saying where one ends */}
                      <Cell unlabelled divided={stacked}>
                        {user.userType?.name ?? '—'}
                      </Cell>
                      {user.primaryOrgNode === null ? (
                        <Cell divided={stacked}>—</Cell>
                      ) : (
                        // Stacked, the chain is most of the line and the
                        // last rung is the only part that tells two people
                        // apart - everything above it is the unit the
                        // roster is already showing. The whole address is
                        // on the person's own page.
                        <UnitPath
                          steps={
                            stacked
                              ? [{ id: user.primaryOrgNode.id, name: user.primaryOrgNode.name }]
                              : stepsTo(user.primaryOrgNode.id).length > 0
                                ? stepsTo(user.primaryOrgNode.id)
                                : [{ id: user.primaryOrgNode.id, name: user.primaryOrgNode.name }]
                          }
                          pickLabel={format(m.pickUnit)}
                          onPick={asking('anchor')}
                          divided={stacked}
                          plain={stacked}
                        />
                      )}
                      {/* Across a table the standing is a column like any
                          other; stacked it has moved up beside the name, and
                          the cell stays as the empty one it is - it is what
                          tells the row where its facts end and what it is
                          scanned by begins. */}
                      <Cell narrow="end" unlabelled>
                        {!stacked && (
                          <Status tone={user.status === 'active' ? 'plain' : 'bad'}>
                            {format(
                              user.status === 'deleted'
                                ? m.deletedBadge
                                : user.status === 'disabled'
                                  ? m.disabledBadge
                                  : m.statusActive,
                            )}
                          </Status>
                        )}
                      </Cell>
                      {/* A glance at somebody without leaving the list is
                          worth a press beside the row only where the list
                          stays on screen. Stacked, the sheet covers the
                          list it was supposed to keep you in, and every
                          act on it is another press away - so there the
                          row itself is the way in, and it goes to the
                          person's own page. */}
                      {/* stacked, the row itself is the way in, and the
                          mark at its end says so - standing against the
                          whole row rather than at the end of its second
                          line, so a column of them reads straight down */}
                      {stacked && (
                        <span aria-hidden {...stylex.props(styles.go)}>
                          <ChevronRightIcon {...stylex.props(styles.goGlyph)} />
                        </span>
                      )}
                      {!stacked && (
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
                      )}
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

      {phone && (
        <DetailSheet
          open={pickingUnit}
          onClose={() => setPickingUnit(false)}
          title={format(m.unitsTitle)}
          closeLabel={format(commonMessages.close)}
          testId="unit-sheet"
          fill
        >
          <UnitTree
            bare
            units={units}
            openId={active?.orgNodeId ?? null}
            scope={within}
            onOpen={(id) => {
              asking('anchor')(id)
              setPickingUnit(false)
            }}
            onScope={asking('scope')}
          />
        </DetailSheet>
      )}

      {shownUserId !== null && (
        <PersonSheet
          open={openUserId !== ''}
          userId={shownUserId}
          onClose={() => setOpenUserId('')}
        />
      )}

      {active?.manageable && (
        // only the kinds of person a unit may hold: the api refuses the
        // rest, and a picker offering them turns a rule into an error
        // message. Asked per unit, because the form may be pointed at
        // another one than the roster is showing.
        <NewUserForm
          open={creating}
          onClose={() => setCreating(false)}
          orgNodeId={active.orgNodeId}
          orgNodeName={active.name}
          userTypesAt={(id) => {
            const at = byId.get(id)
            if (at === undefined) return []
            return userTypes.filter(
              (type) =>
                type.placementPolicy.mode === 'unrestricted' ||
                (type.placementPolicy.mode === 'allow-list' &&
                  type.placementPolicy.orgTypeIds.includes(at.orgTypeId)),
            )
          }}
        />
      )}
    </Screen>
  )
}
