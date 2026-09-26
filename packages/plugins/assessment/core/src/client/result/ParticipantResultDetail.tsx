import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeftIcon, ChevronDownIcon } from 'lucide-react'
import {
  ScreenAside,
  useApi,
  useApiQuery,
  useRunApi,
  useScreenAsideOffered,
} from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { isApiErrorCode, useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog } from '@qualy/ui/admin'
import { toast } from '@qualy/ui/toast'
import { Button } from '@qualy/ui/button'
import { Count } from '@qualy/ui/count'
import { Skeleton } from '@qualy/ui/skeleton'
import { Drill, Swap, type DrillMove } from '@qualy/ui/reveal'
import { liveStateOf } from '@qualy/ui/live-mark'
import { UnitPath } from '@qualy/ui/unit-path'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { a11yStyles } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { ZoneAwayNotice } from '../batch/BatchZone.tsx'
import { inZone, useBatchZone } from '../batch/zone.ts'
import { useBatchLive } from '../live.ts'
import { useQueueRefresh } from '../review/queue.ts'
import { StandingNotice } from '../entry/workspace/StandingNotice.tsx'
import { ResultLedger, ResultUnavailable } from './ResultLedger.tsx'
import { ParticipantEntries } from './ParticipantEntries.tsx'
import { useParticipantEntries } from './participant-entries.ts'
import { unitChainOf, unitPathOf } from '../roster/unit-path.ts'
import { settler } from '../roster/live-settle.ts'

// One participant's whole account, in the page the list came from.
//
// Who they are stands beside the work rather than above it. Where the
// workspace shell has a column beside the page, the rail of the round's
// sections gives it up to this person: their name, where they stand in the
// organization and on this round's roster, the two halves of their account,
// the way to the people either side of them and the way back to the list -
// and under all that the list itself, so the next person to open is a press
// away. The work itself - the claims, or the account's arithmetic - then
// takes the rest of the window, edge to edge. Narrower, the same things
// stand in a head over the work, the list a press away from where this
// person stands on it, and on a phone the facts fold behind the name.
//
// Stepping to another person is the same page with other facts in it: the
// column stays - and with it the list's place and whatever had the focus -
// and only the work steps up or down the way the list went.
//
// Two halves, because there are two questions: what was filed and decided,
// read in the same workspace the person files in, and what the total came
// to. They are the same facts read two ways, so either hands off to the
// other - a score line leads to the filing that earned it.

