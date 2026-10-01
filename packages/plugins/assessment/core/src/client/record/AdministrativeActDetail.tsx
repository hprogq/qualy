import { formatPlatformFailure as formatError } from '@qualy/web-i18n'
import {
  useApiMutation,
  LoadFailure,
  isRecordId,
  useApi,
  useApiQuery,
  useLoadFailure,
} from '@qualy/web-runtime'
import { Fragment, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'

import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'

import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'

import { sayEntryFailure } from '../entry/refusals.ts'
import { ReasonDialog } from '../items/ReasonDialog.tsx'
import { RecordStanding } from './RecordStanding.tsx'
import { useWhen } from './when.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One bulk act, looked back on.
//
// What it was comes first - the question, how the people were found, how
// many facts it wrote - then what it comes to now, then what has been done
// to it.
//
// How the people were found is shown as a phrase rather than as the units
// themselves, and that is deliberate. The selection is history: it says how
// somebody arrived at this set on the day, and re-reading it as a list of
// units invites the reader to believe the act still means "class 1", which
// is the one thing it does not mean (§32.78). What the act reaches is the
// facts it wrote, and those are what a withdrawal walks.
//
// An act that is not there is said as that, with the way back to the acts.

/** the one answer that means the act itself is not there for this reader */
const RECORD_NOT_FOUND = 'ASSESSMENT_ADMINISTRATIVE_RECORD_NOT_FOUND'

const styles = stylex.create({
  column: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 16 },
  sheet: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    padding: 20,
  },
  titleRow: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 12 },
  title: { fontSize: 16, fontWeight: 600 },
  by: { fontSize: 13, color: tokens.mutedForeground },
  spacer: { flexGrow: 1 },
  facts: {
    display: 'grid',
    gridTemplateColumns: 'max-content minmax(0, 1fr)',
    columnGap: 24,
    rowGap: 10,
    margin: 0,
    fontSize: 14,
    lineHeight: '1.25rem',
  },
  term: { color: tokens.mutedForeground },
  value: { minWidth: 0, margin: 0, overflowWrap: 'anywhere' },
  now: { display: 'flex', flexWrap: 'wrap', gap: 12 },
  events: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 },
  section: { fontSize: 14, fontWeight: 600 },
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  row: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: 'minmax(0, 8rem) minmax(0, 1fr) 7rem 1rem',
    alignItems: 'center',
    columnGap: 12,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    paddingInline: 16,
    paddingBlock: 10,
    textAlign: 'start',
    fontSize: 13,
    cursor: 'pointer',
  },
  headRow: {
    backgroundColor: tokens.surfaceInset,
    cursor: 'default',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  cell: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  no: { fontVariantNumeric: 'tabular-nums' },
  noneGiven: { color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)` },
  chevron: {
    width: 16,
    height: 16,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  // what an act's page is: a few facts in a list, then the people it
  // reached - drawn as that rather than as a rectangle of its height
  waiting: { display: 'flex', flexDirection: 'column', gap: 14 },
  waitingFacts: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'center',
  },
  waitingRows: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 },
  waitingBone: { height: 13, borderRadius: 4 },
})

export function AdministrativeActDetail({
  batchId,
  operationId,
  onOpenEntry,
}: {
  batchId: string
  operationId: string
  onOpenEntry: (entryId: string) => void
}) {
  const api = useApi(assessmentApi)
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()

  const businessNo = useTerm(authTerms.businessNumber)
  const whenOf = useWhen()
  const [asking, setAsking] = useState(false)
  const words = useLoadFailure()
  // an address that cannot name an act is not asked about at all
  const named = isRecordId(operationId)

  // the people an act reached arrive a page at a time: one act may name
  // thousands, and a list that stops without saying so is not the act
  const [rowsCursor, setRowsCursor] = useState<string | null>(null)
  const detail = useQuery({
    ...query.assessment.getAdministrativeRecord.queryOptions({
      params: { operationId },
      query: rowsCursor === null ? {} : { rowsCursor },
    }),
    enabled: named,
  })

  const reverse = useApiMutation({
    mutationFn: (reason: string) =>
      api.assessment.reverseAdministrativeRecord({
        params: { operationId },
        payload: { reason },
      }),
    onSuccess: (done) => {
      toast.success(m.record_actReversed({ count: done.affectedCount }))
      // what the score is made of just changed: the act, the acts list and
      // the record book are all asked again
      void queryClient.invalidateQueries({
        queryKey: query.assessment.getAdministrativeRecord.key({
          params: { operationId },
          query: {},
        }),
      })
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeRecords.key({
          params: { batchId },
          query: {},
        }),
      })
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeEntries.key({
          params: { batchId },
          query: {},
        }),
      })
    },
    onError: (error) => toast.error(sayEntryFailure(error, { formatError })),
  })

  const found = detail.data

  // A bulk record shown already stays up through a reading that failed
  // after it; only one that turned out not to be there, or not the
  // reader's, takes its place.
  const copy = {
    missing: { title: m.record_actMissing(), description: m.record_missingHint() },
  }
  const failure = named
    ? words.subject(detail, { missing: [RECORD_NOT_FOUND], copy })
    : words.missing({ copy })
  if (failure !== null) {
    return (
      <div data-testid="administrative-act-absent">
        <LoadFailure
          size="section"
          failure={failure}
          onRetry={() => void detail.refetch()}
          retrying={detail.isFetching}
          back={{
            page: 'assessment/batch-record',
            params: { batchId },
            search: { tab: 'acts' },
            label: m.record_actBack(),
          }}
        />
      </div>
    )
  }

  return (
    <AsyncSection
      pending={detail.isPending}
      loadingLabel={commonMessages.state_loading()}
      retryLabel={commonMessages.action_retry()}
      onRetry={() => void detail.refetch()}
      skeleton={
        <div {...stylex.props(styles.waiting)}>
          <div {...stylex.props(styles.waitingFacts)}>
            {['52%', '38%', '61%', '44%'].map((width, index) => (
              <Fragment key={index}>
                <Skeleton className={stylex.props(styles.waitingBone).className} width={72} />
                <Skeleton className={stylex.props(styles.waitingBone).className} width={width} />
              </Fragment>
            ))}
          </div>
          <div {...stylex.props(styles.waitingRows)}>
            {['48%', '57%', '41%'].map((width, index) => (
              <Skeleton
                key={index}
                className={stylex.props(styles.waitingBone).className}
                width={width}
              />
            ))}
          </div>
        </div>
      }
    >
      {found !== undefined && (
        <div {...stylex.props(styles.column)} data-testid="administrative-act-detail">
          <section {...stylex.props(styles.sheet)}>
            <div {...stylex.props(styles.titleRow)}>
              <h2 {...stylex.props(styles.title)}>{m.record_actTitle()}</h2>
              <span {...stylex.props(styles.by)}>{whenOf(found.createdAt)}</span>
              <span {...stylex.props(styles.spacer)} />
              {/* offered whenever anything of it still counts; the server
                  decides again, and says so if nothing is left */}
              {found.voidedCount < found.recordedCount && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reverse.isPending}
                  onClick={() => setAsking(true)}
                  data-testid="act-reverse"
                >
                  {m.record_actReverse()}
                </Button>
              )}
            </div>

            <dl {...stylex.props(styles.facts)}>
              <dt {...stylex.props(styles.term)}>{m.record_actItem()}</dt>
              <dd {...stylex.props(styles.value)}>{found.itemTitle}</dd>
              <dt {...stylex.props(styles.term)}>{m.record_targets()}</dt>
              <dd {...stylex.props(styles.value)}>
                {(found.targetKind === 'organization'
                  ? m.record_actByUnits
                  : m.record_actByPeople)()}
              </dd>
              <dt {...stylex.props(styles.term)}>{m.record_import_detailCount()}</dt>
              <dd {...stylex.props(styles.value)} data-count={found.recordedCount}>
                {m.record_actCount({ count: found.recordedCount })}
              </dd>
              <dt {...stylex.props(styles.term)}>{m.record_import_detailNow()}</dt>
              <dd {...stylex.props(styles.value)}>
                <span {...stylex.props(styles.now)} data-voided={found.voidedCount}>
                  <span>
                    {m.record_actCount({
                      count: found.recordedCount - found.voidedCount,
                    })}
                  </span>
                  {found.voidedCount > 0 && (
                    <span>{m.record_actVoided({ count: found.voidedCount })}</span>
                  )}
                </span>
              </dd>
            </dl>

            {found.events.length > 0 && (
              <dl {...stylex.props(styles.facts)}>
                <dt {...stylex.props(styles.term)}>{m.record_actEvents()}</dt>
                <dd {...stylex.props(styles.value, styles.events)}>
                  {found.events.map((one) => (
                    <span key={one.id}>
                      {m.record_actEventLine({
                        when: whenOf(one.createdAt),
                        actor: one.actorName ?? m.record_actorUnknown(),
                        count: one.affectedCount,
                        reason: one.reason ?? '',
                      })}
                    </span>
                  ))}
                </dd>
              </dl>
            )}
          </section>

          {/* the same table the import's rows use, because it answers the
              same question: which people this act reached, and what each of
              their facts is now. A row opens that fact. */}
          {found.rows.length > 0 && (
            <>
              <p {...stylex.props(styles.section)}>{m.record_actRows()}</p>
              <div {...stylex.props(styles.card)} role="table" data-testid="act-rows">
                <div role="row" {...stylex.props(styles.row, styles.headRow)}>
                  <span role="columnheader">{businessNo}</span>
                  <span role="columnheader">{m.record_import_columnName()}</span>
                  <span role="columnheader">{m.record_import_columnStatus()}</span>
                  <span />
                </div>
                {found.rows.map((one) => (
                  <button
                    key={one.participantId}
                    type="button"
                    role="row"
                    data-testid="act-row"
                    data-entry={one.entryId}
                    onClick={() => onOpenEntry(one.entryId)}
                    {...stylex.props(styles.row)}
                  >
                    {/* an empty cell reads as data that failed to arrive;
                        this person simply has no number bound */}
                    <span
                      role="cell"
                      {...stylex.props(
                        styles.cell,
                        styles.no,
                        one.businessNo === null && styles.noneGiven,
                      )}
                    >
                      {one.businessNo ?? m.roster_noBusinessNo({ businessNo })}
                    </span>
                    <span role="cell" {...stylex.props(styles.cell)}>
                      {one.displayName}
                    </span>
                    <span role="cell">
                      <RecordStanding status={one.status as never} />
                    </span>
                    <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                  </button>
                ))}
              </div>
              {found.rowsNextCursor !== null && (
                <Button
                  variant="outline"
                  data-testid="act-rows-more"
                  onClick={() => setRowsCursor(found.rowsNextCursor)}
                >
                  {m.record_moreWho()}
                </Button>
              )}
            </>
          )}

          {/* the reason is required by the contract and read later by whoever
              reconstructs why a round's scores moved */}
          <ReasonDialog
            open={asking}
            title={m.record_actReverseTitle()}
            description={m.record_actReverseHint()}
            confirmLabel={m.record_actReverse()}
            busy={reverse.isPending}
            onConfirm={(reason) => {
              setAsking(false)
              reverse.mutate(reason)
            }}
            onClose={() => setAsking(false)}
          />
        </div>
      )}
    </AsyncSection>
  )
}
