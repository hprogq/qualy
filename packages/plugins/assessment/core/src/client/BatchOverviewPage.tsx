import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRightIcon } from 'lucide-react'
import {
  useApi,
  useApiQuery,
  usePageNavigate,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { assessmentApi } from './api.ts'
import { useBatchLive } from './live.ts'
import type { ApiResult } from '@qualy/web-runtime/api'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { BatchFlow, BatchFlowStrip } from './batch/BatchFlow.tsx'
import { PhaseContextBar } from './batch/PhaseContextBar.tsx'
import { assessmentMessages as m } from './i18n.ts'

// Where a batch opens, for whoever it belongs to.
//
// The flow of the round is one of the two things this page is for, so it is
// here in full and read-only. Which shape it takes is a question of what the
// screen has spare: a wide one has width, so the flow runs down a column
// beside the page; a narrow one has none to give a second column and cannot
// spend the height either, so the flow becomes one scrollable line above the
// work. The break is at the width the two columns stop fitting, not at any
// idea of what device is holding it.

export default function BatchOverviewPage() {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const { format } = useI18n()

  const plan = useQuery({
    ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const timeline = plan.data?.timeline ?? []

  return (
    <BatchScreen title={format(m.tabOverview)} description={format(m.overviewHint)}>
      {() => (
        <div className="flex flex-col gap-5">
          {plan.isPending ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <PhaseContextBar timeline={timeline} />
          )}

          {!plan.isPending && <BatchFlowStrip timeline={timeline} className="lg:hidden" />}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="flex min-w-0 flex-col gap-6">
              <MyDesk batchId={batchId} />
            </div>
            {/* it follows the page down rather than scrolling away, and keeps
                its own scrollbar when the round has more stages than the
                screen has height */}
            <aside className="sticky top-6 hidden max-h-[calc(100dvh-9rem)] self-start overflow-y-auto lg:block">
              <p className="pb-3 text-xs font-medium text-muted-foreground">
                {format(m.flowTitle)}
              </p>
              {plan.isPending ? (
                <div className="flex flex-col gap-3">
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                  <Skeleton className="h-5 w-full" />
                </div>
              ) : (
                <BatchFlow timeline={timeline} keepPast={1} />
              )}
            </aside>
          </div>
        </div>
      )}
    </BatchScreen>
  )
}

type ActivityItem = ApiResult<
  typeof assessmentApi,
  'assessment',
  'listMyEntryActivity'
>['items'][number]

const ACTIVITY_SAID = {
  'entry-created': m['activity.entry-created'],
  'entry-revised': m['activity.entry-revised'],
  'entry-submitted': m['activity.entry-submitted'],
  'entry-withdrawn': m['activity.entry-withdrawn'],
  'entry-abandoned': m['activity.entry-abandoned'],
  'review-approved': m['activity.review-approved'],
  'review-rejected': m['activity.review-rejected'],
  'review-escalated': m['activity.review-escalated'],
  'appeal-filed': m['activity.appeal-filed'],
  'supplement-requested': m['activity.supplement-requested'],
  'supplement-submitted': m['activity.supplement-submitted'],
  'supplement-cancelled': m['activity.supplement-cancelled'],
  'revision-required': m['activity.revision-required'],
} as const

const when = (iso: string, locale: string) => {
  // postgres text form: space separator and a bare "+00" offset that
  // Date refuses; normalize both before parsing
  const at = new Date(iso.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'))
  return new Intl.DateTimeFormat(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}

/**
 * The participant's own half of the overview (§32.72): what needs their
 * hand right now, and what has happened to their claims lately. Both are
 * read models over the entry facts; neither is a notification centre.
 */
function MyDesk({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  const { format, locale } = useI18n()

  useBatchLive(batchId, (kind) => {
    if (kind !== 'sync' && kind !== 'entries-changed' && kind !== 'result-changed') return
    void queryClient.invalidateQueries({
      queryKey: query.assessment.getMyEntrySummary.key({ params: { batchId } }),
    })
    void queryClient.invalidateQueries({
      queryKey: query.assessment.listMyEntryActivity.key({ params: { batchId }, query: {} }),
    })
  })

  const summary = useQuery(query.assessment.getMyEntrySummary.queryOptions({ params: { batchId } }))
  const activity = useQuery(
    query.assessment.listMyEntryActivity.queryOptions({ params: { batchId }, query: {} }),
  )
  // pages the reader asked for beyond the first, kept until the batch changes
  const [more, setMore] = useState<readonly ActivityItem[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const first = activity.data?.items ?? []
  const shown = [...first, ...more]
  const nextCursor = cursor ?? activity.data?.nextCursor ?? null
  const hasMore = (cursor === null ? activity.data?.nextCursor : cursor) !== null

  // a participant without a membership row simply has no desk here: the
  // administrator's overview keeps the flow column and nothing else
  if (summary.error !== null) return null

  const openEntry = (itemId: string, entryId: string, layer: 'detail' | 'entry') =>
    navigate('assessment/batch-my-entries', {
      params: { batchId },
      search:
        layer === 'detail' ? { open: itemId, detail: entryId } : { open: itemId, entry: entryId },
    })

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">{format(m.overviewActionsTitle)}</h2>
          {(summary.data?.actions.length ?? 0) > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {summary.data!.actions.length}
            </Badge>
          )}
        </div>
        {summary.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : summary.data!.actions.length === 0 ? (
          <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
            {format(m.overviewActionsNone)}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="overview-actions">
            {summary.data!.actions.map((action) => (
              <li
                key={`${action.kind}:${action.entryId}`}
                data-action={action.kind}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/25"
              >
                <div className="flex min-w-0 flex-1 basis-52 flex-col gap-0.5">
                  <p className="truncate text-sm font-medium text-amber-950 dark:text-amber-100">
                    {action.itemTitle}
                  </p>
                  <p className="text-[13px] text-amber-900/85 dark:text-amber-200/80">
                    {action.kind === 'supplement'
                      ? format(m.overviewActionSupplement, {
                          who: action.who ?? format(m['activity.somebody']),
                        })
                      : format(m.overviewActionRevision)}
                  </p>
                  {action.summary !== null && (
                    <p className="truncate text-[13px] text-amber-900/70 dark:text-amber-200/60">
                      {action.summary}
                    </p>
                  )}
                </div>
                <span className="text-xs text-amber-900/60 tabular-nums dark:text-amber-200/50">
                  {when(action.at, locale)}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-amber-300 bg-transparent text-amber-950 hover:bg-amber-100/60 dark:border-amber-800 dark:text-amber-100 dark:hover:bg-amber-900/40"
                  onClick={() =>
                    openEntry(
                      action.itemId,
                      action.entryId,
                      action.kind === 'supplement' ? 'detail' : 'entry',
                    )
                  }
                >
                  {format(
                    action.kind === 'supplement' ? m.overviewGoSupplement : m.overviewGoRevision,
                  )}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">{format(m.overviewActivityTitle)}</h2>
          <span className="flex-1" />
          {(summary.data?.unreadItemCount ?? 0) > 0 && (
            <span className="text-xs text-muted-foreground">
              {format(m.overviewActivityUnread, { count: summary.data!.unreadItemCount })}
            </span>
          )}
        </div>
        {activity.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : shown.length === 0 ? (
          <p className="rounded-xl border px-4 py-3 text-sm text-muted-foreground">
            {format(m.overviewActivityNone)}
          </p>
        ) : (
          <ul className="flex flex-col" data-testid="overview-activity">
            {shown.map((row) => (
              <li key={row.id + row.kind}>
                <button
                  type="button"
                  onClick={() => openEntry(row.itemId, row.entryId, 'detail')}
                  className="flex w-full flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b px-1 py-2.5 text-left last:border-b-0 hover:bg-accent/40"
                >
                  <span className="min-w-0 shrink-0 basis-40 truncate text-sm font-medium">
                    {row.itemTitle}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-muted-foreground">
                    {format(ACTIVITY_SAID[row.kind], {
                      who: row.actorName ?? format(m['activity.somebody']),
                    })}
                    {row.reason !== null && ` · ${row.reason}`}
                  </span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums">
                    {when(row.at, locale)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {hasMore && (
          <Button
            variant="ghost"
            size="sm"
            className="self-start"
            disabled={loadingMore}
            onClick={() => {
              const after = nextCursor
              if (after === null) return
              setLoadingMore(true)
              void run(
                api.assessment.listMyEntryActivity({
                  params: { batchId },
                  query: { cursor: after },
                }),
              )
                .then((page) => {
                  setMore((held) => [...held, ...page.items])
                  setCursor(page.nextCursor)
                })
                .finally(() => setLoadingMore(false))
            }}
          >
            {format(m.overviewActivityMore)}
            <ChevronRightIcon aria-hidden />
          </Button>
        )}
      </section>
    </>
  )
}