const styles = stylex.create({
  root: {
    display: 'flex',
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  // ---- beside the work, in the column the shell lends ----
  // As tall as the column at least, the list under the facts taking what
  // they leave; a column too short for both scrolls whole.
  panel: {
    display: 'flex',
    flexGrow: 1,
    flexShrink: 0,
    flexDirection: 'column',
    gap: 16,
    paddingInline: 16,
    paddingTop: 12,
    paddingBottom: 16,
  },
  panelTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginInline: -6,
  },
  back: {
    display: 'inline-flex',
    minWidth: 0,
    height: 30,
    alignItems: 'center',
    gap: 6,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: { default: 'transparent', ':hover': tokens.surfaceMuted },
    fontFamily: 'inherit',
    fontSize: 13,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `0 0 0 2px ${tokens.focusRing}` },
  },
  backIcon: { width: 15, height: 15, flexShrink: 0 },
  backWords: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  identity: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 8 },
  name: {
    margin: 0,
    fontSize: { default: 18, [breakpoints.phone]: 17 },
    lineHeight: '1.5rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    overflowWrap: 'anywhere',
  },
  chips: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  // the standing, and the way to change it at the far end of the same line
  standingLine: {
    display: 'flex',
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  // the roster standing as a chip beside the name: counted in, or taken off
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 22,
    borderRadius: 6,
    paddingInline: 8,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  chipActive: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 15%, transparent)`,
    color: tokens.successForeground,
  },
  chipExcluded: { backgroundColor: tokens.surfaceMuted, color: tokens.surfaceMutedForeground },
  chipMoved: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 16%, transparent)`,
    color: tokens.warningForeground,
  },
  // The facts as a short list, each name over its value. The column is
  // narrow, and a name beside its value took the room from the value in
  // whichever language names it at length - where somebody stands, said
  // from its own end, lost its end first. The short ones share a line two
  // abreast, so the list under them has the room; where they stand takes a
  // line of its own.
  facts: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gridAutoFlow: 'row dense',
    columnGap: 12,
    rowGap: 10,
    margin: 0,
    fontSize: 13,
  },
  fact: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  factWide: { gridColumn: '1 / -1' },
  factName: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  factValue: {
    display: 'flex',
    minWidth: 0,
    margin: 0,
    color: tokens.foreground,
    overflowWrap: 'anywhere',
  },
  numeric: { fontVariantNumeric: 'tabular-nums' },
  // the two halves, as the entries of the column they stand in
  halves: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  half: {
    display: 'flex',
    height: 36,
    alignItems: 'center',
    gap: 8,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    fontFamily: 'inherit',
    fontSize: 14,
    textAlign: 'start',
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
    outline: 'none',
    boxShadow: { default: 'none', ':focus-visible': `0 0 0 2px ${tokens.focusRing}` },
  },
  halfOn: {
    fontWeight: 600,
    color: tokens.foreground,
    backgroundColor: { default: tokens.surfaceMuted, ':hover': tokens.surfaceMuted },
  },
  halfWord: { flexGrow: 1 },
  halfFigure: {
    fontSize: 13,
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.surfaceMutedForeground,
  },
  // ---- over the work, where there is no column to lend ----
  head: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 10,
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingTop: { default: 12, [breakpoints.phone]: 8 },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: tokens.background,
  },
  headTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginInline: -6,
  },
  headWho: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 6,
  },
  headName: { minWidth: 0 },
  headEnd: { display: 'flex', marginInlineStart: 'auto', alignItems: 'center', gap: 4 },
  // Across, the facts share a line and a rule stands between them; on a
  // phone each takes a line of its own. Every fact carries its rule in
  // front of it, and the line starts one rule and gap to the left of where
  // it is seen, so the rule in front of whichever fact starts a line - the
  // first, or one that wrapped - is cut away rather than standing alone.
  lineClip: {
    minWidth: 0,
    overflow: 'hidden',
    // room for a fact's focus ring inside the cut
    padding: 2,
    margin: -2,
  },
  line: {
    display: 'flex',
    minWidth: 0,
    flexDirection: { default: 'row', [breakpoints.phone]: 'column' },
    flexWrap: 'wrap',
    alignItems: { default: 'center', [breakpoints.phone]: 'flex-start' },
    columnGap: 10,
    rowGap: 4,
    marginInlineStart: { default: -11, [breakpoints.phone]: 0 },
    fontSize: 13,
    color: tokens.surfaceMutedForeground,
  },
  lineFact: {
    display: 'inline-flex',
    minWidth: 0,
    maxWidth: '100%',
    alignItems: 'center',
    gap: 10,
  },
  lineRule: {
    display: { default: 'block', [breakpoints.phone]: 'none' },
    width: 1,
    height: 11,
    flexShrink: 0,
    backgroundColor: tokens.border,
  },
  // as wide as what it says, up to the whole line; a path cut to fit then
  // starts a line of its own, and whatever it leaves over ends that line
  lineUnit: { minWidth: 0, maxWidth: '100%' },
  fold: { width: 16, height: 16, transitionProperty: 'transform', transitionDuration: '150ms' },
  foldOpen: { transform: 'rotate(180deg)' },
  tabs: { display: 'flex', alignItems: 'center', gap: 4, marginBottom: -1 },
  tab: {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    borderWidth: 0,
    backgroundColor: 'transparent',
    paddingInline: 12,
    paddingBlock: 10,
    fontFamily: 'inherit',
    fontSize: 14,
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    cursor: 'pointer',
  },
  tabOn: { color: tokens.foreground, fontWeight: 600 },
  tabInk: {
    position: 'absolute',
    insetInline: 8,
    bottom: 0,
    height: 2,
    borderRadius: 999,
    backgroundColor: tokens.foreground,
  },
  // ---- the work ----
  // The claims fill whatever the window leaves them and scroll inside;
  // the account is read down the page, and grows as long as it is.
  body: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  bodyFilled: { minHeight: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%' },
  bodyGrown: { flexGrow: 1, flexShrink: 0, flexBasis: 'auto' },
  swapFilled: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  // The account keeps its own reading measure - its outline, the gap and
  // the ledger at their widest, 1076, inside this padding - and a window
  // wider than that stands it in the middle of the room beside the column,
  // rather than against the column with all that is left over on the far
  // side. Whatever stands in for it while it loads keeps the same measure.
  ledger: {
    display: 'flex',
    width: '100%',
    maxWidth: 1132,
    marginInline: 'auto',
    flexDirection: 'column',
    gap: 12,
    paddingInline: { default: 28, [breakpoints.phone]: 16 },
    paddingTop: { default: 24, [breakpoints.phone]: 16 },
    paddingBottom: 32,
  },
  zone: { margin: 0 },
  unreadable: { margin: 0, fontSize: 14, color: tokens.danger },
  // the same shape the name and the number take, so nothing moves when the
  // words arrive
  nameBone: { height: 22, width: 128 },
  numberBone: { height: 14, width: 168 },
  // the account's own shape: the total band with its bar, then a line per
  // score group - which is what lands a moment later
  skBand: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 18,
  },
  skTotal: { display: 'flex', flexShrink: 0, flexDirection: 'column', gap: 8 },
  skBars: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 10 },
  skGroups: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 16 },
  skGroupRow: {
    display: 'grid',
    alignItems: 'center',
    gap: 12,
    gridTemplateColumns: 'minmax(0, 1fr) 4rem',
  },
  skBone: { height: 13, borderRadius: 4 },
})

