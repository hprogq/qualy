import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'
import {
  useApi,
  useApiQuery,
  usePageNavigate,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { Skeleton } from '@qualy/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { assessmentApi } from './api.ts'
import { useBatchLive } from './live.ts'
import type { ApiResult } from '@qualy/web-runtime/api'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { BatchFlow, BatchFlowStrip } from './batch/BatchFlow.tsx'
import { assessmentMessages as m } from './i18n.ts'

// The batch's front page as one desk (§32.73, laid out to design 2a/2b):
// the page description says what stands on the desk, the body starts
// straight at the work, and the stage plan keeps to the side - a column
// beside the desk on a wide screen, a strip above it on a phone. The top
// bar already names the current stage, so the page does not say it twice.

type OverviewDto = ApiResult<typeof assessmentApi, 'assessment', 'getMyOverview'>
type ActivityItem = ApiResult<typeof assessmentApi, 'assessment', 'listMyActivity'>['items'][number]

export default function BatchOverviewPage() {
  const { batchId } = usePageRouteParams('batchId')
  const query = useApiQuery(assessmentApi)
  const queryClient = useQueryClient()
  const { format } = useI18n()

  const plan = useQuery({
    ...query.assessment.getTimeline.queryOptions({ params: { batchId } }),
    staleTime: 30_000,
  })
  const timeline = plan.data?.timeline ?? []
  const overview = useQuery(query.assessment.getMyOverview.queryOptions({ params: { batchId } }))

  useBatchLive(batchId, (kind) => {
    if (
      kind !== 'sync' &&
      kind !== 'entries-changed' &&
      kind !== 'result-changed' &&
      kind !== 'review-inbox-changed' &&
      kind !== 'review-instance-changed'
    ) {
      return
    }
    void queryClient.invalidateQueries({
      queryKey: query.assessment.getMyOverview.key({ params: { batchId } }),
    })
    void queryClient.invalidateQueries({
      queryKey: query.assessment.listMyActivity.key({ params: { batchId }, query: {} }),
    })
  })

  return (
    <BatchScreen title={format(m.tabOverview)} description={format(m.overviewHint)}>
      {() => (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17.25rem] lg:gap-12">
          <div className="flex min-w-0 flex-col gap-5 lg:gap-8">
            {/* the stage plan on a phone: the same strip, laid over the
                desk rather than beside it */}
            <section className="flex flex-col gap-2.5 max-lg:order-2 max-lg:mt-2 lg:hidden">
              <h2 className="text-sm font-semibold">{format(m.flowTitle)}</h2>
              {plan.isPending ? (
                <Skeleton className="h-16 w-full" />
              ) : (
                <BatchFlowStrip timeline={timeline} />
              )}
            </section>

            <MyDesk batchId={batchId} overview={overview} />
          </div>

          <aside className="sticky top-6 hidden self-start lg:block">
            <h2 className="pb-3 text-sm font-semibold">{format(m.flowTitle)}</h2>
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
      )}
    </BatchScreen>
  )
}

const SAID: Record<'participant' | 'reviewer', Partial<Record<ActivityItem['kind'], unknown>>> = {
  participant: {
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
  },
  reviewer: {
    'review-approved': m['activity.r.review-approved'],
    'review-stage-approved': m['activity.r.review-stage-approved'],
    'review-rejected': m['activity.r.review-rejected'],
    'review-escalated': m['activity.r.review-escalated'],
    'review-opinion-rejected': m['activity.r.review-opinion-rejected'],
    'supplement-requested': m['activity.r.supplement-requested'],
    'supplement-cancelled': m['activity.r.supplement-cancelled'],
    'supplement-answered': m['activity.r.supplement-answered'],
  },
}

type Lane = 'all' | 'participant' | 'reviewer'

interface TodoRow {
  key: string
  lane: 'participant' | 'reviewer'
  action: string
  count?: number
  subject: string
  detail: string | null
  at: string | null
  verb: string
  go: () => void
}

/**
 * The desk itself: what needs the reader's hand, grouped by the standing
 * it speaks to, then one merged feed of what lately happened around them.
 * Full histories stay on the claim and the round.
 */
