import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { layout } from '@qualy/ui/theme/layout.stylex'
import { useApi, useApiQuery, usePageNavigate, usePageQueryState } from '@qualy/web-runtime'
import { isApiErrorCode, useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { useLingering } from '@qualy/ui/use-lingering'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { EntryDto, FilingGateDto, ItemDto } from '../entry/model.ts'
import { EntrySheet } from '../entry/EntrySheet.tsx'
import { AppealDialog } from '../entry/AppealDialog.tsx'
import { SupplementAnswerDialog } from '../entry/SupplementAnswerDialog.tsx'
import { useMarkItemRead, useOwnClaimActs } from '../entry/own-acts.ts'
import { entryLineOf } from '../entry/workspace/model.ts'
import { useLineWords } from '../entry/workspace/calc.ts'
import { useWorkspaceMode } from '../entry/workspace/layout.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { useBatchLive } from '../live.ts'
import { ResultLedger, ResultUnavailable } from './ResultLedger.tsx'
import { filingShutOf, trailOf } from './ledger.ts'
import { useMyEntriesQuery } from '../entry/my-entries.ts'

// One's own standing in a round, and the page it is read on.
//
// The account itself is `ResultLedger`, which this page shares with the
// staff view of a participant. What belongs to this page is everything
// around it: reading the three answers, keeping them current while the
// round moves and saying so, what to say when the arithmetic cannot be
// reached, and reading a claim behind a line without leaving - its drawer
// opens here, with the owner's acts on it. Only rewriting a claim needs the
// filing page, and the button that goes there says so.

export default function MyResultPage() {
  const { format } = useI18n()
  return (
    // no band: the ledger carries its own head, with the total in it
    <BatchScreen title={format(m.resultTab)} size="full" chrome="none">
      {(batch) => (
        <Standing
          batchId={batch.id}
          archived={batch.status === 'archived'}
          materialRange={batch.materialRange}
        />
      )}
    </BatchScreen>
  )
}

const styles = stylex.create({
  page: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 12,
    paddingInline: { default: 24, [breakpoints.phone]: layout.pageGutter },
    paddingTop: { default: 24, [breakpoints.phone]: 16 },
    paddingBottom: { default: 32, [breakpoints.phone]: 40 },
  },
  seat: { width: '100%', maxWidth: 1076, marginInline: 'auto' },
  // the ledger's own shape: the head with its total, then a band and rows
  skHead: { display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 20 },
  skCard: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: tokens.radiusLg,
    boxShadow: tokens.elevation1,
    backgroundColor: tokens.surface,
  },
  skBand: {
    height: 42,
    borderTopLeftRadius: tokens.radiusLg,
    borderTopRightRadius: tokens.radiusLg,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 70%, ${tokens.surface})`,
  },
  skRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 4rem',
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 14,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  skBone: { height: 13, borderRadius: 4 },
  stale: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 10,
    width: '100%',
    maxWidth: 1076,
    marginInline: 'auto',
    paddingInline: 14,
    paddingBlock: 10,
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 12%, transparent)`,
    fontSize: 13,
    color: tokens.warningForeground,
  },
  staleWhy: { flexBasis: '100%', color: tokens.mutedForeground },
})

/**
 * The claim a drawer was opened from, taken back to when the drawer closes.
 *
 * The drawer returns focus itself only to what held it when it opened, and
 * the first time it opens here it mounts already open, with nothing
 * recorded; a keyboard reader would land at the top of the page, far from
 * the line they were on. So once the drawer has let go of focus - it holds
 * it while it leaves - and nothing else has taken it, the line of the claim
 * takes it back.
 */
function useFocusBack(open: boolean) {
  const opener = useRef<string | null>(null)
  useEffect(() => {
    if (open) return
    const entryId = opener.current
    if (entryId === null) return
    opener.current = null
    const until = performance.now() + 1_000
    let frame = 0
    const back = () => {
      const here = document.activeElement
      const released = here === null || here === document.body
      // still inside the drawer on its way out: wait for it to go
      if (!released && here.closest('[role="dialog"]') !== null && performance.now() < until) {
        frame = requestAnimationFrame(back)
        return
      }
      if (!released) return
      const line = [
        ...document.querySelectorAll<HTMLElement>('[data-testid="ledger-line"][data-entry]'),
      ].find((one) => one.dataset['entry'] === entryId && one.closest('[inert]') === null)
      line?.focus({ preventScroll: true })
    }
    frame = requestAnimationFrame(back)
    return () => cancelAnimationFrame(frame)
  }, [open])
  return opener
}

