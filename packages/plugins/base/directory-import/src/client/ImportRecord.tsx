import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { UserRoundCheckIcon } from 'lucide-react'
import { PageLink, useApi, useApiQuery, useLoadFailure, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'

import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
  Blank,
  Card,
  CardFoot,
  CardHead,
  Cell,
  DetailSheet,
  FactStrip,
  FootNote,
  Spacer,
  Status,
  Table,
  TableHead,
  TableRow,
} from '@qualy/ui/screen'
import { Pager } from '@qualy/ui/pager'
import { useIsBelow } from '@qualy/ui/use-mobile'
import { Textarea } from '@qualy/ui/textarea'
import { toast } from '@qualy/ui/toast'
import { directoryApi } from './api.ts'

import { whenText } from './words.ts'
import * as commonMessages from '@qualy/web-i18n/messages'
import * as m from '#messages'

// One import as history: what it did, what became of the people, and the
// two things that can still be done to it - reversing it, which deletes
// the people it created, and cleaning it, which removes the units it made
// that nothing uses any more.

/** rows of the source file to a page */
const ROWS_PER_PAGE = 20
/** units touched to a page: they arrive whole, and a big import names hundreds */
const NODES_PER_PAGE = 10

const styles = stylex.create({
  page: { display: 'flex', flexDirection: 'column', gap: 14 },
  row: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  spacer: { flexGrow: 1 },
  outcome: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingInline: 16,
    paddingBlock: 12,
    fontSize: 13,
  },
  quiet: { fontSize: 12, color: tokens.mutedForeground },
  // Narrow, a row of six columns is not a row: the person and where they
  // stand on the left, what the import did to them and what they are now on
  // the right, one under the other.
  person: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 10,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  personWords: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  personLine: { display: 'flex', minWidth: 0, alignItems: 'baseline', gap: 8 },
  personName: { fontSize: 13.5, fontWeight: 500 },
  personNo: { fontSize: 12, fontVariantNumeric: 'tabular-nums', color: tokens.mutedForeground },
  personWhere: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  personStanding: {
    display: 'flex',
    flexShrink: 0,
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    marginLeft: 'auto',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  gone: { display: 'inline-flex', alignItems: 'center', gap: 5, color: tokens.danger },
  goneDot: {
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.danger,
  },
  elsewhere: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    paddingInline: 14,
    paddingBlock: 12,
    borderRadius: 12,
    backgroundColor: tokens.surfaceInset,
    fontSize: 12.5,
    lineHeight: 1.55,
    color: tokens.surfaceMutedForeground,
  },
  personLink: {
    color: 'inherit',
    textDecorationLine: { default: 'none', ':hover': 'underline' },
    textUnderlineOffset: 3,
  },
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
  const { formatError, locale } = useI18n()
  const businessNo = useTerm(authTerms.businessNumber)
  const phone = useIsBelow(768)
  const api = useApi(directoryApi)
  const query = useApiQuery(directoryApi)
  const run = useRunApi()
  const queryClient = useQueryClient()
  const detail = useQuery(query.directory.getUserImport.queryOptions({ params: { importId } }))
  const [rowPage, setRowPage] = useState(1)
  const [nodePage, setNodePage] = useState(1)
  const rows = useQuery({
    ...query.directory.listUserImportRows.queryOptions({
      params: { importId },
      query: { page: String(rowPage), limit: String(ROWS_PER_PAGE) },
    }),
    placeholderData: keepPreviousData,
  })
  const [reversing, setReversing] = useState(false)
  const [reason, setReason] = useState('')
  const [cleaning, setCleaning] = useState(false)
  const reversal = useQuery({
    ...query.directory.previewUserImportReversal.queryOptions({ params: { importId } }),
    enabled: reversing,
  })
  const failed = useLoadFailure()
  // nobody the import made is left to delete: the dialog says so and asks
  // for nothing, rather than wanting a reason for a press that does nothing
  const nothingLeft = reversal.data !== undefined && reversal.data.toRetire === 0
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: query.directory.key() })
  }
  const reverse = useMutation({
    mutationFn: () =>
      run(
        api.directory.reverseUserImport({
          params: { importId },
          payload: { reason: reason.trim() },
        }),
      ),
    onSuccess: (outcome) => {
      toast.success(m.reverse_done({ retired: outcome.retired }))
      setReversing(false)
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })
  const clean = useMutation({
    mutationFn: () => run(api.directory.cleanUserImportNodes({ params: { importId } })),
    onSuccess: (outcome) => {
      toast.success(m.clean_done({ deleted: outcome.deleted, retained: outcome.retained.length }))
      setCleaning(false)
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const found = detail.data
  // the import is what the sheet is about: one shown already stays up
  // through a reading that failed after it
  const absent = failed.subject(detail, {
    missing: ['USER_IMPORT_NOT_FOUND'],
    copy: {
      missing: { title: m.record_missing() },
      failed: { title: m.record_failed() },
    },
  })
  const items = rows.data?.items ?? []
  const standingWords = {
    active: m.record_standingActive,
    disabled: m.record_standingDisabled,
    deleted: m.record_standingDeleted,
    missing: m.record_standingMissing,
  } as const

  return (
    <DetailSheet
      open={open}
      onClose={onClose}
      width="wide"
      title={found === undefined ? m.records_title() : found.import.filename}
      closeLabel={m.record_close()}
      testId="import-record-sheet"
    >
      <AsyncSection
        pending={detail.isPending}
        error={absent}
        loadingLabel={m.record_loading()}
        retryLabel={m.records_retry()}
        onRetry={() => void detail.refetch()}
      >
        {found !== undefined && (
          <div {...stylex.props(styles.page)} data-testid="import-record-page">
            <FactStrip
              columns={4}
              items={[
                { label: m.record_by(), value: found.import.actorName ?? '—' },
                { label: m.record_at(), value: whenText(locale, found.import.createdAt) },
                { label: m.record_type(), value: found.import.userTypeName ?? '—' },
                {
                  label: m.record_under(),
                  value:
                    [
                      found.import.anchorPath,
                      ...found.import.chain.slice(found.import.anchorPath === '' ? 0 : 1),
                    ]
                      .filter((part) => part !== '')
                      .join(' / ') || '—',
                },
              ]}
            />

            <Card>
              <CardHead title={m.record_outcome()} />
              <div {...stylex.props(styles.outcome)}>
                <span data-testid="import-counts">
                  {m.record_counts({
                    users: found.import.createdUserCount,
                    existing: found.import.existingUserCount,
                    nodes: found.import.createdNodeCount,
                  })}
                </span>
                <span
                  {...stylex.props(styles.quiet)}
                  data-testid="import-standing"
                  data-living={found.import.standing.living}
                >
                  {m.record_standing(found.import.standing)}
                </span>
                {/* the counts above are the import's own; what of it this
                    reader is not shown is said, not left as an empty list */}
                {found.hidden.rows > 0 && (
                  <span
                    {...stylex.props(styles.quiet)}
                    data-testid="import-hidden-rows"
                    data-count={found.hidden.rows}
                  >
                    {m.record_hiddenRows({ count: found.hidden.rows })}
                  </span>
                )}
                {found.hidden.nodes > 0 && (
                  <span
                    {...stylex.props(styles.quiet)}
                    data-testid="import-hidden-nodes"
                    data-count={found.hidden.nodes}
                  >
                    {m.record_hiddenNodes({ count: found.hidden.nodes })}
                  </span>
                )}
              </div>
              {/* Reversing an import means reading how many of the people
                  it created can sign in and hold roles, and typing a reason
                  for deleting them. That is not a judgement to make on a
                  handset, so narrow the press is not offered at all - a line
                  says where it is instead of a button that invites a mis-hit. */}
              {phone ? (
                <CardFoot inset>
                  <FootNote>{m.record_undoElsewhere()}</FootNote>
                </CardFoot>
              ) : (
                <CardFoot inset>
                  <FootNote>{m.record_undoHint()}</FootNote>
                  <Spacer />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      !found.nodes.some((node) => node.disposition === 'created' && node.present)
                    }
                    onClick={() => setCleaning(true)}
                  >
                    {m.clean_action()}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={found.import.standing.living === 0}
                    onClick={() => setReversing(true)}
                  >
                    {m.reverse_action()}
                  </Button>
                </CardFoot>
              )}
            </Card>

            {found.events.length > 0 && (
              <Card>
                <CardHead title={m.record_events()} />
                <Table columns="minmax(0, 1.4fr) minmax(0, 1fr)">
                  {found.events.map((event) => (
                    <TableRow key={event.id} data-testid="import-event" data-kind={event.kind}>
                      <Cell lead>
                        {event.kind === 'reversed'
                          ? m.event_reversed({ count: event.affectedUserCount })
                          : m.event_nodesCleaned({
                              deleted: event.deletedNodeCount,
                              retained: event.retainedNodeCount,
                            })}
                      </Cell>
                      <Cell title={event.reason ?? undefined}>
                        {[event.actorName, whenText(locale, event.createdAt), event.reason]
                          .filter(Boolean)
                          .join('  ')}
                      </Cell>
                    </TableRow>
                  ))}
                </Table>
              </Card>
            )}

            {!phone && found.nodes.length > 0 && (
              <Card>
                <CardHead
                  title={m.record_nodes()}
                  note={m.countOf({ count: found.nodes.length })}
                />
                <Table columns="minmax(0, 1fr) 5rem 5rem">
                  <TableHead>
                    <span>{m.record_columnUnit()}</span>
                    <span>{m.record_columnOutcome()}</span>
                    <span>{m.record_columnStanding()}</span>
                  </TableHead>
                  {found.nodes
                    .slice((nodePage - 1) * NODES_PER_PAGE, nodePage * NODES_PER_PAGE)
                    .map((node) => (
                      <TableRow
                        key={node.id}
                        height="compact"
                        data-testid="import-node"
                        data-present={node.present}
                      >
                        <Cell lead title={node.path}>
                          {node.path}
                        </Cell>
                        <Cell>
                          {(node.disposition === 'created' ? m.record_created : m.record_reused)()}
                        </Cell>
                        <Status tone={node.present ? 'plain' : 'bad'}>
                          {(node.present ? m.record_nodePresent : m.record_nodeGone)()}
                        </Status>
                      </TableRow>
                    ))}
                </Table>
                <CardFoot>
                  <Pager
                    label={m.pager()}
                    page={nodePage}
                    pageSize={NODES_PER_PAGE}
                    total={found.nodes.length}
                    onPage={setNodePage}
                  />
                </CardFoot>
              </Card>
            )}

            <Card>
              <CardHead
                title={m.record_rows()}
                note={m.countOf({ count: rows.data?.total ?? found.import.sourceRowCount })}
              />
              {phone ? (
                items.map((row) => {
                  const gone = row.standing === 'deleted' || row.standing === 'missing'
                  return (
                    <div
                      key={row.sourceRowNo}
                      {...stylex.props(styles.person)}
                      data-testid="import-row"
                      data-standing={row.standing}
                    >
                      <span {...stylex.props(styles.personWords)}>
                        <span {...stylex.props(styles.personLine)}>
                          <span {...stylex.props(styles.personName)}>
                            {row.userId === null ? (
                              row.displayName
                            ) : (
                              <PageLink
                                page="auth/user-detail"
                                params={{ userId: row.userId }}
                                className={stylex.props(styles.personLink).className}
                              >
                                {row.displayName}
                              </PageLink>
                            )}
                          </span>
                          <span {...stylex.props(styles.personNo)}>{row.businessNo}</span>
                        </span>
                        <span {...stylex.props(styles.personWhere)}>{row.orgPath}</span>
                      </span>
                      <span {...stylex.props(styles.personStanding)}>
                        <span>
                          {(row.disposition === 'created' ? m.record_created : m.record_existing)()}
                        </span>
                        {/* only what is wrong is marked: a column of grey
                            words with one red one in it is read at a glance */}
                        {gone ? (
                          <span {...stylex.props(styles.gone)}>
                            <span aria-hidden {...stylex.props(styles.goneDot)} />
                            {standingWords[row.standing]()}
                          </span>
                        ) : (
                          <span>{standingWords[row.standing]()}</span>
                        )}
                      </span>
                    </div>
                  )
                })
              ) : (
                <Table columns="3.5rem 7.5rem 6rem minmax(0, 1fr) 4.5rem 4.5rem">
                  <TableHead>
                    <span>{m.record_columnRow()}</span>
                    <span>{businessNo}</span>
                    <span>{m.record_columnName()}</span>
                    <span>{m.record_columnUnit()}</span>
                    <span>{m.record_columnOutcome()}</span>
                    <span>{m.record_columnStanding()}</span>
                  </TableHead>
                  {items.map((row) => (
                    <TableRow
                      key={row.sourceRowNo}
                      height="compact"
                      data-testid="import-row"
                      data-standing={row.standing}
                    >
                      <Cell numeric>{row.sourceRowNo}</Cell>
                      <Cell numeric tone="plain">
                        {row.businessNo}
                      </Cell>
                      <Cell tone="plain">
                        {row.userId === null ? (
                          row.displayName
                        ) : (
                          <PageLink
                            page="auth/user-detail"
                            params={{ userId: row.userId }}
                            className={stylex.props(styles.personLink).className}
                          >
                            {row.displayName}
                          </PageLink>
                        )}
                      </Cell>
                      <Cell title={row.orgPath}>{row.orgPath}</Cell>
                      <Cell>
                        {(row.disposition === 'created' ? m.record_created : m.record_existing)()}
                      </Cell>
                      <Status
                        tone={
                          row.standing === 'deleted' || row.standing === 'missing' ? 'bad' : 'plain'
                        }
                      >
                        {standingWords[row.standing]()}
                      </Status>
                    </TableRow>
                  ))}
                </Table>
              )}
              <CardFoot>
                <Pager
                  testId="import-rows-pager"
                  label={m.pager()}
                  page={rows.data?.page ?? rowPage}
                  pageSize={ROWS_PER_PAGE}
                  total={rows.data?.total ?? 0}
                  disabled={rows.isFetching}
                  onPage={setRowPage}
                />
              </CardFoot>
            </Card>
          </div>
        )}
      </AsyncSection>

      <FormDialog
        open={reversing}
        title={m.reverse_title()}
        description={
          reversal.data === undefined || nothingLeft
            ? undefined
            : m.reverse_hint({
                count: reversal.data.toRetire,
                bindings: reversal.data.withBindings,
                grants: reversal.data.withGrants,
              })
        }
        onClose={() => setReversing(false)}
        footer={
          <div {...stylex.props(styles.row)}>
            <span {...stylex.props(styles.spacer)} />
            <Button variant="outline" onClick={() => setReversing(false)}>
              {(nothingLeft ? commonMessages.action_close : m.dialog_cancel)()}
            </Button>
            {reversal.data !== undefined && !nothingLeft && (
              <Button
                variant="destructive"
                disabled={reason.trim() === '' || reverse.isPending}
                onClick={() => reverse.mutate()}
              >
                {m.reverse_confirm()}
              </Button>
            )}
          </div>
        }
      >
        <AsyncSection
          pending={reversal.isPending}
          error={reversal.isError ? failed.of(reversal.error) : null}
          loadingLabel={commonMessages.state_loading()}
          retryLabel={commonMessages.action_retry()}
          onRetry={() => void reversal.refetch()}
        >
          {nothingLeft ? (
            <div data-testid="reverse-nothing">
              <Blank size="compact" icon={<UserRoundCheckIcon />} title={m.reverse_nothing()} />
            </div>
          ) : (
            <Field required label={m.reverse_reason()}>
              {(id) => (
                <Textarea
                  id={id}
                  rows={3}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            </Field>
          )}
        </AsyncSection>
      </FormDialog>

      <ConfirmDialog
        open={cleaning}
        title={m.clean_title()}
        description={m.clean_hint()}
        confirmLabel={m.clean_confirm()}
        cancelLabel={m.dialog_cancel()}
        pending={clean.isPending}
        onConfirm={() => clean.mutate()}
        onCancel={() => setCleaning(false)}
      />
    </DetailSheet>
  )
}
