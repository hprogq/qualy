import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon, EllipsisIcon } from 'lucide-react'
import { UiSlot, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { orgNodePickerView } from '@qualy/ui-contract'
import { AsyncSection, Feedback } from '@qualy/ui/admin'
import {
  Card,
  CardEmpty,
  CardFoot,
  Cell,
  DetailSheet,
  ResizableSplit,
  SearchField,
  Status,
  StickyFill,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { toast } from '@qualy/ui/toast'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@qualy/ui/dropdown-menu'
import { ConfirmDialog } from '@qualy/ui/admin'
import { Pager } from '@qualy/ui/pager'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Skeleton } from '@qualy/ui/skeleton'
import { Spinner } from '@qualy/ui/spinner'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { useIsBelow, useIsMobile } from '@qualy/ui/use-mobile'
import { AddPeopleDialog } from '../roster/AddPeopleDialog.tsx'
import { ImportDialog } from '../roster/ImportDialog.tsx'
import { PlacementDialog, type PlacementDecision } from '../roster/PlacementDialog.tsx'
import { PlacementNotice } from '../roster/PlacementNotice.tsx'
import { RosterFilings } from '../roster/RosterFilings.tsx'
import { RosterScore } from '../roster/RosterScore.tsx'
import { unitPathOf } from '../roster/unit-path.ts'
import {
  ROSTER_PAGE_SIZE,
  ROSTER_WAITING,
  rosterQueryOf,
  type RosterView,
  type RosterWaiting,
} from '../roster/roster-view.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { settler } from '../roster/live-settle.ts'
import { ScoresNotice } from '../roster/ScoresNotice.tsx'
import type { BatchLiveEvent } from '../../api.ts'

// The roster, walked by page, with where each person stands.
//
// A page is small, because each row carries a current total and a total is
// not a stored number: it is one person's whole account, read and computed
// on request. So the rows come first and the page's totals are asked for
// after, bounded in time and arithmetic by the server; whoever that answer
// does not reach gets a button that asks about them alone. What each
// person's claims are waiting on comes with the rows, counted in sql.
//
// Everything the reader narrows the list by is in the address (roster-view),
// so opening somebody and coming back lands on the same page of the same
// question, and the account opened over it can walk to the next person.

/**
 * The width from which the unit tree stands beside the list rather than
 * folding into one line above it.
 *
 * Counted from what the table needs, not from where two columns first fit:
 * a laptop's 1280 less the rail (224), the page's margins (48), the tree
 * (300) and the gap (20) leaves the list 688 pixels, which is the number,
 * name and waiting columns plus a total and a menu with room for a name. An
 * inch narrower and the name is what gives.
 */
const TWO_COLUMNS = 1280

/**
 * The widest the reader may drag the unit tree.
 *
 * Bounded by the table, not by the tree: the list keeps the row's padding
 * (32) and gaps (64), the number (120), a name's floor (144), room for the
 * longest count's longest word (80), the total (136) and the menu (32), 608
 * in all. At the narrowest width the tree stands beside the list, that
 * leaves it 1280 less the rail (224), a scrollbar's gutter where the system
 * draws one (17), the page's margins (48) and the gap (20), less 608: 363. A
 * width stored in a wider window is held to this too, rather than squeezing
 * the counts out of their column.
 */
const TREE_MOST = 360

/**
 * The roster's columns: the number it is scanned by, the person, what their
 * claims wait on, the total and the row's menu. The person has a floor and
 * the larger share of what is left, so the counts beside it can never
 * squeeze a name down to nothing. The total is wide enough for the longest
 * reason there is none beside the button that asks again; a reason longer
 * still, in some language, takes a second line rather than the button.
 */
const COLUMNS = '7.5rem minmax(9rem, 3fr) minmax(0, 2fr) 8.5rem 2rem'

/**
 * A select cannot hold the empty string as a value, so "no narrowing" needs
 * a word of its own, one that none of these selects' choices uses.
 */
const ALL = 'all'

/** how long the page waits for a burst of live wake-ups to end before reading again */
const LIVE_SETTLE = 1_000

/** how long after a burst began the page reads again, whether or not it has ended */
const LIVE_MAX_WAIT = 5_000

/**
 * The wake-ups that can move somebody's total, rather than only what they
 * wait on. A `sync` opens every connection and means "read everything
 * again": after a reconnect, whatever moved while the stream was down.
 */
const MOVES_TOTALS: ReadonlySet<BatchLiveEvent['kind']> = new Set([
  'sync',
  'entries-changed',
  'review-instance-changed',
  'item-changed',
  'result-changed',
])

const WAITING_WORDS: Record<RosterWaiting, (typeof m)[keyof typeof m]> = {
  inReview: m.rosterWaitingInReview,
  toSupplement: m.rosterWaitingToSupplement,
  reconsidering: m.rosterWaitingReconsidering,
  toRevise: m.rosterWaitingToRevise,
  blocked: m.rosterWaitingBlocked,
}

/** where a row is stacked, and what stands against it has to say so */
const phone = '@media (max-width: 767.98px)'

const styles = stylex.create({
  panel: { display: 'flex', flexDirection: 'column', gap: 20 },
  unitsAside: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 8 },
  // stacked, it stands against the whole row beside what the row is scanned
  // by, rather than auto-placing itself on the first line; a reader with
  // nothing to do on a row still gets the seat, so both lay out alike
  rowAct: {
    display: 'inline-flex',
    alignItems: 'center',
    justifySelf: 'end',
    gridColumn: { default: null, [phone]: 3 },
    gridRow: { default: null, [phone]: '1 / 3' },
  },
  unitsSeat: { display: 'flex', minHeight: 0, minWidth: 0, flexGrow: 1, flexDirection: 'column' },
  // The same line the roster of people keeps, and a card like it: which
  // units the list is of, and the way to change them.
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
  unitSwitchName: {
    overflow: 'hidden',
    fontSize: 14,
    fontWeight: 600,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  unitSwitchNote: { fontSize: 11.5, color: tokens.mutedForeground },
  unitSwitchGo: { flexShrink: 0, fontSize: 13, color: tokens.surfaceMutedForeground },
  unitSwitchIcon: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
  treeWaiting: { display: 'flex', flexDirection: 'column', gap: 10, paddingBlock: 8 },
  bone: { height: 14, borderRadius: 4 },
  listColumn: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 10 },
  listHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  listTitle: { fontSize: 14, fontWeight: 600 },
  listCount: { fontSize: 12, fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  listSpacer: { flexGrow: 1 },
  listActions: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8 },
  // the search takes what the line has; on a phone the three choices share
  // the next line, each taking its part of it
  toolbar: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  search: {
    width: { default: '15rem', [breakpoints.phone]: '100%' },
    flexShrink: { default: 0, [breakpoints.phone]: 1 },
  },
  choice: {
    width: { default: '9.5rem', [breakpoints.phone]: 'auto' },
    flexGrow: { default: 0, [breakpoints.phone]: 1 },
    flexShrink: 0,
    flexBasis: { default: null, [breakpoints.phone]: '0%' },
  },
  busy: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
  who: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  nameWithMark: { display: 'inline-flex', minWidth: 0, alignItems: 'center', gap: 8 },
  name: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  mark: { display: 'inline-flex', flexShrink: 0 },
  unitLine: {
    overflow: 'hidden',
    fontSize: 12,
    fontWeight: 400,
    color: tokens.mutedForeground,
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  // the table's own shape, greyed: a head and rows of the widths a roster
  // actually has. One slab says only "something is coming".
  skFrame: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  skRow: {
    display: 'grid',
    alignItems: 'center',
    gap: 12,
    gridTemplateColumns: '7.5rem minmax(0, 3fr) minmax(0, 2fr) 8.5rem',
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: 14,
    paddingBlock: 12,
    ':last-child': { borderBottomWidth: 0 },
  },
  skHead: { backgroundColor: tokens.surfaceInset },
  skBone: { height: 13, borderRadius: 4 },
  skChip: { height: 20, width: '4rem', borderRadius: 9999 },
})

export function ParticipantResultList({
  batchId,
  manageable,
  view,
  onView,
  onOpen,
}: {
  batchId: string
  /** whether this reader may add people to the round */
  manageable: boolean
  /** where the reader is in the list, as the address has it */
  view: RosterView
  onView: (changes: Partial<RosterView>) => void
  onOpen: (participantId: string) => void
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const [failure, setFailure] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [importing, setImporting] = useState(false)
  const [excluding, setExcluding] = useState<{ id: string; name: string } | null>(null)
  const [reconciling, setReconciling] = useState(false)
  const businessNo = useTerm(authTerms.businessNumber)
  // the tree folds into one line at a width of its own; the rows stack only
  // on a phone, where the table has no head to line its columns up under
  const narrow = useIsBelow(TWO_COLUMNS)
  const stacked = useIsMobile()
  const [unitsOpen, setUnitsOpen] = useState(false)

  // Typing does not fire a request per keystroke. What the box last asked
  // the address for is remembered, so an address that moves by itself - the
  // back button, a link - moves the box, rather than the box writing its
  // old words back over it.
  const [draft, setDraft] = useState(view.q)
  const asked = useRef(view.q)
  useEffect(() => {
    if (view.q === asked.current) return
    asked.current = view.q
    setDraft(view.q)
  }, [view.q])
  useEffect(() => {
    if (draft === asked.current) return
    const timer = setTimeout(() => {
      asked.current = draft
      onView({ q: draft })
    }, 300)
    return () => clearTimeout(timer)
  }, [draft, onView])

  const participants = useQuery({
    ...query.assessment.listParticipantAccounts.queryOptions({
      params: { batchId },
      query: rosterQueryOf(view),
    }),
    // the rows of the page being left stay up until the next one arrives,
    // so turning a page does not blank the table
    placeholderData: keepPreviousData,
  })
  const rows = participants.data?.items ?? []
  const total = participants.data?.total ?? 0
  const page = participants.data?.page ?? view.page

  // the page's totals, asked once its rows are known and never before: the
  // rows are what somebody came for, and they must not wait on arithmetic
  const ids = rows.map((row) => row.id)
  const pageScores = query.assessment.listParticipantScores.queryOptions({
    params: { batchId },
    query: { participantIds: ids },
  })
  const scores = useQuery({
    ...pageScores,
    enabled: ids.length > 0 && !participants.isPlaceholderData,
  })
  const scored = new Map((scores.data?.scores ?? []).map((one) => [one.participantId, one]))
  // the scoring service down answers as one row saying so and the rest
  // deferred, which is a page without totals as surely as a failed question
  const serviceDown = (scores.data?.scores ?? []).some(
    (one) => one.state === 'unavailable' && one.reason === 'scoring-unavailable',
  )

  // Live: a claim that moved changes what somebody is waiting on and what
  // they have, so the page and its totals are read again. A burst of
  // wake-ups - a reviewer working down a queue - is one re-read rather than
  // one per event, and never waits past the burst's longest wait: each
  // re-read of the totals is a page of accounts. Only this page's own
  // question is asked again; a person somebody asked about alone is not
  // re-asked with it: their answer gives way to the page's newer one where
  // that says something about them, and they are asked about alone again
  // only where it defers them once more (RosterScore). Each wake-up is
  // gathered as whether it may move a total.
  const latestScores = useRef(pageScores.queryKey)
  latestScores.current = pageScores.queryKey
  const [movedAt, setMovedAt] = useState(0)
  const live = useMemo(
    () =>
      settler<boolean>({
        settle: LIVE_SETTLE,
        maxWait: LIVE_MAX_WAIT,
        fire: (moves) => {
          void queryClient.invalidateQueries({
            queryKey: query.assessment.listParticipantAccounts.key(),
          })
          if (moves.some(Boolean)) {
            setMovedAt(Date.now())
            void queryClient.invalidateQueries({ queryKey: latestScores.current, exact: true })
          }
        },
      }),
    [queryClient, query],
  )
  useEffect(() => () => live.cancel(), [live])
  // The first sync after the page opens finds totals the page has only just
  // asked for, and asking again would work out the whole page twice; every
  // later one follows a reconnect, and reads them again.
  const connected = useRef(false)
  useBatchLive(batchId, (kind) => {
    if (kind === 'heartbeat' || kind === 'plan-changed' || kind === 'review-inbox-changed') return
    if (kind === 'sync' && !connected.current) {
      connected.current = true
      live.wake(false)
      return
    }
    live.wake(MOVES_TOTALS.has(kind))
  })

  // The units the people this list can show were admitted from: the tree the
  // list is narrowed by, and the names of each row's unit. Read through this
  // page's own door and over the standing the list is filtered to, so the
  // tree holds no unit whose list comes back empty, and every row's units
  // are in it.
  const units = useQuery({
    ...query.assessment.listRosterUnits.queryOptions({
      params: { batchId },
      query: { reading: 'accounts', status: view.status === '' ? 'all' : view.status },
    }),
    placeholderData: keepPreviousData,
  })
  const byUnit = useMemo(
    () => new Map((units.data?.units ?? []).map((unit) => [unit.id, unit])),
    [units.data],
  )
  /** a row's unit, said the way the heading over that person's account says it */
  const unitPath = (lineage: readonly { nodeId: string }[]) =>
    units.data === undefined
      ? { path: '', unknown: 0 }
      : unitPathOf(lineage, (nodeId) => byUnit.get(nodeId)?.name)
  const chosenUnit = view.unit === '' ? undefined : byUnit.get(view.unit)

  // whether the organization has anybody elsewhere: the totals ride on the
  // first page, so one row is all this has to fetch to know
  const placements = useQuery({
    ...query.assessment.listParticipantPlacements.queryOptions({
      params: { batchId },
      query: { limit: '1' },
    }),
    enabled: manageable,
  })

  // targeted invalidation: only this plugin's reads, never the whole cache
  const invalidate = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  const onError = (error: unknown) => setFailure(formatError(error))
  const addPeople = useMutation({
    mutationFn: (userIds: readonly string[]) =>
      run(
        api.assessment.addParticipants({
          params: { batchId },
          payload: { userIds: [...userIds] },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: (result: { added: number }) => {
      setAdding(false)
      toast.success(format(m.toastAdded, { count: result.added }))
      void invalidate()
    },
    onError,
  })
  const importPeople = useMutation({
    mutationFn: (selection: { orgNodeIds: readonly string[]; userTypeIds: readonly string[] }) =>
      run(
        api.assessment.importParticipants({
          params: { batchId },
          payload: {
            orgNodeIds: [...selection.orgNodeIds],
            userTypeIds: [...selection.userTypeIds],
          },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: (result: { added: number }) => {
      setImporting(false)
      toast.success(format(m.toastImported, { count: result.added }))
      void invalidate()
    },
    onError,
  })

  const setStatus = useMutation({
    mutationFn: (input: { participantId: string; status: 'active' | 'excluded' }) =>
      run(
        api.assessment.setParticipantStatus({
          params: { batchId, participantId: input.participantId },
          payload: { status: input.status },
        }),
      ).then((answer) => ({ ...answer, status: input.status })),
    onMutate: () => setFailure(null),
    onSuccess: (result: { status: 'active' | 'excluded' }) => {
      setExcluding(null)
      toast.success(format(result.status === 'excluded' ? m.toastExcluded : m.toastRestored))
      void invalidate()
    },
    onError,
  })

  const reconcile = useMutation({
    mutationFn: (input: { decisions: readonly PlacementDecision[]; reason: string }) =>
      run(
        api.assessment.reconcileParticipantPlacements({
          params: { batchId },
          payload: {
            decisions: [...input.decisions],
            ...(input.reason !== '' ? { reason: input.reason } : {}),
          },
        }),
      ),
    onSuccess: (result: { synced: number; kept: number }) => {
      toast.success(format(m.placementSettled, { count: result.synced + result.kept }))
      void invalidate()
    },
    // a refusal is about what the dialog shows, so it is said there and the
    // differences are read again: one that moved on is shown as it is now
    onError: (error: unknown) => {
      toast.error(formatError(error))
      void invalidate()
    },
  })

  const tree = (
    <UiSlot
      token={orgNodePickerView}
      context={{
        // one unit, pointed at rather than collected, plus how far down to
        // look: a filter is not a shopping list
        single: true,
        fill: true,
        value: view.unit === '' ? [] : [view.unit],
        onChange: (next: string[]) => onView({ unit: next[0] ?? '' }),
        scope: view.scope,
        onScopeChange: (scope: 'self' | 'subtree') => onView({ scope }),
        nodes: units.data?.units ?? [],
        loading: units.isPending,
      }}
      fallback={null}
      // the shape of a tree, not a block the size of one: a grey rectangle
      // where a list of units will be says only that something is missing
      loading={
        <div {...stylex.props(styles.treeWaiting)}>
          {[0, 1, 2, 3, 4].map((depth) => (
            <Skeleton
              key={depth}
              className={stylex.props(styles.bone).className}
              style={{
                width: `${[68, 84, 56, 76, 48][depth]!}%`,
                marginInlineStart: depth % 2 === 0 ? 0 : 14,
              }}
            />
          ))}
        </div>
      }
    />
  )

  const narrowed = view.q !== '' || view.unit !== '' || view.status !== '' || view.waiting !== ''

  return (
    <div {...stylex.props(styles.panel)}>
      <Feedback message={failure} />
      <ResizableSplit
        storageKey="qualy:assessment-roster-tree"
        initial={300}
        min={240}
        max={TREE_MOST}
        from={TWO_COLUMNS}
        handleLabel={format(m.rosterUnitsResize)}
        // With room for the tree beside the table, it is simply there,
        // filling the window's height from where it stands. Narrower, it is
        // one line saying which units the list is of, and a sheet to change
        // them - the shape the roster of people uses - and no side at all,
        // so no boundary is offered to drag.
        side={
          narrow ? null : (
            <aside {...stylex.props(styles.unitsAside)}>
              <StickyFill>{tree}</StickyFill>
            </aside>
          )
        }
      >
        <section aria-label={format(m.participantResultsTab)} {...stylex.props(styles.listColumn)}>
          <div {...stylex.props(styles.listHead)}>
            <h3 {...stylex.props(styles.listTitle)}>{format(m.tabRoster)}</h3>
            <span data-testid="roster-total" data-count={total} {...stylex.props(styles.listCount)}>
              {format(m.participantCount, { count: total })}
            </span>
            <span {...stylex.props(styles.listSpacer)} />
            {manageable && (
              <span {...stylex.props(styles.listActions)}>
                <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
                  {format(m.importFromOrganization)}
                </Button>
                <Button size="sm" onClick={() => setAdding(true)}>
                  {format(m.addPeople)}
                </Button>
              </span>
            )}
          </div>
          {manageable && placements.data !== undefined && (
            <PlacementNotice
              changedTotal={placements.data.changedTotal}
              unavailableTotal={placements.data.unavailableTotal}
              onOpen={() => setReconciling(true)}
            />
          )}
          {narrow && (
            <button
              type="button"
              data-testid="roster-unit-switch"
              data-unit={view.unit}
              {...stylex.props(styles.unitSwitch)}
              onClick={() => setUnitsOpen(true)}
            >
              <span {...stylex.props(styles.unitSwitchWords)}>
                <span {...stylex.props(styles.unitSwitchName)}>
                  {chosenUnit?.name ?? format(m.rosterUnitsAll)}
                </span>
                <span {...stylex.props(styles.unitSwitchNote)}>{format(m.rosterUnits)}</span>
              </span>
              <span {...stylex.props(styles.unitSwitchGo)}>{format(m.rosterUnitsChange)}</span>
              <ChevronRightIcon aria-hidden {...stylex.props(styles.unitSwitchIcon)} />
            </button>
          )}
          <div {...stylex.props(styles.toolbar)}>
            <SearchField
              name="roster-search"
              value={draft}
              onChange={setDraft}
              label={format(m.rosterSearch, { businessNo })}
              xstyle={styles.search}
            />
            <Select
              value={view.status === '' ? ALL : view.status}
              onValueChange={(next) =>
                onView({ status: next === ALL ? '' : (next as 'active' | 'excluded') })
              }
            >
              <SelectTrigger
                aria-label={format(m.rosterStatusLabel)}
                data-testid="roster-status"
                xstyle={styles.choice}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{format(m.rosterStatusAny)}</SelectItem>
                <SelectItem value="active">{format(m.participantActive)}</SelectItem>
                <SelectItem value="excluded">{format(m.excludedBadge)}</SelectItem>
              </SelectContent>
            </Select>
            <Select
              value={view.waiting === '' ? ALL : view.waiting}
              onValueChange={(next) =>
                onView({ waiting: next === ALL ? '' : (next as 'any' | RosterWaiting) })
              }
            >
              <SelectTrigger
                aria-label={format(m.rosterWaitingLabel)}
                data-testid="roster-waiting"
                xstyle={styles.choice}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{format(m.rosterWaitingAny)}</SelectItem>
                <SelectItem value="any">{format(m.rosterWaitingSomething)}</SelectItem>
                {ROSTER_WAITING.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {format(WAITING_WORDS[kind])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={view.sort}
              onValueChange={(next) => onView({ sort: next as RosterView['sort'] })}
            >
              <SelectTrigger
                aria-label={format(m.rosterSortLabel)}
                data-testid="roster-sort"
                xstyle={styles.choice}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unit">{format(m.rosterSortUnit)}</SelectItem>
                <SelectItem value="name">{format(m.rosterSortName)}</SelectItem>
                <SelectItem value="business-no">
                  {format(m.rosterSortBusinessNo, { businessNo })}
                </SelectItem>
              </SelectContent>
            </Select>
            {participants.isFetching && !participants.isPending && (
              <Spinner
                aria-label={format(commonMessages.loading)}
                className={stylex.props(styles.busy).className}
              />
            )}
          </div>
          {/* the rows stand without their totals; why, and the way to ask
              for them again, said once above them rather than on each row */}
          {scores.isError ? (
            <ScoresNotice
              cause="request"
              reason={formatError(scores.error)}
              busy={scores.isFetching}
              onRetry={() => void scores.refetch()}
            />
          ) : (
            serviceDown && (
              <ScoresNotice
                cause="scoring-unavailable"
                reason={format(m.rosterScoreUnavailable)}
                busy={scores.isFetching}
                onRetry={() => void scores.refetch()}
              />
            )
          )}
          <AsyncSection
            pending={participants.isPending}
            error={participants.isError ? formatError(participants.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void participants.refetch()}
            skeleton={
              <div {...stylex.props(styles.skFrame)}>
                {['60%', '45%', '70%', '52%', '64%', '48%'].map((width, index) => (
                  <div key={index} {...stylex.props(styles.skRow, index === 0 && styles.skHead)}>
                    <Skeleton className={stylex.props(styles.skBone).className} width="70%" />
                    <Skeleton className={stylex.props(styles.skBone).className} width={width} />
                    <Skeleton className={stylex.props(styles.skChip).className} />
                    <Skeleton className={stylex.props(styles.skBone).className} width="60%" />
                  </div>
                ))}
              </div>
            }
          >
            <Card data-testid="roster">
              <Table columns={COLUMNS}>
                <TableHead>
                  <span>{businessNo}</span>
                  <span>{format(m.columnParticipant)}</span>
                  <span>{format(m.rosterColumnWaiting)}</span>
                  <span>{format(m.rosterColumnScore)}</span>
                  <span />
                </TableHead>
                {rows.length === 0 ? (
                  <CardEmpty>{format(narrowed ? m.rosterNoMatch : m.rosterEmpty)}</CardEmpty>
                ) : (
                  rows.map((row) => {
                    const { path, unknown } = unitPath(row.anchorLineage)
                    const who = (
                      <span data-testid="participant-who" {...stylex.props(styles.who)}>
                        <span {...stylex.props(styles.nameWithMark)}>
                          <span data-testid="participant-name" {...stylex.props(styles.name)}>
                            {row.displayName}
                          </span>
                          {/* taking part is what a roster row is, so only
                              the exception is said, beside the name it is
                              about rather than in a column of its own */}
                          {row.status === 'excluded' && (
                            <span {...stylex.props(styles.mark)}>
                              <Status tone="bad" data-testid="participant-excluded">
                                {format(m.excludedBadge)}
                              </Status>
                            </span>
                          )}
                          <PlacementMark placement={row.placement} />
                        </span>
                        {path !== '' && (
                          <span
                            data-testid="participant-unit"
                            data-unknown={unknown}
                            title={path}
                            {...stylex.props(styles.unitLine)}
                          >
                            {path}
                          </span>
                        )}
                      </span>
                    )
                    return (
                      <TableRow
                        key={row.id}
                        height="compact"
                        nested
                        onOpen={() => onOpen(row.id)}
                        data-testid="participant-row"
                        data-participant={row.id}
                        data-participant-status={row.status}
                      >
                        {/* across a table the number leads, because that is
                            what the list is scanned by; stacked, a row is a
                            person with their facts under them */}
                        {stacked ? (
                          <>
                            <Cell lead>{who}</Cell>
                            <Cell
                              numeric
                              unlabelled
                              tone={row.businessNo === null ? 'quiet' : 'muted'}
                            >
                              {row.businessNo ?? format(m.noBusinessNoShort, { businessNo })}
                            </Cell>
                          </>
                        ) : (
                          <>
                            <Cell lead numeric tone={row.businessNo === null ? 'quiet' : 'plain'}>
                              {row.businessNo ?? format(m.noBusinessNoShort, { businessNo })}
                            </Cell>
                            <Cell tone="plain" unlabelled>
                              {who}
                            </Cell>
                          </>
                        )}
                        <Cell unlabelled>
                          <RosterFilings filings={row.filings} />
                        </Cell>
                        {/* the total is what the list is scanned by, so
                            stacked it keeps the end of the row */}
                        <Cell narrow="end" end unlabelled>
                          <RosterScore
                            batchId={batchId}
                            participantId={row.id}
                            name={row.displayName}
                            answer={scored.get(row.id)}
                            answeredAt={scores.dataUpdatedAt}
                            waiting={scores.isPending && scores.fetchStatus !== 'idle'}
                            movedAt={movedAt}
                          />
                        </Cell>
                        {/* the act on one person, where the person is */}
                        <span {...stylex.props(styles.rowAct)}>
                          {manageable && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  size="icon-xs"
                                  variant="ghost"
                                  data-testid="participant-actions"
                                  aria-label={format(m.rosterRowActions, { name: row.displayName })}
                                  onClick={(event) => event.stopPropagation()}
                                >
                                  <EllipsisIcon aria-hidden />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => onOpen(row.id)}>
                                  {format(m.participantResultsOpen)}
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  data-testid="participant-standing"
                                  onSelect={() =>
                                    row.status === 'excluded'
                                      ? setStatus.mutate({
                                          participantId: row.id,
                                          status: 'active',
                                        })
                                      : setExcluding({ id: row.id, name: row.displayName })
                                  }
                                >
                                  {format(row.status === 'excluded' ? m.restore : m.exclude)}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </span>
                      </TableRow>
                    )
                  })
                )}
              </Table>
              <CardFoot>
                <Pager
                  testId="roster-pager"
                  label={format(m.rosterPagerLabel)}
                  page={page}
                  pageSize={ROSTER_PAGE_SIZE}
                  total={total}
                  disabled={participants.isFetching}
                  summary={format(m.rosterPageSummary, {
                    from: total === 0 ? 0 : (page - 1) * ROSTER_PAGE_SIZE + 1,
                    to: (page - 1) * ROSTER_PAGE_SIZE + rows.length,
                    total,
                  })}
                  onPage={(next) => {
                    onView({ page: next })
                    // the pager is at the foot of the list; the next page
                    // is read from its top
                    document
                      .querySelector('[data-testid="roster"]')
                      ?.scrollIntoView({ block: 'start', behavior: 'smooth' })
                  }}
                />
              </CardFoot>
            </Card>
          </AsyncSection>
        </section>
      </ResizableSplit>

      {narrow && (
        <DetailSheet
          open={unitsOpen}
          onClose={() => setUnitsOpen(false)}
          title={format(m.rosterUnits)}
          closeLabel={format(commonMessages.close)}
          testId="roster-unit-sheet"
          fill
        >
          <div {...stylex.props(styles.unitsSeat)}>{tree}</div>
        </DetailSheet>
      )}

      <ConfirmDialog
        open={excluding !== null}
        title={format(m.excludeTitle, { name: excluding?.name ?? '' })}
        description={format(m.excludeBody)}
        confirmLabel={format(m.exclude)}
        cancelLabel={format(commonMessages.cancel)}
        pending={setStatus.isPending}
        tone="destructive"
        onConfirm={() =>
          excluding && setStatus.mutate({ participantId: excluding.id, status: 'excluded' })
        }
        onCancel={() => setExcluding(null)}
      />
      {manageable && (
        <>
          <PlacementDialog
            batchId={batchId}
            open={reconciling}
            pending={reconcile.isPending}
            onDecide={(decisions, reason) => reconcile.mutate({ decisions, reason })}
            onClose={() => setReconciling(false)}
          />
          <AddPeopleDialog
            batchId={batchId}
            open={adding}
            pending={addPeople.isPending}
            onAdd={(userIds) => addPeople.mutate(userIds)}
            onClose={() => setAdding(false)}
          />
          <ImportDialog
            batchId={batchId}
            open={importing}
            pending={importPeople.isPending}
            onImport={(selection) => importPeople.mutate(selection)}
            onClose={() => setImporting(false)}
          />
        </>
      )}
    </div>
  )
}

/**
 * A light word beside a name whose person the organization has elsewhere.
 *
 * Only that it differs: where from and where to belong in the dialog, and a
 * roster that spelt out every move would be a roster of moves.
 */
function PlacementMark({ placement }: { placement: 'current' | 'changed' | 'unavailable' }) {
  const { format } = useI18n()
  if (placement === 'current') return null
  return (
    <Badge variant="outline" data-testid="placement-mark" data-placement={placement}>
      {format(placement === 'changed' ? m.placementChangedMark : m.placementUnavailableMark)}
    </Badge>
  )
}
