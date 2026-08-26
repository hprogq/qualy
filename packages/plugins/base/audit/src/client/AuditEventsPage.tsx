import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useApi, useApiQuery, usePageQueryState, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Screen } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { auditMessages as m } from './i18n.ts'
import { auditApi } from './api.ts'

// The trail, newest first. One table, two filters, a row opens into its
// correlation ids and details - reading is the whole page, because writing
// is done by operations, never here.

// the select refuses an empty value, and "everything" is a real choice
const ALL = 'all'

const MONO =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

/** the six columns, stated once so the head and every row agree */
const COLUMNS = '10.5rem minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 1fr) 4rem 8rem'

const styles = stylex.create({
  filters: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 16,
  },
  actionFilter: {
    width: 224,
  },
  outcomeFilter: {
    width: 144,
  },
  table: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  head: {
    display: 'grid',
    gridTemplateColumns: COLUMNS,
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    paddingInline: 16,
    paddingBlock: 8,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  right: {
    textAlign: 'right',
  },
  empty: {
    paddingInline: 16,
    paddingBlock: 16,
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  rowSeat: {
    borderTopWidth: {
      default: 1,
      ':first-child': 0,
    },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  row: {
    display: 'grid',
    width: '100%',
    minWidth: 0,
    gridTemplateColumns: COLUMNS,
    alignItems: 'center',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 10,
    textAlign: 'left',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 70%, transparent)`,
    },
  },
  rowOpen: {
    backgroundColor: tokens.surfaceMuted,
  },
  when: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  actor: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  action: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  target: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  outcome: {
    fontSize: 12,
  },
  outcomeQuiet: {
    color: tokens.mutedForeground,
  },
  // anything but success is the reason someone opened this page
  outcomeBad: {
    color: tokens.danger,
  },
  ip: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    textAlign: 'right',
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
    color: tokens.mutedForeground,
  },
  detail: {
    display: 'grid',
    gridTemplateColumns: '8rem minmax(0, 1fr)',
    columnGap: 16,
    rowGap: 4,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 30%, transparent)`,
    paddingInline: 16,
    paddingBlock: 12,
    fontSize: 12,
  },
  detailName: {
    color: tokens.mutedForeground,
  },
  // correlation ids are copied into other systems, so they are read glyph
  // by glyph rather than as words
  mono: {
    fontFamily: MONO,
  },
  truncate: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pre: {
    overflowX: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-all',
    fontFamily: MONO,
  },
  foot: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 16,
    paddingBlock: 8,
  },
  count: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  more: {
    flexShrink: 0,
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
  const orpc = useApiQuery(auditApi)
  const { format, formatText, locale } = useI18n()
  const [action, setAction] = usePageQueryState('action')
  const [outcome, setOutcome] = usePageQueryState('outcome')
  const [openId, setOpenId] = useState('')

  const options = useQuery(orpc.audit.getAuditEventOptions.queryOptions({}))

  const outcomeFilter: 'success' | 'denied' | 'failure' | undefined =
    outcome === 'success' || outcome === 'denied' || outcome === 'failure' ? outcome : undefined
  const filter = {
    ...(action ? { actionCode: action } : {}),
    ...(outcomeFilter !== undefined ? { outcome: outcomeFilter } : {}),
  }
  const events = useInfiniteQuery({
    queryKey: [...orpc.audit.listAuditEvents.key({ query: filter }), 'infinite'],
    queryFn: ({ pageParam }) =>
      runApi(
        api.audit.listAuditEvents({
          query: { ...filter, ...(pageParam !== undefined ? { cursor: pageParam } : {}) },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
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
    <Screen title={format(m.title)} description={format(m.hint)} size="wide">
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
        <div {...stylex.props(styles.table)}>
          <div {...stylex.props(styles.head)}>
            <span>{format(m.columnTime)}</span>
            <span>{format(m.columnActor)}</span>
            <span>{format(m.columnAction)}</span>
            <span>{format(m.columnTarget)}</span>
            <span>{format(m.columnOutcome)}</span>
            <span {...stylex.props(styles.right)}>{format(m.columnIp)}</span>
          </div>
          {rows.length === 0 ? (
            <p {...stylex.props(styles.empty)}>{format(m.empty)}</p>
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
                  <span {...stylex.props(styles.when)}>{when(row.occurredAt)}</span>
                  <span {...stylex.props(styles.actor)}>{actorOf(row)}</span>
                  <span {...stylex.props(styles.action)}>{actionOf(row)}</span>
                  <span {...stylex.props(styles.target)}>
                    {row.targetLabel ?? row.targetId ?? '—'}
                  </span>
                  <span
                    {...stylex.props(
                      styles.outcome,
                      row.outcome === 'success' ? styles.outcomeQuiet : styles.outcomeBad,
                    )}
                  >
                    {format(outcomeLabel[row.outcome])}
                  </span>
                  <span {...stylex.props(styles.ip)}>{row.clientIp ?? '—'}</span>
                </button>
                {row.id === openId && (
                  <dl {...stylex.props(styles.detail)}>
                    <dt {...stylex.props(styles.detailName)}>{format(m.detailSource)}</dt>
                    <dd>{row.source}</dd>
                    {row.reasonCode && (
                      <>
                        <dt {...stylex.props(styles.detailName)}>{format(m.detailReason)}</dt>
                        <dd {...stylex.props(styles.mono)}>{row.reasonCode}</dd>
                      </>
                    )}
                    {row.requestId && (
                      <>
                        <dt {...stylex.props(styles.detailName)}>{format(m.detailRequest)}</dt>
                        <dd {...stylex.props(styles.mono)}>{row.requestId}</dd>
                      </>
                    )}
                    {row.traceId && (
                      <>
                        <dt {...stylex.props(styles.detailName)}>{format(m.detailTrace)}</dt>
                        <dd {...stylex.props(styles.mono)}>{row.traceId}</dd>
                      </>
                    )}
                    {row.userAgent && (
                      <>
                        <dt {...stylex.props(styles.detailName)}>{format(m.detailUserAgent)}</dt>
                        <dd {...stylex.props(styles.truncate)}>{row.userAgent}</dd>
                      </>
                    )}
                    {Object.keys(row.details).length > 0 && (
                      <>
                        <dt {...stylex.props(styles.detailName)}>{format(m.detailDetails)}</dt>
                        <dd>
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
          <div {...stylex.props(styles.foot)}>
            <span
              {...stylex.props(styles.count)}
              data-testid="audit-count"
              data-count={rows.length}
            >
              {format(m.loadedCount, { count: rows.length })}
            </span>
            <span {...stylex.props(styles.spacer)} />
            {events.hasNextPage && (
              <Button
                size="sm"
                variant="outline"
                className={stylex.props(styles.more).className}
                disabled={events.isFetchingNextPage}
                onClick={() => void events.fetchNextPage()}
              >
                {format(m.loadMore)}
              </Button>
            )}
          </div>
        </div>
      </AsyncSection>
    </Screen>
  )
}
