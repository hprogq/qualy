import { useQuery } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useApiQuery, usePageNavigate, usePageRouteParams } from '@qualy/web-runtime'
import { isApiErrorCode, useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import type { EntryDto } from '../entry/model.ts'
import { BatchScreen } from '../batch/BatchScreen.tsx'
import { ResultLedger, type LedgerItem } from './ResultLedger.tsx'

// One's own standing in a round: what the three api answers are, and what
// to say when the arithmetic behind them cannot be reached.
//
// The account itself is `ResultLedger`, which this page shares with the
// staff account. Nothing about how a total divides belongs to one reader.

export default function MyResultPage() {
  const { format } = useI18n()
  return (
    <BatchScreen title={format(m.resultTab)} description={format(m.resultHint)}>
      {(batch) => <Standing batchId={batch.id} />}
    </BatchScreen>
  )
}

const styles = stylex.create({
  // the ledger's own shape: the total band with its bar, then a line per
  // score group - the same thing the account page draws, for the same reason
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
  page: { display: 'flex', flexGrow: 1, flexShrink: 1, flexBasis: '0%', flexDirection: 'column' },
  unavailable: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    padding: 24,
  },
  unavailableTitle: { fontSize: 15, fontWeight: 600 },
  unavailableHint: { fontSize: 13, lineHeight: 1.625, color: tokens.mutedForeground },
  goRow: { display: 'flex', alignItems: 'center', gap: 10 },
  goCounts: {
    fontSize: 12,
    lineHeight: '1rem',
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
  },
})

function Standing({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const { format, formatError } = useI18n()
  const result = useQuery(query.assessment.getMyResult.queryOptions({ params: { batchId } }))
  const items = useQuery(query.assessment.listItems.queryOptions({ params: { batchId } }))
  // for the two counts the empty state and the pending row speak in: what is
  // still moving is a fact about the filings, not about the score
  const mine = useQuery(
    query.assessment.listMyEntries.queryOptions({ params: { batchId }, query: {} }),
  )
  const data = result.data
  const entries = (mine.data?.entries ?? []) as readonly EntryDto[]
  const pendingCount = entries.filter((entry) => entry.status === 'in_review').length
  const draftCount = entries.filter((entry) => entry.status === 'draft').length

  // The arithmetic behind the account is out of reach. Not an error to
  // read past: nothing on this page is true until it answers, and the last
  // total it gave is not the current one - so the account is not drawn at
  // all, and the one thing offered is to ask again.
  const unavailable =
    result.error !== null && isApiErrorCode(result.error, 'ASSESSMENT_SCORING_UNAVAILABLE')
  if (unavailable) {
    return (
      <div {...stylex.props(styles.page)}>
        <section {...stylex.props(styles.unavailable)} data-testid="result-unavailable">
          <p {...stylex.props(styles.unavailableTitle)}>{format(m.resultUnavailableTitle)}</p>
          <p {...stylex.props(styles.unavailableHint)}>{format(m.resultUnavailableHint)}</p>
          <Button
            variant="outline"
            size="sm"
            disabled={result.isFetching}
            onClick={() => void result.refetch()}
          >
            {format(m.resultRecalculate)}
          </Button>
        </section>
      </div>
    )
  }

  return (
    <AsyncSection
      pending={result.isPending || items.isPending || mine.isPending}
      error={result.error ? formatError(result.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => {
        void result.refetch()
        void items.refetch()
        void mine.refetch()
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
            {['52%', '38%', '61%'].map((width, index) => (
              <div key={index} {...stylex.props(styles.skGroupRow)}>
                <Skeleton className={stylex.props(styles.skBone).className} width={width} />
                <Skeleton className={stylex.props(styles.skBone).className} />
              </div>
            ))}
          </div>
        </div>
      }
      xstyle={styles.page}
    >
      {data !== undefined && (
        <ResultLedger
          result={data}
          items={(items.data?.items ?? []) as readonly LedgerItem[]}
          entries={entries}
          emptyAction={<GoToEntries pending={pendingCount} drafts={draftCount} />}
        />
      )}
    </AsyncSection>
  )
}

/** the way to where the moving parts are, with what is moving beside it */
function GoToEntries({ pending, drafts }: { pending: number; drafts: number }) {
  const { format } = useI18n()
  const navigate = usePageNavigate()
  const { batchId } = usePageRouteParams('batchId')
  return (
    <div {...stylex.props(styles.goRow)}>
      <Button onClick={() => navigate('assessment/batch-my-entries', { params: { batchId } })}>
        {format(m.resultGoEntries)}
      </Button>
      {(pending > 0 || drafts > 0) && (
        <p {...stylex.props(styles.goCounts)}>{format(m.resultEmptyCounts, { pending, drafts })}</p>
      )}
    </div>
  )
}