type ParticipantDto = ApiResult<typeof assessmentApi, 'assessment', 'getParticipant'>['participant']

/** how long the list beside the account waits for a burst of wake-ups to end before reading again */
const ROSTER_SETTLE = 1_000

/** how long after a burst began it reads again, whether or not the burst has ended */
const ROSTER_MAX_WAIT = 5_000

/** a read this recent is not read again when a line opens */
const SYNC_FRESH = 2_000

export function ParticipantResultDetail({
  batchId,
  participantId,
  manageable,
  writable,
  mayRecord,
  view,
  step,
  entryId,
  neighbors,
  roster,
  listed,
  onView,
  onEntry,
  onFollow,
  onItem,
  onBack,
}: {
  batchId: string
  participantId: string
  /** whether this reader may take somebody off the round or put them back */
  manageable: boolean
  /** false once the round is archived: it is kept as it closed */
  writable: boolean
  /** whether this reader holds the power that records, and so withdraws, a determination */
  mayRecord: boolean
  view: 'score' | 'entries'
  /** which way the list went to reach this person; the work steps the same way */
  step: DrillMove
  /** which claim is open, if any; the drawer over either half */
  entryId: string
  /** the way to the people either side, in the list this page was opened from */
  neighbors?: ReactNode
  /** that list itself, under the facts in the column beside the work */
  roster?: ReactNode
  /** who this is as that list read them, said until they are read themselves */
  listed?: ParticipantDto | null
  onView: (next: 'score' | 'entries') => void
  onEntry: (entryId: string) => void
  /** open a claim, its question AND the half it lives on, in one move */
  onFollow: (entryId: string, itemId: string | null) => void
  /** every claim under one question, on the claims half */
  onItem: (itemId: string) => void
  onBack: () => void
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const [excluding, setExcluding] = useState(false)
  const [unfolded, setUnfolded] = useState(false)
  const { format, formatError, locale } = useI18n()
  const zone = useBatchZone()
  const phone = useIsMobile()
  // beside the work, where the shell lends its column; over it otherwise
  const beside = useScreenAsideOffered()
  const businessNo = useTerm(authTerms.businessNumber)
  // what waits on this reader's own review is marked in the claims half; the
  // queue behind it moves with the same wake-ups the review pages hear
  const refreshQueue = useQueueRefresh(batchId)

  // What somebody's claims wait on moves with every claim and round in the
  // round, and the list beside the account says it on each row: its pages
  // are read again once a burst of wake-ups has gone quiet, and at the
  // latest a few seconds after it began, never once per wake-up.
  const rosterStirred = useMemo(
    () =>
      settler<null>({
        settle: ROSTER_SETTLE,
        maxWait: ROSTER_MAX_WAIT,
        fire: () =>
          void queryClient.invalidateQueries({
            queryKey: query.assessment.listParticipantAccounts.key(),
          }),
      }),
    [queryClient, query],
  )
  useEffect(() => () => rosterStirred.cancel(), [rosterStirred])

  // Wake-ups carry no facts - they say "read again" - so each kind names
  // exactly what it could have changed. Invalidating everything on every
  // event would throw away the roster, the paper and the batch on a wake-up
  // about one claim, which is a page that flickers for no reason.
  const line = useBatchLive(batchId, (kind) => {
    const stale = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key })
    const account = () => {
      stale(
        query.assessment.listParticipantEntries.key({
          params: { batchId, participantId },
          query: {},
        }),
      )
      stale(query.assessment.getParticipantResult.key({ params: { batchId, participantId } }))
    }
    switch (kind) {
      // A line just opened: whatever was read before it may have moved
      // while nobody was listening. What is being read right now, or was
      // read a moment ago - the page opening, the next person stepped to -
      // has not, and reading it again would only read the page twice.
      case 'sync': {
        const lately = Date.now() - SYNC_FRESH
        void queryClient.invalidateQueries({
          queryKey: query.assessment.key(),
          predicate: (read) =>
            read.state.fetchStatus !== 'fetching' && read.state.dataUpdatedAt < lately,
        })
        return
      }
      // a phase that may have moved what staff may do
      case 'phase-changed':
        stale(query.assessment.key())
        return
      // A decision changes both what the claim says and what it counts for,
      // and takes the round it closed out of whoever's queue it was in.
      case 'review-instance-changed':
        account()
        refreshQueue()
        rosterStirred.wake(null)
        return
      // Anybody's claim in the round, a saved draft as often as not: the
      // account may have moved, but a queue only moves on a round, and
      // every write that moves one says so in its own wake-up. Reading the
      // whole queue again on each of these would read it on every save.
      case 'entries-changed':
        account()
        rosterStirred.wake(null)
        return
      case 'result-changed':
        account()
        return
      // somebody else took a round off a queue this reader shares
      case 'review-inbox-changed':
        refreshQueue()
        return
      // the paper itself moved: the ledger is grouped by it, and every
      // amount is computed from the arithmetic it carries
      case 'item-changed':
        stale(query.assessment.listItems.key({ params: { batchId } }))
        stale(query.assessment.listScoreGroups.key({ params: { batchId } }))
        stale(query.assessment.getParticipantResult.key({ params: { batchId, participantId } }))
        return
      default:
        return
    }
  })

  // Stepping to the next person, the list beside the account has already
  // read who they are: said at once, the facts do not blank and come back
  // under the reader's eyes, and the list under them does not jump with them.
  const who = useQuery({
    ...query.assessment.getParticipant.queryOptions({ params: { batchId, participantId } }),
    placeholderData:
      listed !== undefined && listed !== null && listed.id === participantId
        ? { participant: listed }
        : undefined,
  })
  const result = useQuery(
    query.assessment.getParticipantResult.queryOptions({ params: { batchId, participantId } }),
  )
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const entries = useQuery(useParticipantEntries(batchId, participantId))
  // Where they stand, in names: the round's units as this reader may see
  // them, and the kinds of person. Both are optional reading - a unit whose
  // name is not given keeps its place on the path, and a reader who reads
  // neither sees the person without them. The units are the ones the list
  // this page was opened from reads, through the same door, and over
  // everybody the round admitted: somebody taken off it is still somewhere,
  // even where nobody left on the round stands beside them.
  const units = useQuery({
    ...query.assessment.listRosterUnits.queryOptions({
      params: { batchId },
      query: { reading: 'accounts', status: 'all' },
    }),
    staleTime: 60_000,
    retry: false,
  })
  const kinds = useQuery({
    ...query.assessment.listUserTypeOptions.queryOptions({}),
    staleTime: 300_000,
    retry: false,
  })

  const participant = who.data?.participant
  const claims = entries.data?.entries ?? []
  // The arithmetic behind the account is out of reach, and nothing was read
  // before it went: no figure on this half would be true, so the ledger is
  // not drawn at all - only why, and asking again where asking can help.
  const unreadable =
    result.data === undefined &&
    result.error !== null &&
    (isApiErrorCode(result.error, 'ASSESSMENT_SCORING_UNAVAILABLE') ||
      isApiErrorCode(result.error, 'ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE'))

  // Where they stand, from the top down: the same path their row on the list
  // shows, by the same rule, and the whole chain a press away
  const unitNames = new Map((units.data?.units ?? []).map((unit) => [unit.id, unit.name] as const))
  const nameOf = (nodeId: string) => unitNames.get(nodeId)
  const where =
    participant === undefined || units.data === undefined
      ? { steps: [], path: '', unknown: 0 }
      : unitPathOf(participant.anchorLineage, nameOf)
  const chain =
    participant === undefined || units.data === undefined
      ? []
      : unitChainOf(participant.anchorLineage, nameOf)
  const kind = (kinds.data?.userTypes ?? []).find((one) => one.id === participant?.userTypeId)
  const dayOf = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...inZone(zone),
    }).format(new Date(iso))

  // Taking somebody off the round, or putting them back. It belongs to the
  // person rather than to the list: the list is how somebody is found, and
  // this is the page that says what taking them off would leave behind.
  // The page stays as the reader steps from one person to the next, so a
  // change still on its way belongs to whoever it was asked for.
  const setStatus = useMutation({
    mutationFn: ({
      status,
      participantId: who,
    }: {
      status: 'active' | 'excluded'
      participantId: string
    }) =>
      run(
        api.assessment.setParticipantStatus({
          params: { batchId, participantId: who },
          payload: { status },
        }),
      ).then((answer) => ({ ...answer, status })),
    onSuccess: (answer: { status: 'active' | 'excluded' }) => {
      setExcluding(false)
      toast.success(format(answer.status === 'excluded' ? m.toastExcluded : m.toastRestored))
      void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const excluded = participant?.status === 'excluded'
  const changing = setStatus.isPending && setStatus.variables.participantId === participantId
  const standingKey =
    manageable && writable && participant !== undefined ? (
      <Button
        size="sm"
        variant="outline"
        data-testid="participant-standing"
        disabled={changing}
        onClick={() =>
          excluded
            ? setStatus.mutate({ status: 'active', participantId })
            : // taking somebody off is worth a question, because what it
              // keeps is not obvious
              setExcluding(true)
        }
      >
        {format(excluded ? m.restore : m.exclude)}
      </Button>
    ) : null

  const back = (
    <button
      type="button"
      // the words on it are the list's name; what it is called says where it goes
      aria-label={format(m.participantResultsBack)}
      {...stylex.props(styles.back)}
      onClick={onBack}
    >
      <ArrowLeftIcon aria-hidden {...stylex.props(styles.backIcon)} />
      {/* the list's own name: where pressing it lands, in the fewest words */}
      <span {...stylex.props(styles.backWords)}>{format(m.participantResultsTab)}</span>
    </button>
  )

  const chips =
    participant === undefined ? null : (
      <span {...stylex.props(styles.chips)}>
        <span
          data-testid="participant-roster"
          data-status={participant.status}
          {...stylex.props(styles.chip, excluded ? styles.chipExcluded : styles.chipActive)}
        >
          {format(excluded ? m.excludedBadge : m.participantActive)}
        </span>
        {participant.placement !== 'current' && (
          <span
            data-testid="participant-placement"
            data-placement={participant.placement}
            {...stylex.props(styles.chip, styles.chipMoved)}
          >
            {format(
              participant.placement === 'changed'
                ? m.participantPlacementChanged
                : m.participantPlacementGone,
            )}
          </span>
        )}
      </span>
    )

  // who this is could not be read, and nothing was read before: said where
  // the name would be, rather than an outline that never fills
  const unreadablePerson = participant === undefined && who.error !== null
  const name =
    participant === undefined ? (
      unreadablePerson ? (
        <p role="alert" data-testid="participant-unreadable" {...stylex.props(styles.unreadable)}>
          {formatError(who.error)}
        </p>
      ) : (
        <Skeleton className={stylex.props(styles.nameBone).className} />
      )
    ) : (
      <h1 {...stylex.props(styles.name, !beside && styles.headName)}>{participant.displayName}</h1>
    )

  /** where they stand, said from its own end, the whole chain a press away */
  const unit =
    where.steps.length === 0 ? null : (
      <UnitPath
        steps={where.steps}
        chain={{
          label: format(m.rosterUnits),
          closeLabel: format(commonMessages.close),
          levels: chain,
        }}
      />
    )
  const number = participant?.businessNo ?? format(m.noBusinessNoShort, { businessNo })
  const included =
    participant === undefined
      ? ''
      : dayOf(
          excluded && participant.excludedAt !== null
            ? participant.excludedAt
            : participant.includedAt,
        )

  // the two halves: what was filed and decided first, since that is what
  // somebody checking an account opens it for, and the total follows from it
  // How many claims there are is said once they are read: counted from
  // nothing while they are on their way, the half said nobody had filed.
  const counted = entries.data === undefined ? null : claims.length
  const halves = [
    { key: 'entries', label: m.participantResultsEntriesTab, count: counted, total: false },
    { key: 'score', label: m.participantResultsScoreTab, count: null, total: true },
  ] as const

  const panel = (
    <div data-testid="participant-panel" {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.panelTop)}>
        {back}
        {neighbors}
      </div>
      <div {...stylex.props(styles.identity)}>
        {name}
        {chips !== null && (
          <div {...stylex.props(styles.standingLine)}>
            {chips}
            {standingKey}
          </div>
        )}
      </div>
      {participant === undefined ? (
        !unreadablePerson && <Skeleton className={stylex.props(styles.numberBone).className} />
      ) : (
        <dl {...stylex.props(styles.facts)}>
          <div {...stylex.props(styles.fact)}>
            <dt {...stylex.props(styles.factName)}>{businessNo}</dt>
            <dd data-fact="number" {...stylex.props(styles.factValue, styles.numeric)}>
              {number}
            </dd>
          </div>
          {unit !== null && (
            <div {...stylex.props(styles.fact, styles.factWide)}>
              <dt {...stylex.props(styles.factName)}>{format(m.rosterUnits)}</dt>
              <dd
                data-fact="unit"
                data-path={where.path}
                data-unknown={where.unknown}
                {...stylex.props(styles.factValue)}
              >
                {unit}
              </dd>
            </div>
          )}
          {kind !== undefined && (
            <div {...stylex.props(styles.fact)}>
              <dt {...stylex.props(styles.factName)}>{format(m.participantFactKind)}</dt>
              <dd data-fact="kind" {...stylex.props(styles.factValue)}>
                {kind.name}
              </dd>
            </div>
          )}
          <div {...stylex.props(styles.fact)}>
            <dt {...stylex.props(styles.factName)}>
              {format(excluded ? m.participantFactExcluded : m.participantFactIncluded)}
            </dt>
            <dd data-fact="roster" {...stylex.props(styles.factValue)}>
              {included}
            </dd>
          </div>
        </dl>
      )}
      <ZoneAwayNotice xstyle={styles.zone} />
      <nav aria-label={format(m.participantResultsViews)} {...stylex.props(styles.halves)}>
        {halves.map(({ key, label, count, total }) => (
          <button
            key={key}
            type="button"
            data-testid={`participant-tab-${key}`}
            data-count={count ?? ''}
            aria-current={view === key}
            onClick={() => onView(key)}
            {...stylex.props(styles.half, view === key && styles.halfOn)}
          >
            <span {...stylex.props(styles.halfWord)}>{format(label)}</span>
            {count !== null && <Count>{String(count)}</Count>}
            {total && result.data !== undefined && (
              <span data-testid="participant-total" {...stylex.props(styles.halfFigure)}>
                {result.data.total}
              </span>
            )}
          </button>
        ))}
      </nav>
      {roster}
    </div>
  )

  // Over the work: the same things in a head. On a phone the facts and the
  // way to take somebody off fold behind the name, so the work starts high
  // on a short screen; a press on the fold brings them out.
  const folded = phone && !unfolded
  const head = (
    <header data-testid="participant-head" {...stylex.props(styles.head)}>
      <div {...stylex.props(styles.headTop)}>
        {back}
        {neighbors}
      </div>
      <div {...stylex.props(styles.headWho)}>
        {name}
        {chips}
        <span {...stylex.props(styles.headEnd)}>
          {!folded && standingKey}
          {phone && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={format(m.participantDetails)}
              aria-expanded={unfolded}
              data-testid="participant-fold"
              onClick={() => setUnfolded((open) => !open)}
            >
              <ChevronDownIcon
                aria-hidden
                {...stylex.props(styles.fold, unfolded && styles.foldOpen)}
              />
            </Button>
          )}
        </span>
      </div>
      {participant === undefined ? (
        !unreadablePerson && <Skeleton className={stylex.props(styles.numberBone).className} />
      ) : (
        <div {...stylex.props(styles.lineClip)}>
          <div {...stylex.props(styles.line)}>
            <span data-fact="number" {...stylex.props(styles.lineFact, styles.numeric)}>
              <span aria-hidden {...stylex.props(styles.lineRule)} />
              {number}
            </span>
            {unit !== null && (
              <span
                data-fact="unit"
                data-path={where.path}
                data-unknown={where.unknown}
                {...stylex.props(styles.lineFact)}
              >
                <span aria-hidden {...stylex.props(styles.lineRule)} />
                <span {...stylex.props(styles.lineUnit)}>{unit}</span>
              </span>
            )}
            {!folded && kind !== undefined && (
              <span data-fact="kind" {...stylex.props(styles.lineFact)}>
                <span aria-hidden {...stylex.props(styles.lineRule)} />
                {kind.name}
              </span>
            )}
            {!folded && (
              <span data-fact="roster" {...stylex.props(styles.lineFact)}>
                <span aria-hidden {...stylex.props(styles.lineRule)} />
                {format(excluded ? m.participantExcludedOn : m.participantIncludedOn, {
                  date: included,
                })}
              </span>
            )}
          </div>
        </div>
      )}
      <ZoneAwayNotice xstyle={styles.zone} />
      <nav aria-label={format(m.participantResultsViews)} {...stylex.props(styles.tabs)}>
        {halves.map(({ key, label, count }) => (
          <button
            key={key}
            type="button"
            data-testid={`participant-tab-${key}`}
            data-count={count ?? ''}
            aria-current={view === key}
            onClick={() => onView(key)}
            {...stylex.props(styles.tab, view === key && styles.tabOn)}
          >
            {format(label)}
            {count !== null && <Count>{String(count)}</Count>}
            {view === key && <span aria-hidden {...stylex.props(styles.tabInk)} />}
          </button>
        ))}
      </nav>
    </header>
  )

  // on a phone the claims are part of the page, as long as they are
  const filled = view === 'entries' && !phone
  return (
    <div data-testid="participant-account" data-beside={beside} {...stylex.props(styles.root)}>
      <ScreenAside label={participant?.displayName}>{panel}</ScreenAside>
      {!beside && head}
      {/* Beside the column the name stands in the column, which is a
          landmark of its own; the work still says whose it is, for a reader
          moving by headings through the main part of the page. */}
      {beside && participant !== undefined && (
        <h2 {...stylex.props(a11yStyles.visuallyHidden)}>
          {format(m.participantAccountHeading, {
            name: participant.displayName,
            half: format(
              view === 'score' ? m.participantResultsScoreTab : m.participantResultsEntriesTab,
            ),
          })}
        </h2>
      )}
      {/* another person's work arrives from the way the list went; the
          two halves of one person's replace each other in place */}
      <Drill
        move={step}
        drillKey={participantId}
        className={
          stylex.props(styles.body, filled ? styles.bodyFilled : styles.bodyGrown).className
        }
      >
        <Swap swapKey={view} className={stylex.props(filled && styles.swapFilled).className}>
          {view === 'entries' ? (
            <ParticipantEntries
              batchId={batchId}
              participantId={participantId}
              entryId={entryId}
              may={{
                returnForRevision: writable && manageable,
                withdraw: writable && mayRecord,
                record: writable && mayRecord,
              }}
              line={line}
              closed={!writable || participant?.status === 'excluded'}
              onEntry={onEntry}
            />
          ) : (
            <div {...stylex.props(styles.ledger)}>
              {unreadable ? (
                <ResultUnavailable
                  error={result.error}
                  retrying={result.isFetching}
                  onRetry={() => void result.refetch()}
                />
              ) : (
                <AsyncSection
                  pending={
                    result.isPending || items.isPending || entries.isPending || who.isPending
                  }
                  // a read that failed with nothing to show; one that failed
                  // later keeps what it showed, and the account says it may
                  // be behind
                  error={
                    [result, items, entries]
                      .map((read) =>
                        read.data === undefined && read.error !== null
                          ? formatError(read.error)
                          : null,
                      )
                      .find((said) => said !== null) ?? null
                  }
                  loadingLabel={format(commonMessages.loading)}
                  retryLabel={format(commonMessages.retry)}
                  onRetry={() => {
                    void result.refetch()
                    void items.refetch()
                    void entries.refetch()
                  }}
                  skeleton={
                    <div>
                      <div {...stylex.props(styles.skBand)}>
                        <span {...stylex.props(styles.skTotal)}>
                          <Skeleton className={stylex.props(styles.skBone).className} width={64} />
                          <Skeleton height={34} width={96} radius={6} />
                        </span>
                        <span {...stylex.props(styles.skBars)}>
                          <Skeleton height={12} radius={9999} />
                          <Skeleton className={stylex.props(styles.skBone).className} width="60%" />
                        </span>
                      </div>
                      <div {...stylex.props(styles.skGroups)}>
                        {['52%', '38%', '61%', '44%'].map((width, index) => (
                          <div key={index} {...stylex.props(styles.skGroupRow)}>
                            <Skeleton
                              className={stylex.props(styles.skBone).className}
                              width={width}
                            />
                            <Skeleton className={stylex.props(styles.skBone).className} />
                          </div>
                        ))}
                      </div>
                    </div>
                  }
                >
                  {result.data !== undefined && (
                    <>
                      {result.error !== null && (
                        <StandingNotice
                          error={result.error}
                          stale
                          retrying={result.isFetching}
                          onRetry={() => void result.refetch()}
                        />
                      )}
                      <ResultLedger
                        result={result.data}
                        items={items.data?.items ?? []}
                        entries={claims.map((one) => one.entry)}
                        // somebody else's account, read by whoever runs the round
                        reader="staff"
                        // an archived round, or somebody taken off it, no longer moves
                        closed={!writable ? 'archived' : excluded ? 'excluded' : null}
                        // kept current while the line is open, by the rule the
                        // claims half and the owner's own pages keep; a total
                        // already said to be behind is not also live
                        stream={result.error === null ? liveStateOf(line) : null}
                        align="start"
                        // a number leads back to the filing it came from, on
                        // the question it was filed under; this is the reason
                        // the two halves are one page
                        onEntryOpen={(id) =>
                          onFollow(
                            id,
                            claims.find((one) => one.entry.id === id)?.entry.itemId ?? null,
                          )
                        }
                        onItemOpen={onItem}
                      />
                    </>
                  )}
                </AsyncSection>
              )}
            </div>
          )}
        </Swap>
      </Drill>
      <ConfirmDialog
        open={excluding}
        title={format(m.excludeTitle, { name: participant?.displayName ?? '' })}
        description={format(m.excludeBody)}
        confirmLabel={format(m.exclude)}
        cancelLabel={format(commonMessages.cancel)}
        pending={changing}
        tone="destructive"
        onConfirm={() => setStatus.mutate({ status: 'excluded', participantId })}
        onCancel={() => setExcluding(false)}
      />
    </div>
  )
}
