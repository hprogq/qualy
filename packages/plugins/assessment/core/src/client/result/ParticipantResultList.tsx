import { useEffect, useMemo, useRef, useState } from 'react'
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import {
  ChevronRightIcon,
  EllipsisIcon,
  ListTreeIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
} from 'lucide-react'
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
import { UnitPath } from '@qualy/ui/unit-path'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { AddPeopleDialog } from '../roster/AddPeopleDialog.tsx'
import { ImportDialog } from '../roster/ImportDialog.tsx'
import { PlacementDialog, type PlacementDecision } from '../roster/PlacementDialog.tsx'
import { PlacementNotice } from '../roster/PlacementNotice.tsx'
import { UnreachableNotice } from '../roster/UnreachableNotice.tsx'
import { UnreachableDialog } from '../roster/UnreachableDialog.tsx'
import type { AdmissionOutcomeFacts } from '../roster/AdmissionOutcome.tsx'
import { RosterFilings } from '../roster/RosterFilings.tsx'
import { useWaitingColumn, waitsOnAnything } from '../roster/filings.ts'
import { RosterScore } from '../roster/RosterScore.tsx'
import { unitPathOf } from '../roster/unit-path.ts'
import { pathWidthOf, widthOf } from '../roster/measure.ts'
import {
  ROSTER_PAGE_SIZE,
  ROSTER_WAITING,
  rosterQueryOf,
  useRosterSearch,
  type RosterView,
  type RosterWaiting,
} from '../roster/roster-view.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { ROSTER_MAX_WAIT, ROSTER_SETTLE, settler, SYNC_FRESH } from '../roster/live-settle.ts'
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
 * folding into one control in the toolbar.
 *
 * Counted from what the table needs, not from where two columns first fit:
 * a laptop's 1280 less the rail (224), a scrollbar's gutter (17), the page's
 * margins (48), the tree (260) and the gap (20) leaves the list 711 pixels.
 * The row takes its padding (32) and gaps (64), the number (104), a name
 * with its unit (160 at least), the waiting counts (144 at most), a total
 * (120) and a menu (32): 656. An inch narrower and the name is what gives.
 */
const TWO_COLUMNS = 1280

/**
 * The widest the reader may drag the unit tree.
 *
 * Bounded by the table, not by the tree: at the narrowest width the tree
 * stands beside the list, 1280 less the rail (224), a scrollbar's gutter
 * (17), the page's margins (48) and the gap (20), less the table's 656,
 * leaves it 315. A width stored in a wider window is held to this too,
 * rather than squeezing the menu out of the row.
 */
const TREE_MOST = 312

/**
 * The columns around the person and what waits on them. The person's column
 * is as wide as the page's widest name or unit path (measured below) and
 * is given that before anything else grows; the waiting column is at least
 * as wide as the page's widest answer (RosterFilings) and takes whatever is
 * left, so on a wide screen the room goes to the counts beside a name
 * rather than to a band of nothing between the name and them. The total is
 * wide enough for the longest reason there is none beside the button that
 * asks again; a reason longer still, in some language, takes a second line
 * rather than the button.
 */
const numberColumn = '6.5rem'
const tailColumns = '7.5rem 2rem'

/**
 * The narrowest and widest the person's column is drawn. Past the widest a
 * unit path folds its front away, which leaves the unit itself said whole.
 */
const PERSON_LEAST = 160
const PERSON_MOST = 480

/** the size a name is said at on a row, and a mark beside it */
const NAME_SIZE = 12.5
const MARK_SIZE = 12

/** whether the reader keeps the unit tree open beside the list, remembered per browser */
const TREE_OPEN_KEY = 'qualy:assessment-roster-tree-open'

const readTreeOpen = (): boolean => {
  try {
    return window.localStorage.getItem(TREE_OPEN_KEY) !== '0'
  } catch {
    return true
  }
}

const keepTreeOpen = (open: boolean) => {
  try {
    window.localStorage.setItem(TREE_OPEN_KEY, open ? '1' : '0')
  } catch {
    // a window that cannot remember starts with the tree open again
  }
}

/**
 * A select cannot hold the empty string as a value, so "no narrowing" needs
 * a word of its own, one that none of these selects' choices uses.
 */
const ALL = 'all'

