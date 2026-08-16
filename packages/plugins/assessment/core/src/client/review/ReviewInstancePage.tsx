import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  DownloadIcon,
  InfoIcon,
  Maximize2Icon,
  TriangleAlertIcon,
} from 'lucide-react'
import {
  useApi,
  useApiQuery,
  usePageNavigate,
  usePageQueryState,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import type { MessageDescriptor } from '@qualy/i18n-contract'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Avatar, AvatarFallback } from '@qualy/ui/avatar'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { cn } from '@qualy/ui/cn'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@qualy/ui/input-group'
import { Kbd } from '@qualy/ui/kbd'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@qualy/ui/dialog'
import { Skeleton } from '@qualy/ui/skeleton'
import { Textarea } from '@qualy/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { toast } from '@qualy/ui/toast'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { AttachmentLink } from '../entry/AttachmentLink.tsx'
import { Basis } from '../entry/Basis.tsx'
import { entryStatusMessage, fieldsOf, lastDay, trimAmount, type EntryDto } from '../entry/model.ts'
import { reviewEventMessage, reviewOutcomeMessage } from './events.ts'
import {
  readRunScope,
  runRows,
  summaryOf,
  timeLabel,
  clockLabel,
  useEntryHistory,
  valuesOf,
  type HistoryRevision,
  type InboxItemDto,
} from './model.ts'
import type { BatchDto } from '../phase/model.ts'
import type { ReviewDto } from './model.ts'
import { RejectDialog, EscalateDialog, type WordedDecision } from './decision-dialogs.tsx'
import { SupplementDialog } from './SupplementDialog.tsx'
import { useDeferredDecision, type StagedDecision } from './useDeferredDecision.ts'
import { HistorySheet, VersionPicker } from './history.tsx'
import { attachmentContentUrl } from '../entry/model.ts'
import { useLingering } from '@qualy/ui/use-lingering'
import { Appear, CountdownRing, DoneMark, Drill, Stagger } from '@qualy/ui/reveal'

// The workbench: one submission a screen, walked in a run.
//
// Everything said before this round sits on top so it needs no scrolling,
// the filing and its materials follow, and what the question is worth stands
// beside them. Letters choose a decision, ⌘↵ stages it, and for five seconds
// it can be taken back; then it is submitted and the next one is already on
// screen. Sending back and escalating each carry a word, so they open their
// dialog instead of arming silently.

/** one decision this sitting, wherever it has got to */
interface SessionEntry {
  readonly instanceId: string
  readonly participantName: string
  readonly itemTitle: string
  readonly decision: 'approve' | 'reject' | 'escalate'
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

  const inbox = useQuery({
    ...query.assessment.listReviewInbox.queryOptions({ query: { batchId: batch.id } }),
    refetchInterval: 30_000,
  })
  const detail = useQuery(
    query.assessment.getReviewInstance.queryOptions({ params: { instanceId } }),
  )
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

  const goTo = (id: string) =>
    navigate('assessment/review-instance', {
      params: { batchId: batch.id, instanceId: id },
      search: runRaw === '' ? {} : { run: runRaw },
    })

  const [armed, setArmed] = useState<'approve' | 'comment' | null>(null)
  const [word, setWord] = useState('')
  const [dialog, setDialog] = useState<'reject' | 'escalate' | 'supplement' | null>(null)
  const [keysOpen, setKeysOpen] = useState(false)
  const [writing, setWriting] = useState(false)
  const [openSibling, setOpenSibling] = useState<string | null>(null)
  const lingeringSibling = useLingering(openSibling)
  // the pill has to keep its words while it animates out
  const lingeringStaged = useLingering(deferred.pending)
  const [trailOpen, setTrailOpen] = useState(false)
  const [versionsOpen, setVersionsOpen] = useState(false)
  // which earlier version the filing is read against; null is not comparing
  const [comparing, setComparing] = useState<string | null>(null)
  const wordRef = useRef<HTMLInputElement | null>(null)
  // Whether something over the workbench owns the keyboard. Read from a ref
  // because the window listener runs in the same native event as the panel
  // that just closed itself: through a render closure it saw "no overlay"
  // and ran the page's own ⌘↵ a moment after the panel had already acted.
  const overlaid = useRef(false)
  overlaid.current = dialog !== null || trailOpen || versionsOpen || writing || openSibling !== null

