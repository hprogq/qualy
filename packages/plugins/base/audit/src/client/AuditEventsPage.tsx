import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { useApi, useApiQuery, usePageQueryState, useRunApi } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { commonMessages } from '@qualy/web-i18n/messages'
import { AsyncSection } from '@qualy/ui/admin'
import { Screen } from '@qualy/ui/screen'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { cn } from '@qualy/ui/cn'
import { auditMessages as m } from './i18n.ts'
import { auditApi } from './api.ts'

// The trail, newest first. One table, two filters, a row opens into its
// correlation ids and details - reading is the whole page, because writing
// is done by operations, never here.

// radix refuses an empty select value, and "everything" is a real choice
const ALL = 'all'

type EventRow = {
  id: string
  occurredAt: string
  actionCode: string
  actionName:
    | { kind: 'message'; id: string; defaultMessage: string }
    | { kind: 'literal'; value: string }
    | null
  actorKind: 'user' | 'system' | 'service' | 'anonymous'
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
    (row.actorKind === 'anonymous' ? format(m.actorAnonymous) : format(m.actorSystem))
  const actionOf = (row: EventRow) => (row.actionName ? formatText(row.actionName) : row.actionCode)
  const outcomeLabel = {
    success: m.outcomeSuccess,
    denied: m.outcomeDenied,
    failure: m.outcomeFailure,
  }

  return (
    <Screen title={format(m.title)} description={format(m.hint)} size="wide">
      <div className="flex items-center gap-2 pb-4">
        <Select
          value={action || ALL}
          onValueChange={(value) => setAction(value === ALL ? '' : value)}
        >
          <SelectTrigger size="sm" className="w-56">
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
          <SelectTrigger size="sm" className="w-36">
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
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border">
          <div className="grid grid-cols-[10.5rem_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_4rem_8rem] items-center gap-3 border-b bg-muted/50 px-4 py-2 text-xs text-muted-foreground">
            <span>{format(m.columnTime)}</span>
            <span>{format(m.columnActor)}</span>
            <span>{format(m.columnAction)}</span>
            <span>{format(m.columnTarget)}</span>
            <span>{format(m.columnOutcome)}</span>
            <span className="text-right">{format(m.columnIp)}</span>
          </div>
          {rows.length === 0 ? (
            <p className="px-4 py-4 text-sm text-muted-foreground">{format(m.empty)}</p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="border-t first:border-t-0">
                <button
                  type="button"
                  aria-expanded={row.id === openId}
                  data-event-outcome={row.outcome}
                  onClick={() => setOpenId(row.id === openId ? '' : row.id)}
                  className={cn(
                    'grid w-full min-w-0 grid-cols-[10.5rem_minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,1fr)_4rem_8rem] items-center gap-3 px-4 py-2.5 text-left hover:bg-accent/70',
                    row.id === openId && 'bg-accent',
                  )}
                >
                  <span className="truncate text-xs tabular-nums text-muted-foreground">
                    {when(row.occurredAt)}
                  </span>
                  <span className="min-w-0 truncate text-sm">{actorOf(row)}</span>
                  <span className="min-w-0 truncate text-sm font-medium">{actionOf(row)}</span>
                  <span className="min-w-0 truncate text-xs text-muted-foreground">
                    {row.targetLabel ?? row.targetId ?? '—'}
                  </span>
                  <span
                    className={cn(
                      'text-xs',
                      row.outcome === 'success' ? 'text-muted-foreground' : 'text-destructive',
                    )}
                  >
                    {format(outcomeLabel[row.outcome])}
                  </span>
                  <span className="truncate text-right text-xs tabular-nums text-muted-foreground">
                    {row.clientIp ?? '—'}
                  </span>
                </button>
                {row.id === openId && (
                  <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-1 border-t bg-muted/30 px-4 py-3 text-xs">
                    <dt className="text-muted-foreground">{format(m.detailSource)}</dt>
                    <dd>{row.source}</dd>
                    {row.reasonCode && (
                      <>
                        <dt className="text-muted-foreground">{format(m.detailReason)}</dt>
                        <dd className="font-mono">{row.reasonCode}</dd>
                      </>
                    )}
                    {row.requestId && (
                      <>
                        <dt className="text-muted-foreground">{format(m.detailRequest)}</dt>
                        <dd className="font-mono">{row.requestId}</dd>
                      </>
                    )}
                    {row.traceId && (
                      <>
                        <dt className="text-muted-foreground">{format(m.detailTrace)}</dt>
                        <dd className="font-mono">{row.traceId}</dd>
                      </>
                    )}
                    {row.userAgent && (
                      <>
                        <dt className="text-muted-foreground">{format(m.detailUserAgent)}</dt>
                        <dd className="truncate">{row.userAgent}</dd>
                      </>
                    )}
                    {Object.keys(row.details).length > 0 && (
                      <>
                        <dt className="text-muted-foreground">{format(m.detailDetails)}</dt>
                        <dd>
                          <pre className="overflow-x-auto whitespace-pre-wrap break-all font-mono">
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
          <div className="flex items-center gap-3 border-t px-4 py-2">
            <span
              className="min-w-0 truncate text-xs text-muted-foreground"
              data-testid="audit-count"
              data-count={rows.length}
            >
              {format(m.loadedCount, { count: rows.length })}
            </span>
            <span className="flex-1" />
            {events.hasNextPage && (
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
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
