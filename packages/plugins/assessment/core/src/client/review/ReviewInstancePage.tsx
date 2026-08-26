import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, CornerUpLeftIcon, InfoIcon } from 'lucide-react'
import {
  useApi,
  useApiQuery,
  usePageNavigate,
  useClaimScreenFoot,
  usePageQueryState,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { isApiErrorCode, useI18n } from '@qualy/web-i18n'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection, ConfirmDialog } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Kbd } from '@qualy/ui/kbd'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { Skeleton } from '@qualy/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { entryStatusMessage, type EntryDto } from '../entry/model.ts'
import { reviewOutcomeMessage } from './events.ts'
import { readRunScope, runRows, type InboxItemDto } from './model.ts'
import type { BatchDto } from '../phase/model.ts'
import type { ReviewDto } from './model.ts'
import {
  ApproveDialog,
  EscalateDialog,
  RejectDialog,
  type WordedDecision,
} from './decision-dialogs.tsx'
import { SupplementDialog, type WordedSupplement } from './SupplementDialog.tsx'
import { WORKBENCH_PARTS, type WorkbenchPart } from './Pane.tsx'
import { QueueRail } from './QueueRail.tsx'
import { PartStrip, PersonStrip, RunStrip } from './WorkbenchStrips.tsx'
import { EscalationNotice } from './EscalationNotice.tsx'
import { FlowColumn } from './FlowColumn.tsx'
import { FilingColumn } from './FilingColumn.tsx'
import { ContextRail } from './ContextRail.tsx'
import { useBeside } from './pointer.ts'
import { useDeferredDecision, type StagedDecision } from './useDeferredDecision.ts'
import { VersionPicker } from './history.tsx'
import { EntryHistory } from '../entry/EntryHistory.tsx'
import { attachmentContentUrl } from '../entry/model.ts'
import { useLingering } from '@qualy/ui/use-lingering'
import { Appear, CountdownRing, DoneMark, Drill, GlideAcross, Stagger } from '@qualy/ui/reveal'
import { useFinePointer, useMedia } from './pointer.ts'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

// The workbench: one submission a screen, walked in a run.
//
// Everything said before this round sits on top so it needs no scrolling,
// the filing and its materials follow, and what the question is worth stands
// beside them. Letters choose a decision, ⌘↵ stages it, and for five seconds
// it can be taken back; then it is submitted and the next one is already on
// screen. Sending back and escalating each carry a word, so they open their
// dialog instead of arming silently.

// The decision surface's own styles; the reading workbench around it keeps
// its utility classes until its own migration pass.
const lg = '@media (min-width: 1024px)'
const belowSm = '@media (max-width: 639.98px)'

const styles = stylex.create({
  fill: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  bench: {
    position: 'relative',
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  // Flex, not a two-track grid: with the rail display:none below its width,
  // the content fell into the grid's auto track and the 1fr track sat empty
  // beside it. The rail owns and animates its width as a shrink-0 flex
  // child just as well.
  benchRow: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  benchColumn: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    borderTopWidth: {
      default: 1,
      [lg]: 0,
    },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    borderLeftWidth: {
      default: 0,
      [lg]: 1,
    },
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
  },
  benchSkeletonSeat: {
    padding: 24,
  },
  benchSkeleton: {
    height: 256,
    width: '100%',
  },
  loadSkeleton: {
    height: 384,
    width: '100%',
  },
  readonlyBar: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, transparent)`,
    paddingInline: 20,
    paddingBlock: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  // the turn was lost mid-thought: the standing colour carries the fact,
  // mixed over the scheme's own ground
  goneBanner: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 16,
    rowGap: 8,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: `color-mix(in oklab, ${tokens.warning} 35%, ${tokens.background})`,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 12%, ${tokens.background})`,
    paddingInline: 20,
    paddingBlock: 12,
  },
  goneWords: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 2,
  },
  goneTitle: {
    fontSize: 14,
    fontWeight: 500,
    color: tokens.foreground,
  },
  goneBody: {
    fontSize: 13,
    lineHeight: 1.625,
    color: `color-mix(in oklab, ${tokens.foreground} 75%, transparent)`,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  drillSeat: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  // The same three faces at every width: below lg a snap pager - one whole
  // face per screen - and beside, a three-column grid. Each face keeps its
  // own vertical scroll either way.
  pager: {
    display: {
      default: 'flex',
      [lg]: 'grid',
    },
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    scrollSnapType: {
      default: 'x mandatory',
      [lg]: 'none',
    },
    overflowX: {
      default: 'auto',
      [lg]: 'hidden',
    },
    overflowY: 'hidden',
    overscrollBehaviorX: 'contain',
    scrollbarWidth: 'none',
    gridTemplateColumns: {
      default: null,
      [lg]: 'minmax(0, 0.82fr) minmax(0, 1.18fr) 21rem',
    },
    gridTemplateRows: {
      default: null,
      [lg]: 'minmax(0, 1fr)',
    },
  },
  awaitingFoot: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 12,
  },
  awaitingIcon: {
    width: 16,
    height: 16,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  awaitingWords: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  awaitingTitle: {
    fontSize: 14,
    fontWeight: 500,
  },
  awaitingBody: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  outcomeRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 20,
    paddingBlock: 12,
  },
  // centred across the workbench by a row that spans it; the row ignores
  // the pointer so the filing under it stays readable
  undoRow: {
    pointerEvents: 'none',
    position: 'absolute',
    insetInline: 0,
    bottom: {
      default: 144,
      [lg]: 80,
    },
    zIndex: 10,
    display: 'flex',
    justifyContent: 'center',
  },
  undoSeat: {
    pointerEvents: 'auto',
  },
  // the decision dialogs' last quiet word: faces that matter, still unread
  cautionCard: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.warning} 35%, ${tokens.background})`,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 12%, ${tokens.background})`,
    paddingInline: 12,
    paddingBlock: 10,
  },
  cautionLine: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
  },
  cautionWords: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    fontSize: 13,
    lineHeight: 1.625,
    color: tokens.foreground,
  },
  cautionGo: {
    flexShrink: 0,
    fontSize: 13,
    fontWeight: 500,
    color: tokens.foreground,
    textDecorationLine: 'underline',
    textUnderlineOffset: 2,
  },
  decisionFooter: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: {
      default: 12,
      [lg]: 16,
    },
    paddingTop: {
      default: 10,
      [lg]: 12,
    },
    paddingBottom: {
      default: 'max(0.625rem, env(safe-area-inset-bottom))',
      [lg]: 12,
    },
  },
  decisionRow: {
    display: {
      default: 'flex',
      [belowSm]: 'grid',
    },
    gridTemplateColumns: {
      default: null,
      [belowSm]: 'repeat(2, minmax(0, 1fr))',
    },
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  decisionSpacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    display: {
      default: 'block',
      [belowSm]: 'none',
    },
  },
  phoneRouting: {
    height: {
      default: null,
      [belowSm]: 36,
    },
    width: {
      default: null,
      [belowSm]: '100%',
    },
  },
  phoneVerdict: {
    height: {
      default: null,
      [belowSm]: 44,
    },
    width: {
      default: null,
      [belowSm]: '100%',
    },
    fontSize: {
      default: null,
      [belowSm]: 15,
    },
  },
  // the verdict keys wear their standing colours, mixed over the scheme's
  // own ground so both modes read them
  rejectKey: {
    borderColor: `color-mix(in oklab, ${tokens.danger} 30%, ${tokens.background})`,
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.danger} 10%, ${tokens.background})`,
      ':hover': `color-mix(in oklab, ${tokens.danger} 18%, ${tokens.background})`,
    },
    color: {
      default: tokens.danger,
      ':hover': tokens.danger,
    },
  },
  approveKey: {
    borderColor: `color-mix(in oklab, ${tokens.success} 35%, ${tokens.background})`,
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.success} 12%, ${tokens.background})`,
      ':hover': `color-mix(in oklab, ${tokens.success} 20%, ${tokens.background})`,
    },
    color: {
      default: tokens.successForeground,
      ':hover': tokens.successForeground,
    },
  },
  /**
   * How the decision keys sit under a thumb: taller, sharing the row's full
   * width, and squared off from the buttons' own pill - at 13px in a 44px
   * capsule the words rattled around in the middle of their key. The shape
   * follows the pointer, never the window: a width rule here meant a desktop
   * window dragged narrower watched the keys grow mid-drag.
   */
  touchKey: {
    height: 44,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    paddingInline: 12,
    fontSize: 13,
  },
  blockedKey: {
    pointerEvents: 'auto',
    opacity: 0.45,
    backgroundColor: {
      default: null,
      ':hover': 'transparent',
    },
    transform: {
      default: null,
      ':active': 'translateY(0)',
    },
  },
  // a span, because a key that ignores the pointer cannot answer the hover
  // that asks about it; it inherits the key's growth so wrapping for the
  // tooltip never changes the row
  keySeat: {
    display: 'inline-flex',
  },
  siblingList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  siblingRow: {
    display: 'grid',
    gridTemplateColumns: '7rem minmax(0, 1fr)',
    gap: 12,
  },
  siblingStanding: {
    fontSize: 12,
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
  siblingLabel: {
    fontSize: 14,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  siblingValue: {
    minWidth: 0,
    fontSize: 14,
  },
  undoPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    paddingInline: 14,
    paddingBlock: 10,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  },
  undoSentence: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 8,
    fontSize: 14,
    whiteSpace: 'nowrap',
  },
  undoName: {
    fontWeight: 600,
  },
  undoClock: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  keysPanel: {
    position: 'absolute',
    right: 16,
    bottom: 80,
    zIndex: 10,
    display: 'flex',
    width: 320,
    flexDirection: 'column',
    gap: 10,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    padding: 16,
    boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  },
  keysHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  keysTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  keysSpacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  keysToggle: {
    fontSize: 12,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  keysList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  keysRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  keysKey: {
    width: 56,
    flexShrink: 0,
  },
  keysWord: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  keysFoot: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingTop: 8,
    fontSize: 12,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  doneScreen: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    alignItems: 'center',
    justifyContent: 'center',
    overflowY: 'auto',
    padding: 24,
  },
  doneStack: {
    display: 'flex',
    width: '100%',
    maxWidth: '36rem',
    flexDirection: 'column',
    gap: 20,
  },
  doneHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  doneMark: {
    width: 48,
    height: 48,
    flexShrink: 0,
  },
  doneTitle: {
    fontSize: 20,
    fontWeight: 600,
    letterSpacing: '-0.025em',
  },
  doneStats: {
    display: 'flex',
    alignItems: 'flex-end',
    gap: 24,
    borderBlockWidth: 1,
    borderBlockStyle: 'solid',
    borderBlockColor: tokens.border,
    paddingBlock: 16,
  },
  doneActions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  doneLeft: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  doneStat: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  doneStatLabel: {
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
  doneStatValue: {
    fontSize: 18,
    lineHeight: 1,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
})

