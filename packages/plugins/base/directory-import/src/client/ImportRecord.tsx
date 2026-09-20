import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  cursorPages,
  PageLink,
  useApi,
  useApiQuery,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog, Field, FormDialog } from '@qualy/ui/admin'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { DetailSheet } from '@qualy/ui/screen'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { directoryApi } from './api.ts'
import { directoryImportMessages as m } from './i18n.ts'
import { whenText } from './words.ts'

// One import as history: what it did, what became of the people, and the
// two things that can still be done to it - reversing it, which deletes
// the people it created, and cleaning it, which removes the units it made
// that nothing uses any more.

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 24 },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: 20,
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  facts: {
    display: 'grid',
    gap: 12,
    gridTemplateColumns: { default: 'minmax(0, 1fr)', '@media (min-width: 720px)': 'repeat(2, minmax(0, 1fr))' },
    margin: 0,
  },
  fact: { display: 'flex', flexDirection: 'column', gap: 2 },
  factLabel: { fontSize: 12, color: tokens.mutedForeground },
  factValue: { margin: 0, fontSize: 14 },
  row: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  spacer: { flexGrow: 1 },
  sectionTitle: { margin: 0, fontSize: 13, fontWeight: 600 },
  quiet: { margin: 0, fontSize: 12, color: tokens.mutedForeground },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: 13 },
  th: {
    textAlign: 'start',
    whiteSpace: 'nowrap',
    padding: 8,
    fontWeight: 500,
    color: tokens.mutedForeground,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  td: { padding: 8, borderBottomWidth: 1, borderBottomStyle: 'solid', borderBottomColor: tokens.divider },
  line: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 },
  danger: { color: tokens.danger },
})

/**
 * One import's record, in a sheet beside the roster: what it did, what has
 * become of the people since, and the two ways of taking it back.
 */
