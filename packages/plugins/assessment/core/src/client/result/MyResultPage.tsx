import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { layout } from '@qualy/ui/theme/layout.stylex'
import { useApi, useApiQuery, usePageNavigate } from '@qualy/web-runtime'
import { isApiErrorCode, useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { EntryDto, FilingGateDto } from '../entry/model.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { useBatchLive } from '../live.ts'
import { ResultLedger, ResultUnavailable } from './ResultLedger.tsx'
import { filingShutOf } from './ledger.ts'
import { useMyEntriesQuery } from '../entry/my-entries.ts'

// One's own standing in a round, and the page it is read on.
//
// The account itself is `ResultLedger`, which this page shares with the
// staff view of a participant. What belongs to this page is everything
// around it: reading the three answers, keeping them current while the
// round moves, what to say when the arithmetic cannot be reached, and where
// a line leads - to the claim, on this reader's own filing page.

export default function MyResultPage() {
  const { format } = useI18n()
  return (
    // no band: the ledger carries its own head, with the total in it
    <BatchScreen title={format(m.resultTab)} size="full" chrome="none">
      {(batch) => <Standing batchId={batch.id} archived={batch.status === 'archived'} />}
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

function Standing({ batchId, archived }: { batchId: string; archived: boolean }) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const navigate = usePageNavigate()
  const { format, formatError } = useI18n()

  // Wake-ups say "read again" and name what moved: a decision moves the
  // account, a filing moves the counts beside it, and a change to the paper
  // moves how the account is laid out.
  const { live } = useBatchLive(batchId, (kind) => {
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
  const entries = (mine.data?.entries ?? []) as readonly EntryDto[]
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
            items={items.data?.items ?? []}
            entries={entries}
            heading={format(m.resultTab)}
            reader="owner"
            closed={closed}
            shut={shut}
            emptyAction={goEntries}
            // a line leads to its claim on the filing page, opened there
            onEntryOpen={(entryId) => {
              const itemId = entries.find((entry) => entry.id === entryId)?.itemId
              toEntries({ ...(itemId === undefined ? {} : { open: itemId }), detail: entryId })
            }}
            onItemOpen={(itemId) => toEntries({ open: itemId })}
          />
        </div>
      )}
    </AsyncSection>
  )
}