  /** stage a round-moving decision, log it, and put the next one on screen */
  const stageDecision = (decision: 'approve' | 'reject' | 'escalate', worded?: WordedDecision) => {
    if (review === undefined) return
    const staged: StagedDecision = {
      instanceId,
      decision,
      participantName: review.participantName,
      payload: {
        decision,
        ...(worded?.reason !== undefined ? { reason: worded.reason } : {}),
        ...(worded !== undefined
          ? { comment: worded.comment }
          : word.trim() !== ''
            ? { comment: word.trim() }
            : {}),
        ...(worded?.suggestedPayload !== undefined
          ? { suggestedPayload: worded.suggestedPayload }
          : {}),
      },
    }
    setLog((current) => [
      ...current,
      {
        instanceId,
        participantName: review.participantName,
        itemTitle: review.itemTitle,
        decision,
        status: 'waiting',
      },
    ])
    deferred.stage(staged)
    setArmed(null)
    setWord('')
    setDialog(null)
    const next = remaining.find((row) => row.instanceId !== instanceId)
    if (next !== undefined) goTo(next.instanceId)
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

  /** a note moves nothing, so it goes out at once and the round stays put */
  const sayNote = useMutation({
    mutationFn: () =>
      run(
        api.assessment.decideReview({
          params: { instanceId },
          payload: { decision: 'comment', comment: word.trim() },
        }),
      ),
    onSuccess: () => {
      toast.success(format(m.reviewSaid))
      setArmed(null)
      setWord('')
      void detail.refetch()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const decisions = review?.chain.decisions ?? []
  const submitArmed = () => {
    if (armed === 'approve' && decisions.includes('approve')) {
      stageDecision('approve')
      return
    }
    if (armed === 'comment' && decisions.includes('comment')) {
      if (word.trim() === '') {
        wordRef.current?.focus()
        return
      }
      sayNote.mutate()
      return
    }
    toast.info(format(m.reviewPickDecision))
  }

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
    const down = (event: KeyboardEvent) => {
      if (overlaid.current) return
      // the photo viewer holds its own keys: Esc closes it, arrows page it
      if (document.querySelector('.PhotoView-Portal') !== null) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key === 'Enter') {
        event.preventDefault()
        submitArmed()
        return
      }
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        undoStaged()
        return
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
          if (decisions.includes('approve')) setArmed('approve')
          return
        case 'r':
        case 'R':
          // swallowed before the dialog opens, or the letter lands in the
          // box it is about to focus
          event.preventDefault()
          if (decisions.includes('reject')) setDialog('reject')
          return
        case 'e':
        case 'E':
          event.preventDefault()
          if (decisions.includes('escalate')) setDialog('escalate')
          return
        case 'c':
        case 'C':
          event.preventDefault()
          if (decisions.includes('comment')) {
            setArmed('comment')
            wordRef.current?.focus()
          }
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
          else setArmed(null)
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

  const [measure, height] = useRestOfTheWindow()
  // over only when this sitting decided something: an already-closed round
  // opened from elsewhere is a page to read, not a run to finish
  const done = remaining.length === 0 && log.length > 0 && !inbox.isPending

  return (
    <AsyncSection
      pending={inbox.isPending && detail.isPending}
      error={detail.error ? formatError(detail.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void inbox.refetch()
        void detail.refetch()
      }}
      skeleton={<Skeleton className="h-96 w-full" />}
      className="flex flex-1 flex-col"
    >
      <div
        ref={measure}
        style={height === null ? undefined : { height }}
        className="relative flex min-h-96 flex-col"
      >
        <div className="grid min-h-0 flex-1 lg:grid-cols-[15rem_minmax(0,1fr)]">
          <QueueRail
            rows={scopeRows}
            log={log}
            currentId={instanceId}
            remainingCount={remaining.length}
            onOpen={goTo}
            onBack={() => navigate('assessment/batch-reviews', { params: { batchId: batch.id } })}
          />
          <div className="flex min-h-0 min-w-0 flex-col border-t lg:border-t-0 lg:border-l">
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
                {scopeRows.length > 0 && (
                  <RunStrip
                    at={log.length + (currentIndex === -1 ? 1 : currentIndex + 1)}
                    total={total}
                    log={log}
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
                />
                <Drill
                  move="next"
                  drillKey={instanceId}
                  className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_19rem]"
                >
                  <MainColumn
                    review={review}
                    comparing={comparing}
                    onCompare={setComparing}
                    onVersions={() => setVersionsOpen(true)}
                    onTrail={() => setTrailOpen(true)}
                  />
                  <ContextRail review={review} onOpenSibling={setOpenSibling} />
                </Drill>
                {review.capabilities.canDecide && decisions.length > 0 && (
                  <DecisionBar
                    review={review}
                    decisions={decisions}
                    armed={armed}
                    word={word}
                    wordRef={wordRef}
                    busy={sayNote.isPending}
                    onWord={setWord}
                    onArm={setArmed}
                    onDialog={setDialog}
                    onExpand={() => setWriting(true)}
                    onSubmit={submitArmed}
                  />
                )}
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
                            onClick={() => withdrawSupplement.mutate(open.id)}
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

        <Appear show={deferred.pending !== null} className="absolute bottom-20 left-[16rem] z-10">
          {lingeringStaged !== null && (
            <UndoPill staged={lingeringStaged} deadline={deferred.deadline} onUndo={undoStaged} />
          )}
        </Appear>
        {keysOpen && <KeysPanel onClose={() => setKeysOpen(false)} />}
        {writing && (
          <WritingBox
            value={word}
            advising={review?.chain.route === 'escalation'}
            onChange={setWord}
            onClose={() => setWriting(false)}
          />
        )}
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
            <HistorySheet
              open={trailOpen}
              entryId={review.entryId}
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

        {dialog === 'reject' && review !== undefined && (
          <RejectDialog
            review={review}
            reasons={batch.reviewReasons.reject}
            onClose={() => setDialog(null)}
            onConfirm={(worded) => stageDecision('reject', worded)}
          />
        )}
        {dialog === 'escalate' && review !== undefined && (
          <EscalateDialog
            review={review}
            reasons={batch.reviewReasons.escalate}
            onClose={() => setDialog(null)}
            onConfirm={(worded) => stageDecision('escalate', worded)}
          />
        )}
        {dialog === 'supplement' && review !== undefined && (
          <SupplementDialog
            open
            instanceId={instanceId}
            onClose={() => setDialog(null)}
            onDone={() => {
              setDialog(null)
              refresh()
            }}
          />
        )}
      </div>
    </AsyncSection>
  )
}

/** the run's own rows down the left, decided ones dimmed with their word */
function QueueRail({
  rows,
  log,
  currentId,
  remainingCount,
  onOpen,
  onBack,
}: {
  rows: readonly InboxItemDto[]
  log: readonly SessionEntry[]
  currentId: string
  remainingCount: number
  onOpen: (id: string) => void
  onBack: () => void
}) {
  const { format } = useI18n()
  const decided = new Map(log.map((entry) => [entry.instanceId, entry.decision]))
  return (
    <aside className="hidden min-h-0 flex-col lg:flex">
      <div className="flex items-center gap-1.5 border-b py-2 pr-3.5 pl-2">
        {/* the way out: a workbench with no door back is a dead end */}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={format(m.reviewBackToQueue)}
          onClick={onBack}
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
        <p className="text-xs font-semibold">{format(m.reviewQueueTitle)}</p>
        <Badge variant="secondary" className="tabular-nums">
          {remainingCount}
        </Badge>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {rows.map((row) => {
          const said = decided.get(row.instanceId)
          const current = row.instanceId === currentId
          return (
            <li key={row.instanceId}>
              <button
                type="button"
                disabled={said !== undefined}
                onClick={() => onOpen(row.instanceId)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors',
                  current
                    ? 'border-l-foreground bg-accent'
                    : 'border-l-transparent hover:bg-accent/50',
                  said !== undefined && 'opacity-50',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className={cn('truncate text-sm', current && 'font-semibold')}>
                    {row.participantName}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{row.itemTitle}</span>
                </span>
                {said !== undefined ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format(DECISION_LABEL[said])}
                  </span>
                ) : (
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {clockLabel(row.submittedAt)}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

const DECISION_LABEL: Record<SessionEntry['decision'], MessageDescriptor> = {
  approve: m.reviewApprove,
  reject: m.reviewReject,
  escalate: m.reviewEscalate,
}

/** where the run stands: a thin band of what is done and what is left */
function RunStrip({
  at,
  total,
  log,
  batchId,
}: {
  at: number
  total: number
  log: readonly SessionEntry[]
  batchId: string
}) {
  const { format } = useI18n()
  const navigate = usePageNavigate()
  return (
    <div className="flex items-center gap-3 border-b bg-muted/40 px-4 py-2">
      <p className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {format(m.reviewRunPosition, { at, count: total })}
      </p>
      <span className="flex min-w-0 flex-1 gap-1">
        {Array.from({ length: Math.min(total, 60) }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full',
              index < log.length ? 'bg-foreground' : 'bg-border',
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
}: {
  review: ReviewDto
  at: number | null
  of: number
  canPrev: boolean
  canNext: boolean
  onMove: (step: 1 | -1) => void
}) {
  const { format } = useI18n()
  return (
    <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
      <Avatar className="size-9">
        <AvatarFallback>{review.participantName.slice(0, 1)}</AvatarFallback>
      </Avatar>
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-baseline gap-2.5">
          <h2 className="text-base font-semibold whitespace-nowrap">{review.participantName}</h2>
          {review.businessNo !== null && (
            <span className="text-xs text-muted-foreground tabular-nums">{review.businessNo}</span>
          )}
          {review.unitName !== null && (
            <span className="min-w-0 truncate text-xs text-muted-foreground">
              {review.unitName}
            </span>
          )}
        </div>
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {review.context?.worth.groupName !== null && review.context?.worth.groupName !== undefined
            ? `${review.context.worth.groupName} › ${review.itemTitle}`
            : review.itemTitle}
        </p>
      </div>
      <span className="flex-1" />
      {review.chain.route === 'escalation' && (
        <Badge variant="outline">
          <TriangleAlertIcon aria-hidden />
          {format(m.reviewRouteEscalation)}
        </Badge>
      )}
      {at !== null && (
        <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
          {format(m.reviewRunPosition, { at, count: of })}
        </p>
      )}
      <span className="flex gap-1">
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
function MainColumn({
  review,
  comparing,
  onCompare,
  onVersions,
  onTrail,
}: {
  review: ReviewDto
  /** an earlier revision id, 'previous' for the one just before, or null */
  comparing: string | null
  onCompare: (next: string | null) => void
  onVersions: () => void
  onTrail: () => void
}) {
  const { format } = useI18n()
  const fields = fieldsOf(review.form.formConfig).filter((field) => field.type !== 'attachment')
  const record = (review.revision.payload ?? {}) as Record<string, unknown>
  const previous = review.context?.previous ?? null
  // the version being read against, resolved from the entry's own history;
  // asked for only while a comparison is on
  const history = useEntryHistory(review.entryId, comparing !== null)
  const revisions = ((history.data as { revisions?: readonly HistoryRevision[] } | undefined)
    ?.revisions ?? []) as readonly HistoryRevision[]
  const earlier = revisions.filter((one) => one.revisionNo < review.revision.revisionNo)
  const against =
    comparing === null
      ? null
      : comparing === 'previous'
        ? (earlier[earlier.length - 1] ?? null)
        : (earlier.find((one) => one.id === comparing) ?? null)
  const was = new Map(
    against === null
      ? []
      : valuesOf(against.formConfig, against.payload).map((v) => [v.key, v.value]),
  )
  const changes =
    against === null
      ? 0
      : fields.filter((field) => {
          const now = typeof record[field.key] === 'string' ? (record[field.key] as string) : ''
          return (was.get(field.key) ?? '') !== now
        }).length
  return (
    <main className="flex min-w-0 flex-col gap-6 overflow-y-auto p-5">
      {review.chain.route === 'escalation' && review.state !== 'completed' && (
        <div className="flex items-start gap-3 rounded-xl bg-muted/60 p-4">
          <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-sm font-medium">{format(m.reviewEscBannerTitle)}</p>
            <p className="text-sm text-muted-foreground">{format(m.reviewEscBannerBody)}</p>
          </div>
        </div>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2.5 border-b pb-2">
          <h3 className="text-sm font-semibold">{format(m.reviewPrior)}</h3>
          <Badge variant="secondary">{format(m.reviewStateRound, { round: review.roundNo })}</Badge>
        </div>
        {previous !== null && (
          <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-medium">{format(m.reviewPreviousTitle)}</p>
              <Badge variant="outline">
                {format(reviewEventMessage(previous.kind).message, {
                  who: previous.actorName ?? format(m.eventSomebody),
                })}
              </Badge>
              {previous.reason !== null && <Badge variant="outline">{previous.reason}</Badge>}
              <span className="flex-1" />
              <p className="text-xs text-muted-foreground tabular-nums">{timeLabel(previous.at)}</p>
            </div>
            {previous.comment !== null && (
              <p className="border-l-2 border-muted-foreground/30 pl-3 text-sm leading-relaxed">
                {previous.comment}
              </p>
            )}
            <p className="text-xs text-muted-foreground">{format(m.reviewPreviousHint)}</p>
          </div>
        )}
        {review.events.length === 0 ? (
          <p className="text-sm text-muted-foreground">—</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {review.events.map((event, index) => {
              const said = reviewEventMessage(event.kind)
              return (
                <li key={index} className="flex gap-3">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] text-muted-foreground tabular-nums">
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <p className="text-sm">
                        {format(
                          said.message,
                          said.needsActor
                            ? { who: event.actorName ?? format(m.eventSomebody) }
                            : {},
                        )}
                      </p>
                      {event.reason !== null && <Badge variant="outline">{event.reason}</Badge>}
                      <span className="flex-1" />
                      <p className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {timeLabel(event.at)}
                      </p>
                    </div>
                    {event.comment !== null && (
                      <p className="border-l-2 border-border pl-2.5 text-sm leading-relaxed">
                        {event.comment}
                      </p>
                    )}
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5 border-b pb-2">
          <div className="flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm font-semibold">{format(m.reviewPayloadTitle)}</h3>
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
                  variant={comparing === null ? 'ghost' : 'secondary'}
                  size="sm"
                  className="text-xs"
                  onClick={() => onCompare(comparing === null ? 'previous' : null)}
                >
                  {format(m.reviewCompare)}
                  <Kbd>D</Kbd>
                </Button>
                <Button variant="ghost" size="sm" className="text-xs" onClick={onVersions}>
                  {format(m.reviewPickVersion)}
                  <Kbd>⇧D</Kbd>
                </Button>
              </>
            )}
          </div>
          {against !== null && (
            <p className="text-xs text-muted-foreground">
              {format(m.reviewCompareCount, { count: changes, no: against.revisionNo })}
            </p>
          )}
        </div>
        <dl className="flex flex-col gap-2">
          {fields.map((field) => {
            const now = typeof record[field.key] === 'string' ? (record[field.key] as string) : ''
            const before = was.get(field.key) ?? ''
            const changed = against !== null && before !== now
            return (
              <div
                key={field.key}
                className={cn(
                  'grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-l-2 pl-2.5',
                  changed ? 'border-l-foreground/40' : 'border-l-transparent',
                )}
              >
                <dt className="text-sm whitespace-nowrap text-muted-foreground">{field.label}</dt>
                <dd className="flex min-w-0 flex-col gap-0.5 text-sm">
                  <span className={cn(changed && 'font-medium')}>{now === '' ? '—' : now}</span>
                  <Appear show={changed}>
                    <span className="flex items-baseline gap-2 text-xs text-muted-foreground">
                      <span className="shrink-0">{format(m.reviewComparePrevious)}</span>
                      {before === '' ? (
                        <span>{format(m.reviewCompareBlank)}</span>
                      ) : (
                        <span className="min-w-0 line-through">{before}</span>
                      )}
                    </span>
                  </Appear>
                </dd>
              </div>
            )
          })}
          {review.revision.note !== null && (
            <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 pl-2.5">
              <dt className="text-sm whitespace-nowrap text-muted-foreground">
                {format(m.entryNote)}
              </dt>
              <dd className="min-w-0 text-sm">{review.revision.note}</dd>
            </div>
          )}
        </dl>
      </section>

      {review.revision.attachments.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 border-b pb-2">
            <h3 className="text-sm font-semibold">{format(m.reviewFiles)}</h3>
            <span className="text-xs text-muted-foreground">
              {format(m.reviewFilesCount, { count: review.revision.attachments.length })}
            </span>
            <span className="flex-1" />
            <span className="hidden text-xs text-muted-foreground lg:block">
              {format(m.reviewFilesKeys)}
            </span>
            <Button variant="ghost" size="sm" className="text-xs" asChild>
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
          {/* drawn large: reading the evidence is what this screen is for */}
          <ul className="flex flex-wrap gap-4">
            {review.revision.attachments.map((attachment, index) => (
              <li key={attachment.attachmentId} data-file-slot={index + 1} className="relative">
                {index < 9 && <Kbd className="absolute top-1.5 left-1.5 z-10">{index + 1}</Kbd>}
                <AttachmentLink attachmentId={attachment.attachmentId} variant="preview" />
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.supplements.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2.5 border-b pb-2">
            <h3 className="text-sm font-semibold">{format(m.supplementSectionTitle)}</h3>
          </div>
          {review.supplements.map((supplement) => (
            <SupplementCard key={supplement.id} supplement={supplement} />
          ))}
        </section>
      )}

      {/* reserved: machine reading arrives later, and the reading order
          already keeps its place */}
      <section className="flex flex-col gap-1.5 rounded-xl border border-dashed p-4">
        <p className="text-sm font-medium">{format(m.reviewInsight)}</p>
        <p className="text-sm text-muted-foreground">{format(m.reviewInsightSoon)}</p>
      </section>
    </main>
  )
}

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
        <dl className="flex flex-col gap-2">
          {supplement.requirements.map((asked) => {
            const value = answers[asked.key]
            return (
              <div key={asked.key} className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3">
                <dt className="text-sm whitespace-nowrap text-muted-foreground">{asked.label}</dt>
                <dd className="min-w-0 text-sm">
                  {asked.kind === 'file' ? (
                    Array.isArray(value) && value.length > 0 ? (
                      <span className="flex flex-wrap gap-3">
                        {value.map((attachmentId) => (
                          <AttachmentLink
                            key={String(attachmentId)}
                            attachmentId={String(attachmentId)}
                            variant="preview"
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
function ContextRail({
  review,
  onOpenSibling,
}: {
  review: ReviewDto
  onOpenSibling: (entryId: string) => void
}) {
  const { format, locale } = useI18n()
  const listed = useMemo(
    () => new Intl.ListFormat(locale, { style: 'narrow', type: 'conjunction' }),
    [locale],
  )
  const context = review.context
  return (
    <aside className="flex min-w-0 flex-col gap-4 overflow-y-auto border-t p-4 lg:border-t-0 lg:border-l">
      <Basis compact />

      <section className="flex flex-col gap-2.5 rounded-xl border p-3.5">
        <p className="text-sm font-semibold">{format(m.reviewChainTitle)}</p>
        <Route
          title={format(m.reviewRouteNormal)}
          stages={review.chain.normal}
          here={review.chain.route === 'normal' ? review.chain.stageId : null}
          listed={listed}
        />
        {review.chain.escalation.length > 0 && (
          <Route
            title={format(m.reviewRouteEscalation)}
            stages={review.chain.escalation}
            here={review.chain.route === 'escalation' ? review.chain.stageId : null}
            listed={listed}
          />
        )}
      </section>

      {context !== null && (
        <section className="flex flex-col gap-2 rounded-xl border p-3.5 text-sm">
          <p className="font-semibold">{format(m.reviewAboutTitle)}</p>
          {context.worth.each !== null && (
            <AboutRow label={format(m.reviewAboutEach)} value={trimAmount(context.worth.each)} />
          )}
          {context.worth.maxEntries !== null && (
            <AboutRow label={format(m.reviewAboutMax)} value={String(context.worth.maxEntries)} />
          )}
          {context.worth.groupCap !== null && (
            <AboutRow
              label={format(m.reviewAboutGroupCap)}
              value={trimAmount(context.worth.groupCap)}
            />
          )}
          <AboutRow
            label={format(m.reviewAboutRange)}
            value={`${context.worth.materialRange.start} — ${lastDay(context.worth.materialRange.end)}`}
          />
        </section>
      )}

      {context !== null && context.siblings.length > 0 && (
        <section className="flex flex-col gap-2 rounded-xl border p-3.5">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold">{format(m.reviewSiblingsTitle)}</p>
            <span className="flex-1" />
            <span className="text-xs whitespace-nowrap text-muted-foreground">
              {format(m.reviewSiblingsCount, { count: context.siblings.length })}
            </span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {context.siblings.map((sibling) => (
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
                      sibling.current ? 'bg-foreground' : 'bg-muted-foreground/40',
                    )}
                  />
                  <span className={cn('min-w-0 flex-1 truncate', sibling.current && 'font-medium')}>
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
                </button>
              </li>
            ))}
          </ul>
          {context.worth.maxEntries !== null &&
            context.siblings.length >= context.worth.maxEntries && (
              <p className="border-t pt-2 text-xs text-muted-foreground">
                {format(m.reviewSiblingsFull)}
              </p>
            )}
        </section>
      )}
    </aside>
  )
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="whitespace-nowrap text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
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
  title: string
  stages: ReviewDto['chain']['normal']
  here: string | null
  listed: Intl.ListFormat
}) {
  const { format } = useI18n()
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <ol className="flex flex-col gap-1.5 text-sm">
        {stages.map((stage) => (
          <li
            key={stage.id}
            className={cn('rounded-md px-2 py-1', stage.id === here && 'bg-accent/60')}
          >
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">
                {stage.nodeName ??
                  format(
                    stage.skipped === 'no-holder' ? m.reviewStageNoHolder : m.reviewStageSkipped,
                  )}
              </span>
              {stage.id === here && (
                <span className="text-xs text-primary">{format(m.reviewStageHere)}</span>
              )}
            </p>
            <p className="text-xs text-muted-foreground">{listed.format(stage.roleNames)}</p>
            {stage.nodeName !== null && stage.reviewers !== null && (
              <p className="text-xs text-muted-foreground">
                {stage.reviewers.length === 0
                  ? format(m.reviewStageNobody)
                  : format(m.reviewStageReviewers, { who: listed.format(stage.reviewers) })}
              </p>
            )}
          </li>
        ))}
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
  decisions,
  armed,
  word,
  wordRef,
  busy,
  onWord,
  onArm,
  onDialog,
  onExpand,
  onSubmit,
}: {
  review: ReviewDto
  decisions: readonly string[]
  armed: 'approve' | 'comment' | null
  word: string
  wordRef: RefObject<HTMLInputElement | null>
  busy: boolean
  onWord: (next: string) => void
  onArm: (next: 'approve' | 'comment' | null) => void
  onDialog: (next: 'reject' | 'escalate' | 'supplement') => void
  onExpand: () => void
  onSubmit: () => void
}) {
  const { format } = useI18n()
  const advising = review.chain.route === 'escalation' && !decisions.includes('reject')
  // approving at the end of a route is the decision itself, not a hand-on
  const route = review.chain.route === 'escalation' ? review.chain.escalation : review.chain.normal
  const lastStep = route[route.length - 1]?.id === review.chain.stageId
  return (
    <footer className="flex flex-col gap-2 border-t px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* one line at the bar, because the bar is one line; anything longer
            is written in a box that is actually a box */}
        <InputGroup className="min-w-48 flex-1">
          <InputGroupInput
            ref={wordRef}
            value={word}
            placeholder={format(
              advising ? m.reviewCommentPlaceholderAdvise : m.reviewCommentPlaceholder,
            )}
            onChange={(event) => onWord(event.target.value)}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              size="icon-xs"
              aria-label={format(m.reviewWriteMore)}
              onClick={onExpand}
            >
              <Maximize2Icon aria-hidden />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
        {review.capabilities.canRequestSupplement && (
          <Explained why={format(m.reviewTipSupplement)}>
            <Button variant="outline" onClick={() => onDialog('supplement')}>
              {format(m.reviewSupplementAsk)}
            </Button>
          </Explained>
        )}
        {decisions.includes('comment') && (
          <Explained why={format(m.reviewTipComment)}>
            <Button
              variant={armed === 'comment' ? 'secondary' : 'outline'}
              onClick={() => onArm(armed === 'comment' ? null : 'comment')}
            >
              {format(m.reviewActionNote)}
              <Kbd>C</Kbd>
            </Button>
          </Explained>
        )}
        {decisions.includes('escalate') && (
          <Explained why={format(m.reviewTipEscalate)}>
            <Button variant="outline" onClick={() => onDialog('escalate')}>
              {format(m.reviewEscalate)}
              <Kbd>E</Kbd>
            </Button>
          </Explained>
        )}
        {decisions.includes('reject') && (
          <Explained why={format(m.reviewTipReject)}>
            <Button
              variant="outline"
              className="border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100 hover:text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-950/70"
              onClick={() => onDialog('reject')}
            >
              {format(m.reviewReject)}
              <Kbd className="bg-rose-500/10 text-rose-700 dark:text-rose-300">R</Kbd>
            </Button>
          </Explained>
        )}
        {decisions.includes('approve') && (
          <Explained why={format(m.reviewTipApprove)}>
            <Button
              variant="outline"
              className={cn(
                'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300 dark:hover:bg-emerald-950/70',
                armed === 'approve' && 'ring-2 ring-emerald-500/40',
              )}
              onClick={() => onArm(armed === 'approve' ? null : 'approve')}
            >
              {format(m.reviewApprove)}
              <Kbd className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">A</Kbd>
            </Button>
          </Explained>
        )}
        {/* the one solid on the bar: choosing is soft, committing is not */}
        <Explained why={format(m.reviewTipSubmit)}>
          <Button
            disabled={busy || armed === null}
            className="bg-primary/90 hover:bg-primary"
            onClick={onSubmit}
          >
            {format(m.reviewSubmitDecision)}
            <Kbd className="bg-primary-foreground/20 text-primary-foreground">⌘↵</Kbd>
          </Button>
        </Explained>
      </div>
      {/* what the bar says depends on what is chosen: a line that reads the
          same whatever is about to happen is a line nobody reads */}
      <p className="text-xs text-muted-foreground">
        {format(
          advising
            ? m.reviewSubmitHintAdvise
            : armed === 'approve'
              ? lastStep
                ? m.reviewHintLastStep
                : m.reviewHintArmedApprove
              : armed === 'comment'
                ? m.reviewHintArmedComment
                : m.reviewHintPickFirst,
        )}
      </p>
    </footer>
  )
}

/**
 * A box for a word too long for the bar.
 *
 * The bar holds one line because a bar is one line; a sentence that outgrows
 * it should not make the row of buttons jump, so it gets a real box instead.
 * The text is the same text either way.
 */
function WritingBox({
  value,
  advising,
  onChange,
  onClose,
}: {
  value: string
  advising: boolean
  onChange: (next: string) => void
  onClose: () => void
}) {
  const { format } = useI18n()
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="text-sm">{format(m.reviewComment)}</DialogTitle>
        </DialogHeader>
        <Textarea
          rows={8}
          value={value}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus
          placeholder={format(
            advising ? m.reviewCommentPlaceholderAdvise : m.reviewCommentPlaceholder,
          )}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              onClose()
            }
          }}
        />
        <div className="flex justify-end">
          <Button variant="outline" onClick={onClose}>
            {format(commonMessages.close)}
            <Kbd>Esc</Kbd>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** one of the participant's other claims on this question, read in full */
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
        <dl className="flex flex-col gap-2">
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
    <div className="flex items-center gap-3 rounded-xl border bg-background px-3.5 py-2.5 shadow-lg">
      <CountdownRing seconds={5} remaining={started.current}>
        {left}
      </CountdownRing>
      <p className="flex items-baseline gap-2 text-sm whitespace-nowrap">
        <span className="font-semibold">{staged.participantName}</span>
        {format(DECISION_LABEL[staged.decision as SessionEntry['decision']] ?? m.reviewApprove)}
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
    ['⌘↵', m.reviewKeySubmit],
    ['⌘Z', m.reviewKeyUndo],
    ['A', m.reviewKeyApprove],
    ['R', m.reviewKeyReject],
    ['E', m.reviewKeyEscalate],
    ['C', m.reviewKeyComment],
    ['J / K', m.reviewKeyMove],
    ['1–9', m.reviewKeyFiles],
    ['D', m.reviewKeyCompare],
    ['⇧D', m.reviewKeyVersions],
    ['H', m.reviewKeyTrail],
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
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
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
        {log.length > 0 && (
          <div className="flex flex-col gap-2 rounded-xl bg-muted/60 p-4">
            <p className="text-sm font-medium">{format(m.reviewDoneList)}</p>
            <ul className="flex flex-col gap-1.5">
              {log.map((entry) => (
                <li key={entry.instanceId} className="flex items-center gap-2.5 text-sm">
                  <span
                    aria-hidden
                    className={cn(
                      'size-1.5 shrink-0 rounded-full',
                      entry.decision === 'reject'
                        ? 'bg-destructive'
                        : entry.decision === 'escalate'
                          ? 'bg-muted-foreground/60'
                          : 'bg-foreground',
                    )}
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {entry.participantName}
                    <span className="pl-2 text-muted-foreground">{entry.itemTitle}</span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {format(DECISION_LABEL[entry.decision])}
                    {entry.status === 'failed' && ' ✕'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="border-t pt-2 text-xs text-muted-foreground">
              {format(m.reviewDoneFinal)}
            </p>
          </div>
        )}
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

/**
 * However much of the window is left below wherever this lands, so the
 * workbench fills the screen and scrolls inside its own panes - the same
 * measurement my-entries makes, for the same reason.
 */
function useRestOfTheWindow(): [(node: HTMLDivElement | null) => void, number | null] {
  const [node, setNode] = useState<HTMLDivElement | null>(null)
  const [height, setHeight] = useState<number | null>(null)

  useEffect(() => {
    if (node === null) return
    const beside = window.matchMedia('(min-width: 64rem)')
    const measure = () => {
      if (!beside.matches) {
        setHeight(null)
        return
      }
      const room = window.innerHeight - node.getBoundingClientRect().top
      setHeight(Math.max(360, Math.round(room)))
    }
    measure()
    window.addEventListener('resize', measure)
    beside.addEventListener('change', measure)
    return () => {
      window.removeEventListener('resize', measure)
      beside.removeEventListener('change', measure)
    }
  }, [node])

  return [setNode, height]
}