export function ImportRecordSheet({
  importId,
  open,
  onClose,
}: {
  importId: string
  open: boolean
  onClose: () => void
}) {
  const { format, formatError, locale } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const api = useApi(directoryApi)
  const query = useApiQuery(directoryApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const detail = useQuery(query.directory.getUserImport.queryOptions({ params: { importId } }))
  const rows = useInfiniteQuery({
    queryKey: [...query.directory.listUserImportRows.key({ params: { importId }, query: {} }), 'infinite'],
    queryFn: ({ pageParam }) =>
      run(
        api.directory.listUserImportRows({
          params: { importId },
          query: pageParam === undefined ? {} : { cursor: pageParam },
        }),
      ),
    ...cursorPages,
  })
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState('')
  const [cleaning, setCleaning] = useState(false)
  const reversal = useQuery({
    ...query.directory.previewUserImportReversal.queryOptions({ params: { importId } }),
    enabled: reversing,
  })
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: query.directory.key() })
    void rows.refetch()
  }
  const reverse = useMutation({
    mutationFn: () =>
      run(api.directory.reverseUserImport({ params: { importId }, payload: { reason: reason.trim() } })),
    onSuccess: (outcome) => {
      toast.success(format(m.reversed, { retired: outcome.retired }))
      setReversing(false)
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })
  const clean = useMutation({
    mutationFn: () => run(api.directory.cleanUserImportNodes({ params: { importId } })),
    onSuccess: (outcome) => {
      toast.success(format(m.cleaned, { deleted: outcome.deleted, retained: outcome.retained.length }))
      setCleaning(false)
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const found = detail.data
  const items = rows.data?.pages.flatMap((page) => page.items) ?? []
  const standingWords = {
    active: m.standingActive,
    disabled: m.standingDisabled,
    deleted: m.standingDeleted,
    missing: m.standingMissing,
  } as const

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      width="wide"
      title={found === undefined ? format(m.recordsTitle) : found.import.filename}
      closeLabel={format(m.recordClose)}
      testId="import-record-sheet"
    >
      <AsyncSection
        pending={detail.isPending}
        error={detail.isError ? formatError(detail.error) : null}
        loadingLabel={format(m.recordLoading)}
        retryLabel={format(m.retry)}
        onRetry={() => void detail.refetch()}
      >
        {found !== undefined && (
          <div {...stylex.props(styles.page)} data-testid="import-record-page">
            <section {...stylex.props(styles.card)}>
              <dl {...stylex.props(styles.facts)}>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{format(m.recordBy)}</dt>
                  <dd {...stylex.props(styles.factValue)}>{found.import.actorName ?? '–'}</dd>
                </div>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{format(m.recordAt)}</dt>
                  <dd {...stylex.props(styles.factValue)}>{whenText(locale, found.import.createdAt)}</dd>
                </div>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{format(m.recordUnder)}</dt>
                  <dd {...stylex.props(styles.factValue)}>
                    {[found.import.anchorPath, ...found.import.chain.slice(found.import.anchorPath === '' ? 0 : 1)]
                      .filter((part) => part !== '')
                      .join(' / ')}
                  </dd>
                </div>
                <div {...stylex.props(styles.fact)}>
                  <dt {...stylex.props(styles.factLabel)}>{format(m.recordType)}</dt>
                  <dd {...stylex.props(styles.factValue)}>{found.import.userTypeName ?? '–'}</dd>
                </div>
              </dl>
              <p {...stylex.props(styles.factValue)} data-testid="import-counts">
                {format(m.recordCounts, {
                  users: found.import.createdUserCount,
                  existing: found.import.existingUserCount,
                  nodes: found.import.createdNodeCount,
                })}
              </p>
              <p {...stylex.props(styles.quiet)} data-testid="import-standing" data-living={found.import.standing.living}>
                {format(m.recordStanding, found.import.standing)}
              </p>
              <div {...stylex.props(styles.row)}>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={found.import.standing.living === 0}
                  onClick={() => setReversing(true)}
                >
                  {format(m.reverse)}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!found.nodes.some((node) => node.disposition === 'created' && node.present)}
                  onClick={() => setCleaning(true)}
                >
                  {format(m.clean)}
                </Button>
              </div>
            </section>

            {found.events.length > 0 && (
              <section {...stylex.props(styles.card)}>
                <p {...stylex.props(styles.sectionTitle)}>{format(m.recordEvents)}</p>
                {found.events.map((event) => (
                  <div key={event.id} {...stylex.props(styles.line)} data-testid="import-event" data-kind={event.kind}>
                    <span>
                      {event.kind === 'reversed'
                        ? format(m.eventReversed, { count: event.affectedUserCount })
                        : format(m.eventCleaned, {
                            deleted: event.deletedNodeCount,
                            retained: event.retainedNodeCount,
                          })}
                    </span>
                    <span {...stylex.props(styles.quiet)}>
                      {[event.actorName, whenText(locale, event.createdAt), event.reason]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>
                ))}
              </section>
            )}

            {found.nodes.length > 0 && (
              <section {...stylex.props(styles.card)}>
                <p {...stylex.props(styles.sectionTitle)}>{format(m.recordNodes)}</p>
                {found.nodes.map((node) => (
                  <div key={node.id} {...stylex.props(styles.line)} data-testid="import-node" data-present={node.present}>
                    <span>{node.path}</span>
                    <Badge variant="secondary">
                      {format(node.disposition === 'created' ? m.dispositionCreated : m.dispositionReused)}
                    </Badge>
                    {!node.present && <Badge variant="outline">{format(m.nodeGone)}</Badge>}
                  </div>
                ))}
              </section>
            )}

            <section {...stylex.props(styles.card)}>
              <p {...stylex.props(styles.sectionTitle)}>{format(m.recordRows)}</p>
              <table {...stylex.props(styles.table)}>
                <thead>
                  <tr>
                    <th {...stylex.props(styles.th)}>{format(m.columnRow)}</th>
                    <th {...stylex.props(styles.th)}>{businessNo}</th>
                    <th {...stylex.props(styles.th)}>{format(m.columnName)}</th>
                    <th {...stylex.props(styles.th)}>{format(m.columnUnit)}</th>
                    <th {...stylex.props(styles.th)}>{format(m.columnOutcome)}</th>
                    <th {...stylex.props(styles.th)}>{format(m.columnStanding)}</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((row) => (
                    <tr key={row.sourceRowNo} data-testid="import-row" data-standing={row.standing}>
                      <td {...stylex.props(styles.td)}>{row.sourceRowNo}</td>
                      <td {...stylex.props(styles.td)}>{row.businessNo}</td>
                      <td {...stylex.props(styles.td)}>
                        {row.userId === null ? (
                          row.displayName
                        ) : (
                          <PageLink page="auth/user-detail" params={{ userId: row.userId }}>
                            {row.displayName}
                          </PageLink>
                        )}
                      </td>
                      <td {...stylex.props(styles.td)}>{row.orgPath}</td>
                      <td {...stylex.props(styles.td)}>
                        {format(row.disposition === 'created' ? m.dispositionCreated : m.dispositionExisting)}
                      </td>
                      <td {...stylex.props(styles.td, row.standing === 'deleted' && styles.danger)}>
                        {format(standingWords[row.standing])}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.hasNextPage && (
                <div>
                  <Button variant="ghost" size="sm" disabled={rows.isFetchingNextPage} onClick={() => void rows.fetchNextPage()}>
                    {format(m.recordsLoadMore)}
                  </Button>
                </div>
              )}
            </section>
          </div>
        )}
      </AsyncSection>

      <FormDialog
        open={reversing}
        title={format(m.reverseTitle)}
        description={
          reversal.data === undefined
            ? undefined
            : reversal.data.toRetire === 0
              ? format(m.reverseNothing)
              : format(m.reversalHint, {
                  count: reversal.data.toRetire,
                  identities: reversal.data.withIdentities,
                  grants: reversal.data.withGrants,
                })
        }
        onClose={() => setReversing(false)}
        footer={
          <div {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.spacer)} />
            <Button variant="outline" onClick={() => setReversing(false)}>
              {format(m.cancel)}
            </Button>
            <Button
              variant="destructive"
              disabled={reason.trim() === '' || reverse.isPending || (reversal.data?.toRetire ?? 0) === 0}
              onClick={() => reverse.mutate()}
            >
              {format(m.reverseConfirm)}
            </Button>
          </div>
        }
      >
        <Field required label={format(m.reverseReason)}>
          {(id) => <Textarea id={id} rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />}
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={cleaning}
        title={format(m.cleanTitle)}
        description={format(m.cleanHint)}
        confirmLabel={format(m.cleanConfirm)}
        cancelLabel={format(m.cancel)}
        pending={clean.isPending}
        onConfirm={() => clean.mutate()}
        onCancel={() => setCleaning(false)}
      />
    </DetailSheet>
  )
}
