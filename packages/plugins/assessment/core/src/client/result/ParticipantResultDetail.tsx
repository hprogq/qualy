import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ArrowLeftIcon, ChevronDownIcon } from 'lucide-react'
import {
  isRecordId,
  LoadFailure,
  ScreenAside,
  useApi,
  useApiQuery,
  useLoadFailure,
  useRunApi,
  useScreenAsideOffered,
} from '@qualy/web-runtime'
import type { ApiResult } from '@qualy/web-runtime/api'
import { isApiErrorCode, useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'

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

import { ZoneAwayNotice } from '../batch/BatchZone.tsx'
import { inZone, useBatchZone } from '../batch/zone.ts'
import { useBatchLive } from '../live.ts'
import { useQueueRefresh } from '../review/queue.ts'
import { StandingNotice } from '../entry/workspace/StandingNotice.tsx'
import { ResultLedger, ResultUnavailable } from './ResultLedger.tsx'
import { ParticipantEntries } from './ParticipantEntries.tsx'
import { WorkspaceSkeleton } from '../entry/workspace/WorkspaceSkeleton.tsx'
import { useParticipantEntries } from './participant-entries.ts'
import { unitChainOf, unitPathOf } from '../roster/unit-path.ts'
import { ROSTER_MAX_WAIT, ROSTER_SETTLE, settler, SYNC_FRESH } from '../roster/live-settle.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

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
  // with nobody to name, the head keeps only its ways out
  headAbsent: { paddingBottom: 8 },
  // the state stands where the work would, a little in from the column
  absent: {
    display: 'flex',
    flexGrow: 1,
    flexDirection: 'column',
    paddingInline: { default: 28, [breakpoints.phone]: 16 },
    paddingTop: { default: 24, [breakpoints.phone]: 16 },
    paddingBottom: 32,
  },
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

/** the code that says the person this page is about is not there */
const PARTICIPANT_MISSING = 'ASSESSMENT_PARTICIPANT_NOT_FOUND'

export function ParticipantResultDetail({
  batchId,
  participantId,
  manageable,
  writable,
  mayRecord,
  view: addressed,
  step,
  entryId,
  neighbors,
  roster,
  listed,
  onListMoved,
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
  /** somebody's claims moved under the live round: the list may say something else now */
  onListMoved?: () => void
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
  // Both belong to one person. The page stays as the reader steps from one
  // person to the next - back and forward included, which a modal question
  // does not stop - so each remembers whom it was opened for: a question
  // asked about one person is never answered about the next, and the facts
  // unfolded for one are folded again for whoever comes after.
  const [excluding, setExcluding] = useState<string | null>(null)
  const [unfoldedFor, setUnfoldedFor] = useState<string | null>(null)
  if (excluding !== null && excluding !== participantId) setExcluding(null)
  if (unfoldedFor !== null && unfoldedFor !== participantId) setUnfoldedFor(null)
  const unfolded = unfoldedFor === participantId
  const { formatError, locale } = useI18n()
  const zone = useBatchZone()
  const phone = useIsMobile()
  // beside the work, where the shell lends its column; over it otherwise
  const beside = useScreenAsideOffered()
  const businessNo = useTerm(authTerms.businessNumber)
  // what waits on this reader's own review is marked in the claims half; the
  // queue behind it moves with the same wake-ups the review pages hear
  const refreshQueue = useQueueRefresh(batchId)

  // What somebody's claims wait on moves with every claim and round in the
  // round, and the list beside the account says it on each row: it is read
  // again once a burst of wake-ups has gone quiet, and at the latest a few
  // seconds after it began, never once per wake-up. The list itself says
  // which of its pages are worth reading now.
  const listMoved = useRef(onListMoved)
  listMoved.current = onListMoved
  const rosterStirred = useMemo(
    () =>
      settler<null>({
        settle: ROSTER_SETTLE,
        maxWait: ROSTER_MAX_WAIT,
        fire: () => listMoved.current?.(),
      }),
    [],
  )
  useEffect(() => () => rosterStirred.cancel(), [rosterStirred])

  // Wake-ups carry no facts - they say "read again" - so each kind names
  // exactly what it could have changed. Invalidating everything on every
  // event would throw away the roster, the paper and the batch on a wake-up
  // about one claim, which is a page that flickers for no reason.
  const line = useBatchLive(batchId, ({ kinds, stale }) => {
    const account = () => {
      stale(
        query.assessment.listParticipantEntries.key({
          params: { batchId, participantId },
          query: {},
        }),
      )
      stale(query.assessment.getParticipantResult.key({ params: { batchId, participantId } }))
    }
    // A line just opened: whatever was read before it may have moved while
    // nobody was listening. What is being read right now, or was read a
    // moment ago - the page opening, the next person stepped to - has not,
    // and reading it again would only read the page twice.
    if (kinds.has('sync')) {
      const lately = Date.now() - SYNC_FRESH
      void queryClient.invalidateQueries({
        queryKey: query.assessment.key(),
        predicate: (read) =>
          read.state.fetchStatus !== 'fetching' && read.state.dataUpdatedAt < lately,
      })
    }
    // a phase that may have moved what staff may do
    if (kinds.has('phase-changed')) stale(query.assessment.key())
    // A decision changes both what the claim says and what it counts for,
    // and takes the round it closed out of whoever's queue it was in.
    // Anybody's claim in the round - a saved draft as often as not - may
    // move the account, but a queue only moves on a round, and every write
    // that moves one says so in its own wake-up.
    const decided = kinds.has('review-instance-changed')
    if (decided || kinds.has('entries-changed') || kinds.has('result-changed')) account()
    // somebody else took a round off a queue this reader shares
    if (decided || kinds.has('review-inbox-changed')) refreshQueue(stale)
    if (decided || kinds.has('entries-changed')) rosterStirred.wake(null)
    // the paper itself moved: the ledger is grouped by it, and every amount
    // is computed from the arithmetic it carries
    if (kinds.has('item-changed')) {
      stale(query.assessment.listItems.key({ params: { batchId } }))
      stale(query.assessment.listScoreGroups.key({ params: { batchId } }))
      stale(query.assessment.getParticipantResult.key({ params: { batchId, participantId } }))
    }
  })

  // Stepping to the next person, the list beside the account has already
  // read who they are: said at once, the facts do not blank and come back
  // under the reader's eyes, and the list under them does not jump with them.
  // An address that cannot name anybody names nobody, and is not asked about.
  const shaped = isRecordId(participantId)
  const who = useQuery({
    ...query.assessment.getParticipant.queryOptions({ params: { batchId, participantId } }),
    enabled: shaped,
    // whether the claims open is the reader's standing over the person
    // before, which on one list is nearly always the same answer
    placeholderData: (before) =>
      listed !== undefined && listed !== null && listed.id === participantId
        ? { participant: listed, claims: before?.claims ?? true }
        : undefined,
  })
  // Whether this reader opens the person's claims, or reads their account
  // alone (ruling of 2026-09-29): the claims half is offered only where they
  // open, and an address naming it lands on the account otherwise. Unknown
  // while the person is on their way.
  const claimsOpen = who.data?.claims
  const view = claimsOpen === false ? 'score' : addressed
  const result = useQuery({
    ...query.assessment.getParticipantResult.queryOptions({ params: { batchId, participantId } }),
    enabled: shaped,
  })
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  const entries = useQuery({
    ...useParticipantEntries(batchId, participantId),
    enabled: shaped && claimsOpen === true,
  })
  // a reader who opens no claims is not waiting for any
  const claimsPending = claimsOpen !== false && entries.isPending
  // The person this page is about is not there, or not this reader's to see,
  // or could not be read at all: said once, in the room their work would
  // have had, with the way back to the list. The column keeps the list
  // itself, so the next person is still a press away.
  const failures = useLoadFailure()
  const absentWords = {
    missing: {
      title: m.participantResults_missingTitle(),
      description: m.participantResults_missingHint(),
    },
    denied: {
      title: m.participantResults_deniedTitle(),
      description: m.participantResults_deniedHint(),
    },
  }
  const absent = shaped
    ? failures.subject(who, { missing: [PARTICIPANT_MISSING], copy: absentWords })
    : failures.missing({ copy: absentWords })
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
      setExcluding(null)
      toast.success((answer.status === 'excluded' ? m.toast_excluded : m.toast_restored)())
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
              setExcluding(participantId)
        }
      >
        {(excluded ? m.roster_restore : m.roster_exclude)()}
      </Button>
    ) : null

  const back = (
    <button
      type="button"
      // the words on it are the list's name; what it is called says where it goes
      aria-label={m.participantResults_back()}
      {...stylex.props(styles.back)}
      onClick={onBack}
    >
      <ArrowLeftIcon aria-hidden {...stylex.props(styles.backIcon)} />
      {/* the list's own name: where pressing it lands, in the fewest words */}
      <span {...stylex.props(styles.backWords)}>{m.participantResults_tab()}</span>
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
          {(excluded ? m.roster_excluded : m.roster_active)()}
        </span>
        {participant.placement !== 'current' && (
          <span
            data-testid="participant-placement"
            data-placement={participant.placement}
            {...stylex.props(styles.chip, styles.chipMoved)}
          >
            {(participant.placement === 'changed'
              ? m.participant_placementChanged
              : m.participant_placementGone)()}
          </span>
        )}
      </span>
    )

  // Nobody to name: the name, the facts and the two halves stand down, and
  // the state in the work says why once; only the ways out stay.
  const name =
    absent !== null ? null : participant === undefined ? (
      <Skeleton className={stylex.props(styles.nameBone).className} />
    ) : (
      <h1 {...stylex.props(styles.name, !beside && styles.headName)}>{participant.displayName}</h1>
    )

  /** where they stand, said from its own end, the whole chain a press away */
  const unit =
    where.steps.length === 0 ? null : (
      <UnitPath
        steps={where.steps}
        chain={{
          label: m.roster_units(),
          closeLabel: commonMessages.action_close(),
          levels: chain,
        }}
      />
    )
  const number = participant?.businessNo ?? m.roster_noBusinessNo({ businessNo })
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
    ...(claimsOpen === false
      ? []
      : [
          {
            key: 'entries',
            label: m.participantResults_entriesTab,
            count: counted,
            total: false,
          } as const,
        ]),
    { key: 'score', label: m.participantResults_scoreTab, count: null, total: true } as const,
  ]

  const halvesNav = (
    <nav aria-label={m.participantResults_views()} {...stylex.props(styles.halves)}>
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
          <span {...stylex.props(styles.halfWord)}>{label()}</span>
          {count !== null && <Count>{String(count)}</Count>}
          {total && result.data !== undefined && (
            <span data-testid="participant-total" {...stylex.props(styles.halfFigure)}>
              {result.data.total}
            </span>
          )}
        </button>
      ))}
    </nav>
  )

  const panel = (
    <div data-testid="participant-panel" data-absent={absent?.kind} {...stylex.props(styles.panel)}>
      <div {...stylex.props(styles.panelTop)}>
        {back}
        {neighbors}
      </div>
      {absent === null && (
        <div {...stylex.props(styles.identity)}>
          {name}
          {chips !== null && (
            <div {...stylex.props(styles.standingLine)}>
              {chips}
              {standingKey}
            </div>
          )}
        </div>
      )}
      {absent !== null ? null : participant === undefined ? (
        <Skeleton className={stylex.props(styles.numberBone).className} />
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
              <dt {...stylex.props(styles.factName)}>{m.roster_units()}</dt>
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
              <dt {...stylex.props(styles.factName)}>{m.participant_factKind()}</dt>
              <dd data-fact="kind" {...stylex.props(styles.factValue)}>
                {kind.name}
              </dd>
            </div>
          )}
          <div {...stylex.props(styles.fact)}>
            <dt {...stylex.props(styles.factName)}>
              {(excluded ? m.participant_factExcluded : m.participant_factIncluded)()}
            </dt>
            <dd data-fact="roster" {...stylex.props(styles.factValue)}>
              {included}
            </dd>
          </div>
        </dl>
      )}
      {absent === null && <ZoneAwayNotice xstyle={styles.zone} />}
      {absent === null && halvesNav}
      {roster}
    </div>
  )

  // Over the work: the same things in a head. On a phone the facts and the
  // way to take somebody off fold behind the name, so the work starts high
  // on a short screen; a press on the fold brings them out.
  const folded = phone && !unfolded
  const headWho = (
    <>
      <div {...stylex.props(styles.headWho)}>
        {name}
        {chips}
        <span {...stylex.props(styles.headEnd)}>
          {!folded && standingKey}
          {phone && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={m.participant_details()}
              aria-expanded={unfolded}
              data-testid="participant-fold"
              onClick={() => setUnfoldedFor(unfolded ? null : participantId)}
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
        <Skeleton className={stylex.props(styles.numberBone).className} />
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
                {(excluded ? m.participant_excludedOn : m.participant_includedOn)({
                  date: included,
                })}
              </span>
            )}
          </div>
        </div>
      )}
      <ZoneAwayNotice xstyle={styles.zone} />
      <nav aria-label={m.participantResults_views()} {...stylex.props(styles.tabs)}>
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
            {label()}
            {count !== null && <Count>{String(count)}</Count>}
            {view === key && <span aria-hidden {...stylex.props(styles.tabInk)} />}
          </button>
        ))}
      </nav>
    </>
  )
  const head = (
    <header
      data-testid="participant-head"
      data-absent={absent?.kind}
      {...stylex.props(styles.head, absent !== null && styles.headAbsent)}
    >
      <div {...stylex.props(styles.headTop)}>
        {back}
        {neighbors}
      </div>
      {absent === null && headWho}
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
      {beside && participant !== undefined && absent === null && (
        <h2 {...stylex.props(a11yStyles.visuallyHidden)}>
          {m.participantResults_accountHeading({
            name: participant.displayName,
            half: (view === 'score'
              ? m.participantResults_scoreTab
              : m.participantResults_entriesTab)(),
          })}
        </h2>
      )}
      {/* another person's work arrives from the way the list went; the
          two halves of one person's replace each other in place */}
      <Drill
        move={step}
        drillKey={participantId}
        className={
          stylex.props(
            styles.body,
            filled && absent === null ? styles.bodyFilled : styles.bodyGrown,
          ).className
        }
      >
        {absent !== null ? (
          <div data-testid="participant-absent" {...stylex.props(styles.absent)}>
            <LoadFailure
              failure={absent}
              size="section"
              // the rest of the account failed with the person, and comes back with them
              // the claims come back with the person, where they open
              onRetry={() => {
                void who.refetch()
                void result.refetch()
              }}
              retrying={who.isFetching}
              extra={
                <Button variant={absent.retryable ? 'outline' : 'default'} onClick={onBack}>
                  {m.participantResults_back()}
                </Button>
              }
            />
          </div>
        ) : (
          <Swap swapKey={view} className={stylex.props(filled && styles.swapFilled).className}>
            {view === 'entries' && claimsOpen !== true ? (
              // whether the claims open is said with the person: until then
              // the claims are not asked for, since a reader who reads the
              // account alone would only be refused them
              <WorkspaceSkeleton viewer="staff" open={false} />
            ) : view === 'entries' ? (
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
                    pending={result.isPending || items.isPending || claimsPending || who.isPending}
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
                    loadingLabel={commonMessages.state_loading()}
                    retryLabel={commonMessages.action_retry()}
                    onRetry={() => {
                      void result.refetch()
                      void items.refetch()
                      if (claimsOpen === true) void entries.refetch()
                    }}
                    skeleton={
                      <div>
                        <div {...stylex.props(styles.skBand)}>
                          <span {...stylex.props(styles.skTotal)}>
                            <Skeleton
                              className={stylex.props(styles.skBone).className}
                              width={64}
                            />
                            <Skeleton height={34} width={96} radius={6} />
                          </span>
                          <span {...stylex.props(styles.skBars)}>
                            <Skeleton height={12} radius={9999} />
                            <Skeleton
                              className={stylex.props(styles.skBone).className}
                              width="60%"
                            />
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
                          {...(claimsOpen === true
                            ? {
                                onEntryOpen: (id: string) =>
                                  onFollow(
                                    id,
                                    claims.find((one) => one.entry.id === id)?.entry.itemId ?? null,
                                  ),
                                onItemOpen: onItem,
                              }
                            : {})}
                        />
                      </>
                    )}
                  </AsyncSection>
                )}
              </div>
            )}
          </Swap>
        )}
      </Drill>
      <ConfirmDialog
        open={excluding !== null && excluding === participantId}
        title={m.roster_excludeTitle({ name: participant?.displayName ?? '' })}
        description={m.roster_excludeBody()}
        confirmLabel={m.roster_exclude()}
        cancelLabel={commonMessages.action_cancel()}
        pending={changing}
        tone="destructive"
        onConfirm={() => {
          if (excluding !== null) setStatus.mutate({ status: 'excluded', participantId: excluding })
        }}
        onCancel={() => setExcluding(null)}
      />
    </div>
  )
}