function MyDesk({
  batchId,
  overview,
}: {
  batchId: string
  overview: {
    data: OverviewDto | undefined
    isPending: boolean
    isError: boolean
    error: unknown
  }
}) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const navigate = usePageNavigate()
  const { format, formatError, locale } = useI18n()
  const [lane, setLane] = useState<Lane>('all')
  // the desk's list fragments join in the reader's own punctuation
  const listJoin = locale.startsWith('zh') ? '，' : ', '

  const perspective = lane === 'all' ? undefined : lane
  const activity = useInfiniteQuery({
    queryKey: [
      ...query.assessment.listMyActivity.key({ params: { batchId }, query: {} }),
      { lane },
      'infinite',
    ],
    queryFn: ({ pageParam }) =>
      run(
        api.assessment.listMyActivity({
          params: { batchId },
          query: {
            ...(pageParam !== undefined ? { cursor: pageParam } : {}),
            ...(perspective !== undefined ? { perspective } : {}),
          },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })

  const rows = useMemo(
    () => activity.data?.pages.flatMap((page) => page.items) ?? [],
    [activity.data],
  )
  const groups = useMemo(() => groupByDay(rows, locale, format), [rows, locale, format])
  // the unread questions, marked once each: the newest row of that question
  // in the feed carries the dot, read state stays the version pair's
  const freshRowIds = useMemo(() => {
    const unread = new Set(overview.data?.participant?.unreadItemIds ?? [])
    const marked = new Set<string>()
    const fresh = new Set<string>()
    for (const row of rows) {
      if (row.perspective !== 'participant') continue
      if (!unread.has(row.itemId) || marked.has(row.itemId)) continue
      marked.add(row.itemId)
      fresh.add(row.id + row.kind)
    }
    return fresh
  }, [rows, overview.data])

  const desk = overview.data
  const mixed = desk !== undefined && desk.participant !== null && desk.reviewer !== null
  if (overview.isError) {
    return <p className="text-sm text-destructive">{formatError(overview.error as never)}</p>
  }
  if (desk !== undefined && desk.participant === null && desk.reviewer === null) {
    // an administrator without a standing here reads the stage plan alone
    return null
  }

  const openEntry = (itemId: string, entryId: string, layer: 'detail' | 'entry') =>
    navigate('assessment/batch-my-entries', {
      params: { batchId },
      search:
        layer === 'detail' ? { open: itemId, detail: entryId } : { open: itemId, entry: entryId },
    })

  const todo: TodoRow[] = []
  for (const action of desk?.participant?.actions ?? []) {
    const sentence =
      action.kind === 'supplement'
        ? format(m.overviewActionSupplement, { who: action.who ?? format(m['activity.somebody']) })
        : format(m.overviewActionRevision)
    todo.push({
      key: `${action.kind}:${action.entryId}`,
      lane: 'participant',
      action: action.kind,
      subject: action.itemTitle,
      detail: action.summary === null ? sentence : `${sentence}：${action.summary}`,
      at: clockOf(action.at, locale),
      verb: format(action.kind === 'supplement' ? m.overviewGoSupplement : m.overviewGoRevision),
      go: () =>
        openEntry(action.itemId, action.entryId, action.kind === 'supplement' ? 'detail' : 'entry'),
    })
  }
  if ((desk?.reviewer?.pendingCount ?? 0) > 0) {
    todo.push({
      key: 'review-pending',
      lane: 'reviewer',
      action: 'review-pending',
      count: desk!.reviewer!.pendingCount,
      subject: format(m.overviewPendingReviews, { count: desk!.reviewer!.pendingCount }),
      detail:
        desk!.reviewer!.queueGroups.length === 0
          ? null
          : desk!
              .reviewer!.queueGroups.map((group) =>
                format(m.overviewQueueGroup, { name: group.name, count: group.count }),
              )
              .join(listJoin),
      at: null,
      verb: format(m.overviewGoReview),
      go: () => navigate('assessment/batch-reviews', { params: { batchId } }),
    })
  }
  if ((desk?.reviewer?.answeredAskCount ?? 0) > 0) {
    todo.push({
      key: 'review-answered',
      lane: 'reviewer',
      action: 'review-answered',
      count: desk!.reviewer!.answeredAskCount,
      subject: format(m.overviewAskAnswered, { count: desk!.reviewer!.answeredAskCount }),
      detail:
        desk!.reviewer!.answeredAsks.length === 0
          ? null
          : desk!
              .reviewer!.answeredAsks.map((ask) =>
                format(m.overviewAskEntry, {
                  who: ask.who ?? format(m['activity.somebody']),
                  item: ask.itemTitle,
                }),
              )
              .join(listJoin),
      at: null,
      verb: format(m.overviewGoAsked),
      go: () =>
        navigate('assessment/batch-reviews', { params: { batchId }, search: { view: 'asked' } }),
    })
  }
  // grouped by the standing each row speaks to, labels only when both exist
  const laneWord = (which: 'participant' | 'reviewer') =>
    format(which === 'participant' ? m.overviewLaneEntry : m.overviewLaneReview)
  const todoGroups = (mixed ? (['participant', 'reviewer'] as const) : ([null] as const))
    .map((which) => ({
      which,
      rows: which === null ? todo : todo.filter((row) => row.lane === which),
    }))
    .filter((group) => group.rows.length > 0)

  return (
    <>
      <section className="flex flex-col gap-3 max-lg:order-1">
        <div className="flex items-center gap-2.5">
          <h2 className="text-sm font-semibold">{format(m.overviewActionsTitle)}</h2>
          {todo.length > 0 && (
            <span className="rounded-md bg-muted px-1.5 text-xs tabular-nums">{todo.length}</span>
          )}
        </div>
        {overview.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : todo.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[10px] border px-6 py-9">
            <span className="flex size-[30px] items-center justify-center rounded-full border bg-background text-muted-foreground">
              <CheckIcon aria-hidden className="size-[15px]" />
            </span>
            <p className="text-sm font-medium">{format(m.overviewActionsNone)}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4" data-testid="overview-actions">
            {todoGroups.map((group) => (
              <div key={group.which ?? 'all'} className="flex min-w-0 flex-col gap-2">
                {group.which !== null && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      {laneWord(group.which)}
                    </span>
                    <span className="text-xs text-muted-foreground/80 tabular-nums">
                      {group.rows.length}
                    </span>
                    <span aria-hidden className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="flex min-w-0 flex-col overflow-hidden rounded-[10px] border">
                  {group.rows.map((row) => (
                    // the whole line is the way in; the verb inside is the
                    // same door with a keyboard-reachable handle
                    <div
                      key={row.key}
                      data-action={row.action}
                      {...(row.count !== undefined ? { 'data-count': row.count } : {})}
                      onClick={row.go}
                      className="grid cursor-pointer grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 border-t px-4 py-3.5 first:border-t-0 hover:bg-muted/60 lg:grid-cols-[minmax(0,1fr)_3.5rem_7rem] lg:items-center lg:gap-x-5 lg:px-5 lg:py-4"
                    >
                      <span className="col-start-1 row-start-1 min-w-0 truncate text-sm font-medium">
                        {row.subject}
                      </span>
                      <span className="col-start-2 row-start-1 text-right text-xs whitespace-nowrap text-muted-foreground tabular-nums lg:row-span-2 lg:self-center">
                        {row.at}
                      </span>
                      {row.detail !== null && (
                        <span className="col-start-1 row-start-2 line-clamp-2 min-w-0 text-[13px] leading-relaxed text-pretty text-muted-foreground">
                          {row.detail}
                        </span>
                      )}
                      <span className="col-start-2 row-start-2 self-end lg:col-start-3 lg:row-span-2 lg:row-start-1 lg:self-center">
                        <button
                          type="button"
                          onClick={row.go}
                          className="inline-flex cursor-pointer items-center gap-0.5 text-[13px] font-medium whitespace-nowrap lg:h-9 lg:w-full lg:justify-center lg:gap-1 lg:rounded-lg lg:border lg:bg-background lg:text-[13px] lg:transition-colors lg:hover:bg-muted/60"
                        >
                          {row.verb}
                          <ChevronRightIcon aria-hidden className="size-3.5 lg:size-3" />
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex min-w-0 flex-col gap-5 max-lg:order-3 lg:mt-4">
        {/* the header holds the filter, and on a phone it stays put while
            the days scroll under it */}
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 bg-background max-lg:sticky max-lg:-top-6 max-lg:z-10 max-lg:py-1.5">
          <h2 className="shrink-0 text-sm font-semibold">{format(m.overviewActivityTitle)}</h2>
          {(desk?.participant?.unreadItemIds.length ?? 0) > 0 && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {format(m.overviewActivityUnread, {
                count: desk!.participant!.unreadItemIds.length,
              })}
            </span>
          )}
          <span className="flex-1" />
          {mixed && (
            <Tabs value={lane} onValueChange={(value) => setLane(value as Lane)}>
              <TabsList>
                {(
                  [
                    ['all', m.overviewFilterAll],
                    ['participant', m.overviewLaneEntry],
                    ['reviewer', m.overviewLaneReview],
                  ] as const
                ).map(([value, label]) => (
                  <TabsTrigger key={value} value={value}>
                    {format(label)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
        </div>

        {activity.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : activity.isError ? (
          <p className="text-sm text-destructive">{formatError(activity.error as never)}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{format(m.overviewActivityNone)}</p>
        ) : (
          <div className="flex flex-col gap-7" data-testid="overview-activity">
            {groups.map((group) => (
              <section key={group.label} className="flex flex-col gap-4">
                <div className="flex items-center gap-2.5">
                  <span className="shrink-0 text-xs font-medium text-muted-foreground">
                    {group.label}
                  </span>
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </div>
                {group.items.map((row) => {
                  const sentence = SAID[row.perspective][row.kind]
                  const who =
                    (row.perspective === 'reviewer' ? row.subjectName : row.actorName) ??
                    format(m['activity.somebody'])
                  return (
                    <button
                      key={row.id + row.kind}
                      type="button"
                      data-kind={row.kind}
                      data-perspective={row.perspective}
                      data-unread={freshRowIds.has(row.id + row.kind) || undefined}
                      onClick={() => {
                        if (row.perspective === 'reviewer') {
                          if (row.instanceId !== null) {
                            navigate('assessment/review-instance', {
                              params: { batchId, instanceId: row.instanceId },
                            })
                          }
                          return
                        }
                        openEntry(row.itemId, row.entryId, 'detail')
                      }}
                      className="group grid grid-cols-[minmax(0,1fr)] gap-x-5 text-left lg:grid-cols-[3.25rem_minmax(0,1fr)]"
                    >
                      <span className="hidden pt-px text-xs text-muted-foreground tabular-nums lg:block">
                        {clockOf(row.at, locale)}
                      </span>
                      <span className="flex min-w-0 flex-col gap-1.5">
                        <span className="flex min-w-0 items-baseline gap-2.5">
                          <span className="flex min-w-0 items-center gap-1.5">
                            {freshRowIds.has(row.id + row.kind) && (
                              <span
                                role="status"
                                aria-label={format(m.rowUnread)}
                                className="size-[7px] shrink-0 rounded-full bg-destructive"
                              />
                            )}
                            <span className="min-w-0 truncate text-sm font-medium group-hover:underline">
                              {row.itemTitle}
                            </span>
                          </span>
                          {mixed && (
                            <span className="ml-auto shrink-0 text-xs text-muted-foreground/80 max-lg:hidden">
                              {laneWord(row.perspective)}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 text-xs text-muted-foreground tabular-nums lg:hidden">
                            {clockOf(row.at, locale)}
                          </span>
                        </span>
                        <span className="text-[13px] leading-relaxed text-muted-foreground">
                          {sentence !== undefined &&
                            format(sentence as (typeof m)['activity.r.review-approved'], { who })}
                        </span>
                        {(row.reason !== null || row.comment !== null) && (
                          <span className="flex flex-col gap-0.5 border-l-2 pl-2.5 text-xs leading-relaxed text-pretty text-foreground/70">
                            {row.reason !== null && <span>{row.reason}</span>}
                            {row.comment !== null && (
                              <span className="line-clamp-2">{row.comment}</span>
                            )}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </section>
            ))}
            {activity.hasNextPage && (
              <button
                type="button"
                disabled={activity.isFetchingNextPage}
                onClick={() => void activity.fetchNextPage()}
                className="inline-flex cursor-pointer items-center gap-0.5 self-start text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {format(m.overviewActivityMore)}
                <ChevronRightIcon aria-hidden className="size-3" />
              </button>
            )}
          </div>
        )}
      </section>
    </>
  )
}

const clockOf = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

function groupByDay(
  rows: readonly ActivityItem[],
  locale: string,
  format: ReturnType<typeof useI18n>['format'],
): readonly { label: string; items: ActivityItem[] }[] {
  const today = new Date()
  const floor = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const todayFloor = floor(today)
  const labelOf = (iso: string) => {
    const at = new Date(iso)
    const diff = Math.round((todayFloor - floor(at)) / 86_400_000)
    if (diff === 0) return format(m.overviewToday)
    if (diff === 1) return format(m.overviewYesterday)
    return new Intl.DateTimeFormat(locale, {
      month: 'numeric',
      day: 'numeric',
      ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    }).format(at)
  }
  const groups: { label: string; items: ActivityItem[] }[] = []
  for (const row of rows) {
    const label = labelOf(row.at)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.label === label) last.items.push(row)
    else groups.push({ label, items: [row] })
  }
  return groups
}
