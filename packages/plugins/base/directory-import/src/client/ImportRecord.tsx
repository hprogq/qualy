import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PageLink, useApi, useApiQuery, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { useTerm } from '@qualy/plugin-settings/client/terms'
import { authTerms } from '@qualy/auth-contract/terms'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { AsyncSection, ConfirmDialog, Field, FormDialog } from '@qualy/ui/admin'
import { Button } from '@qualy/ui/button'
import {
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
import { directoryImportMessages as m } from './i18n.ts'
import { whenText } from './words.ts'

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
  const { format, formatError, locale } = useI18n()
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
      toast.success(format(m.reversed, { retired: outcome.retired }))
      setReversing(false)
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })
  const clean = useMutation({
    mutationFn: () => run(api.directory.cleanUserImportNodes({ params: { importId } })),
    onSuccess: (outcome) => {
      toast.success(
        format(m.cleaned, { deleted: outcome.deleted, retained: outcome.retained.length }),
      )
      setCleaning(false)
      refresh()
    },
    onError: (error) => toast.error(formatError(error)),
  })

  const found = detail.data
  const items = rows.data?.items ?? []
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
            <FactStrip
              columns={4}
              items={[
                { label: format(m.recordBy), value: found.import.actorName ?? '—' },
                { label: format(m.recordAt), value: whenText(locale, found.import.createdAt) },
                { label: format(m.recordType), value: found.import.userTypeName ?? '—' },
                {
                  label: format(m.recordUnder),
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
              <CardHead title={format(m.recordOutcome)} />
              <div {...stylex.props(styles.outcome)}>
                <span data-testid="import-counts">
                  {format(m.recordCounts, {
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
                  {format(m.recordStanding, found.import.standing)}
                </span>
              </div>
              {/* Reversing an import means reading how many of the people
                  it created can sign in and hold roles, and typing a reason
                  for deleting them. That is not a judgement to make on a
                  handset, so narrow the press is not offered at all - a line
                  says where it is instead of a button that invites a mis-hit. */}
              {phone ? (
                <CardFoot inset>
                  <FootNote>{format(m.undoElsewhere)}</FootNote>
                </CardFoot>
              ) : (
                <CardFoot inset>
                  <FootNote>{format(m.recordUndoHint)}</FootNote>
                  <Spacer />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      !found.nodes.some((node) => node.disposition === 'created' && node.present)
                    }
                    onClick={() => setCleaning(true)}
                  >
                    {format(m.clean)}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={found.import.standing.living === 0}
                    onClick={() => setReversing(true)}
                  >
                    {format(m.reverse)}
                  </Button>
                </CardFoot>
              )}
            </Card>

            {found.events.length > 0 && (
              <Card>
                <CardHead title={format(m.recordEvents)} />
                <Table columns="minmax(0, 1.4fr) minmax(0, 1fr)">
                  {found.events.map((event) => (
                    <TableRow key={event.id} data-testid="import-event" data-kind={event.kind}>
                      <Cell lead>
                        {event.kind === 'reversed'
                          ? format(m.eventReversed, { count: event.affectedUserCount })
                          : format(m.eventCleaned, {
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
                  title={format(m.recordNodes)}
                  note={format(m.countOf, { count: found.nodes.length })}
                />
                <Table columns="minmax(0, 1fr) 5rem 5rem">
                  <TableHead>
                    <span>{format(m.columnUnit)}</span>
                    <span>{format(m.columnOutcome)}</span>
                    <span>{format(m.columnStanding)}</span>
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
                          {format(
                            node.disposition === 'created'
                              ? m.dispositionCreated
                              : m.dispositionReused,
                          )}
                        </Cell>
                        <Status tone={node.present ? 'plain' : 'bad'}>
                          {format(node.present ? m.nodePresent : m.nodeGone)}
                        </Status>
                      </TableRow>
                    ))}
                </Table>
                <CardFoot>
                  <Pager
                    label={format(m.pagerLabel)}
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
                title={format(m.recordRows)}
                note={format(m.countOf, { count: rows.data?.total ?? found.import.sourceRowCount })}
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
                          {format(
                            row.disposition === 'created'
                              ? m.dispositionCreated
                              : m.dispositionExisting,
                          )}
                        </span>
                        {/* only what is wrong is marked: a column of grey
                            words with one red one in it is read at a glance */}
                        {gone ? (
                          <span {...stylex.props(styles.gone)}>
                            <span aria-hidden {...stylex.props(styles.goneDot)} />
                            {format(standingWords[row.standing])}
                          </span>
                        ) : (
                          <span>{format(standingWords[row.standing])}</span>
                        )}
                      </span>
                    </div>
                  )
                })
              ) : (
                <Table columns="3.5rem 7.5rem 6rem minmax(0, 1fr) 4.5rem 4.5rem">
                  <TableHead>
                    <span>{format(m.columnRow)}</span>
                    <span>{businessNo}</span>
                    <span>{format(m.columnName)}</span>
                    <span>{format(m.columnUnit)}</span>
                    <span>{format(m.columnOutcome)}</span>
                    <span>{format(m.columnStanding)}</span>
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
                        {format(
                          row.disposition === 'created'
                            ? m.dispositionCreated
                            : m.dispositionExisting,
                        )}
                      </Cell>
                      <Status
                        tone={
                          row.standing === 'deleted' || row.standing === 'missing' ? 'bad' : 'plain'
                        }
                      >
                        {format(standingWords[row.standing])}
                      </Status>
                    </TableRow>
                  ))}
                </Table>
              )}
              <CardFoot>
                <Pager
                  testId="import-rows-pager"
                  label={format(m.pagerLabel)}
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
        title={format(m.reverseTitle)}
        description={
          reversal.data === undefined
            ? undefined
            : reversal.data.toRetire === 0
              ? format(m.reverseNothing)
              : format(m.reversalHint, {
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
              {format(m.cancel)}
            </Button>
            <Button
              variant="destructive"
              disabled={
                reason.trim() === '' || reverse.isPending || (reversal.data?.toRetire ?? 0) === 0
              }
              onClick={() => reverse.mutate()}
            >
              {format(m.reverseConfirm)}
            </Button>
          </div>
        }
      >
        <Field required label={format(m.reverseReason)}>
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
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