/**
 * The wake-ups that can move somebody's total, rather than only what they
 * wait on. A `sync`, which opens every connection, is weighed on its own.
 */
const MOVES_TOTALS: ReadonlySet<BatchLiveEvent['kind']> = new Set([
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
  // The whole content area, from the top: the page says its own name on one
  // line and the list starts under it, rather than under a band, a heading
  // and a second heading over the list itself.
  panel: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 12,
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingTop: { default: 18, [breakpoints.phone]: 14 },
    paddingBottom: 24,
  },
  head: {
    display: 'flex',
    minHeight: 34,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 8,
  },
  title: {
    margin: 0,
    fontSize: { default: 18, [breakpoints.phone]: 17 },
    lineHeight: '1.5rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  count: {
    fontSize: 13,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  spacer: { flexGrow: 1 },
  actions: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 8 },
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
  // Which units the list is of, as one control in the toolbar: where the
  // tree is folded away it says the unit and brings the tree back; where
  // there is no room for a tree it opens it in a sheet. Shaped like the
  // choices beside it, so the toolbar reads as one row of questions.
  unitSwitch: {
    display: 'inline-flex',
    height: 36,
    maxWidth: { default: '16rem', [breakpoints.tablet]: '12rem', [breakpoints.phone]: 'none' },
    width: { default: 'auto', [breakpoints.phone]: '100%' },
    // it says which units the list is of, so it keeps its words while the
    // choices beside it, which have room to spare, give way first; a long
    // unit's name is held to a width the row can always spare
    flexShrink: 0,
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    borderRadius: tokens.radiusMd,
    backgroundColor: {
      default: tokens.input,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, ${tokens.input})`,
    },
    fontFamily: 'inherit',
    fontSize: 14,
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `0 0 0 2px ${tokens.focusRing}` },
  },
  unitSwitchName: {
    minWidth: 0,
    flexGrow: 1,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  unitSwitchIcon: { width: 15, height: 15, flexShrink: 0, color: tokens.mutedForeground },
  // the unit the list is narrowed to, where the tree no longer holds it
  offTree: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 8,
    rowGap: 4,
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  offTreeName: { minWidth: 0, overflowWrap: 'anywhere' },
  treeWaiting: { display: 'flex', flexDirection: 'column', gap: 10, paddingBlock: 8 },
  bone: { height: 14, borderRadius: 4 },
  listColumn: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 10 },
  // One row from a tablet up, however narrow the list gets beside the rail:
  // the choices and the search give a little rather than the last choice
  // dropping to a line of its own. On a phone the search takes a line and
  // the choices share the next.
  toolbar: {
    display: 'flex',
    flexWrap: { default: 'nowrap', [breakpoints.phone]: 'wrap' },
    alignItems: 'center',
    gap: 8,
  },
  // the search takes what the row leaves the choices, within reason
  search: {
    minWidth: { default: '8rem', [breakpoints.phone]: 0 },
    maxWidth: { default: '20rem', [breakpoints.phone]: 'none' },
    width: { default: 'auto', [breakpoints.phone]: '100%' },
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: { default: '10rem', [breakpoints.phone]: 'auto' },
  },
  choice: {
    width: { default: '8rem', [breakpoints.phone]: 'auto' },
    minWidth: { default: '6.5rem', [breakpoints.phone]: 0 },
    flexGrow: { default: 0, [breakpoints.phone]: 1 },
    flexShrink: 4,
    flexBasis: { default: null, [breakpoints.phone]: '0%' },
  },
  busy: { width: 14, height: 14, flexShrink: 0, color: tokens.mutedForeground },
  who: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 1, paddingBlock: 4 },
  nameWithMark: { display: 'inline-flex', minWidth: 0, alignItems: 'center', gap: 8 },
  name: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  mark: { display: 'inline-flex', flexShrink: 0 },
  unitLine: { display: 'flex', minWidth: 0, fontWeight: 400 },
  // a column's none, as light as the dash of a row with nothing waiting
  none: { color: `color-mix(in oklab, ${tokens.mutedForeground} 55%, transparent)` },
  // the total's own edge, which is the row's: the digits of every row line
  // up against the menu, where the eye running down the column meets them
  scoreSeat: { display: 'flex', minWidth: 0, justifyContent: 'flex-end' },
  headEnd: { textAlign: 'end' },
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
    gap: 16,
    gridTemplateColumns: {
      default: '6.5rem minmax(0, 1fr) 6rem 7.5rem',
      [breakpoints.phone]: 'minmax(0, 1fr) 4rem',
    },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: 16,
    paddingBlock: 14,
    ':last-child': { borderBottomWidth: 0 },
  },
  skHead: { backgroundColor: tokens.surfaceInset, paddingBlock: 9 },
  skWide: { display: { default: null, [breakpoints.phone]: 'none' } },
  skBone: { height: 13, borderRadius: 4 },
  skChip: { height: 13, width: '3rem', borderRadius: 4 },
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
  // Beside the list the tree can be folded away, for a reader who works
  // down the whole roster and wants the room; the fold is remembered.
  const [treeOpen, setTreeOpen] = useState(readTreeOpen)
  const foldTree = (open: boolean) => {
    setTreeOpen(open)
    keepTreeOpen(open)
  }
  const treeBeside = !narrow && treeOpen

  // the same words, asked the same way, as the list beside an open account
  const search = useRosterSearch(view.q, onView)

  const pageRows = query.assessment.listParticipantAccounts.queryOptions({
    params: { batchId },
    query: rosterQueryOf(view),
  })
  const participants = useQuery({
    ...pageRows,
    // the rows of the page being left stay up until the next one arrives,
    // so turning a page does not blank the table
    placeholderData: keepPreviousData,
  })
  // one list per answer, so what is measured from the rows is measured once
  const rows = useMemo(() => participants.data?.items ?? [], [participants.data])
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
  const latestRows = useRef(pageRows.queryKey)
  latestRows.current = pageRows.queryKey
  const [movedAt, setMovedAt] = useState(0)
  const live = useMemo(
    () =>
      settler<boolean>({
        settle: ROSTER_SETTLE,
        maxWait: ROSTER_MAX_WAIT,
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
  // A line that has just opened finds whatever was read before it may have
  // moved while nobody was listening - after a reconnect, the rows and their
  // totals both. What is being read right now, or was read a moment ago,
  // has not: the page has only just asked for its rows and totals, and
  // asking again would work out the whole page twice.
  useBatchLive(batchId, (kind) => {
    if (kind === 'heartbeat' || kind === 'plan-changed' || kind === 'review-inbox-changed') return
    if (kind === 'sync') {
      const lately = Date.now() - SYNC_FRESH
      // read at some point, not being read now, and not a moment ago; what
      // has never been read is read when it is first asked for
      const behind = (key: QueryKey) => {
        const read = queryClient.getQueryState(key)
        return (
          read !== undefined &&
          read.dataUpdatedAt > 0 &&
          read.fetchStatus !== 'fetching' &&
          read.dataUpdatedAt < lately
        )
      }
      const totals = behind(latestScores.current)
      if (totals || behind(latestRows.current)) live.wake(totals)
      return
    }
    // a question's review steps changed: who they find nowhere may have too
    if (kind === 'item-changed') {
      void queryClient.invalidateQueries({
        queryKey: query.assessment.reviewAlerts.key({ params: { batchId } }),
      })
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
      ? { steps: [], path: '', unknown: 0 }
      : unitPathOf(lineage, (nodeId) => byUnit.get(nodeId)?.name)
  const chosenUnit = view.unit === '' ? undefined : byUnit.get(view.unit)

  // The unit the list is narrowed to can fall out of the tree: the tree is
  // read over the standing the list shows, and a unit with nobody of that
  // standing is not in it. The narrowing stays - the list answers the
  // question that was asked - and is said, by the name it had, with a way
  // to drop it, since the tree no longer offers one.
  const named = useRef(new Map<string, string>())
  useEffect(() => {
    for (const unit of units.data?.units ?? []) named.current.set(unit.id, unit.name)
  }, [units.data])
  const unitName = view.unit === '' ? undefined : (chosenUnit?.name ?? named.current.get(view.unit))
  const offTree =
    view.unit !== '' &&
    units.data !== undefined &&
    !units.isPlaceholderData &&
    !byUnit.has(view.unit)

  // whether the organization has anybody elsewhere: the totals ride on the
  // first page, so one row is all this has to fetch to know
  const placements = useQuery({
    ...query.assessment.listParticipantPlacements.queryOptions({
      params: { batchId },
      query: { limit: '1' },
    }),
    enabled: manageable,
  })
  // whether some question's review steps find anybody on the roster nowhere,
  // read off the roster and the questions as they are now (§32.93)
  const reach = useQuery({
    ...query.assessment.reviewAlerts.queryOptions({ params: { batchId } }),
    enabled: manageable,
  })
  const [unreachableOpen, setUnreachableOpen] = useState(false)

  // targeted invalidation: only this plugin's reads, never the whole cache
  const invalidate = () => queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  const onError = (error: unknown) => setFailure(formatError(error))
  // What people put on the roster leave it with, where there is something
  // to say, stays in the dialog that put them there until the reader is done
  // with it; otherwise the dialog closes on a toast, as it always has.
  const [added, setAdded] = useState<AdmissionOutcomeFacts | null>(null)
  const [imported, setImported] = useState<AdmissionOutcomeFacts | null>(null)
  const warns = (facts: AdmissionOutcomeFacts) => facts.cannotSubmit > 0 || facts.systemAccounts > 0
  const addPeople = useMutation({
    mutationFn: (userIds: readonly string[]) =>
      run(
        api.assessment.addParticipants({
          params: { batchId },
          payload: { userIds: [...userIds] },
        }),
      ),
    onMutate: () => setFailure(null),
    onSuccess: (result: AdmissionOutcomeFacts) => {
      if (warns(result)) setAdded(result)
      else {
        setAdding(false)
        toast.success(format(m.toastAdded, { count: result.added }))
      }
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
    onSuccess: (result: AdmissionOutcomeFacts) => {
      if (warns(result)) setImported(result)
      else {
        setImporting(false)
        toast.success(format(m.toastImported, { count: result.added }))
      }
      void invalidate()
    },
    onError,
  })
  const closeAdding = () => {
    setAdding(false)
    setAdded(null)
  }
  const closeImporting = () => {
    setImporting(false)
    setImported(null)
  }
  // from what a write just said to the questions and people concerned
  const review = () => {
    closeAdding()
    closeImporting()
    setUnreachableOpen(true)
  }

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
  const unitWord =
    view.unit === '' ? format(m.rosterUnitsAll) : (unitName ?? format(m.rosterUnitChosen))
  const waitingHead = format(m.rosterColumnWaiting)
  const waitingColumn = useWaitingColumn(rows, waitingHead)
  // The person's column, measured from what this page's rows say: the name
  // with the marks beside it, and the unit path under it on one line.
  const personWidth = useMemo(() => {
    let widest = 0
    for (const row of rows) {
      const marks = [
        ...(row.status === 'excluded'
          ? [widthOf(format(m.excludedBadge), MARK_SIZE, 400) + 12]
          : []),
        ...(row.placement === 'current'
          ? []
          : [
              widthOf(
                format(
                  row.placement === 'changed' ? m.placementChangedMark : m.placementUnavailableMark,
                ),
                MARK_SIZE,
                600,
              ) + 22,
            ]),
      ]
      const name =
        widthOf(row.displayName, NAME_SIZE, 400) + marks.reduce((sum, one) => sum + one + 8, 0)
      const path =
        units.data === undefined
          ? 0
          : pathWidthOf(unitPathOf(row.anchorLineage, (nodeId) => byUnit.get(nodeId)?.name).steps)
      widest = Math.max(widest, name, path)
    }
    return Math.ceil(Math.min(PERSON_MOST, Math.max(PERSON_LEAST, widest + 8)))
  }, [rows, units.data, byUnit, format])
  const columns = `${numberColumn} minmax(${String(PERSON_LEAST)}px, ${String(personWidth)}px) minmax(${waitingColumn}, 1fr) ${tailColumns}`

  const listSection = (
    <section aria-label={format(m.participantResultsTab)} {...stylex.props(styles.listColumn)}>
      <div {...stylex.props(styles.toolbar)}>
        {narrow ? (
          <button
            type="button"
            data-testid="roster-unit-switch"
            data-unit={view.unit}
            data-off-tree={offTree}
            aria-label={`${format(m.rosterUnits)} ${unitWord}`}
            aria-haspopup="dialog"
            {...stylex.props(styles.unitSwitch)}
            onClick={() => setUnitsOpen(true)}
          >
            <ListTreeIcon aria-hidden {...stylex.props(styles.unitSwitchIcon)} />
            <span {...stylex.props(styles.unitSwitchName)}>{unitWord}</span>
            <ChevronRightIcon aria-hidden {...stylex.props(styles.unitSwitchIcon)} />
          </button>
        ) : treeOpen ? (
          <Button
            size="icon"
            variant="outline"
            data-testid="roster-tree-toggle"
            data-open="true"
            aria-expanded
            aria-label={format(m.rosterTreeHide)}
            onClick={() => foldTree(false)}
          >
            <PanelLeftCloseIcon aria-hidden />
          </Button>
        ) : (
          // folded away, the control still says which units the list
          // is of, and brings the tree back
          <button
            type="button"
            data-testid="roster-tree-toggle"
            data-open="false"
            data-unit={view.unit}
            aria-expanded={false}
            aria-label={`${format(m.rosterTreeShow)} ${unitWord}`}
            {...stylex.props(styles.unitSwitch)}
            onClick={() => foldTree(true)}
          >
            <PanelLeftOpenIcon aria-hidden {...stylex.props(styles.unitSwitchIcon)} />
            <span {...stylex.props(styles.unitSwitchName)}>{unitWord}</span>
          </button>
        )}
        <SearchField
          name="roster-search"
          value={search.draft}
          onChange={search.setDraft}
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
      {offTree && (
        <div
          data-testid="roster-unit-off-tree"
          data-unit={view.unit}
          {...stylex.props(styles.offTree)}
        >
          <span {...stylex.props(styles.offTreeName)}>
            {format(m.rosterUnitNarrowed, {
              unit: unitName ?? format(m.rosterUnitChosen),
            })}
          </span>
          <Button
            size="xs"
            variant="outline"
            aria-label={format(m.rosterUnitClearLabel)}
            onClick={() => onView({ unit: '' })}
          >
            {format(m.rosterUnitClear)}
          </Button>
        </div>
      )}
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
                <Skeleton
                  className={stylex.props(styles.skBone, styles.skWide).className}
                  width="70%"
                />
                <Skeleton className={stylex.props(styles.skBone).className} width={width} />
                <Skeleton className={stylex.props(styles.skChip, styles.skWide).className} />
                <Skeleton className={stylex.props(styles.skBone).className} width="60%" />
              </div>
            ))}
          </div>
        }
      >
        <Card data-testid="roster">
          <Table columns={columns}>
            <TableHead>
              <span>{businessNo}</span>
              <span>{format(m.columnParticipant)}</span>
              <span>{waitingHead}</span>
              <span {...stylex.props(styles.headEnd)}>{format(m.rosterColumnScore)}</span>
              <span />
            </TableHead>
            {rows.length === 0 ? (
              <CardEmpty>{format(narrowed ? m.rosterNoMatch : m.rosterEmpty)}</CardEmpty>
            ) : (
              rows.map((row) => {
                const { steps, path, unknown } = unitPath(row.anchorLineage)
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
                    {/* said from the unit's own end: the class tells two
                        people apart, the college above it rarely does */}
                    {steps.length > 0 && (
                      <span
                        data-testid="participant-unit"
                        data-unknown={unknown}
                        // the whole path as the row says it; the hint on
                        // hover is the line's own
                        data-path={path}
                        {...stylex.props(styles.unitLine)}
                      >
                        <UnitPath steps={steps} title={path} />
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
                        <Cell numeric unlabelled tone={row.businessNo === null ? 'quiet' : 'muted'}>
                          {row.businessNo ?? format(m.noBusinessNoShort, { businessNo })}
                        </Cell>
                      </>
                    ) : (
                      <>
                        {/* under its column's head a missing number is a
                            dash, as a row with nothing waiting is: the words
                            for it are longer than the column in some
                            languages, and stay a hover and a reader away */}
                        <Cell
                          lead
                          numeric
                          tone={row.businessNo === null ? 'quiet' : 'plain'}
                          title={
                            row.businessNo === null
                              ? format(m.noBusinessNoShort, { businessNo })
                              : undefined
                          }
                        >
                          {row.businessNo ?? (
                            <span data-testid="participant-no-number">
                              <span aria-hidden {...stylex.props(styles.none)}>
                                —
                              </span>
                              <VisuallyHidden>
                                {format(m.noBusinessNoShort, { businessNo })}
                              </VisuallyHidden>
                            </span>
                          )}
                        </Cell>
                        <Cell tone="plain" unlabelled>
                          {who}
                        </Cell>
                      </>
                    )}
                    {/* in a column, nothing waiting is a dash; stacked
                        under a name it is nothing at all, since a fact
                        with no words would only leave its rule behind */}
                    <Cell unlabelled>
                      {stacked && !waitsOnAnything(row.filings) ? null : (
                        <RosterFilings filings={row.filings} />
                      )}
                    </Cell>
                    {/* the total is what the list is scanned by, so
                        stacked it keeps the end of the row */}
                    <Cell narrow="end" end unlabelled>
                      <span {...stylex.props(styles.scoreSeat)}>
                        <RosterScore
                          batchId={batchId}
                          participantId={row.id}
                          name={row.displayName}
                          answer={scored.get(row.id)}
                          answeredAt={scores.dataUpdatedAt}
                          waiting={scores.isPending && scores.fetchStatus !== 'idle'}
                          movedAt={movedAt}
                        />
                      </span>
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
          {total > 0 && (
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
          )}
        </Card>
      </AsyncSection>
    </section>
  )

  return (
    <div {...stylex.props(styles.panel)}>
      {/* The page's name, how many it holds and what can be done to it, on
          one line: the rail already says which section this is, and the bar
          above it which round, so a band saying it again only pushed the
          list down. */}
      <header {...stylex.props(styles.head)}>
        <h1 {...stylex.props(styles.title)}>{format(m.participantResultsTab)}</h1>
        {/* how many the list holds, or how many answer what it was asked;
            an empty list says so itself, below */}
        {total > 0 && (
          <span
            data-testid="roster-total"
            data-count={total}
            data-narrowed={narrowed}
            {...stylex.props(styles.count)}
          >
            {format(narrowed ? m.rosterMatchCount : m.participantCount, { count: total })}
          </span>
        )}
        <span {...stylex.props(styles.spacer)} />
        {manageable && (
          <span {...stylex.props(styles.actions)}>
            <Button size="sm" variant="outline" onClick={() => setImporting(true)}>
              {format(m.importFromOrganization)}
            </Button>
            <Button size="sm" onClick={() => setAdding(true)}>
              {format(m.addPeople)}
            </Button>
          </span>
        )}
      </header>
      <Feedback message={failure} />
      {manageable && placements.data !== undefined && (
        <PlacementNotice
          changedTotal={placements.data.changedTotal}
          unavailableTotal={placements.data.unavailableTotal}
          onOpen={() => setReconciling(true)}
        />
      )}
      {manageable && reach.data !== undefined && (
        <UnreachableNotice
          cannotSubmit={reach.data.unreachable.cannotSubmit}
          onOpen={() => setUnreachableOpen(true)}
        />
      )}
      {treeBeside ? (
        <ResizableSplit
          storageKey="qualy:assessment-roster-tree"
          initial={260}
          min={220}
          max={TREE_MOST}
          from={TWO_COLUMNS}
          handleLabel={format(m.rosterUnitsResize)}
          // with room for the tree beside the table, it is simply there,
          // filling the window's height from where it stands
          side={
            <aside {...stylex.props(styles.unitsAside)}>
              <StickyFill>{tree}</StickyFill>
            </aside>
          }
        >
          {listSection}
        </ResizableSplit>
      ) : (
        // Folded away, or no room for it: the list alone, the whole width,
        // with the unit said in the toolbar and a sheet to change it where
        // the tree cannot come back beside the list. No side at all, so no
        // boundary is offered to drag.
        listSection
      )}

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
            outcome={added}
            onAdd={(userIds) => addPeople.mutate(userIds)}
            onReview={review}
            onClose={closeAdding}
          />
          <ImportDialog
            batchId={batchId}
            open={importing}
            pending={importPeople.isPending}
            outcome={imported}
            onImport={(selection) => importPeople.mutate(selection)}
            onReview={review}
            onClose={closeImporting}
          />
          <UnreachableDialog
            batchId={batchId}
            open={unreachableOpen}
            onClose={() => setUnreachableOpen(false)}
            onOpenPerson={(participantId) => {
              setUnreachableOpen(false)
              onOpen(participantId)
            }}
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
