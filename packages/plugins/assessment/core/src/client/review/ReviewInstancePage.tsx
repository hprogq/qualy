import { memo, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertCircleIcon,
  ArrowLeftIcon,
  ChevronDownIcon,
  CircleArrowUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  DownloadIcon,
  InfoIcon,
} from 'lucide-react'
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
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import { Kbd } from '@qualy/ui/kbd'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Skeleton } from '@qualy/ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { useBatchLive } from '../live.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AttachmentLink } from '../entry/AttachmentLink.tsx'
import { Basis } from '../entry/Basis.tsx'
import { entryStatusMessage, fieldsOf, trimAmount, type EntryDto } from '../entry/model.ts'
import { reviewEventMessage, reviewOutcomeMessage } from './events.ts'
import {
  readRunScope,
  runRows,
  summaryOf,
  timeLabel,
  clockLabel,
  useDayClock,
  useEntryHistory,
  idsOf,
  valueOf,
  valuesOf,
  type HistoryRevision,
  type InboxItemDto,
} from './model.ts'
import type { BatchDto } from '../phase/model.ts'
import type { ReviewDto } from './model.ts'
import {
  ApproveDialog,
  EscalateDialog,
  RejectDialog,
  type WordedDecision,
} from './decision-dialogs.tsx'
import { SupplementDialog, type WordedSupplement } from './SupplementDialog.tsx'
import { useDeferredDecision, type StagedDecision } from './useDeferredDecision.ts'
import { VersionPicker } from './history.tsx'
import { EntryHistory } from '../entry/EntryHistory.tsx'
import { attachmentContentUrl } from '../entry/model.ts'
import { useLingering } from '@qualy/ui/use-lingering'
import { Appear, CountdownRing, DoneMark, Drill, GlideAcross, Stagger } from '@qualy/ui/reveal'
import { useFinePointer, useMedia } from './pointer.ts'

// The workbench: one submission a screen, walked in a run.
//
// Everything said before this round sits on top so it needs no scrolling,
// the filing and its materials follow, and what the question is worth stands
// beside them. Letters choose a decision, ⌘↵ stages it, and for five seconds
// it can be taken back; then it is submitted and the next one is already on
// screen. Sending back and escalating each carry a word, so they open their
// dialog instead of arming silently.

/**
 * The three parts of a workbench, in reading order: what has been said about
 * the filing, the filing itself, and the terms it is judged under. Beside
 * each other they are columns; stacked they are sections of one page, and
 * the strip under the header anchors to them by these names.
 */
type WorkbenchPart = 'flow' | 'filing' | 'about'

const WORKBENCH_PARTS: readonly WorkbenchPart[] = ['flow', 'filing', 'about']

/**
 * The seam between two stacked parts: a shallow full-bleed band rather than
 * a hairline. Three sections of one page need more than a border to stop
 * reading as one; when a section runs short the band is still only 10px, so
 * it never turns into a field of nothing. Beside the columns there is no
 * seam to draw - the grid drops it entirely.
 */
function PartBand() {
  return <span aria-hidden className="h-2.5 shrink-0 border-y bg-muted/70 lg:hidden" />
}

