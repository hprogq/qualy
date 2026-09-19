import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { ChevronRightIcon } from 'lucide-react'
import { useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi } from '../api.ts'
import { assessmentMessages as m } from '../i18n.ts'
import { ReasonDialog } from '../items/ReasonDialog.tsx'
import { RecordStanding } from './RecordStanding.tsx'
import { useWhen } from './when.ts'

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
  waiting: { height: 200, width: '100%' },
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
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError } = useI18n()
  const whenOf = useWhen()
  const [asking, setAsking] = useState(false)

  // the people an act reached arrive a page at a time: one act may name
  // thousands, and a list that stops without saying so is not the act
  const [rowsCursor, setRowsCursor] = useState<string | null>(null)
  const detail = useQuery(
    query.assessment.getAdministrativeRecord.queryOptions({
      params: { operationId },
      query: rowsCursor === null ? {} : { rowsCursor },
    }),
  )

  const reverse = useMutation({
    mutationFn: (reason: string) =>
      run(
        api.assessment.reverseAdministrativeRecord({
          params: { operationId },
          payload: { reason },
        }),
      ),
    onSuccess: (done) => {
      toast.success(format(m.recordActReversed, { count: done.affectedCount }))
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
    onError: (error) => toast.error(formatError(error)),
  })

  const found = detail.data

  return (
    <AsyncSection
      pending={detail.isPending}
      error={detail.isError ? formatError(detail.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void detail.refetch()}
      skeleton={<Skeleton className={stylex.props(styles.waiting).className} />}
    >
      {found !== undefined && (
        <div {...stylex.props(styles.column)} data-testid="administrative-act-detail">
          <section {...stylex.props(styles.sheet)}>
            <div {...stylex.props(styles.titleRow)}>
              <h2 {...stylex.props(styles.title)}>{format(m.recordActTitle)}</h2>
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
                  {format(m.recordActReverse)}
                </Button>
              )}
            </div>

            <dl {...stylex.props(styles.facts)}>
              <dt {...stylex.props(styles.term)}>{format(m.recordActItem)}</dt>
              <dd {...stylex.props(styles.value)}>{found.itemTitle}</dd>
              <dt {...stylex.props(styles.term)}>{format(m.recordTargets)}</dt>
              <dd {...stylex.props(styles.value)}>
                {format(
                  found.targetKind === 'organization' ? m.recordActByUnits : m.recordActByPeople,
                )}
              </dd>
              <dt {...stylex.props(styles.term)}>{format(m.importDetailCount)}</dt>
              <dd {...stylex.props(styles.value)} data-count={found.recordedCount}>
                {format(m.recordActCount, { count: found.recordedCount })}
              </dd>
              <dt {...stylex.props(styles.term)}>{format(m.importDetailNow)}</dt>
              <dd {...stylex.props(styles.value)}>
                <span {...stylex.props(styles.now)} data-voided={found.voidedCount}>
                  <span>
                    {format(m.recordActCount, {
                      count: found.recordedCount - found.voidedCount,
                    })}
                  </span>
                  {found.voidedCount > 0 && (
                    <span>{format(m.recordActVoided, { count: found.voidedCount })}</span>
                  )}
                </span>
              </dd>
            </dl>

            {found.events.length > 0 && (
              <dl {...stylex.props(styles.facts)}>
                <dt {...stylex.props(styles.term)}>{format(m.recordActEvents)}</dt>
                <dd {...stylex.props(styles.value, styles.events)}>
                  {found.events.map((one) => (
                    <span key={one.id}>
                      {format(m.recordActEventLine, {
                        when: whenOf(one.createdAt),
                        actor: one.actorName ?? format(m.recordActorUnknown),
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
              <p {...stylex.props(styles.section)}>{format(m.recordActRows)}</p>
              <div {...stylex.props(styles.card)} role="table" data-testid="act-rows">
                <div role="row" {...stylex.props(styles.row, styles.headRow)}>
                  <span role="columnheader">{format(m.importColumnBusinessNo)}</span>
                  <span role="columnheader">{format(m.importColumnName)}</span>
                  <span role="columnheader">{format(m.importColumnStatus)}</span>
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
                      {one.businessNo ?? format(m.noBusinessNoShort)}
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
                  {format(m.recordMoreWho)}
                </Button>
              )}
            </>
          )}

          {/* the reason is required by the contract and read later by whoever
              reconstructs why a round's scores moved */}
          <ReasonDialog
            open={asking}
            title={format(m.recordActReverseTitle)}
            description={format(m.recordActReverseHint)}
            confirmLabel={format(m.recordActReverse)}
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
