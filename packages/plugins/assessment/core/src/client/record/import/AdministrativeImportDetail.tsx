import { Fragment, useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRightIcon, DownloadIcon } from 'lucide-react'
import { choiceLabel, displayTitle, kindOf, type AtomicSchema } from '@qualy/value-schema'
import { cursorPages, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { toast } from '@qualy/ui/toast'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentApi, assessmentUrls } from '../../api.ts'
import { assessmentMessages as m } from '../../i18n.ts'
import { EntryStanding } from '../../entry/EntryStanding.tsx'
import { ReasonDialog } from '../../items/ReasonDialog.tsx'
import { sizeLabel } from '../../entry/model.ts'
import { sayEntryFailure } from '../../entry/refusals.ts'

// One import, looked back on.
//
// What it was comes first - the file, the question and its version, the
// shared basis, the original to download - then what it comes to now, then
// its rows. The rows are the facts it created, each opening the same sheet
// the record book opens, because a row here and its line there are one fact.
//
// Withdrawing what is left is offered only when the server says it could
// work, and it is all or nothing: the confirmation says what stays.

const PAGE = 50

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
  title: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 16,
    fontWeight: 600,
  },
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
  icon: { width: 14, height: 14 },
  sourceRow: { display: 'inline-flex', alignItems: 'baseline', gap: 10 },
  sourceLink: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    borderWidth: 0,
    backgroundColor: 'transparent',
    padding: 0,
    fontSize: 'inherit',
    lineHeight: 'inherit',
    fontFamily: 'inherit',
    color: { default: tokens.foreground, ':hover': tokens.foreground },
    textDecorationLine: { default: 'underline', ':hover': 'underline' },
    textUnderlineOffset: 3,
    cursor: { default: 'pointer', ':disabled': 'progress' },
  },
  sourceSize: { color: tokens.mutedForeground },
  reversals: { display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 },
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
    gridTemplateColumns: '3.5rem minmax(0, 7rem) minmax(0, 6rem) 7rem minmax(0, 1fr) 1rem',
    alignItems: 'center',
    columnGap: 12,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
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
    cursor: 'default',
    backgroundColor: 'transparent',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  cell: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  // the determined parts, spaced rather than punctuated
  determinedNone: { color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)` },
  determined: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    columnGap: 12,
    rowGap: 2,
    overflow: 'hidden',
  },
  chevron: {
    width: 16,
    height: 16,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  // what an import's page is: a band of facts, then the lines it carried
  waiting: { display: 'flex', flexDirection: 'column', gap: 14 },
  waitingFacts: {
    display: 'grid',
    gap: 10,
    gridTemplateColumns: 'auto minmax(0, 1fr)',
    alignItems: 'center',
  },
  waitingRows: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 6 },
  waitingBone: { height: 13, borderRadius: 4 },
  moreRow: { display: 'flex', justifyContent: 'center', paddingBlock: 8 },
})

export function AdministrativeImportDetail({
  batchId,
  importId,
  onOpenEntry,
}: {
  batchId: string
  importId: string
  onOpenEntry: (entryId: string) => void
}) {
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const [asking, setAsking] = useState(false)

  const detail = useQuery(
    query.assessment.getAdministrativeImport.queryOptions({ params: { importId } }),
  )
  const rows = useInfiniteQuery({
    queryKey: [
      ...query.assessment.listAdministrativeImportRows.key({ params: { importId }, query: {} }),
      'infinite',
    ],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listAdministrativeImportRows({
          params: { importId },
          query: {
            limit: String(PAGE),
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
          },
        }),
      ),
    ...cursorPages,
  })
  const lines = useMemo(() => rows.data?.pages.flatMap((page) => page.items) ?? [], [rows.data])

  const download = useMutation({
    mutationFn: () =>
      run(api.assessment.describeAdministrativeImportSource({ params: { importId } })),
    onSuccess: (described) => {
      // a store with its own door is sent to; otherwise the bytes come
      // through this api, under the file's own name
      window.location.assign(
        described.delivery.kind === 'redirect'
          ? described.delivery.url
          : assessmentUrls.assessment.getAdministrativeImportSourceContent({
              params: { importId },
            }),
      )
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const reverse = useMutation({
    mutationFn: (reason: string) =>
      run(
        api.assessment.reverseAdministrativeImport({
          params: { importId },
          payload: { reason },
        }),
      ),
    onSuccess: (done) => {
      toast.success(format(m.importReversed, { count: done.affectedCount }))
      // what the score is made of just changed: the import, its rows, the
      // history's standing and the record book are all asked again
      void queryClient.invalidateQueries({
        queryKey: query.assessment.getAdministrativeImport.key({ params: { importId } }),
      })
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeImportRows.key({
          params: { importId },
          query: {},
        }),
      })
      void queryClient.invalidateQueries({
        queryKey: query.assessment.listAdministrativeImports.key({
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
    onError: (error) => {
      const refused = error as { _tag?: string; issues?: readonly unknown[] }
      toast.error(
        refused._tag === 'ASSESSMENT_ADMINISTRATIVE_IMPORT_INVALID' && refused.issues !== undefined
          ? format(m.importReverseRefused, { count: refused.issues.length })
          : sayEntryFailure(error, { format, formatError }),
      )
    },
  })

  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    )

  // What was determined, as the parts it was determined in.
  //
  // They come back as a list rather than a sentence because what goes
  // between them is not a word in any language the catalogs carry: it is
  // whitespace, and the cell below sets it. `Intl.ListFormat` was tried and
  // is wrong here - in zh-CN a narrow unit list joins with nothing at all,
  // running "等级 省级" and "加分 3.00" into one unreadable run.
  const determinationOf = (recognition: (typeof lines)[number]['recognition']): string[] => {
    if (recognition === null) return []
    const values = (recognition.values ?? {}) as Record<string, unknown>
    return recognition.fields.flatMap((field) => {
      if (!Object.hasOwn(values, field.id)) return []
      const value = values[field.id]
      if (value === null || value === undefined || value === '') return []
      const schema = field.schema as AtomicSchema
      const text =
        kindOf(schema) === 'choice'
          ? choiceLabel(schema as never, String(value), locale)
          : typeof value === 'boolean'
            ? format(value ? m.recognitionYes : m.recognitionNo)
            : String(value)
      return [`${displayTitle(schema, field.id, locale)} ${text}`]
    })
  }

  const found = detail.data

  return (
    <AsyncSection
      pending={detail.isPending}
      error={detail.isError ? formatError(detail.error) : null}
      loadingLabel={format(commonMessages.loading)}
      retryLabel={format(commonMessages.retry)}
      onRetry={() => void detail.refetch()}
      skeleton={
        <div {...stylex.props(styles.waiting)}>
          <div {...stylex.props(styles.waitingFacts)}>
            {['46%', '58%', '39%'].map((width, index) => (
              <Fragment key={index}>
                <Skeleton className={stylex.props(styles.waitingBone).className} width={72} />
                <Skeleton className={stylex.props(styles.waitingBone).className} width={width} />
              </Fragment>
            ))}
          </div>
          <div {...stylex.props(styles.waitingRows)}>
            {['62%', '48%', '55%', '40%'].map((width, index) => (
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
        <div {...stylex.props(styles.column)} data-testid="administrative-import-detail">
          <div {...stylex.props(styles.sheet)}>
            <div {...stylex.props(styles.titleRow)}>
              <h2 {...stylex.props(styles.title)}>
                {found.source.available ? found.source.filename : format(m.importDetailTitle)}
              </h2>
              <span {...stylex.props(styles.by)}>
                {format(m.importDetailBy, {
                  when: when(found.createdAt),
                  actor: found.actor?.name ?? format(m.eventSomebody),
                })}
              </span>
              <span {...stylex.props(styles.spacer)} />
              {found.capabilities.reverse && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reverse.isPending}
                  onClick={() => setAsking(true)}
                  data-testid="import-reverse"
                >
                  {format(m.importReverse)}
                </Button>
              )}
            </div>

            <dl {...stylex.props(styles.facts)}>
              <dt {...stylex.props(styles.term)}>{format(m.recordItem)}</dt>
              <dd {...stylex.props(styles.value)}>{found.item.title}</dd>
              <dt {...stylex.props(styles.term)}>{format(m.importDetailRevision)}</dt>
              <dd {...stylex.props(styles.value)}>
                {format(m.importDetailRevisionNo, { no: found.itemRevision.revisionNo })}
              </dd>
              <dt {...stylex.props(styles.term)}>{format(m.importDefaultBasis)}</dt>
              <dd
                {...stylex.props(styles.value)}
                data-testid="import-basis"
                data-state={
                  found.defaultBasis !== null
                    ? 'written'
                    : found.source.available
                      ? 'none'
                      : 'withheld'
                }
              >
                {/* free text an office often writes names into, so it waits
                    for the same reach the file does */}
                {found.defaultBasis ??
                  format(
                    found.source.available ? m.importDetailBasisNone : m.importDetailSourceWithheld,
                  )}
              </dd>
              <dt {...stylex.props(styles.term)}>{format(m.importDetailSource)}</dt>
              <dd {...stylex.props(styles.value)}>
                {found.source.available ? (
                  <span {...stylex.props(styles.sourceRow)}>
                    {/* text-sized: a control at a control's own height in a
                        row of plain facts makes that one row taller than the
                        rest, and the whole list steps around it */}
                    <button
                      type="button"
                      disabled={download.isPending}
                      onClick={() => download.mutate()}
                      data-testid="import-source-download"
                      {...stylex.props(styles.sourceLink)}
                    >
                      <DownloadIcon aria-hidden {...stylex.props(styles.icon)} />
                      {format(m.importDetailDownload)}
                    </button>
                    <span {...stylex.props(styles.sourceSize)}>
                      {sizeLabel(Number(found.source.size))}
                    </span>
                  </span>
                ) : (
                  // the file's own name says who is in it, so it waits for
                  // the same reach its rows do
                  <span data-testid="import-source-withheld">
                    {format(m.importDetailSourceWithheld)}
                  </span>
                )}
              </dd>
              <dt {...stylex.props(styles.term)}>{format(m.importDetailCount)}</dt>
              <dd {...stylex.props(styles.value)}>
                {format(m.importStandingCount, { count: found.importedCount })}
              </dd>
              <dt {...stylex.props(styles.term)}>{format(m.importDetailNow)}</dt>
              <dd
                {...stylex.props(styles.value, styles.now)}
                data-testid="import-standing"
                data-approved={found.standing.approved}
                data-in-review={found.standing.inReview}
                data-rejected={found.standing.rejected}
                data-voided={found.standing.voided}
              >
                {found.standing.approved > 0 && (
                  <span>{format(m.importNowApproved, { count: found.standing.approved })}</span>
                )}
                {found.standing.inReview > 0 && (
                  <span>{format(m.importNowInReview, { count: found.standing.inReview })}</span>
                )}
                {found.standing.rejected > 0 && (
                  <span>{format(m.importNowRejected, { count: found.standing.rejected })}</span>
                )}
                {found.standing.voided > 0 && (
                  <span>{format(m.importNowVoided, { count: found.standing.voided })}</span>
                )}
              </dd>
              {found.reversals.length > 0 && (
                <>
                  <dt {...stylex.props(styles.term)}>{format(m.importReversals)}</dt>
                  <dd {...stylex.props(styles.value, styles.reversals)}>
                    {found.reversals.map((one) => (
                      <span
                        key={one.id}
                        data-testid="import-reversal"
                        data-reason={one.reason === null || one.reason === '' ? 'none' : 'written'}
                      >
                        {one.reason === null || one.reason === ''
                          ? format(m.importReversalLineBare, {
                              when: when(one.createdAt),
                              actor: one.actor?.name ?? format(m.eventSomebody),
                              count: one.affectedCount,
                            })
                          : format(m.importReversalLine, {
                              when: when(one.createdAt),
                              actor: one.actor?.name ?? format(m.eventSomebody),
                              count: one.affectedCount,
                              reason: one.reason,
                            })}
                      </span>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          </div>

          <p {...stylex.props(styles.section)}>{format(m.importRows)}</p>
          <AsyncSection
            pending={rows.isPending}
            error={rows.isError ? formatError(rows.error) : null}
            loadingLabel={format(commonMessages.loading)}
            retryLabel={format(commonMessages.retry)}
            onRetry={() => void rows.refetch()}
            skeleton={
              <div {...stylex.props(styles.waiting)}>
                <div {...stylex.props(styles.waitingFacts)}>
                  {['46%', '58%', '39%'].map((width, index) => (
                    <Fragment key={index}>
                      <Skeleton className={stylex.props(styles.waitingBone).className} width={72} />
                      <Skeleton
                        className={stylex.props(styles.waitingBone).className}
                        width={width}
                      />
                    </Fragment>
                  ))}
                </div>
                <div {...stylex.props(styles.waitingRows)}>
                  {['62%', '48%', '55%', '40%'].map((width, index) => (
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
            <div {...stylex.props(styles.card)} role="table" data-testid="import-rows">
              <div role="row" {...stylex.props(styles.row, styles.headRow)}>
                <span role="columnheader">{format(m.importColumnRow)}</span>
                <span role="columnheader">{businessNo}</span>
                <span role="columnheader">{format(m.importColumnName)}</span>
                <span role="columnheader">{format(m.importColumnStatus)}</span>
                <span role="columnheader">{format(m.importColumnDetermination)}</span>
                <span />
              </div>
              {lines.map((line) => (
                <button
                  key={line.entryId}
                  type="button"
                  role="row"
                  data-testid="import-row"
                  data-row={line.rowNo}
                  data-entry={line.entryId}
                  onClick={() => onOpenEntry(line.entryId)}
                  {...stylex.props(styles.row)}
                >
                  <span role="cell">{line.rowNo}</span>
                  <span
                    role="cell"
                    {...stylex.props(
                      styles.cell,
                      (line.businessNoSnapshot ?? line.participant.businessNo) === null &&
                        styles.determinedNone,
                    )}
                  >
                    {line.businessNoSnapshot ??
                      line.participant.businessNo ??
                      format(m.noBusinessNoShort, { businessNo })}
                  </span>
                  <span role="cell" {...stylex.props(styles.cell)}>
                    {line.participant.displayName}
                  </span>
                  <span role="cell">
                    <EntryStanding status={line.status} source="import" />
                  </span>
                  <span role="cell" {...stylex.props(styles.determined)}>
                    {(() => {
                      const parts = determinationOf(line.recognition)
                      // a question that determines nothing leaves this cell
                      // empty on every row, which reads as data that failed
                      // to load rather than as a column that does not apply
                      return parts.length > 0 ? (
                        parts.map((part) => <span key={part}>{part}</span>)
                      ) : (
                        <span {...stylex.props(styles.determinedNone)}>
                          {format(m.recognitionNoValuesShort)}
                        </span>
                      )
                    })()}
                  </span>
                  <ChevronRightIcon aria-hidden {...stylex.props(styles.chevron)} />
                </button>
              ))}
            </div>
            {rows.hasNextPage && (
              <div {...stylex.props(styles.moreRow)}>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rows.isFetchingNextPage}
                  onClick={() => void rows.fetchNextPage()}
                >
                  {format(m.recordMoreWho)}
                </Button>
              </div>
            )}
          </AsyncSection>

          {/* the reason is required by the contract and read later by whoever
              reconstructs why a round's scores moved */}
          <ReasonDialog
            open={asking}
            title={format(m.importReverseTitle)}
            description={format(m.importReverseHint)}
            confirmLabel={format(m.importReverse)}
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