const PART_LABEL: Record<WorkbenchPart, MessageDescriptor> = {
  flow: m.reviewPrior,
  filing: m.reviewPayloadTitle,
  about: m.reviewAboutSection,
}

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
      skeleton={<Skeleton className="h-96 w-full" />}
      className="flex min-h-0 flex-1 flex-col"
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
      <div className="relative flex min-h-0 flex-1 flex-col">
        {/* Flex, not a two-track grid: with the rail display:none below its
            width, the content fell into the grid's `auto` track and the 1fr
            track sat empty beside it - the whole workbench at half width,
            found as a left-leaning done screen. The rail owns and animates
            its width as a shrink-0 flex child just as well. */}
        <div className="flex min-h-0 flex-1">
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
            className="flex min-h-0 min-w-0 flex-1 flex-col border-t lg:border-t-0 lg:border-l"
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
              <div className="p-6">
                <Skeleton className="h-64 w-full" />
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
                    <p
                      data-testid="review-readonly"
                      className="border-b bg-muted/40 px-5 py-2 text-xs text-muted-foreground"
                    >
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
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-200 bg-amber-50/70 px-5 py-3 dark:border-amber-900/50 dark:bg-amber-950/25"
                  >
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <p className="text-sm font-medium text-amber-950 dark:text-amber-100">
                        {format(m.reviewGoneTitle)}
                      </p>
                      <p className="text-[13px] leading-relaxed text-amber-900/80 dark:text-amber-200/70">
                        {format(lostBecause)}
                        {` ${format(m.reviewGoneKept)}`}
                      </p>
                    </div>
                    <span className="flex-1" />
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
                <PartStrip
                  scroller={stack}
                  round={review.roundNo}
                  revision={review.revision.revisionNo}
                  drillKey={instanceId}
                />
                <Drill move="next" drillKey={instanceId} className="flex min-h-0 flex-1 flex-col">
                  {/* One scroller stacked, one per column beside: the strip
                      above spies on this node either way, and beside each
                      other it never moves, so the strip is not there. */}
                  <div
                    ref={setStack}
                    className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain lg:grid lg:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)_21rem] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden"
                  >
                    <FlowColumn review={review} onTrail={openTrail} />
                    <PartBand />
                    <FilingColumn
                      review={review}
                      comparing={comparing}
                      onCompare={setComparing}
                      onVersions={openVersions}
                    />
                    <PartBand />
                    <ContextRail review={review} onOpenSibling={setOpenSibling} />
                  </div>
                </Drill>
                {bar && <DecisionBar review={review} onDialog={setDialog} />}
                {review.state === 'awaiting_supplement' && (
                  <footer className="flex flex-wrap items-center gap-3 border-t px-5 py-3">
                    <InfoIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <div className="flex min-w-0 flex-col">
                      <p className="text-sm font-medium">{format(m.supplementWaitingTitle)}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(m.supplementWaitingBody, { who: review.participantName })}
                      </p>
                    </div>
                    <span className="flex-1" />
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
                  <div className="flex items-center gap-2 border-t px-5 py-3">
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
        <div className="pointer-events-none absolute inset-x-0 bottom-36 z-10 flex justify-center lg:bottom-20">
          <Appear show={deferred.pending !== null} className="pointer-events-auto">
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
            onClose={() => setDialog(null)}
            onConfirm={(worded) => stageDecision('approve', worded)}
          />
        )}
        {lingeringDialog === 'reject' && review !== undefined && (
          <RejectDialog
            open={dialog === 'reject'}
            review={review}
            reasons={batch.reviewReasons.reject}
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

/**
 * What is still to do in this run, down the left.
 *
 * A filing leaves the list the moment its disposition is staged, not when
 * the five seconds are up: from the reviewer's side it is dealt with, and a
 * row that lingers greyed out for five seconds reads as one that did not
 * take. Taking it back with ⌘Z puts it back, because then it really was not
 * dealt with.
 */
// The four panes are memoized: the root re-renders on every keystroke in
// the decision bar and on every overlay opening or closing, and each of
// those re-rendered three columns and a queue for nothing - the sibling
// dialog's entrance visibly lost its first frames to that commit.
const QueueRail = memo(function QueueRail({
  rows,
  currentId,
  remainingCount,
  open,
  onToggle,
  onOpen,
  onBack,
}: {
  rows: readonly InboxItemDto[]
  currentId: string
  remainingCount: number
  /** whether the column is showing its list, or folded to a strip */
  open: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  onBack: () => void
}) {
  const { format } = useI18n()
  const dayClock = useDayClock()
  return (
    // The rail is always its full width; the aside around it is what
    // narrows and clips. Animating the contents' own layout warped every
    // row mid-flight - the shell's rail solved this the same way, and the
    // two folds should feel like one mechanism.
    <aside
      className={cn(
        'relative hidden min-h-0 shrink-0 overflow-hidden transition-[width] duration-200 ease-linear min-[84rem]:flex',
        open ? 'w-56' : 'w-11',
      )}
    >
      <nav
        {...(!open ? { inert: true, 'aria-hidden': true } : {})}
        className={cn(
          'flex h-full w-56 shrink-0 flex-col transition-opacity duration-150',
          !open && 'opacity-0',
        )}
      >
        <div className="flex shrink-0 items-center gap-1 border-b py-2 pr-1.5 pl-1">
          {/* the way out: a workbench with no door back is a dead end */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={format(m.reviewBackToQueue)}
            onClick={onBack}
          >
            <ArrowLeftIcon aria-hidden />
          </Button>
          <p className="min-w-0 truncate text-sm font-semibold">{format(m.reviewQueueTitle)}</p>
          <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
            {remainingCount}
          </span>
          <span className="flex-1" />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={format(m.reviewQueueFold)}
            onClick={onToggle}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="flex flex-col gap-px p-1.5">
            {rows.map((row) => {
              const current = row.instanceId === currentId
              return (
                <li key={row.instanceId}>
                  <button
                    type="button"
                    onClick={() => onOpen(row.instanceId)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors',
                      current
                        ? 'border-l-foreground bg-accent'
                        : 'border-l-transparent hover:bg-accent/50',
                    )}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-px">
                      <span className={cn('truncate text-sm', current && 'font-semibold')}>
                        {row.participantName}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {row.itemTitle}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {dayClock(row.submittedAt)}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </nav>
      {/* Folded, the rail is a handle and a number - nothing more. It used
          to keep a column of grey faces, which at 32px against a dark ring
          read like a wall of memorial portraits; who is waiting is the open
          list's answer, and folded only "how many" fits honestly. */}
      <div
        {...(open ? { inert: true, 'aria-hidden': true } : {})}
        className={cn(
          'absolute inset-y-0 left-0 flex w-11 flex-col items-center gap-1.5 py-2 transition-opacity duration-150',
          open && 'pointer-events-none opacity-0',
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={format(m.reviewQueueUnfold)}
          onClick={onToggle}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={format(m.reviewBackToQueue)}
          onClick={onBack}
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
        <span aria-hidden className="my-0.5 h-px w-5 bg-border" />
        <span className="rounded-full bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground tabular-nums">
          {remainingCount}
        </span>
      </div>
    </aside>
  )
})

const DECISION_LABEL: Record<SessionEntry['decision'], MessageDescriptor> = {
  approve: m.reviewApprove,
  reject: m.reviewReject,
  escalate: m.reviewEscalate,
  supplement: m.reviewSupplementAsked,
}

/**
 * Where the run stands: one segment per filing, filled behind the reader and
 * marked at the one they are on.
 *
 * It used to light only what was finished, so the segment for the filing on
 * screen stayed grey until it had been dealt with - the bar was always one
 * behind what the reader was looking at.
 */
function RunStrip({
  at,
  total,
  done,
  batchId,
}: {
  /** which filing of the run is on screen, counting from one */
  at: number
  total: number
  /** how many have been dealt with this sitting */
  done: number
  batchId: string
}) {
  const { format } = useI18n()
  const navigate = usePageNavigate()
  return (
    <div className="hidden shrink-0 items-center gap-3 border-b bg-muted/40 px-4 py-2 lg:flex">
      <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {format(m.reviewRunPosition, { at, count: total })}
      </p>
      <span className="flex min-w-0 flex-1 gap-1">
        {Array.from({ length: Math.min(total, 60) }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full transition-colors',
              index < done ? 'bg-foreground' : index === at - 1 ? 'bg-foreground/45' : 'bg-border',
            )}
          />
        ))}
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="shrink-0 text-xs text-muted-foreground"
        onClick={() => navigate('assessment/batch-reviews', { params: { batchId } })}
      >
        {format(m.reviewRunExit)}
      </Button>
    </div>
  )
}

/** who is being judged, and this round's standing at a glance */
function PersonStrip({
  review,
  at,
  of,
  canPrev,
  canNext,
  onMove,
  onBack,
}: {
  review: ReviewDto
  at: number | null
  of: number
  canPrev: boolean
  canNext: boolean
  onMove: (step: 1 | -1) => void
  /** the way out, where the queue rail is not there to hold one */
  onBack: () => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const round = review.context?.worth.groupName
  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b px-2 lg:gap-2.5 lg:px-4">
      {/* The door back, for every width where the queue rail is not beside:
          a small key, the way the rail's own header key is small, because
          the person being judged owns this bar. On a phone the system back
          key is the reader's other way out. */}
      <Button
        variant="outline"
        size="sm"
        data-testid="queue-key"
        className="h-8 shrink-0 gap-1 px-2 text-xs min-[84rem]:hidden"
        onClick={onBack}
      >
        <ChevronLeftIcon aria-hidden className="size-3.5" />
        {format(m.reviewQueueKey)}
        <span className="text-muted-foreground tabular-nums max-lg:hidden">{of}</span>
      </Button>
      <Avatar className="size-8 lg:size-9">
        <AvatarFallback className="text-sm font-semibold">
          {review.participantName.slice(0, 1)}
        </AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-px">
        <div className="flex items-baseline gap-2 lg:gap-2.5">
          <h2 className="text-[15px] font-semibold whitespace-nowrap lg:text-base">
            {review.participantName}
          </h2>
          {review.businessNo !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">{review.businessNo}</span>
          )}
          {review.unitName !== null && (
            <span className="hidden min-w-0 truncate text-xs text-muted-foreground lg:block">
              {review.unitName}
            </span>
          )}
        </div>
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {round !== null && round !== undefined
            ? `${round} › ${review.itemTitle}`
            : review.itemTitle}
        </p>
      </div>
      <span className="flex-1" />
      {review.chain.route === 'escalation' && (
        // at every width: the mode must survive the narrowest header. In the
        // theme's own ink rather than a borrowed hue - the workbench is
        // greyscale but for the two verdict colours, and a third colour on
        // it reads as something pasted on from another product
        <Badge
          variant="outline"
          data-testid="escalation-light"
          className="shrink-0 border-amber-300 bg-amber-50 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/50 dark:text-amber-200"
        >
          {/* the same mark the notice below carries: the filing climbed a
              level, and one glyph says it in both places */}
          <CircleArrowUpIcon aria-hidden />
          {format(m.reviewRouteEscalation)}
        </Badge>
      )}
      {/* this filing has been round the supplement loop before: worth knowing
          before reading it, and only the round itself can say so */}
      {review.supplements.length > 0 && (
        <Badge variant="outline" className="hidden shrink-0 whitespace-nowrap lg:inline-flex">
          <AlertCircleIcon aria-hidden />
          {format(m.reviewHadSupplements)}
        </Badge>
      )}
      {/* the keys hint belongs to a keyboard; without one the letters are
          not mounted and the panel would document controls that do not
          exist here */}
      {fine && (
        <span className="hidden shrink-0 text-xs font-medium whitespace-nowrap lg:inline">
          {format(m.reviewKeysHint)}
        </span>
      )}
      {at !== null && (
        <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {format(m.reviewRunPosition, { at, count: of })}
        </p>
      )}
      <span className="hidden gap-1 lg:flex">
        <EdgeButton
          can={canPrev}
          why={format(m.reviewFirstOne)}
          label="K"
          onPress={() => onMove(-1)}
        >
          <ChevronUpIcon aria-hidden />
        </EdgeButton>
        <EdgeButton can={canNext} why={format(m.reviewLastOne)} label="J" onPress={() => onMove(1)}>
          <ChevronDownIcon aria-hidden />
        </EdgeButton>
      </span>
    </header>
  )
}

/**
 * Where the reader is in a workbench that has become one page.
 *
 * Stacked, the three parts run one after another and nothing says which is
 * which once the headings have scrolled past. This names them, marks the one
 * being read, and scrolls to any of them - a position, not a set of tabs:
 * every part stays on the page, and the back key still leaves for the queue
 * rather than stepping between them.
 *
 * Beside each other there is nothing to say, so it folds to nothing rather
 * than disappearing: crossing the width is the strip closing over, not the
 * work below it jumping up.
 */
function PartStrip({
  scroller,
  round,
  revision,
  drillKey,
}: {
  scroller: HTMLElement | null
  /** which round this is, said on the flow chip */
  round: number
  /** which version is being read, said on the filing chip */
  revision: number
  /** a new filing starts at the top again, whatever the last one was on */
  drillKey: string
}) {
  const { format } = useI18n()
  const beside = useBeside()
  const [at, setAt] = useState<WorkbenchPart>('flow')
  // how far down it is, which is the only thing the way back has to know
  const [away, setAway] = useState(false)
  // While a press is travelling to its part, the spy would call every part
  // it passes the one being read and drag the mark backwards through them.
  // The press says where it is going; the spy is believed again once it
  // agrees, or once the reader takes over by scrolling somewhere else.
  const going = useRef<WorkbenchPart | null>(null)

  useEffect(() => {
    setAt('flow')
    setAway(false)
    going.current = null
  }, [drillKey])

  useEffect(() => {
    if (scroller === null || beside) return
    const spy = () => {
      setAway(scroller.scrollTop > 8)
      // the part under the strip: the last one whose top has passed it
      const edge = scroller.getBoundingClientRect().top + PART_EDGE
      let reading: WorkbenchPart = 'flow'
      for (const node of scroller.querySelectorAll('[data-workbench-part]')) {
        if (!(node instanceof HTMLElement)) continue
        if (node.getBoundingClientRect().top - 1 > edge) break
        reading = (node.dataset['workbenchPart'] ?? 'flow') as WorkbenchPart
      }
      // The end of the scroll can never bring the last part to the edge, so
      // arriving at the bottom is the same answer as reaching it - but only
      // where there is a bottom to arrive at: a page short enough to fit
      // whole has not been read to its end by merely opening it.
      const scrollable = scroller.scrollHeight - scroller.clientHeight > 8
      if (scrollable && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        const last = scroller.querySelectorAll('[data-workbench-part]')
        const tail = last[last.length - 1]
        if (tail instanceof HTMLElement) {
          reading = (tail.dataset['workbenchPart'] ?? reading) as WorkbenchPart
        }
      }
      if (going.current !== null && going.current !== reading) return
      going.current = null
      setAt(reading)
    }
    spy()
    scroller.addEventListener('scroll', spy, { passive: true })
    const watch = new ResizeObserver(spy)
    watch.observe(scroller)
    return () => {
      scroller.removeEventListener('scroll', spy)
      watch.disconnect()
    }
  }, [scroller, beside])

  // Where the mark stands, measured off the chip it marks. One persistent
  // element carried between chips: the layoutId handoff drew both chips
  // half-faded mid-flight, which over a white row read as a blink of white
  // at the place the mark had just left.
  const row = useRef<HTMLDivElement | null>(null)
  const [mark, setMark] = useState<{ left: number; width: number } | null>(null)
  useEffect(() => {
    const strip = row.current
    if (strip === null || beside) return
    const place = () => {
      const chip = strip.querySelector<HTMLElement>(`[data-part="${at}"]`)
      if (chip !== null) setMark({ left: chip.offsetLeft, width: chip.offsetWidth })
    }
    place()
    const watch = new ResizeObserver(place)
    watch.observe(strip)
    return () => watch.disconnect()
  }, [at, beside])

  const goTo = (part: WorkbenchPart) => {
    const node = scroller?.querySelector(`[data-workbench-part="${part}"]`)
    if (!(node instanceof HTMLElement) || scroller === null) return
    going.current = part
    setAt(part)
    // arithmetic rather than scrollIntoView, which walks up the tree and
    // takes the shell's own scroller with it
    const top =
      scroller.scrollTop + node.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTo({
      top: Math.max(0, top - (part === 'flow' ? 0 : PART_EDGE - 4)),
      behavior: 'smooth',
    })
  }

  return (
    <div
      // folded rather than removed, the way the shell folds its own bars
      className={cn(
        'shrink-0 overflow-hidden border-b transition-[height] duration-200 ease-linear',
        beside ? 'h-0 border-b-0' : 'h-9',
      )}
      {...(beside ? { inert: true, 'aria-hidden': true } : {})}
    >
      <div ref={row} className="relative flex h-9 items-center gap-0.5 px-2">
        {mark !== null && (
          <GlideAcross
            left={mark.left}
            width={mark.width}
            className="top-[5px] h-[26px] rounded-md bg-muted"
          />
        )}
        {WORKBENCH_PARTS.map((part) => (
          <button
            key={part}
            type="button"
            data-testid="workbench-anchor"
            data-part={part}
            data-reading={part === at ? 'yes' : 'no'}
            onClick={() => goTo(part)}
            className={cn(
              'relative flex h-[26px] shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap transition-colors',
              part === at ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            <span className="relative flex items-baseline gap-1.5">
              {format(PART_LABEL[part])}
              {/* the chip that is up says where in the thing it is: the
                  round for the flow, the version for the filing */}
              {part === at && part === 'flow' && (
                <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                  {format(m.reviewStateRound, { round })}
                </span>
              )}
              {part === at && part === 'filing' && (
                <span className="text-[11px] font-normal text-muted-foreground tabular-nums">
                  {format(m.reviewFiledVersionShort, { no: revision })}
                </span>
              )}
            </span>
          </button>
        ))}
        <span className="flex-1" />
        <Appear show={away}>
          <button
            type="button"
            onClick={() => scroller?.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex h-[26px] shrink-0 items-center gap-1 px-2 text-[11px] whitespace-nowrap text-muted-foreground"
          >
            <ChevronUpIcon aria-hidden className="size-3" />
            {format(m.reviewBackToTop)}
          </button>
        </Appear>
      </div>
    </div>
  )
}

/** the line a part has to reach before it counts as the one being read */
const PART_EDGE = 44

/**
 * A pager that stays where it is at the edge: disabled with the reason on
 * hover, because a vanished control reads as a broken screen. The disabled
 * button swallows pointer events, so the tooltip hangs on the span around it.
 */
function EdgeButton({
  can,
  why,
  label,
  onPress,
  children,
}: {
  can: boolean
  why: string
  label: string
  onPress: () => void
  children: ReactNode
}) {
  if (can) {
    return (
      <Button variant="outline" size="icon-sm" onClick={onPress}>
        {children}
        <span className="sr-only">{label}</span>
      </Button>
    )
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0}>
            <Button variant="outline" size="icon-sm" disabled className="pointer-events-none">
              {children}
              <span className="sr-only">{label}</span>
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

/** the reading order: what was said, what was filed, what backs it up */
/**
 * How the filing got here and what has been said about it.
 *
 * Its own column beside the filing rather than a section above it: reading
 * the second meant scrolling past the first, and a reviewer checking a
 * resubmission against what was asked of it last time needs both at once.
 * This one is short enough to fit a screen; the filing beside it is what
 * scrolls.
 */

/**
 * One workbench pane. Side by side it scrolls behind an overlay scrollbar
 * (the native track sat as a grey band between the columns); stacked it is
 * a section of the page and the page scrolls. ScrollArea's viewport always
 * clips, so the stacked case renders no ScrollArea at all rather than a
 * pane that swallows its own height. The root stays `relative` either way -
 * an absolutely positioned descendant must belong to its pane, or it
 * stretches the shell's scroll area from wherever it happens to sit.
 */
function Pane({
  as: As,
  part,
  className,
  inner,
  children,
}: {
  as: 'main' | 'section' | 'aside'
  /** which part of the workbench this is, for the strip that anchors to it */
  part: WorkbenchPart
  /** the pane frame: width, borders */
  className?: string
  /** the content column: padding and gap */
  inner: string
  children: ReactNode
}) {
  const beside = useBeside()
  return (
    <As
      data-workbench-part={part}
      className={cn(
        'relative flex min-w-0 flex-col lg:min-h-0',
        // stacked, the strip above stands over the top of whatever it
        // anchored to, so each part starts below the strip's own height
        'scroll-mt-9 lg:scroll-mt-0',
        className,
      )}
    >
      {beside ? (
        <ScrollArea className="min-h-0 flex-1">
          <div className={cn('flex flex-col', inner)}>{children}</div>
        </ScrollArea>
      ) : (
        <div className={cn('flex flex-col', inner)}>{children}</div>
      )}
    </As>
  )
}

/** whether the columns stand beside each other: the same line css draws at */
function useBeside(): boolean {
  return useMedia('(min-width: 64rem)', true)
}

const FlowColumn = memo(function FlowColumn({
  review,
  onTrail,
}: {
  review: ReviewDto
  onTrail: () => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  const previous = review.context?.previous ?? null
  const earlier = review.context?.earlier ?? []
  // A withdrawal is not a refusal: nobody judged anything, and dressing it
  // in the refusal card's words would invent a verdict that never happened.
  // Nor is a policy re-route - the round ended without a word on the
  // merits, and the card says that instead of borrowing a verdict.
  const withdrawn = previous?.kind === 'cancelled-by-submitter'
  const rerouted = previous?.kind === 'rerouted'
  // an appeal round carries its grounds in its own opening event, and the
  // grounds are the one thing this judge must read first
  const appealed = review.events.find((event) => event.kind === 'appealed')
  const spoken =
    previous === null ? null : reviewEventMessage(previous.kind, previous.actorName !== null)
  const said =
    spoken === null || previous === null
      ? ''
      : format(
          spoken.message,
          spoken.needsActor ? { who: previous.actorName ?? format(m.eventSomebody) } : {},
        )
  return (
    <Pane as="section" part="flow" inner="gap-4 p-5">
      <section className="flex flex-col gap-3">
        {/* Only beside the other columns. Stacked, the anchor strip already
            says which part this is and which round it is on, and a second
            heading under it read as a third voice saying the same thing. */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-b pb-2 max-lg:hidden">
          <h3 className="shrink-0 text-sm font-semibold whitespace-nowrap">
            {format(m.reviewPrior)}
          </h3>
          <Badge variant="secondary" className="shrink-0">
            {format(m.reviewStateRound, { round: review.roundNo })}
          </Badge>
          <span className="flex-1" />
          {/* What this round says is only the last part of the story, and the
              rest of it decides how to read this part. The key alone was not
              a way in: nobody finds H without being told. */}
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-xs whitespace-nowrap"
            onClick={onTrail}
          >
            {format(m.reviewTrailFullOpen)}
            {fine && <Kbd>H</Kbd>}
          </Button>
        </div>
        {/* The notice the reviewer must not scroll past: under the flow
            title, above the previous round's word. A tinted card with a
            hairline edge rather than a slab of ink - amber because the two
            colours already spoken here are the verdicts, approval and
            refusal, and this is neither: it is the round asking to be read
            more closely. The badge in the header wears the same colour, so
            the two are recognizably one fact. */}
        {review.chain.route === 'escalation' && review.state !== 'completed' && (
          <div
            data-testid="escalation-card"
            className="flex min-w-0 items-start gap-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3.5 dark:border-amber-900/50 dark:bg-amber-950/25"
          >
            <CircleArrowUpIcon
              aria-hidden
              className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            />
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-sm font-medium tracking-tight text-amber-950 dark:text-amber-100">
                {format(
                  appealed !== undefined ? m.reviewAppealBannerTitle : m.reviewEscBannerTitle,
                )}
              </p>
              {/* the appellant's grounds are business evidence, not chrome:
                shown in their own words wherever they exist */}
              {appealed !== undefined && appealed.comment !== null ? (
                <p className="text-sm leading-relaxed text-pretty text-amber-950 dark:text-amber-100">
                  {appealed.comment}
                </p>
              ) : (
                <p className="text-[13px] leading-relaxed text-amber-900/80 dark:text-amber-200/70">
                  {format(m.reviewEscBannerBody)}
                </p>
              )}
            </div>
          </div>
        )}
        {previous !== null && (
          <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3.5">
            {/* Wrap, never squeeze - and by the column's own width, not the
                window's: pinning the badge and the time to the title's line
                left the title min-content wide in a narrow column, which
                set a long sentence one character per line. The title keeps
                at least its basis and the datum pair drops below when the
                line cannot hold all three. */}
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <p className="min-w-0 flex-1 basis-44 text-sm font-semibold text-pretty">
                {format(
                  withdrawn
                    ? m.reviewPreviousWithdrawn
                    : rerouted
                      ? m.reviewPreviousRerouted
                      : previous.kind === 'approved'
                        ? m.reviewPreviousApproved
                        : m.reviewPreviousTitle,
                )}
              </p>
              <span className="flex shrink-0 items-baseline gap-2">
                <Badge variant="secondary" className="bg-background">
                  {format(m.reviewStateRound, { round: previous.roundNo })}
                </Badge>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {timeLabel(previous.at)}
                </span>
              </span>
            </div>
            {/* One line, and the name gives way first. A reviewer's full
                title runs long, and left to wrap it pushed the reason onto a
                third line and the card into the space the comment needed;
                the reason is the shorter and the more useful of the two, so
                it keeps its width and the name ellipses. Both carry their
                full text as a tooltip. */}
            {/* the verdict chips only where a verdict exists: the withdrawn
                and re-routed cards' titles already say the whole of it */}
            {!withdrawn && !rerouted && (
              <div className="flex min-w-0 items-center gap-2">
                {/* what was done, in the colour of what it was: a refusal read
                    in the same ink as a note is one a tired reader scrolls past */}
                <Badge
                  variant="outline"
                  title={said}
                  className="min-w-0 bg-background text-destructive"
                >
                  <span className="truncate">{said}</span>
                </Badge>
                {previous.reason !== null && (
                  <Badge
                    variant="outline"
                    title={previous.reason}
                    className="min-w-0 max-w-[55%] shrink bg-background"
                  >
                    <span className="truncate">{previous.reason}</span>
                  </Badge>
                )}
              </div>
            )}
            {previous.comment !== null && (
              <p className="border-l-2 border-muted-foreground/30 pl-3 text-sm leading-relaxed">
                {previous.comment}
              </p>
            )}
            {/* the rounds before that, a line each: whether the same thing
                has been asked for three times is not answerable from the
                latest round alone */}
            {earlier.length > 0 && (
              <div className="flex flex-col gap-1 border-t pt-2">
                <div className="flex items-baseline gap-2">
                  <p className="text-xs font-semibold text-muted-foreground">
                    {format(m.reviewEarlierRounds)}
                  </p>
                  <span className="flex-1" />
                  <p className="text-xs text-muted-foreground">
                    {format(m.reviewEarlierCount, { count: earlier.length })}
                  </p>
                </div>
                {/* Round, grounds, time - never who. This list answers
                    "where has this been getting stuck", and the grounds
                    answer that directly; a name only matters when tracing
                    responsibility, which is the full trail's job. A
                    withdrawal has no grounds to show and must not be
                    dressed in one: nobody ruled, so the line goes grey and
                    says exactly what happened. */}
                {earlier.map((one, index) => {
                  const took = one.kind === 'cancelled-by-submitter'
                  const grounds = took
                    ? format(m.reviewEarlierWithdrawn)
                    : (one.reason ?? format(m.reviewEarlierReturned))
                  return (
                    // Wrap by the column's own width, never squeeze: the
                    // grounds are the row's point and keep a floor of their
                    // own; when the line cannot also hold the clock, the
                    // clock drops to its own line instead of erasing the
                    // grounds or running out of the card.
                    <span
                      key={index}
                      data-testid="earlier-row"
                      className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                    >
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {format(m.reviewStateRound, { round: one.roundNo })}
                      </span>
                      <span
                        title={grounds}
                        className={cn(
                          'min-w-0 flex-1 basis-36 truncate',
                          took && 'text-muted-foreground',
                        )}
                      >
                        {grounds}
                      </span>
                      <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                        {timeLabel(one.at)}
                      </span>
                    </span>
                  )
                })}
              </div>
            )}
            {!withdrawn && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {format(m.reviewPreviousHint)}
              </p>
            )}
          </div>
        )}
        {/* What has happened since this round opened, told apart from the
            history above it: the card is why it came back, these are what
            has been said about the answer to that. The rule draws only
            where there IS history - a first round has nothing to be told
            apart from, and the pane's own header already drew a line. */}
        <div
          className={cn(
            'flex items-baseline gap-2 max-lg:hidden',
            previous !== null && 'border-t pt-2',
          )}
        >
          <p className="text-xs font-semibold text-muted-foreground">{format(m.reviewThisRound)}</p>
          <span className="flex-1" />
          {review.state !== 'completed' && review.capabilities.canDecide && (
            <p className="text-xs text-muted-foreground">{format(m.reviewAwaitingYou)}</p>
          )}
        </div>
        {review.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          // A timeline, not a numbered list: dots on one thread, the last
          // solid because it is where the round stands now. The two lines of
          // an event are told apart by weight and colour - the name of what
          // happened in ink, the words said about it in grey - so the quote
          // bar the comment used to carry has nothing left to add.
          <ol className="flex flex-col">
            {review.events.map((event, index) => {
              const said = reviewEventMessage(event.kind, event.actorName !== null)
              // the submission names the version it carried in - the round
              // judges exactly one, and the trail should say which
              const title =
                event.kind === 'submitted'
                  ? format(m.entryTrailSubmittedBy, {
                      who: event.actorName ?? format(m.eventSomebody),
                      no: review.revision.revisionNo,
                    })
                  : format(
                      said.message,
                      said.needsActor ? { who: event.actorName ?? format(m.eventSomebody) } : {},
                    )
              const last = index === review.events.length - 1
              return (
                <li key={index} className="flex gap-2.5 pb-3 last:pb-0">
                  <span className="relative flex w-4 shrink-0 justify-center">
                    {!last && (
                      <span aria-hidden className="absolute top-3.5 bottom-0 w-px bg-border" />
                    )}
                    <span
                      aria-hidden
                      className={cn(
                        'mt-1.5 size-2 shrink-0 rounded-full',
                        last ? 'bg-foreground' : 'bg-muted-foreground/45',
                      )}
                    />
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="text-sm font-medium">{title}</p>
                      {event.reason !== null && <Badge variant="outline">{event.reason}</Badge>}
                      <span className="flex-1" />
                      <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {timeLabel(event.at)}
                      </p>
                    </div>
                    {event.comment !== null && (
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {event.comment}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        {/* the stacked page's way into the whole story, sitting where the
            story just ended; beside the columns the heading row carries it */}
        <button
          type="button"
          onClick={onTrail}
          className="flex items-center gap-1 self-start pl-[26px] text-xs text-muted-foreground lg:hidden"
        >
          {format(m.reviewTrailFullOpen)}
          {earlier.length > 0 && (
            <span className="tabular-nums">
              {format(m.reviewEarlierCount, { count: earlier.length })}
            </span>
          )}
          <ChevronRightIcon aria-hidden className="size-3" />
        </button>
      </section>
    </Pane>
  )
})

/**
 * What was actually filed, in the order it was asked for.
 *
 * The wider of the two middle columns, and the only one meant to scroll: a
 * filing is worked down item by item, and everything else on the screen is
 * there to be glanced at while doing it.
 */
const FilingColumn = memo(function FilingColumn({
  review,
  comparing,
  onCompare,
  onVersions,
}: {
  review: ReviewDto
  /** an earlier revision id, 'previous' for the one just before, or null */
  comparing: string | null
  onCompare: (next: string | null) => void
  onVersions: () => void
}) {
  const { format } = useI18n()
  const fine = useFinePointer()
  // every field the question asks, files included and in their own places:
  // a field that asks for a certificate is not "materials", it is the
  // certificate, and folding it away left the reading order with a hole
  const fields = fieldsOf(review.form.formConfig)
  const record = (review.revision.payload ?? {}) as Record<string, unknown>
  // The version being read against. The default - the one just before this -
  // travels with the review itself, so the page's first paint already holds
  // the comparison it opens with; only a version picked by hand comes from
  // the entry's history, and the picker has that cached before anything can
  // be picked. What cannot load together would have to flash in, and this
  // screen opens comparing.
  const shipped = review.context?.previousRevision ?? null
  const wantsHistory = comparing !== null && comparing !== 'previous'
  const history = useEntryHistory(review.entryId, wantsHistory)
  // Keyed so a late fetch never performs an entrance: a fresh mount shows
  // its settled state, and only the user's own toggles animate.
  const arrived = !wantsHistory || !history.isPending
  const revisions = ((history.data as { revisions?: readonly HistoryRevision[] } | undefined)
    ?.revisions ?? []) as readonly HistoryRevision[]
  const earlier = revisions.filter((one) => one.revisionNo < review.revision.revisionNo)
  const against =
    comparing === null
      ? null
      : comparing === 'previous'
        ? shipped
        : (earlier.find((one) => one.id === comparing) ?? null)
  const was = new Map<string, { value: string; ids: readonly string[] }>(
    against === null
      ? []
      : valuesOf(against.formConfig, against.payload).map((v) => [v.key, v] as const),
  )
  const lingeringAgainst = useLingering(against)
  const changes =
    against === null
      ? 0
      : fields.filter((field) => (was.get(field.key)?.value ?? '') !== valueOf(record[field.key]))
          .length
  // The materials, numbered once across the whole filing in the order the
  // questions ask for them - the same numbers the 1-9 keys open. A file
  // taken out this version has no number: it is not one of the things to
  // look at, it is a record of what used to be.
  const slots = new Map(
    fields
      .filter((field) => field.type === 'attachment')
      .flatMap((field) => idsOf(record[field.key]))
      .map((attachmentId, index) => [attachmentId, index + 1]),
  )
  return (
    <Pane as="main" part="filing" className="lg:border-l" inner="gap-4 p-5">
      <section className="flex min-h-0 flex-1 flex-col gap-3.5">
        <div className="flex flex-col border-b pb-2 max-lg:border-b-0 max-lg:pb-0">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* stacked, the strip names the part; the version and the
                compare key are what is left to say */}
            <h3 className="text-sm font-semibold max-lg:hidden">{format(m.reviewPayloadTitle)}</h3>
            <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
              {format(m.reviewFiledVersion, {
                no: review.revision.revisionNo,
                at: timeLabel(review.submittedAt),
              })}
            </p>
            <span className="flex-1" />
            {review.revision.revisionNo > 1 && (
              <>
                <Button
                  variant={comparing === null ? 'outline' : 'secondary'}
                  size="sm"
                  className="text-xs"
                  onClick={() => onCompare(comparing === null ? 'previous' : null)}
                >
                  {format(comparing === null ? m.reviewCompareOn : m.reviewCompareOff)}
                  {fine && <Kbd>D</Kbd>}
                </Button>
                <Button variant="outline" size="sm" className="text-xs" onClick={onVersions}>
                  {format(m.reviewPickVersion)}
                  {fine && <Kbd>⇧D</Kbd>}
                </Button>
              </>
            )}
          </div>
          {/* It closes over rather than leaving a blank line behind: the
              row reserved its height so nothing would jump, which traded a
              jump for a permanent gap above the rule. Collapsing gives the
              space back on the way out, so neither happens. The version it
              was reading against lingers through the exit - the sentence has
              to stay whole while it is leaving. */}
          <Appear key={String(arrived)} show={against !== null} collapse>
            <p className="pt-1.5 text-xs text-muted-foreground">
              {format(m.reviewCompareCount, {
                count: changes,
                no: lingeringAgainst?.revisionNo ?? 0,
              })}
            </p>
          </Appear>
        </div>
        <dl className="flex flex-col">
          {fields.map((field) => {
            const now = valueOf(record[field.key])
            const previous = was.get(field.key)
            const before = previous?.value ?? ''
            const changed = against !== null && before !== now
            const cited = field.type === 'attachment' ? idsOf(record[field.key]) : []
            // only while comparing: without a version to read against, a file
            // that is not here now was simply never here
            const gone =
              field.type === 'attachment'
                ? (previous?.ids ?? []).filter((one) => !cited.includes(one))
                : []
            return (
              // Stacked, and flush with the heading above: this column is
              // 1.18fr of what is left after the queue and the two rails, and
              // a fixed label gutter there costs more width than the
              // alignment buys - a long field name wrapped to three lines
              // against a one-line answer.
              <div key={field.key} className="flex flex-col gap-1.5 pb-5">
                {/* A field's name is what identifies its row, so a long one
                    wraps rather than being cut or shoved into the answer
                    beside it: "参加校级以上竞赛并获奖" truncated to its first
                    few characters names nothing. The count of files sits
                    under the name, in the same column. */}
                <dt className="flex min-w-0 items-baseline gap-2.5 text-sm text-muted-foreground">
                  <span className="min-w-0 [overflow-wrap:anywhere]">{field.label}</span>
                  {field.type === 'attachment' && cited.length > 0 && (
                    <span className="shrink-0 text-xs tabular-nums">
                      {format(m.reviewFilesCount, { count: cited.length })}
                    </span>
                  )}
                </dt>
                <dd className="flex min-w-0 flex-col text-base">
                  {field.type === 'attachment' ? (
                    cited.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      // the files themselves, under the field that asked for
                      // them: one flat "materials" heap at the end of the page
                      // could not say which of them was the certificate
                      <span className="flex flex-wrap gap-2">
                        {cited.map((attachmentId) => (
                          <AttachmentLink
                            key={attachmentId}
                            attachmentId={attachmentId}
                            variant="card"
                            slot={slots.get(attachmentId)}
                            mark={
                              previous !== undefined && !previous.ids.includes(attachmentId)
                                ? 'added'
                                : undefined
                            }
                          />
                        ))}
                      </span>
                    )
                  ) : (
                    <span className={cn('leading-relaxed', changed && 'font-medium')}>
                      {now === '' ? '—' : now}
                    </span>
                  )}
                  {/* What the last version had here, under what this one
                      has - the same grey line for a sentence that was
                      rewritten and for a file that was taken out. The file
                      is named and nothing more: drawn as a card among the
                      cards it would read as one of the materials on offer,
                      which is the opposite of what it is. */}
                  {field.type === 'attachment' ? (
                    <Appear key={String(arrived)} show={gone.length > 0} collapse>
                      {/* Further from the cards than they stand from each
                          other, nearer than the next field: it belongs to
                          this question, and a row of tiles is a heavy enough
                          block that a hairline gap under it reads as part of
                          the row. */}
                      <span className="flex min-w-0 flex-col gap-1 pt-3 text-xs text-muted-foreground">
                        <span className="self-start rounded bg-muted px-1.5 py-0.5">
                          {format(m.reviewFileGone)}
                        </span>
                        {gone.map((attachmentId) => (
                          // struck through, or a reviewer scanning the column
                          // reads it as one more file that is there
                          <span key={attachmentId} className="min-w-0 line-through">
                            <AttachmentLink attachmentId={attachmentId} variant="line" />
                          </span>
                        ))}
                      </span>
                    </Appear>
                  ) : (
                    <Appear key={String(arrived)} show={changed} collapse>
                      <span className="flex items-baseline gap-2 pt-1.5 text-xs text-muted-foreground">
                        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5">
                          {format(m.reviewComparePrevious)}
                        </span>
                        {before === '' ? (
                          <span>{format(m.reviewCompareBlank)}</span>
                        ) : (
                          <span className="min-w-0 line-through">{before}</span>
                        )}
                      </span>
                    </Appear>
                  )}
                </dd>
              </div>
            )
          })}
          {review.revision.note !== null && (
            <div className="flex flex-col gap-1.5 pb-5">
              <dt className="text-sm text-muted-foreground">{format(m.entryNote)}</dt>
              <dd className="min-w-0 text-base leading-relaxed">{review.revision.note}</dd>
            </div>
          )}
        </dl>
        {/* What the machine noticed, pinned under the filing it read: the
            checks are about these fields, and the reader meets them after
            the evidence rather than as a banner over it. Sticky beside the
            columns so it stays in reach while a long filing scrolls; in the
            stacked page it is simply the section's last word. The caveat is
            part of the block: a machine's note without its error bar reads
            as a verdict. */}
        <aside className="order-last mt-auto flex flex-col gap-1 border-t pt-2.5 lg:sticky lg:bottom-0 lg:-mx-5 lg:-mb-5 lg:bg-background lg:px-5 lg:pb-4">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="shrink-0 text-xs text-muted-foreground">{format(m.reviewInsight)}</p>
            <p className="min-w-0 truncate text-xs text-muted-foreground">
              {format(m.reviewInsightCaveat)}
            </p>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {format(m.reviewInsightSoon)}
          </p>
        </aside>
      </section>

      {/* What a reviewer asked for mid-round and what came back, after the
          filing and apart from it: these questions were written by whoever
          was reviewing at the time, so they are not the item's fields and
          must not read as though the filer answered them unprompted. */}
      {review.supplements.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 border-t pt-3">
            <p className="shrink-0 text-sm font-semibold">{format(m.reviewSupplementSection)}</p>
            <span className="flex-1" />
            <p className="text-xs text-muted-foreground">{format(m.reviewSupplementSectionNote)}</p>
          </div>
          {review.supplements.map((one) => (
            <SupplementCard key={one.id} supplement={one} />
          ))}
        </section>
      )}

      {/* the count and the way out, once, at the end of the filing: the
          materials are up there with the questions that asked for them */}
      {review.revision.attachments.length > 0 && (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 border-t pt-3">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
            {format(m.reviewFilesNote)}
          </p>
          <Button variant="outline" size="sm" className="text-xs" asChild>
            {/* one press per file, opened as downloads: a zip would be a
                server-side archive nobody asked for yet */}
            <button
              type="button"
              onClick={() => {
                for (const attachment of review.revision.attachments) {
                  window.open(attachmentContentUrl(attachment.attachmentId), '_blank')
                }
              }}
            >
              <DownloadIcon aria-hidden />
              {format(m.reviewDownloadAll)}
            </button>
          </Button>
        </div>
      )}
    </Pane>
  )
})

/** one ask and what came back, read like the filing above it */
function SupplementCard({ supplement }: { supplement: ReviewDto['supplements'][number] }) {
  const { format } = useI18n()
  const answers = (supplement.response?.payload ?? {}) as Record<string, unknown>
  return (
    <div className="flex flex-col gap-2.5 rounded-xl border p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">
          {format(m.supplementRequestHeading, { no: supplement.requestNo })}
        </p>
        <Badge variant={supplement.status === 'answered' ? 'default' : 'outline'}>
          {format(
            supplement.status === 'answered'
              ? m.supplementStatusAnswered
              : supplement.status === 'cancelled'
                ? m.supplementStatusCancelled
                : m.supplementStatusOpen,
          )}
        </Badge>
        <span className="flex-1" />
        <p className="text-xs text-muted-foreground tabular-nums">
          {timeLabel(supplement.requestedAt)}
        </p>
      </div>
      <p className="border-l-2 border-border pl-2.5 text-sm leading-relaxed">
        {supplement.instructions}
      </p>
      {supplement.response !== null && (
        <dl className="flex flex-col gap-3">
          {supplement.requirements.map((asked) => {
            const value = answers[asked.key]
            return (
              <div key={asked.key} className="flex flex-col gap-1.5">
                <dt className="min-w-0 text-sm [overflow-wrap:anywhere] text-muted-foreground">
                  {asked.label}
                </dt>
                <dd className="min-w-0 text-base leading-relaxed">
                  {asked.kind === 'file' ? (
                    Array.isArray(value) && value.length > 0 ? (
                      <span className="flex flex-wrap gap-2">
                        {value.map((attachmentId) => (
                          <AttachmentLink
                            key={String(attachmentId)}
                            attachmentId={String(attachmentId)}
                            variant="card"
                            mark="supplement"
                          />
                        ))}
                      </span>
                    ) : (
                      '—'
                    )
                  ) : typeof value === 'string' && value !== '' ? (
                    value
                  ) : (
                    '—'
                  )}
                </dd>
              </div>
            )
          })}
        </dl>
      )}
    </div>
  )
}

/** what stands beside the filing: the terms it is judged under */
const ContextRail = memo(function ContextRail({
  review,
  onOpenSibling,
}: {
  review: ReviewDto
  onOpenSibling: (entryId: string) => void
}) {
  return (
    <Pane
      as="aside"
      part="about"
      // stacked it is the page's closing reference block, washed a shade
      // down so the reading matter above it keeps the white
      className="max-lg:bg-muted/30 lg:border-l"
      inner="gap-4 p-4 lg:p-5"
    >
      <AboutParts review={review} onOpenSibling={onOpenSibling} />
    </Pane>
  )
})

/**
 * The terms this filing is judged under: what the clause says, whose hands
 * it passes through, what it is worth, and what else the same person filed
 * against the same question.
 *
 * Its own component because it is read in two shapes. Wide enough for three
 * columns it is the third; under that it is a layer the header pushes out,
 * and stacked it is the last section of the page. One rendering either way:
 * a reviewer comparing what they were told at two window widths must not be
 * comparing two different screens.
 */
function AboutParts({
  review,
  onOpenSibling,
}: {
  review: ReviewDto
  onOpenSibling: (entryId: string) => void
}) {
  const { format, locale } = useI18n()
  const fine = useFinePointer()
  const listed = useMemo(
    () => new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }),
    [locale],
  )
  const context = review.context
  // Blocks under hairlines rather than four bordered cards: at 19rem a card's
  // border and padding cost more width than they buy, and boxing every peer
  // makes four parts of one question read as four unrelated panels. The
  // clause keeps a filled card, because it is quoted matter rather than this
  // screen's own words.
  return (
    <>
      {/* the clause. Reserved, not written: nothing in the round carries the
          wording yet, so the block holds its place. */}
      <section className="flex shrink-0 flex-col gap-2 rounded-xl bg-muted/60 px-3 py-2.5">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {format(m.myEntriesBasis)}
        </p>
        <p className="text-sm leading-relaxed text-pretty text-muted-foreground">
          {format(m.myEntriesBasisSoon)}
        </p>
      </section>

      <section className="flex shrink-0 flex-col gap-2.5 border-t pt-4">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          {format(m.reviewChainTitle)}
        </p>
        <Route
          stages={review.chain.normal}
          here={review.chain.route === 'normal' ? review.chain.stageId : null}
          title={review.chain.escalation.length > 0 ? format(m.reviewRouteNormal) : null}
          listed={listed}
        />
        {review.chain.escalation.length > 0 && (
          <Route
            stages={review.chain.escalation}
            here={review.chain.route === 'escalation' ? review.chain.stageId : null}
            title={format(m.reviewRouteEscalation)}
            listed={listed}
          />
        )}
      </section>

      {context !== null && (
        <section className="flex shrink-0 flex-col gap-2.5 border-t pt-4">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {format(m.reviewAboutTitle)}
          </p>
          {context.worth.each !== null && (
            <AboutRow label={format(m.reviewAboutEach)} value={trimAmount(context.worth.each)} />
          )}
          {context.worth.maxEntries !== null && (
            <AboutRow label={format(m.reviewAboutMax)} value={String(context.worth.maxEntries)} />
          )}
          {context.worth.groupCap !== null && (
            <AboutRow
              // the group by name when there is one: "所属分组上限" makes a
              // reader work out which group, and the answer is on screen
              label={
                context.worth.groupName === null
                  ? format(m.reviewAboutGroupCap)
                  : format(m.reviewAboutGroupCapNamed, { group: context.worth.groupName })
              }
              value={trimAmount(context.worth.groupCap)}
            />
          )}
        </section>
      )}

      {context !== null && context.siblings.length > 0 && (
        <section className="flex shrink-0 flex-col gap-2.5 border-t pt-4">
          <div className="flex items-baseline gap-2">
            <p className="shrink-0 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              {format(m.reviewSiblingsTitle)}
            </p>
            <span className="flex-1" />
            {/* the keys, once, over the list they open - rather than the
                count, which the list itself already shows */}
            {fine && (
              <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                {format(m.reviewSiblingsKeys, {
                  count: Math.min(context.siblings.length, 9),
                })}
              </span>
            )}
          </div>
          <ul className="flex flex-col gap-0.5">
            {context.siblings.map((sibling, index) => (
              <li key={sibling.entryId}>
                {/* every claim opens: reading one against another is how a
                    duplicate is caught, and the aside is where they meet */}
                <button
                  type="button"
                  onClick={() => onOpenSibling(sibling.entryId)}
                  className="-mx-1.5 flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors hover:bg-accent/60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      sibling.current
                        ? 'bg-foreground'
                        : sibling.status === 'rejected' || sibling.status === 'needs_revision'
                          ? 'bg-destructive'
                          : 'bg-muted-foreground/40',
                    )}
                  />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate',
                      sibling.current ? 'font-medium' : 'text-muted-foreground',
                    )}
                  >
                    {sibling.current && (
                      <span className="pr-1.5 text-muted-foreground">
                        {format(m.reviewSiblingThis)}
                      </span>
                    )}
                    {summaryOf(sibling.values) === ''
                      ? review.itemTitle
                      : summaryOf(sibling.values)}
                  </span>
                  <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                    {format(
                      entryStatusMessage[sibling.status as EntryDto['status']] ?? m.eventOther,
                    )}
                  </span>
                  {fine && index < 9 && <Kbd className="shrink-0">{`⌥${index + 1}`}</Kbd>}
                </button>
              </li>
            ))}
          </ul>
          {context.worth.maxEntries !== null &&
            context.siblings.length >= context.worth.maxEntries && (
              <p className="text-xs leading-relaxed text-muted-foreground">
                {format(m.reviewSiblingsFull)}
              </p>
            )}
        </section>
      )}
    </>
  )
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    // A leader rules the gap so the eye carries from a short name to a value
    // three rows down, which is what a column of unequal names needs. It
    // wraps rather than squeezing the name: a truncated "材料时间范围" names
    // nothing, and the range is long enough to want the width.
    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">{label}</span>
      <span aria-hidden className="h-px min-w-0 flex-1 bg-border" />
      <span className="ml-auto shrink-0 tabular-nums">{value}</span>
    </div>
  )
}

/** one route, in order, with the step this round is standing at marked */
function Route({
  title,
  stages,
  here,
  listed,
}: {
  /** named only when there are two routes to tell apart */
  title: string | null
  stages: ReviewDto['chain']['normal']
  here: string | null
  listed: Intl.ListFormat
}) {
  const { format } = useI18n()
  const at = stages.findIndex((stage) => stage.id === here)
  return (
    <div className="flex flex-col gap-1.5">
      {/* the route's name is part of the map, not another caption: the
          caption above says what the block is, this says which road */}
      {title !== null && <p className="text-sm font-medium">{title}</p>}
      <ol className="flex flex-col gap-1.5">
        {stages.map((stage, index) => {
          const current = stage.id === here
          // behind the step this round stands at, so it has been through
          const passed = at !== -1 && index < at
          return (
            <li key={stage.id} className="flex items-start gap-2">
              <span
                className={cn(
                  'mt-px flex size-5 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums',
                  current
                    ? 'border-foreground bg-foreground text-background'
                    : passed
                      ? 'border-transparent bg-muted text-foreground'
                      : 'border-border text-muted-foreground',
                )}
              >
                {index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex min-w-0 items-baseline gap-2">
                  {/* the administrator's name for the step where one exists;
                      the unit-and-roles composite only as the fallback */}
                  <span className={cn('min-w-0 truncate text-sm', current && 'font-medium')}>
                    {stage.nodeName === null
                      ? format(
                          stage.skipped === 'no-holder'
                            ? m.reviewStageNoHolder
                            : m.reviewStageSkipped,
                        )
                      : (stage.label ?? `${stage.nodeName}／${listed.format(stage.roleNames)}`)}
                  </span>
                  <span className="flex-1" />
                  {/* what happened at this step, where the eye already is:
                      a step with nothing beside it is one still ahead */}
                  {(current || passed) && (
                    <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
                      {format(
                        current
                          ? m.reviewStageHere
                          : stage.skipped === 'reviewer-conflict'
                            ? m.reviewStageStepped
                            : m.reviewStagePassed,
                      )}
                    </span>
                  )}
                </div>
                {stage.nodeName !== null && stage.reviewers !== null && (
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {stage.reviewers.length === 0
                      ? format(m.reviewStageNobody)
                      : format(m.reviewStageReviewers, { who: listed.format(stage.reviewers) })}
                  </span>
                )}
                {/* what the concluded sitting here said, name by name: the
                    evidence the judge after it reads */}
                {stage.opinions !== null && stage.opinions.length > 0 && (
                  <div
                    data-testid="stage-opinions"
                    data-stage={stage.id}
                    className="mt-1.5 flex flex-col gap-1.5 rounded-lg bg-muted/50 p-2.5"
                  >
                    {stage.opinions.map((opinion, said) => (
                      <div key={said} className="flex min-w-0 flex-col gap-0.5">
                        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 text-xs">
                          <span className="font-medium">
                            {opinion.who ?? format(m.eventSomebody)}
                          </span>
                          <span
                            data-opinion={opinion.decision}
                            className={
                              opinion.decision === 'approve'
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }
                          >
                            {format(
                              opinion.decision === 'approve'
                                ? m.reviewOpinionApprove
                                : m.reviewOpinionReject,
                            )}
                          </span>
                          {opinion.reason !== null && (
                            <span className="min-w-0 truncate text-muted-foreground">
                              {opinion.reason}
                            </span>
                          )}
                        </div>
                        {opinion.comment !== null && (
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {opinion.comment}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** a button that says what it does before it is pressed */
function Explained({ why, children }: { why: string; children: ReactNode }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent>{why}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
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
    <footer className="flex shrink-0 flex-col gap-2 border-t px-3 py-2.5 pb-[max(0.625rem,env(safe-area-inset-bottom))] lg:px-4 lg:py-3">
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
      <div className="flex flex-wrap items-center gap-2 max-sm:gap-1.5">
        <ActionKey
          act="escalate"
          offer={review.actions.escalate}
          label={format(m.reviewEscalate)}
          kbd="E"
          why={format(onLadder ? m.reviewTipEscalateMid : m.reviewTipEscalate)}
          className="max-sm:flex-none"
          onPress={() => onDialog('escalate')}
        />
        <ActionKey
          act="supplement"
          offer={review.actions.supplement}
          label={format(m.reviewSupplementAsk)}
          kbd="S"
          why={format(m.reviewTipSupplement)}
          className="max-sm:flex-none"
          onPress={() => onDialog('supplement')}
        />
        <span aria-hidden className="flex-1 max-sm:h-0 max-sm:basis-full" />
        <ActionKey
          act="reject"
          offer={review.actions.reject}
          label={format(m.reviewReject)}
          kbd="R"
          why={format(onLadder && !lastStep ? m.reviewTipRejectMid : m.reviewTipReject)}
          className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 max-sm:min-w-0 max-sm:flex-1 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
          kbdClassName="bg-rose-500/10 text-rose-700 dark:text-rose-300"
          onPress={() => onDialog('reject')}
        />
        <ActionKey
          act="approve"
          offer={review.actions.approve}
          label={format(m.reviewApprove)}
          kbd="A"
          // an ordinary middle step's approval hands the round on; the
          // ladder's every step and the ordinary route's last one settle it
          why={format(onLadder || lastStep ? m.reviewTipApprove : m.reviewTipApproveMid)}
          className="border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 max-sm:min-w-0 max-sm:flex-1 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70"
          kbdClassName="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
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
  className,
  kbdClassName,
  onPress,
}: {
  act: 'approve' | 'reject' | 'escalate' | 'supplement'
  offer: ReviewDto['actions']['approve']
  label: string
  kbd: string
  /** what the act will do, told on hover while it is offered */
  why: string
  className?: string
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
      aria-disabled={blocked || undefined}
      className={cn(
        !fine && TOUCH_KEY,
        className,
        blocked && 'pointer-events-auto opacity-45 hover:bg-transparent active:translate-y-0',
      )}
      onClick={() => {
        if (!blocked) {
          onPress()
          return
        }
        // no hover under a thumb: the press itself asks "why not"
        if (!fine) toast.info(because)
      }}
    >
      {label}
      {fine && <Kbd className={kbdClassName}>{kbd}</Kbd>}
    </Button>
  )
  if (!fine) return key
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* a span, because a key that ignores the pointer cannot answer
              the hover that asks about it; it inherits the key's growth so
              wrapping for the tooltip never changes the row */}
          <span
            className={cn(
              'inline-flex',
              className?.includes('flex-1') && 'max-sm:min-w-0 max-sm:flex-1',
            )}
          >
            {key}
          </span>
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

/**
 * How the decision keys sit under a thumb: taller, sharing the row's full
 * width, and squared off from the buttons' own pill - at 13px in a 44px
 * capsule the words rattled around in the middle of their key. The shape
 * follows the pointer, never the window: a width rule here meant a desktop
 * window dragged narrower watched the keys grow mid-drag.
 *
 * `flex-auto`, not `flex-1`: the spare width is shared equally but every
 * key keeps at least its own words - an even split gave five keys of a
 * 390px row about 66px each, and 要求补充材料 does not fit in 66px.
 */
const TOUCH_KEY = 'h-11 rounded-xl px-3 text-[13px]'

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
            <span className="text-xs font-normal text-muted-foreground">
              {sibling === null
                ? ''
                : format(entryStatusMessage[sibling.status as EntryDto['status']] ?? m.eventOther)}
            </span>
          </DialogTitle>
        </DialogHeader>
        <dl className="flex flex-col gap-3">
          {(sibling?.values ?? []).map((pair) => (
            <div key={pair.label} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
              <dt className="text-sm whitespace-nowrap text-muted-foreground">{pair.label}</dt>
              <dd className="min-w-0 text-sm">{pair.value === '' ? '—' : pair.value}</dd>
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
      className="flex items-center gap-3 rounded-xl border bg-background px-3.5 py-2.5 shadow-lg"
    >
      <CountdownRing seconds={5} remaining={started.current}>
        {left}
      </CountdownRing>
      <p className="flex items-baseline gap-2 text-sm whitespace-nowrap">
        <span className="font-semibold">{staged.participantName}</span>
        {format(
          staged.kind === 'supplement'
            ? DECISION_LABEL.supplement
            : (DECISION_LABEL[staged.decision as SessionEntry['decision']] ?? m.reviewApprove),
        )}
      </p>
      <p className="text-xs whitespace-nowrap text-muted-foreground">
        {format(m.reviewUndoPending, { seconds: left })}
      </p>
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
    <div className="absolute right-4 bottom-20 z-10 flex w-80 flex-col gap-2.5 rounded-xl border bg-background p-4 shadow-lg">
      <div className="flex items-center gap-2">
        <p className="text-sm font-semibold">{format(m.reviewKeysTitle)}</p>
        <span className="flex-1" />
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          {format(m.reviewKeysToggle)}
        </button>
      </div>
      <dl className="flex flex-col gap-1.5">
        {keys.map(([key, message]) => (
          <div key={key} className="flex items-center gap-3">
            <dt className="w-14 shrink-0">
              <Kbd className="w-full justify-center">{key}</Kbd>
            </dt>
            <dd className="min-w-0 flex-1 truncate text-sm">{format(message)}</dd>
          </div>
        ))}
      </dl>
      <p className="border-t pt-2 text-xs leading-relaxed text-muted-foreground">
        {format(m.reviewKeysFoot)}
      </p>
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
      className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6"
    >
      <Stagger className="flex w-full max-w-xl flex-col gap-5" step={0.08}>
        <div className="flex items-center gap-4">
          <DoneMark className="size-12 shrink-0" />
          <h2 className="text-xl font-semibold tracking-tight">
            {format(m.reviewDoneTitle, { count: log.length })}
          </h2>
        </div>
        <div className="flex items-end gap-6 border-y py-4">
          <DoneStat label={format(m.reviewApprove)} value={counts.approve} />
          <DoneStat label={format(m.reviewReject)} value={counts.reject} />
          <DoneStat label={format(m.reviewEscalate)} value={counts.escalate} />
          <span className="flex-1" />
          <DoneStat label={format(m.reviewDoneSpent)} value={spentLabel} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
          <span className="flex-1" />
          <p className="text-xs whitespace-nowrap text-muted-foreground">
            {format(m.reviewDoneLeft, { count: inboxRows.length })}
          </p>
        </div>
      </Stagger>
    </div>
  )
}

function DoneStat({ label, value }: { label: string; value: number | string }) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="text-lg leading-none font-semibold tabular-nums">{value}</span>
    </span>
  )
}