/** one disposition this sitting, wherever it has got to */
interface SessionEntry {
  readonly instanceId: string
  readonly participantName: string
  readonly itemTitle: string
  /** asking for material ends the reviewer's turn too, so it is one of these */
  readonly decision: 'approve' | 'reject' | 'escalate' | 'supplement'
  readonly status: 'waiting' | 'sent' | 'failed'
}

export default function ReviewInstancePage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.reviewDetailTab)} size="full" chrome="none">
      {(batch) => <Workbench batch={batch} />}
    </BatchScreen>
  )
}

function Workbench({ batch }: { batch: BatchDto }) {
  const { instanceId } = usePageRouteParams('instanceId')
  const [runRaw] = usePageQueryState('run')
  const scope = readRunScope(runRaw)
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()

  // The live channel carries wake-ups, never data: on each one the screen
  // re-reads whichever authorized query the wake-up names. While the channel
  // is down the same queries poll instead - later, but not blind.
  const { live } = useBatchLive(batch.id, (kind) => {
    switch (kind) {
      case 'sync':
      case 'phase-changed':
      case 'review-instance-changed':
        void queryClient.invalidateQueries({
          queryKey: query.assessment.getReviewInstance.key({ params: { instanceId } }),
        })
        void queryClient.invalidateQueries({
          queryKey: query.assessment.listReviewInbox.key({ query: { batchId: batch.id } }),
        })
        return
      case 'review-inbox-changed':
        void queryClient.invalidateQueries({
          queryKey: query.assessment.listReviewInbox.key({ query: { batchId: batch.id } }),
        })
        return
      default:
        return
    }
  })

  const inbox = useQuery({
    ...query.assessment.listReviewInbox.queryOptions({ query: { batchId: batch.id } }),
    refetchInterval: live ? 60_000 : 30_000,
  })
  const detail = useQuery({
    ...query.assessment.getReviewInstance.queryOptions({ params: { instanceId } }),
    // never zero: `live` proves the browser-to-server hop, not the
    // server-to-database one, and a wake-up lost between them must decay
    // into a late poll rather than a blind screen
    refetchInterval: live ? 60_000 : 15_000,
  })
  const review = detail.data?.review

  // this sitting's decisions, newest last; the queue rail and the closing
  // screen both read it
  const [log, setLog] = useState<readonly SessionEntry[]>([])
  const startedAt = useRef(Date.now())
  const decidedIds = useMemo(() => new Set(log.map((entry) => entry.instanceId)), [log])

  const scopeRows = useMemo(
    () =>
      runRows(
        (inbox.data?.items ?? []).filter((row) => row.batchId === batch.id),
        scope,
      ),
    [inbox.data, batch.id, scope],
  )
  const remaining = useMemo(
    () => scopeRows.filter((row) => !decidedIds.has(row.instanceId)),
    [scopeRows, decidedIds],
  )
  const currentIndex = remaining.findIndex((row) => row.instanceId === instanceId)
  const total = log.length + remaining.length

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: query.assessment.key() })
  }

  const mark = (id: string, status: SessionEntry['status']) =>
    setLog((current) =>
      current.map((entry) => (entry.instanceId === id ? { ...entry, status } : entry)),
    )

  const deferred = useDeferredDecision({
    onCommitted: (staged) => {
      mark(staged.instanceId, 'sent')
      refresh()
    },
    onFailed: (staged, error) => {
      mark(staged.instanceId, 'failed')
      toast.error(formatError(error))
      refresh()
    },
  })

  const goTo = useCallback(
    (id: string) =>
      navigate('assessment/review-instance', {
        params: { batchId: batch.id, instanceId: id },
        search: runRaw === '' ? {} : { run: runRaw },
      }),
    [navigate, batch.id, runRaw],
  )
  const openTrail = useCallback(() => setTrailOpen(true), [])
  const openVersions = useCallback(() => setVersionsOpen(true), [])

  // Nothing more to do here, and something else waiting.
  //
  // Two ways to end up looking at a filing this sitting already dealt with:
  // deciding the last one in the run, and then work arriving while the done
  // screen was up. Either way the rail no longer holds it, so the screen was
  // showing one filing and the list beside it another. Narrow on purpose -
  // only filings THIS sitting decided - or opening a paused round from the
  // queue's other half would bounce the reader somewhere they did not ask
  // for.
  const settledHere = decidedIds.has(instanceId)
  // The turn is lost when a round that was this reader's to decide stops
  // being so under them - settled elsewhere, withdrawn, re-routed. Two ways
  // the server says it, depending on who is asking: an ordinary reviewer's
  // refetch turns not-found, an administrator's succeeds and comes back
  // terminal with canDecide gone. Neither is the 404 a wrong address
  // deserves - the reader is mid-thought over this very filing, possibly
  // mid-sentence in a dialog - so the workbench stands, wearing the fact,
  // and nothing typed goes anywhere. A settled round opened cold was never
  // this sitting's turn, so nothing fires there.
  const wasMine = useRef(new Set<string>())
  useEffect(() => {
    if (review?.capabilities.canDecide) wasMine.current.add(instanceId)
  }, [instanceId, review?.capabilities.canDecide])
  const lostTurn =
    review !== undefined &&
    !settledHere &&
    wasMine.current.has(instanceId) &&
    ((detail.error !== null &&
      (isApiErrorCode(detail.error, 'ASSESSMENT_REVIEW_NOT_FOUND') ||
        isApiErrorCode(detail.error, 'ASSESSMENT_REVIEW_CONFLICT'))) ||
      (review.state === 'completed' && !review.capabilities.canDecide))
  /** the closest thing to a cause the refetched round can still say */
  const lostBecause =
    detail.data?.review.outcome === 'cancelled'
      ? m.reviewGoneWithdrawn
      : detail.data?.review.outcome === 'superseded'
        ? m.reviewGoneRerouted
        : detail.data?.review.state === 'completed'
          ? m.reviewGoneDecided
          : m.reviewGoneBody

  // Said out loud once, over whatever dialog the reader is writing in - the
  // banner may be standing behind it. And a decision waiting out its undo
  // window aims at a round that no longer exists; taking it back now turns
  // a five-seconds-later conflict into a sentence.
  const told = useRef(new Set<string>())
  useEffect(() => {
    if (!lostTurn || told.current.has(instanceId)) return
    told.current.add(instanceId)
    toast.info(format(lostBecause))
    if (deferred.pending !== null) {
      deferred.undo()
      toast.info(format(m.reviewGoneUndone))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lostTurn])
  useEffect(() => {
    if (!settledHere) return
    const next = remaining[0]
    if (next !== undefined) goTo(next.instanceId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settledHere, remaining.length])

  // The queue is furniture, not a layer: it stays where it was left, and a
  // reload finds it there, but pressing back should never be about it.
  const [rail, setRail] = usePageQueryState('queue')
  const railOpen = rail !== 'off'

  // Every decision is an act with its own panel; nothing arms silently.
  const [dialog, setDialog] = useState<'approve' | 'reject' | 'escalate' | 'supplement' | null>(
    null,
  )
  const [keysOpen, setKeysOpen] = useState(false)
  const [openSibling, setOpenSibling] = useState<string | null>(null)
  const lingeringSibling = useLingering(openSibling)
  // which dialog to keep drawn while it shuts; a conditionally mounted one
  // vanishes instead of closing, and only the way in ever looks right
  const lingeringDialog = useLingering(dialog)
  // the pill has to keep its words while it animates out
  const lingeringStaged = useLingering(deferred.pending)
  const [trailOpen, setTrailOpen] = useState(false)
  // the other person may already be answering the request
  const [withdrawing, setWithdrawing] = useState<string | null>(null)
  const [versionsOpen, setVersionsOpen] = useState(false)
  // The stacked scroller, held as state rather than a ref: the strip that
  // spies on it mounts in the same commit, and a ref would still be null
  // when its effect first looked.
  const [stack, setStack] = useState<HTMLDivElement | null>(null)
  const beside = useBeside()
  // Which faces of this round have been under the reader, this sitting.
  // Session memory, not a record: it exists so the dot on an unread face
  // and the last word in a decision dialog know what has not been looked
  // at, and it starts over with every filing.
  const [visited, setVisited] = useState<ReadonlySet<WorkbenchPart>>(new Set(['filing']))
  useEffect(() => {
    setVisited(new Set(['filing']))
  }, [instanceId])
  const partGo = useRef<((part: WorkbenchPart) => void) | null>(null)
  // what the side faces hold that is worth this judgment's while: process
  // history that shaped the round, and terms that bound the score
  const flowMatters =
    review !== undefined &&
    (review.chain.route === 'escalation' || review.roundNo > 1 || review.supplements.length > 0)
  const aboutMatters =
    review !== undefined &&
    review.context !== null &&
    (review.context.siblings.filter((one) => !one.current).length > 0 ||
      review.context.worth.groupCap !== null ||
      review.context.worth.maxEntries !== null)
  const attention = useMemo(() => {
    const marks = new Set<WorkbenchPart>()
    if (flowMatters && !visited.has('flow')) marks.add('flow')
    if (aboutMatters && !visited.has('about')) marks.add('about')
    return marks as ReadonlySet<WorkbenchPart>
  }, [flowMatters, aboutMatters, visited])
  /** the decision dialogs' last quiet word: faces that matter, still unread */
  const unseen = (): readonly { part: WorkbenchPart; say: MessageDescriptor }[] => {
    if (beside) return []
    const gaps: { part: WorkbenchPart; say: MessageDescriptor }[] = []
    if (flowMatters && !visited.has('flow')) {
      gaps.push({ part: 'flow', say: m.reviewGuardUnseenFlow })
    }
    if (aboutMatters && !visited.has('about')) {
      gaps.push({ part: 'about', say: m.reviewGuardUnseenAbout })
    }
    return gaps
  }
  const caution = (gaps: readonly { part: WorkbenchPart; say: MessageDescriptor }[]) =>
    gaps.length === 0 ? undefined : (
      <div data-testid="decision-caution" {...stylex.props(styles.cautionCard)}>
        {gaps.map((gap) => (
          <span key={gap.part} {...stylex.props(styles.cautionLine)}>
            <span {...stylex.props(styles.cautionWords)}>{format(gap.say)}</span>
            <button
              type="button"
              {...stylex.props(styles.cautionGo)}
              onClick={() => {
                setDialog(null)
                partGo.current?.(gap.part)
              }}
            >
              {format(m.reviewGuardOpen)}
            </button>
          </span>
        ))}
      </div>
    )
  // Which earlier version the filing is read against; null is not comparing.
  // On by default: a resubmission is read for what changed in it, and having
  // to ask for that every time made the question "did they fix it" cost a
  // keystroke on every filing in the run.
  const [comparing, setComparing] = useState<string | null>('previous')
  // The bar at the bottom is where this screen is acted on, so the shell's
  // own floating control stands down for as long as it is up. The way back
  // to the queue is the key at the left of the header instead - and where
  // there is no bar (a round already closed, the screen that ends a run),
  // the foot goes back to the shell rather than leaving a phone with
  // neither.
  // Whether something over the workbench owns the keyboard. Read from a ref
  // because the window listener runs in the same native event as the panel
  // that just closed itself: through a render closure it saw "no overlay"
  // and ran the page's own ⌘↵ a moment after the panel had already acted.
  const overlaid = useRef(false)
  overlaid.current = dialog !== null || trailOpen || versionsOpen || openSibling !== null

  /**
   * Log what was just staged and put the next filing on screen.
   *
   * Every disposition ends the reviewer's turn on this one - a decision, and
   * asking for material just as much - so every one of them moves on. Leaving
   * the ask on screen meant walking back to the queue to find the next.
   */
  const stageAndAdvance = (
    staged: StagedDecision,
    decision: SessionEntry['decision'],
    itemTitle: string,
    participantName: string,
  ) => {
    setLog((current) => [
      ...current,
      { instanceId, participantName, itemTitle, decision, status: 'waiting' },
    ])
    deferred.stage(staged)
    setDialog(null)
    const next = remaining.find((row) => row.instanceId !== instanceId)
    if (next !== undefined) goTo(next.instanceId)
  }

  /** asking for more material, through the same window everything else uses */
  const stageSupplement = (worded: WordedSupplement) => {
    if (review === undefined || lostTurn) return
    stageAndAdvance(
      { kind: 'supplement', instanceId, participantName: review.participantName, payload: worded },
      'supplement',
      review.itemTitle,
      review.participantName,
    )
  }

  /** stage a round-moving decision, log it, and put the next one on screen */
  const stageDecision = (decision: 'approve' | 'reject' | 'escalate', worded?: WordedDecision) => {
    if (review === undefined || lostTurn) return
    const staged: StagedDecision = {
      kind: 'decision',
      instanceId,
      decision,
      participantName: review.participantName,
      payload: {
        decision,
        ...(worded?.reason !== undefined ? { reason: worded.reason } : {}),
        // an approval's opinion is optional, and an empty box means none
        ...(worded !== undefined && worded.comment !== '' ? { comment: worded.comment } : {}),
        ...(worded?.suggestedPayload !== undefined
          ? { suggestedPayload: worded.suggestedPayload }
          : {}),
      },
    }
    stageAndAdvance(staged, decision, review.itemTitle, review.participantName)
  }

  /** taking the ask back; the round returns to the queue as it stood */
  const withdrawSupplement = useMutation({
    mutationFn: (requestId: string) =>
      run(
        api.assessment.cancelSupplement({
          params: { requestId },
          payload: { status: 'cancelled' },
        }),
      ),
    onSuccess: () => {
      toast.success(format(m.supplementWithdrawn))
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const may = (act: 'approve' | 'reject' | 'escalate' | 'supplement') =>
    !lostTurn && review?.actions[act].state === 'available'

  const undoStaged = () => {
    const staged = deferred.undo()
    if (staged === null) return
    setLog((current) => current.filter((entry) => entry.instanceId !== staged.instanceId))
    goTo(staged.instanceId)
  }

  const move = (step: 1 | -1) => {
    const at = currentIndex === -1 ? 0 : currentIndex + step
    const next = remaining[Math.max(0, Math.min(remaining.length - 1, at))]
    if (next !== undefined && next.instanceId !== instanceId) goTo(next.instanceId)
  }

  // the letters are choices, never acts: only ⌘↵ submits, and while the
  // cursor is in a box the letters belong to the text
  useEffect(() => {
    // Only where there is a keyboard to press them. A phone's on-screen
    // keyboard opens for a text box and closes with it, so a bare letter
    // there is never a decision - but a soft keyboard can still fire one
    // while something else has focus, and A meaning "approve" is not a key
    // to leave lying under a thumb.
    if (!window.matchMedia('(pointer: fine)').matches) return
    const down = (event: KeyboardEvent) => {
      if (overlaid.current) return
      // the photo viewer holds its own keys: Esc closes it, arrows page it
      if (document.querySelector('.PhotoView-Portal') !== null) return
      const mod = event.metaKey || event.ctrlKey
      // ⌘↵ lives inside each act's panel now: confirming is the panel's to
      // do, and a chord with nothing open has nothing to confirm
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undoStaged()
        return
      }
      if (event.altKey && !mod) {
        const nth = /^Digit([1-9])$/.exec(event.code)
        if (nth !== null) {
          event.preventDefault()
          const other = (review?.context?.siblings ?? [])[Number(nth[1]) - 1]
          if (other !== undefined) setOpenSibling(other.entryId)
          return
        }
      }
      // ⌘C, ⌃V and friends belong to the browser: only bare keys choose
      if (mod || event.altKey) return
      const typing =
        event.target instanceof HTMLElement &&
        event.target.closest('input, textarea, [contenteditable]') !== null
      if (typing) {
        if (event.key === 'Escape' && event.target instanceof HTMLElement) event.target.blur()
        return
      }
      switch (event.key) {
        case '?':
          event.preventDefault()
          setKeysOpen((open) => !open)
          return
        case 'a':
        case 'A':
          event.preventDefault()
          if (may('approve')) setDialog('approve')
          return
        case 'r':
        case 'R':
          // swallowed before the dialog opens, or the letter lands in the
          // box it is about to focus
          event.preventDefault()
          if (may('reject')) setDialog('reject')
          return
        case 'e':
        case 'E':
          event.preventDefault()
          if (may('escalate')) setDialog('escalate')
          return
        case 's':
        case 'S':
          // the ask has to be written before it can be staged, so the letter
          // opens the box rather than arming anything
          event.preventDefault()
          if (may('supplement')) setDialog('supplement')
          return
        case 'd':
          event.preventDefault()
          setComparing((current) => (current === null ? 'previous' : null))
          return
        case 'D':
          event.preventDefault()
          setVersionsOpen(true)
          return
        case 'h':
        case 'H':
          event.preventDefault()
          setTrailOpen(true)
          return
        case 'j':
        case 'J':
          event.preventDefault()
          move(1)
          return
        case 'k':
        case 'K':
          event.preventDefault()
          move(-1)
          return
        case 'Escape':
          if (keysOpen) setKeysOpen(false)
          return
        default: {
          const slot = Number(event.key)
          if (Number.isInteger(slot) && slot >= 1 && slot <= 9) {
            event.preventDefault()
            document
              .querySelector(`[data-file-slot="${slot}"]`)
              ?.querySelector<HTMLElement>('img, a, button')
              ?.click()
          }
        }
      }
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  })

  // over only when this sitting decided something: an already-closed round
  // opened from elsewhere is a page to read, not a run to finish
  const done = remaining.length === 0 && log.length > 0 && !inbox.isPending
  const bar = !done && !lostTurn && review !== undefined && review.capabilities.canDecide
  useClaimScreenFoot(bar)

  return (
    <AsyncSection
      pending={inbox.isPending && detail.isPending}
      // A round this sitting decided stops being this reviewer's to read
      // the moment the decision lands, and the refetch behind the done
      // screen comes back not-found. That is the access rule working, not
      // an error to show over the reader's own closing screen.
      error={detail.error && !settledHere && !lostTurn ? formatError(detail.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void inbox.refetch()
        void detail.refetch()
      }}
      skeleton={<Skeleton className={stylex.props(styles.loadSkeleton).className} />}
      xstyle={styles.fill}
    >
      {/* Given its height by the shell rather than measuring the window for
          one. Measuring was wrong in both directions: taken while the pane
          was scrolled it read too tall, and the workbench grew the scrollbar
          it is built not to need; taken before the bands above it settled it
          read too short, and left a screenful of nothing under the decision
          bar. Every ancestor up to the shell's main is a flex column, so
          filling what is left needs no arithmetic and nothing to keep in
          step.

          A screenful at every width, narrow included: the parts stack into
          one scroller between the header and the bar, rather than the page
          growing and the decision going off the bottom of it. On a phone
          that is the whole point - what is being decided scrolls, and what
          decides it stays under the thumb. */}
      <div {...stylex.props(styles.bench)}>
        {/* Flex, not a two-track grid: with the rail display:none below its
            width, the content fell into the grid's `auto` track and the 1fr
            track sat empty beside it - the whole workbench at half width,
            found as a left-leaning done screen. The rail owns and animates
            its width as a shrink-0 flex child just as well. */}
        <div {...stylex.props(styles.benchRow)}>
          <QueueRail
            rows={remaining}
            currentId={instanceId}
            remainingCount={remaining.length}
            open={railOpen}
            onToggle={() => setRail(railOpen ? 'off' : '')}
            onOpen={goTo}
            onBack={() => navigate('assessment/batch-reviews', { params: { batchId: batch.id } })}
          />
          <div
            data-review-route={review?.chain.route ?? 'normal'}
            {...stylex.props(styles.benchColumn)}
          >
            {done ? (
              <DoneScreen
                batchId={batch.id}
                log={log}
                startedAt={startedAt.current}
                inboxRows={(inbox.data?.items ?? []).filter(
                  (row) => row.batchId === batch.id && !decidedIds.has(row.instanceId),
                )}
              />
            ) : review === undefined ? (
              <div {...stylex.props(styles.benchSkeletonSeat)}>
                <Skeleton className={stylex.props(styles.benchSkeleton).className} />
              </div>
            ) : (
              <>
                {/* the run's standing, for a screen with room for it: narrow,
                    the header already says which of how many this is, and a
                    second bar would cost a tenth of the phone to say it
                    again */}
                {scopeRows.length > 0 && (
                  <RunStrip
                    at={log.length + (currentIndex === -1 ? 1 : currentIndex + 1)}
                    total={total}
                    done={log.length}
                    batchId={batch.id}
                  />
                )}
                <PersonStrip
                  review={review}
                  at={currentIndex === -1 ? null : currentIndex + 1}
                  of={remaining.length}
                  canPrev={currentIndex > 0}
                  canNext={currentIndex !== -1 && currentIndex < remaining.length - 1}
                  onMove={move}
                  onBack={() =>
                    navigate('assessment/batch-reviews', { params: { batchId: batch.id } })
                  }
                />
                {/* A reader with no acts here - an administrator looking
                    in, a reviewer whose phase is closed - gets told the
                    mode instead of a button-less mystery. The requester of
                    an open ask is not read-only: cancelling it is theirs. */}
                {review !== undefined &&
                  !lostTurn &&
                  review.state !== 'completed' &&
                  !review.capabilities.canDecide &&
                  !review.capabilities.canCancelSupplement &&
                  !review.capabilities.canAnswerSupplement && (
                    <p data-testid="review-readonly" {...stylex.props(styles.readonlyBar)}>
                      {format(m.reviewReadOnly)}
                    </p>
                  )}
                {/* The turn was lost mid-thought - settled elsewhere,
                    withdrawn, re-routed. The workbench stays up with
                    everything typed; only the ways to act are shut, and the
                    one way on is the reader's press, never an automatic
                    jump over words they may still want. */}
                {lostTurn && (
                  <div
                    data-testid="review-gone"
                    data-lost={detail.data?.review.outcome ?? 'unreadable'}
                    {...stylex.props(styles.goneBanner)}
                  >
                    <div {...stylex.props(styles.goneWords)}>
                      <p {...stylex.props(styles.goneTitle)}>{format(m.reviewGoneTitle)}</p>
                      <p {...stylex.props(styles.goneBody)}>
                        {format(lostBecause)}
                        {` ${format(m.reviewGoneKept)}`}
                      </p>
                    </div>
                    <span {...stylex.props(styles.spacer)} />
                    {remaining.some((row) => row.instanceId !== instanceId) ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          const next = remaining.find((row) => row.instanceId !== instanceId)
                          if (next !== undefined) goTo(next.instanceId)
                        }}
                      >
                        {format(m.reviewGoneNext)}
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() =>
                          navigate('assessment/batch-reviews', { params: { batchId: batch.id } })
                        }
                      >
                        {format(m.reviewGoneFinish)}
                      </Button>
                    )}
                  </div>
                )}
                {/* Three columns on a wide screen: what has been said, what
                    was filed, and the terms it is judged under. The filing is
                    the widest and the only one that scrolls far; the other
                    two are meant to be taken in at a glance while working
                    down it. Stacked below that, in the same reading order. */}
                {/* the appeal or escalation the reader must meet before
                    anything else must not live inside a side page of the
                    pager: below lg it stands here, over the faces */}
                {!beside && review.chain.route === 'escalation' && (
                  <EscalationNotice review={review} />
                )}
                <PartStrip
                  pager={stack}
                  round={review.roundNo}
                  revision={review.revision.revisionNo}
                  drillKey={instanceId}
                  attention={attention}
                  onReading={(part) =>
                    setVisited((seen) => {
                      if (seen.has(part)) return seen
                      const next = new Set(seen)
                      next.add(part)
                      return next
                    })
                  }
                  bind={(go) => {
                    partGo.current = go
                  }}
                />
                <Drill
                  move="next"
                  drillKey={instanceId}
                  className={stylex.props(styles.drillSeat).className}
                >
                  {/* The same three faces at every width. Beside each other
                      on a desk; below lg a snap pager - one whole face per
                      screen, the filing in the middle and first - because
                      three long blocks in one vertical scroller had no
                      focal point at all. Each face keeps its own vertical
                      scroll either way, so leaving and returning finds a
                      reading where it was left. */}
                  <div ref={setStack} {...stylex.props(styles.pager)}>
                    <FlowColumn review={review} onTrail={openTrail} lifted={!beside} />
                    <FilingColumn
                      review={review}
                      comparing={comparing}
                      onCompare={setComparing}
                      onVersions={openVersions}
                      onPart={(part) => partGo.current?.(part)}
                    />
                    <ContextRail review={review} onOpenSibling={setOpenSibling} />
                  </div>
                </Drill>
                {bar && <DecisionBar review={review} onDialog={setDialog} />}
                {review.state === 'awaiting_supplement' && (
                  <footer {...stylex.props(styles.awaitingFoot)}>
                    <InfoIcon aria-hidden className={stylex.props(styles.awaitingIcon).className} />
                    <div {...stylex.props(styles.awaitingWords)}>
                      <p {...stylex.props(styles.awaitingTitle)}>
                        {format(m.supplementWaitingTitle)}
                      </p>
                      <p {...stylex.props(styles.awaitingBody)}>
                        {format(m.supplementWaitingBody, { who: review.participantName })}
                      </p>
                    </div>
                    <span {...stylex.props(styles.spacer)} />
                    {review.capabilities.canCancelSupplement &&
                      (() => {
                        const open = review.supplements.find((one) => one.status === 'open')
                        return open === undefined ? null : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={withdrawSupplement.isPending}
                            onClick={() => setWithdrawing(open.id)}
                          >
                            {format(m.supplementWithdraw)}
                          </Button>
                        )
                      })()}
                  </footer>
                )}
                {review.state === 'completed' && review.outcome !== null && (
                  <div {...stylex.props(styles.outcomeRow)}>
                    <Badge variant="outline">{format(reviewOutcomeMessage(review.outcome))}</Badge>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Centred across the workbench, by a row that spans it rather than
            by a transform: the pill's own entrance animates one, and an
            inline transform beats a class every time. It used to be pushed
            off the queue rail by a hard-coded 16rem, which put it wherever
            that rail happened to be - and off the screen when it was not
            there at all. The row ignores the pointer so the filing under it
            stays readable. */}
        <div {...stylex.props(styles.undoRow)}>
          <Appear
            show={deferred.pending !== null}
            className={stylex.props(styles.undoSeat).className}
          >
            {lingeringStaged !== null && (
              <UndoPill staged={lingeringStaged} deadline={deferred.deadline} onUndo={undoStaged} />
            )}
          </Appear>
        </div>
        {keysOpen && <KeysPanel onClose={() => setKeysOpen(false)} />}
        {review !== undefined && (
          <SiblingSheet
            open={openSibling !== null}
            itemTitle={review.itemTitle}
            sibling={
              (review.context?.siblings ?? []).find((one) => one.entryId === lingeringSibling) ??
              null
            }
            onClose={() => setOpenSibling(null)}
          />
        )}
        {review !== undefined && (
          <>
            {/* the same account the person who filed reads, told the same
                way: one claim has one story, and a reviewer reading a
                different rendering of it is reading a different thing */}
            <EntryHistory
              open={trailOpen}
              entryId={review.entryId}
              itemTitle={review.itemTitle}
              subject={review.participantName}
              onClose={() => setTrailOpen(false)}
            />
            <VersionPicker
              open={versionsOpen}
              entryId={review.entryId}
              judgedRevisionNo={review.revision.revisionNo}
              comparingId={comparing}
              participantName={review.participantName}
              itemTitle={review.itemTitle}
              onPick={(revisionId) => {
                setComparing(revisionId)
                setVersionsOpen(false)
              }}
              onClose={() => setVersionsOpen(false)}
            />
          </>
        )}

        {lingeringDialog === 'approve' && review !== undefined && (
          <ApproveDialog
            open={dialog === 'approve'}
            review={review}
            caution={caution(unseen())}
            onClose={() => setDialog(null)}
            onConfirm={(worded) => stageDecision('approve', worded)}
          />
        )}
        {lingeringDialog === 'reject' && review !== undefined && (
          <RejectDialog
            open={dialog === 'reject'}
            review={review}
            reasons={batch.reviewReasons.reject}
            caution={caution(unseen())}
            onClose={() => setDialog(null)}
            onConfirm={(worded) => stageDecision('reject', worded)}
          />
        )}
        {lingeringDialog === 'escalate' && review !== undefined && (
          <EscalateDialog
            open={dialog === 'escalate'}
            review={review}
            reasons={batch.reviewReasons.escalate}
            onClose={() => setDialog(null)}
            onConfirm={(worded) => stageDecision('escalate', worded)}
          />
        )}
        <ConfirmDialog
          open={withdrawing !== null}
          tone="destructive"
          title={format(m.supplementWithdrawConfirm)}
          description={format(m.supplementWithdrawConfirmHint)}
          confirmLabel={format(m.supplementWithdraw)}
          cancelLabel={format(commonMessages.cancel)}
          pending={withdrawSupplement.isPending}
          onCancel={() => setWithdrawing(null)}
          onConfirm={() => {
            const id = withdrawing
            setWithdrawing(null)
            if (id !== null) withdrawSupplement.mutate(id)
          }}
        />
        {lingeringDialog === 'supplement' && review !== undefined && (
          <SupplementDialog
            open={dialog === 'supplement'}
            onClose={() => setDialog(null)}
            onConfirm={stageSupplement}
          />
        )}
      </div>
    </AsyncSection>
  )
}

const DECISION_LABEL: Record<SessionEntry['decision'], MessageDescriptor> = {
  approve: m.reviewApprove,
  reject: m.reviewReject,
  escalate: m.reviewEscalate,
  supplement: m.reviewSupplementAsked,
}

/** the word box and the four choices; only ⌘↵ ever submits */
function DecisionBar({
  review,
  onDialog,
}: {
  review: ReviewDto
  onDialog: (next: 'approve' | 'reject' | 'escalate' | 'supplement') => void
}) {
  const { format } = useI18n()
  // What each word will do from here, told on hover. On the ladder every
  // step's approval settles the matter, a middle step's rejection climbs
  // with its opinion, and escalating climbs without one; the ordinary route
  // reads as it always did.
  const onLadder = review.chain.route === 'escalation'
  const route = onLadder ? review.chain.escalation : review.chain.normal
  const lastStep = route[route.length - 1]?.id === review.chain.stageId

  return (
    <footer {...stylex.props(styles.decisionFooter)}>
      {/* All four acts, always: a workbench whose buttons come and go has no
          stable map, and "why can I not escalate this one" is a question a
          missing button cannot answer. What varies is availability, and a
          blocked act carries its reason.

          Two groups, not four equals: escalating and asking for material
          change the path, rejecting and approving conclude this sitting. A
          wide bar seats them left and right of a spacer; on a phone the
          spacer becomes a line break, so the routing pair sits compact over
          a full-width verdict row - never a 2x2 grid, which reads as a
          keypad and ranks nothing. One container either way, because two
          renderings of the same key is two answers to "the" reject button. */}
      {/* A 2x2 matrix on a phone: both rows filled edge to edge, the
          routing pair above in a lighter register, the verdicts below
          taller and heavier - four half-width keys, no stray blank. On
          anything wider, the same one row as always. */}
      <div {...stylex.props(styles.decisionRow)}>
        <ActionKey
          act="escalate"
          offer={review.actions.escalate}
          label={format(m.reviewEscalate)}
          kbd="E"
          why={format(onLadder ? m.reviewTipEscalateMid : m.reviewTipEscalate)}
          xstyle={styles.phoneRouting}
          onPress={() => onDialog('escalate')}
        />
        <ActionKey
          act="supplement"
          offer={review.actions.supplement}
          label={format(m.reviewSupplementAsk)}
          kbd="S"
          why={format(m.reviewTipSupplement)}
          xstyle={styles.phoneRouting}
          onPress={() => onDialog('supplement')}
        />
        <span aria-hidden {...stylex.props(styles.decisionSpacer)} />
        <ActionKey
          act="reject"
          offer={review.actions.reject}
          label={format(m.reviewReject)}
          icon={<CornerUpLeftIcon aria-hidden />}
          kbd="R"
          why={format(onLadder && !lastStep ? m.reviewTipRejectMid : m.reviewTipReject)}
          xstyle={[styles.rejectKey, styles.phoneVerdict]}
          kbdClassName="bg-[color-mix(in_oklab,var(--q-danger)_12%,transparent)] text-[var(--q-danger)]"
          onPress={() => onDialog('reject')}
        />
        <ActionKey
          act="approve"
          offer={review.actions.approve}
          label={format(m.reviewApprove)}
          icon={<CheckIcon aria-hidden />}
          kbd="A"
          // an ordinary middle step's approval hands the round on; the
          // ladder's every step and the ordinary route's last one settle it
          why={format(onLadder || lastStep ? m.reviewTipApprove : m.reviewTipApproveMid)}
          xstyle={[styles.approveKey, styles.phoneVerdict]}
          kbdClassName="bg-[color-mix(in_oklab,var(--q-success)_12%,transparent)] text-[var(--q-success-foreground)]"
          onPress={() => onDialog('approve')}
        />
      </div>
    </footer>
  )
}

/**
 * One act of the bar: offered, or standing with its reason.
 *
 * Blocked is not gone and not dead. Beside a keyboard the reason hangs on
 * hover, on the disabled key itself; under a thumb there is no hover, so
 * the key stays pressable and a press answers with the reason instead of
 * the act - a grey key that never says why is a wall, not a control.
 */
function ActionKey({
  act,
  offer,
  label,
  kbd,
  why,
  icon,
  xstyle,
  kbdClassName,
  onPress,
}: {
  act: 'approve' | 'reject' | 'escalate' | 'supplement'
  offer: ReviewDto['actions']['approve']
  label: string
  kbd: string
  /** what the act will do, told on hover while it is offered */
  why: string
  /** the act's glyph, in the key's own ink */
  icon?: ReactNode
  xstyle?: stylex.StyleXStyles | readonly stylex.StyleXStyles[]
  kbdClassName?: string
  onPress: () => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const blocked = offer.state !== 'available'
  const because = blocked ? format(actionBlockedMessage(offer.reason)) : why
  const key = (
    <Button
      variant="outline"
      data-testid={`act-${act}`}
      data-offer={blocked ? 'blocked' : 'available'}
      // why it is not on offer, as the fact rather than the sentence
      data-blocked-reason={blocked ? offer.reason : undefined}
      aria-disabled={blocked || undefined}
      className={
        stylex.props(!fine && styles.touchKey, xstyle, blocked && styles.blockedKey).className
      }
      onClick={() => {
        if (!blocked) {
          onPress()
          return
        }
        // no hover under a thumb: the press itself asks "why not"
        if (!fine) toast.info(because)
      }}
    >
      {icon}
      {label}
      {fine && <Kbd className={kbdClassName}>{kbd}</Kbd>}
    </Button>
  )
  if (!fine) return key
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span {...stylex.props(styles.keySeat)}>{key}</span>
        </TooltipTrigger>
        <TooltipContent>{because}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** the words for a blocked act, keyed by the server's stable reason codes */
const actionBlockedMessage = (reason: string | null): MessageDescriptor => {
  switch (reason) {
    case 'no-route':
      return m.reviewBlockedNoRoute
    case 'route-closed':
      return m.reviewBlockedRouteClosed
    case 'phase-closed':
      return m.reviewBlockedPhaseClosed
    case 'route-end':
      return m.reviewBlockedRouteEnd
    default:
      return m.reviewBlockedUnavailable
  }
}

function SiblingSheet({
  open,
  itemTitle,
  sibling,
  onClose,
}: {
  open: boolean
  itemTitle: string
  /** null once the claim it named is gone; the panel is shutting anyway */
  sibling: NonNullable<ReviewDto['context']>['siblings'][number] | null
  onClose: () => void
}) {
  const { format } = useI18n()
  return (
    <Dialog open={open && sibling !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-2 text-sm">
            {itemTitle}
            <span {...stylex.props(styles.siblingStanding)}>
              {sibling === null
                ? ''
                : format(entryStatusMessage[sibling.status as EntryDto['status']] ?? m.eventOther)}
            </span>
          </DialogTitle>
        </DialogHeader>
        <dl {...stylex.props(styles.siblingList)}>
          {(sibling?.values ?? []).map((pair) => (
            <div key={pair.label} {...stylex.props(styles.siblingRow)}>
              <dt {...stylex.props(styles.siblingLabel)}>{pair.label}</dt>
              <dd {...stylex.props(styles.siblingValue)}>{pair.value === '' ? '—' : pair.value}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  )
}

/** the five seconds a decision can still be taken back */
function UndoPill({
  staged,
  deadline,
  onUndo,
}: {
  staged: StagedDecision
  deadline: number
  onUndo: () => void
}) {
  const { format } = useI18n()
  const [left, setLeft] = useState(() => Math.ceil((deadline - Date.now()) / 1000))
  const started = useRef(Math.max(0, (deadline - Date.now()) / 1000))
  useEffect(() => {
    const tick = setInterval(
      () => setLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))),
      200,
    )
    return () => clearInterval(tick)
  }, [deadline])
  return (
    <div
      // the decision is staged and can still be taken back: a fact, said
      // once here rather than read out of the sentence beside the clock
      data-testid="decision-staged"
      data-decision={staged.kind === 'supplement' ? 'supplement' : staged.decision}
      {...stylex.props(styles.undoPill)}
    >
      <CountdownRing seconds={5} remaining={started.current}>
        {left}
      </CountdownRing>
      <p {...stylex.props(styles.undoSentence)}>
        <span {...stylex.props(styles.undoName)}>{staged.participantName}</span>
        {format(
          staged.kind === 'supplement'
            ? DECISION_LABEL.supplement
            : (DECISION_LABEL[staged.decision as SessionEntry['decision']] ?? m.reviewApprove),
        )}
      </p>
      <p {...stylex.props(styles.undoClock)}>{format(m.reviewUndoPending, { seconds: left })}</p>
      <Button variant="outline" size="sm" onClick={onUndo}>
        {format(m.reviewUndo)}
        <Kbd>⌘Z</Kbd>
      </Button>
    </div>
  )
}

/** the keyboard, spelled out; ? brings it and takes it away */
function KeysPanel({ onClose }: { onClose: () => void }) {
  const { format } = useI18n()
  const keys: readonly [string, MessageDescriptor][] = [
    ['A', m.reviewKeyApprove],
    ['R', m.reviewKeyReject],
    ['E', m.reviewKeyEscalate],
    ['S', m.reviewKeySupplement],
    ['⌘↵', m.reviewKeySubmit],
    ['⌘Z', m.reviewKeyUndo],
    ['J / K', m.reviewKeyMove],
    ['1–9', m.reviewKeyFiles],
    ['D', m.reviewKeyCompare],
    ['⇧D', m.reviewKeyVersions],
    ['H', m.reviewKeyTrail],
    ['⌥1–⌥9', m.reviewKeySiblings],
    ['Esc', m.reviewKeyCancel],
  ]
  return (
    <div {...stylex.props(styles.keysPanel)}>
      <div {...stylex.props(styles.keysHead)}>
        <p {...stylex.props(styles.keysTitle)}>{format(m.reviewKeysTitle)}</p>
        <span {...stylex.props(styles.keysSpacer)} />
        <button type="button" {...stylex.props(styles.keysToggle)} onClick={onClose}>
          {format(m.reviewKeysToggle)}
        </button>
      </div>
      <dl {...stylex.props(styles.keysList)}>
        {keys.map(([key, message]) => (
          <div key={key} {...stylex.props(styles.keysRow)}>
            <dt {...stylex.props(styles.keysKey)}>
              <Kbd className="w-full justify-center">{key}</Kbd>
            </dt>
            <dd {...stylex.props(styles.keysWord)}>{format(message)}</dd>
          </div>
        ))}
      </dl>
      <p {...stylex.props(styles.keysFoot)}>{format(m.reviewKeysFoot)}</p>
    </div>
  )
}

/** the run is over: what was decided, and where to go next (1g) */
function DoneScreen({
  batchId,
  log,
  startedAt,
  inboxRows,
}: {
  batchId: string
  log: readonly SessionEntry[]
  startedAt: number
  inboxRows: readonly InboxItemDto[]
}) {
  const { format } = useI18n()
  const navigate = usePageNavigate()
  const counts = {
    approve: log.filter((entry) => entry.decision === 'approve').length,
    reject: log.filter((entry) => entry.decision === 'reject').length,
    escalate: log.filter((entry) => entry.decision === 'escalate').length,
  }
  const spent = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
  const spentLabel = `${Math.floor(spent / 60)}:${String(spent % 60).padStart(2, '0')}`
  // the nearest next run: the fullest question still waiting
  const next = (() => {
    const byItem = new Map<string, { title: string; rows: InboxItemDto[] }>()
    for (const row of inboxRows) {
      const group = byItem.get(row.itemId)
      if (group === undefined) byItem.set(row.itemId, { title: row.itemTitle, rows: [row] })
      else group.rows.push(row)
    }
    return [...byItem.entries()].sort((a, b) => b[1].rows.length - a[1].rows.length)[0] ?? null
  })()

  return (
    <div
      // the run is finished, and this many were handled in it
      data-testid="run-done"
      data-handled={String(log.length)}
      {...stylex.props(styles.doneScreen)}
    >
      <Stagger className={stylex.props(styles.doneStack).className} step={0.08}>
        <div {...stylex.props(styles.doneHead)}>
          <DoneMark className={stylex.props(styles.doneMark).className} />
          <h2 {...stylex.props(styles.doneTitle)}>
            {format(m.reviewDoneTitle, { count: log.length })}
          </h2>
        </div>
        <div {...stylex.props(styles.doneStats)}>
          <DoneStat label={format(m.reviewApprove)} value={counts.approve} />
          <DoneStat label={format(m.reviewReject)} value={counts.reject} />
          <DoneStat label={format(m.reviewEscalate)} value={counts.escalate} />
          <span {...stylex.props(styles.keysSpacer)} />
          <DoneStat label={format(m.reviewDoneSpent)} value={spentLabel} />
        </div>
        <div {...stylex.props(styles.doneActions)}>
          {next !== null && (
            <Button
              onClick={() =>
                navigate('assessment/review-instance', {
                  params: { batchId, instanceId: next[1].rows[0]!.instanceId },
                  search: { run: `item:${next[0]}` },
                })
              }
            >
              {format(m.reviewDoneNext, { title: next[1].title, count: next[1].rows.length })}
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => navigate('assessment/batch-reviews', { params: { batchId } })}
          >
            {format(m.reviewDoneBack)}
          </Button>
          <span {...stylex.props(styles.keysSpacer)} />
          <p {...stylex.props(styles.doneLeft)}>
            {format(m.reviewDoneLeft, { count: inboxRows.length })}
          </p>
        </div>
      </Stagger>
    </div>
  )
}

function DoneStat({ label, value }: { label: string; value: number | string }) {
  return (
    <span {...stylex.props(styles.doneStat)}>
      <span {...stylex.props(styles.doneStatLabel)}>{label}</span>
      <span {...stylex.props(styles.doneStatValue)}>{value}</span>
    </span>
  )
}
