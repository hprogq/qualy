import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useApi, useApiQuery, usePageQueryState, useRunApi, cursorPages } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Card, CardEmpty, CardFoot, FootNote, Screen, Spacer, Status } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { auditMessages as m } from './i18n.ts'
import { auditApi } from './api.ts'

// The trail, newest first. One table, two filters, a row opens into its
// correlation ids and details - reading is the whole page, because writing
// is done by operations, never here.

// the select refuses an empty value, and "everything" is a real choice
const ALL = 'all'

const MONO = "'SFMono-Regular', ui-monospace, Menlo, Consolas, monospace"

/** the six columns, stated once so the head and every row agree */
const COLUMNS = '11rem minmax(0, 0.9fr) minmax(0, 1.3fr) minmax(0, 1.1fr) 4.5rem 8rem'

const styles = stylex.create({
  ellipsis: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  filters: { display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
  actionFilter: { width: { default: '14rem', [breakpoints.phone]: '100%' } },
  outcomeFilter: { width: { default: '9rem', [breakpoints.phone]: '100%' } },
  // six columns do not fold onto a phone; the table keeps its measure and
  // the card scrolls sideways under it
  scroll: { overflowX: 'auto' },
  measure: { display: 'flex', minWidth: '46rem', flexDirection: 'column' },
  head: {
    display: 'grid',
    gridTemplateColumns: COLUMNS,
    alignItems: 'center',
    columnGap: 16,
    height: 32,
    paddingInline: 16,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    fontSize: 11,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  right: { textAlign: 'right' },
  rowSeat: {
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  row: {
    display: 'grid',
    width: '100%',
    minWidth: 0,
    minHeight: 40,
    gridTemplateColumns: COLUMNS,
    alignItems: 'center',
    columnGap: 16,
    paddingInline: 16,
    textAlign: 'left',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  rowOpen: { backgroundColor: tokens.surfaceMuted },
  when: {
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  actor: { fontSize: 13 },
  action: { fontSize: 13, fontWeight: 500 },
  target: { fontSize: 12, color: tokens.mutedForeground },
  outcome: { fontSize: 12, color: tokens.mutedForeground },
  ip: {
    textAlign: 'right',
    fontFamily: MONO,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  detail: {
    display: 'grid',
    gridTemplateColumns: '5rem minmax(0, 1fr)',
    columnGap: 16,
    rowGap: 5,
    margin: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    paddingInline: 16,
    paddingBlock: 12,
    fontSize: 12,
  },
  detailName: { color: tokens.mutedForeground },
  detailValue: { margin: 0, minWidth: 0 },
  // correlation ids are copied into other systems, so they are read glyph
  // by glyph rather than as words
  mono: { fontFamily: MONO },
  // anything but success is the reason someone opened this page
  bad: { color: tokens.danger },
  agent: { color: tokens.mutedForeground },
  pre: {
    margin: 0,
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontFamily: MONO,
    fontSize: 11.5,
    lineHeight: 1.6,
    color: tokens.surfaceMutedForeground,
  },
})

type EventRow = {
  id: string
  occurredAt: string
  actionCode: string
  actionName:
    | { kind: 'message'; id: string; defaultMessage: string }
    | { kind: 'literal'; value: string }
    | null
  actorKind: 'user' | 'system' | 'service' | 'anonymous'
  actorUserId: string | null
  actorLabel: string | null
  targetLabel: string | null
  targetId: string | null
  outcome: 'success' | 'denied' | 'failure'
  reasonCode: string | null
  details: Record<string, unknown>
  source: 'http' | 'job' | 'cli' | 'system'
  requestId: string | null
  traceId: string | null
  clientIp: string | null
  userAgent: string | null
}

export default function AuditEventsPage() {
  const api = useApi(auditApi)
  const runApi = useRunApi()
  const query = useApiQuery(auditApi)
  const { format, formatText, locale } = useI18n()
  const [action, setAction] = usePageQueryState('action')
  const [outcome, setOutcome] = usePageQueryState('outcome')
  const [openId, setOpenId] = useState('')

  const options = useQuery(query.audit.getAuditEventOptions.queryOptions({}))

  const outcomeFilter: 'success' | 'denied' | 'failure' | undefined =
    outcome === 'success' || outcome === 'denied' || outcome === 'failure' ? outcome : undefined
  const filter = {
    ...(action ? { actionCode: action } : {}),
    ...(outcomeFilter !== undefined ? { outcome: outcomeFilter } : {}),
  }
  const events = useInfiniteQuery({
    queryKey: [...query.audit.listAuditEvents.key({ query: filter }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.audit.listAuditEvents({
          query: { ...filter, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        }),
      ),
    ...cursorPages,
  })
  const rows = useMemo(() => events.data?.pages.flatMap((page) => page.items) ?? [], [events.data])

  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'medium' })
  const actorOf = (row: EventRow) =>
    row.actorLabel ??
    (row.actorKind === 'anonymous'
      ? format(m.actorAnonymous)
      : row.actorKind === 'user'
        ? (row.actorUserId?.slice(0, 8) ?? '—')
        : format(m.actorSystem))
  const actionOf = (row: EventRow) => (row.actionName ? formatText(row.actionName) : row.actionCode)
  const outcomeLabel = {
    success: m.outcomeSuccess,
    denied: m.outcomeDenied,
    failure: m.outcomeFailure,
  }

  return (
    <Screen title={format(m.title)} description={format(m.hint)} size="broad">
      <div {...stylex.props(styles.filters)}>
        <Select
          value={action || ALL}
          onValueChange={(value) => setAction(value === ALL ? '' : value)}
        >
          <SelectTrigger size="sm" xstyle={styles.actionFilter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{format(m.anyAction)}</SelectItem>
            {(options.data?.actions ?? []).map((entry) => (
              <SelectItem key={entry.code} value={entry.code}>
                {formatText(entry.name)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={outcome || ALL}
          onValueChange={(value) => setOutcome(value === ALL ? '' : value)}
        >
          <SelectTrigger size="sm" xstyle={styles.outcomeFilter}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>{format(m.anyOutcome)}</SelectItem>
            <SelectItem value="success">{format(m.outcomeSuccess)}</SelectItem>
            <SelectItem value="denied">{format(m.outcomeDenied)}</SelectItem>
            <SelectItem value="failure">{format(m.outcomeFailure)}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <AsyncSection
        pending={events.isPending}
        error={events.isError ? format(m.loadFailed) : undefined}
        loadingLabel={format(commonMessages.loading)}
        retryLabel={format(commonMessages.retry)}
        onRetry={() => void events.refetch()}
      >
        <Card data-testid="audit-table">
          <div {...stylex.props(styles.scroll)}>
            <div {...stylex.props(styles.measure)}>
              <div {...stylex.props(styles.head)}>
                <span>{format(m.columnTime)}</span>
                <span>{format(m.columnActor)}</span>
                <span>{format(m.columnAction)}</span>
                <span>{format(m.columnTarget)}</span>
                <span>{format(m.columnOutcome)}</span>
                <span {...stylex.props(styles.right)}>{format(m.columnIp)}</span>
              </div>
              {rows.length === 0 ? (
                <CardEmpty>{format(m.empty)}</CardEmpty>
              ) : (
                rows.map((row) => (
                  <div key={row.id} {...stylex.props(styles.rowSeat)}>
                    <button
                      type="button"
                      aria-expanded={row.id === openId}
                      data-event-outcome={row.outcome}
                      onClick={() => setOpenId(row.id === openId ? '' : row.id)}
                      {...stylex.props(styles.row, row.id === openId && styles.rowOpen)}
                    >
                      <span {...stylex.props(styles.ellipsis, styles.when)}>
                        {when(row.occurredAt)}
                      </span>
                      <span {...stylex.props(styles.ellipsis, styles.actor)}>{actorOf(row)}</span>
                      <span {...stylex.props(styles.ellipsis, styles.action)}>{actionOf(row)}</span>
                      <span {...stylex.props(styles.ellipsis, styles.target)}>
                        {row.targetLabel ?? row.targetId ?? '—'}
                      </span>
                      <span {...stylex.props(styles.outcome)}>
                        <Status tone={row.outcome === 'success' ? 'plain' : 'bad'}>
                          {format(outcomeLabel[row.outcome])}
                        </Status>
                      </span>
                      <span {...stylex.props(styles.ellipsis, styles.ip)}>
                        {row.clientIp ?? '—'}
                      </span>
                    </button>
                    {row.id === openId && (
                      <dl {...stylex.props(styles.detail)}>
                        <dt {...stylex.props(styles.detailName)}>{format(m.detailSource)}</dt>
                        <dd {...stylex.props(styles.detailValue)}>{row.source}</dd>
                        {row.reasonCode && (
                          <>
                            <dt {...stylex.props(styles.detailName)}>{format(m.detailReason)}</dt>
                            <dd {...stylex.props(styles.detailValue, styles.mono, styles.bad)}>
                              {row.reasonCode}
                            </dd>
                          </>
                        )}
                        {row.requestId && (
                          <>
                            <dt {...stylex.props(styles.detailName)}>{format(m.detailRequest)}</dt>
                            <dd {...stylex.props(styles.detailValue, styles.mono)}>
                              {row.requestId}
                            </dd>
                          </>
                        )}
                        {row.traceId && (
                          <>
                            <dt {...stylex.props(styles.detailName)}>{format(m.detailTrace)}</dt>
                            <dd {...stylex.props(styles.detailValue, styles.mono)}>
                              {row.traceId}
                            </dd>
                          </>
                        )}
                        {row.userAgent && (
                          <>
                            <dt {...stylex.props(styles.detailName)}>
                              {format(m.detailUserAgent)}
                            </dt>
                            <dd
                              {...stylex.props(styles.detailValue, styles.ellipsis, styles.agent)}
                            >
                              {row.userAgent}
                            </dd>
                          </>
                        )}
                        {Object.keys(row.details).length > 0 && (
                          <>
                            <dt {...stylex.props(styles.detailName)}>{format(m.detailDetails)}</dt>
                            <dd {...stylex.props(styles.detailValue)}>
                              <pre {...stylex.props(styles.pre)}>
                                {JSON.stringify(row.details, null, 2)}
                              </pre>
                            </dd>
                          </>
                        )}
                      </dl>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
          <CardFoot>
            <FootNote>
              <span data-testid="audit-count" data-count={rows.length}>
                {format(m.loadedCount, { count: rows.length })}
              </span>
            </FootNote>
            <Spacer />
            {events.hasNextPage && (
              <Button
                size="sm"
                variant="outline"
                disabled={events.isFetchingNextPage}
                onClick={() => void events.fetchNextPage()}
              >
                {format(m.loadMore)}
              </Button>
            )}
          </CardFoot>
        </Card>
      </AsyncSection>
    </Screen>
  )
}