function Standing({
  batchId,
  archived,
  materialRange,
}: {
  batchId: string
  archived: boolean
  materialRange: { start: string; end: string }
}) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const navigate = usePageNavigate()
  const { format, formatError } = useI18n()
  const lineWords = useLineWords()
  // on a phone the drawer is somewhere the back key leaves; at a desk it is
  // furniture over the page, and closing it is not a step back
  const phone = useWorkspaceMode() === 'phone'
  const [detail, setDetail] = usePageQueryState('detail', '', {
    history: phone ? 'push' : 'replace',
  })

  // Wake-ups say "read again" and name what moved: a decision moves the
  // account, a filing moves the counts beside it, and a change to the paper
  // moves how the account is laid out.
  // every connection opens with a catch-up signal, which the page's own
  // alarm clock never sends: the first one says the line has carried
  const [heard, setHeard] = useState(false)
  const { live, lost } = useBatchLive(batchId, (kind) => {
    if (kind === 'sync') setHeard(true)
    const stale = (key: readonly unknown[]) => void queryClient.invalidateQueries({ queryKey: key })
    switch (kind) {
      case 'sync':
      case 'phase-changed':
        stale(query.assessment.key())
        return
      case 'entries-changed':
        stale(query.assessment.listMyEntries.key({ params: { batchId }, query: {} }))
        return
      case 'review-instance-changed':
      case 'result-changed':
        stale(query.assessment.getMyResult.key({ params: { batchId } }))
        stale(query.assessment.listMyEntries.key({ params: { batchId }, query: {} }))
        return
      case 'item-changed':
        stale(query.assessment.listItems.key({ params: { batchId } }))
        stale(query.assessment.getMyResult.key({ params: { batchId } }))
        return
      default:
        return
    }
  })

  // The three answers keep time together. Without the stream nothing else
  // tells the claims or the paper that the round moved, and an account read
  // afresh beside claims read long ago counts one claim twice: approved on
  // its line and still under review beside it.
  const cadence = live ? 120_000 : 30_000
  const result = useQuery({
    ...query.assessment.getMyResult.queryOptions({ params: { batchId } }),
    refetchInterval: cadence,
  })
  const items = useQuery({
    ...query.assessment.listItems.queryOptions({ params: { batchId } }),
    refetchInterval: cadence,
  })
  // the filings, for what is still moving and for which claim a line was
  const mine = useQuery({ ...useMyEntriesQuery(batchId), refetchInterval: cadence })
  const entries = useMemo(() => (mine.data?.entries ?? []) as readonly EntryDto[], [mine.data])
  const questions = useMemo(() => (items.data?.items ?? []) as readonly ItemDto[], [items.data])
  // Taken off the roster, a participant may still read their account but
  // file into nothing: the server then hides the filing gate of every
  // question, which it never does for anybody still on the roster.
  const filing = mine.data?.filing
  const gates = useMemo(() => (filing ?? []) as readonly FilingGateDto[], [filing])
  const offRoster = gates.length > 0 && gates.every((gate) => gate.create.state === 'hidden')
  const closed = archived ? 'archived' : offRoster ? 'excluded' : null
  // The timetable, read already by the page's live wake-ups under the same
  // key, says whether a question the stages keep shut has not opened yet or
  // has nothing left to open it. A harness without it leaves it unasked.
  const timed = typeof api.assessment.getTimeline === 'function'
  const plan = useQuery(
    timed
      ? {
          ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
          staleTime: 30_000,
        }
      : // hooks are unconditional, so a harness without the timetable gets
        // a query that never runs rather than none
        {
          queryKey: ['assessment', 'result-timeline-idle', batchId],
          queryFn: () => Promise.resolve({ timeline: [] }),
          enabled: false,
        },
  )
  const stages = plan.data?.timeline
  const shut = useMemo(() => filingShutOf(gates, stages), [gates, stages])
  // the questions another claim can be filed on right now, on the filing page
  const addable = useMemo(
    () =>
      new Set(gates.filter((gate) => gate.create.state === 'available').map((gate) => gate.itemId)),
    [gates],
  )

  // The claim the drawer holds, resolved from the address, so a reload
  // keeps it and a link carries it. One that is gone opens nothing.
  const groups = result.data?.groups
  const detailed = useMemo(() => {
    if (detail === '') return null
    const entry = entries.find((one) => one.id === detail)
    const item = entry === undefined ? undefined : questions.find((one) => one.id === entry.itemId)
    return entry === undefined || item === undefined
      ? null
      : { entry, item, trail: trailOf(groups ?? [], item.scoreGroupId) }
  }, [detail, entries, questions, groups])
  const lingering = useLingering(detailed)
  const opener = useFocusBack(detailed !== null)
  // A claim read in its drawer is its question looked at, as the filing page
  // counts a question shown: what changed on it is no longer news there.
  const markRead = useMarkItemRead(batchId).mutate
  const unread = mine.data?.attention?.unreadItemIds
  const reading = detailed?.item.id
  useEffect(() => {
    if (reading !== undefined && unread?.includes(reading) === true) markRead(reading)
  }, [reading, unread, markRead])
  const [appealing, setAppealing] = useState<EntryDto | null>(null)
  const lingeringAppeal = useLingering(appealing)
  const [answering, setAnswering] = useState<EntryDto | null>(null)
  const lingeringAnswer = useLingering(answering)
  const acts = useOwnClaimActs({ items: questions, entries, materialRange })
  const refresh = () => void queryClient.invalidateQueries({ queryKey: query.assessment.key() })

  const toEntries = (search?: Record<string, string>) =>
    navigate('assessment/batch-my-entries', {
      params: { batchId },
      ...(search === undefined ? {} : { search }),
    })
  const goEntries = (
    <Button variant="outline" size="sm" onClick={() => toEntries()}>
      {format(m.resultGoEntries)}
    </Button>
  )

  // Nothing read yet and the arithmetic out of reach: no figure on this page
  // would be true, so none is drawn - only why, and what can be done.
  const unreadable =
    result.data === undefined &&
    result.error !== null &&
    (isApiErrorCode(result.error, 'ASSESSMENT_SCORING_UNAVAILABLE') ||
      isApiErrorCode(result.error, 'ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE'))
  if (unreadable) {
    return (
      <div {...stylex.props(styles.page)}>
        <ResultUnavailable
          error={result.error}
          retrying={result.isFetching}
          onRetry={() => void result.refetch()}
          action={goEntries}
        />
      </div>
    )
  }

  // Only a read that has never answered stands in the page's way. One that
  // answered and then failed leaves its answer in place, and the page says
  // what may be behind and whether asking again can help.
  const error =
    result.data === undefined
      ? result.error
      : items.data === undefined
        ? items.error
        : mine.data === undefined
          ? mine.error
          : null
  // which of the two reads beside the account is behind: the questions, the
  // claims, or both
  const behind: 'items' | 'entries' | 'reads' | null =
    items.error !== null
      ? mine.error !== null
        ? 'reads'
        : 'items'
      : mine.error !== null
        ? 'entries'
        : null
  const stale: 'too-large' | 'score' | 'items' | 'entries' | 'reads' | null =
    result.error !== null
      ? isApiErrorCode(result.error, 'ASSESSMENT_SCORING_ACCOUNT_TOO_LARGE')
        ? 'too-large'
        : 'score'
      : behind
  const readsAgain = () => {
    if (items.error !== null) void items.refetch()
    if (mine.error !== null) void mine.refetch()
  }
  // Whether the page is keeping time with the round. Until the line has
  // carried anything nothing is said; a connection the server ends after
  // serving a while is followed by a planned re-dial, which the stream does
  // not count as lost. A read beside the account that failed has already
  // said the page may be behind, which "live" would contradict.
  const stream = !heard || stale !== null ? null : lost ? 'reconnecting' : 'live'
  const readFailedAgain = () => {
    if (result.error !== null) void result.refetch()
    readsAgain()
  }
  const behindSaid = (which: 'items' | 'entries' | 'reads') =>
    format(
      which === 'items'
        ? m.resultStaleItems
        : which === 'entries'
          ? m.resultStaleEntries
          : m.resultStaleReads,
    )
  return (
    <AsyncSection
      pending={result.isPending || items.isPending || mine.isPending}
      error={error ? formatError(error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void result.refetch()
        void items.refetch()
        void mine.refetch()
      }}
      skeleton={
        <div data-testid="result-skeleton" {...stylex.props(styles.page)}>
          <div {...stylex.props(styles.seat)}>
            <div {...stylex.props(styles.skHead)}>
              <Skeleton height={20} width={120} radius={6} />
              <Skeleton height={36} width={132} radius={6} />
              <Skeleton className={stylex.props(styles.skBone).className} width="min(22rem, 70%)" />
            </div>
            <div {...stylex.props(styles.skCard)}>
              <div {...stylex.props(styles.skBand)} />
              {['58%', '41%', '66%', '47%', '52%'].map((width, index) => (
                <div key={index} {...stylex.props(styles.skRow)}>
                  <Skeleton className={stylex.props(styles.skBone).className} width={width} />
                  <Skeleton className={stylex.props(styles.skBone).className} />
                </div>
              ))}
            </div>
          </div>
        </div>
      }
    >
      {result.data !== undefined && (
        <div {...stylex.props(styles.page)}>
          {stale !== null && (
            <div
              data-testid="result-stale"
              data-reason={stale}
              data-behind={behind ?? undefined}
              role="status"
              {...stylex.props(styles.stale)}
            >
              <span>
                {stale === 'too-large' || stale === 'score'
                  ? format(m.resultStaleTitle)
                  : behindSaid(stale)}
              </span>
              {stale === 'too-large' ? (
                <>
                  {/* the account grew past what one reading may evaluate:
                      asking again cannot help, so the page says why instead */}
                  <span {...stylex.props(styles.staleWhy)}>{formatError(result.error)}</span>
                  {/* the reads beside it can still be asked for again */}
                  {behind !== null && (
                    <>
                      <span>{behindSaid(behind)}</span>
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={items.isFetching || mine.isFetching}
                        onClick={readsAgain}
                      >
                        {format(commonMessages.retry)}
                      </Button>
                    </>
                  )}
                </>
              ) : (
                <Button
                  variant="outline"
                  size="xs"
                  disabled={result.isFetching || items.isFetching || mine.isFetching}
                  onClick={readFailedAgain}
                >
                  {format(stale === 'score' ? m.resultRecalculate : commonMessages.retry)}
                </Button>
              )}
            </div>
          )}
          <ResultLedger
            result={result.data}
            items={questions}
            entries={entries}
            heading={format(m.resultTab)}
            reader="owner"
            closed={closed}
            shut={shut}
            stream={stream}
            emptyAction={goEntries}
            // every claim of a question is read where it stands, and its
            // drawer opens over the account rather than on another page
            fold="claims"
            onEntryOpen={(entryId) => {
              // the claim the reader goes back to when the drawer closes
              opener.current = entryId
              setDetail(entryId)
            }}
            addable={addable}
            onItemAdd={(itemId) => toEntries({ open: itemId })}
          />
        </div>
      )}

      {/* kept mounted while it shuts, or it would vanish rather than close */}
      {lingering !== null && (
        <EntrySheet
          open={detailed !== null}
          entry={detailed?.entry ?? lingering.entry}
          item={lingering.item}
          trail={lingering.trail}
          resubmit={gates.find((gate) => gate.itemId === lingering.item.id)?.submit}
          busy={acts.isPending}
          summary={entryLineOf(
            detailed?.entry ?? lingering.entry,
            lingering.item,
            result.data ?? null,
            lineWords,
          )}
          onClose={() => setDetail('')}
          // rewriting a claim is the filing page's form; the button names it
          editLabel={format(m.resultEditAway, {
            kind: lingering.entry.status === 'draft' ? 'draft' : 'edit',
          })}
          onEdit={() => toEntries({ open: lingering.item.id, entry: lingering.entry.id })}
          onStatus={(status, expectedItemRevisionId) => {
            // the version the drawer is showing is the one handed on
            const shownRevision = (detailed?.entry ?? lingering.entry).currentRevision?.id
            acts.mutate({
              entryId: lingering.entry.id,
              itemId: lingering.item.id,
              status,
              ...(expectedItemRevisionId === undefined ? {} : { expectedItemRevisionId }),
              ...(status !== 'in_review' || shownRevision === undefined
                ? {}
                : { expectedEntryRevisionId: shownRevision }),
            })
          }}
          onAppeal={() => setAppealing(lingering.entry)}
          onSupplement={() => setAnswering(lingering.entry)}
        />
      )}
      {lingeringAppeal !== null && (
        <AppealDialog
          // keyed by what it is about, so a second request does not open on
          // the first one's typing
          key={lingeringAppeal.id}
          open={appealing !== null}
          entryId={lingeringAppeal.id}
          onClose={() => setAppealing(null)}
          onDone={() => {
            setAppealing(null)
            refresh()
          }}
        />
      )}
      {lingeringAnswer?.supplement != null && (
        <SupplementAnswerDialog
          key={lingeringAnswer.supplement.requestId}
          open={answering !== null}
          entry={lingeringAnswer}
          supplement={lingeringAnswer.supplement}
          onClose={() => setAnswering(null)}
          onDone={() => {
            setAnswering(null)
            refresh()
          }}
        />
      )}
    </AsyncSection>
  )
}
