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
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { Skeleton } from '@qualy/ui/skeleton'
import { Tabs, TabsList, TabsTrigger } from '@qualy/ui/tabs'
import { cn } from '@qualy/ui/cn'
import { assessmentApi } from './api.ts'
import { useBatchLive } from './live.ts'
import type { ApiResult } from '@qualy/web-runtime/api'
import { BatchScreen } from './batch/BatchScreen.tsx'
import { BatchFlow, BatchFlowStrip } from './batch/BatchFlow.tsx'
import { PhaseContextBar } from './batch/PhaseContextBar.tsx'
import { assessmentMessages as m } from './i18n.ts'

// The batch's front page, with two time axes that must not blur into one
// (§32.73): across the top, where the whole round stands; below it, what
// this user should handle and what has lately happened around them. The
// page is the user's desk on the batch, not the participant's - a reviewer
// has a desk here too, and someone who is both reads one merged story.

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

type ActivityItem = ApiResult<typeof assessmentApi, 'assessment', 'listMyActivity'>['items'][number]

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

// the reader's own acts wear a hollow marker; what arrived from outside is
// filled, and a settled verdict keeps a quiet trace of its color
const OWN: Record<'participant' | 'reviewer', ReadonlySet<string>> = {
  participant: new Set([
    'entry-created',
    'entry-revised',
    'entry-submitted',
    'entry-withdrawn',
    'entry-abandoned',
    'appeal-filed',
    'supplement-submitted',
  ]),
  reviewer: new Set([
    'review-approved',
    'review-stage-approved',
    'review-rejected',
    'review-escalated',
    'review-opinion-rejected',
    'supplement-requested',
    'supplement-cancelled',
  ]),
}

const markOf = (row: ActivityItem): string => {
  if (row.perspective === 'participant' && row.kind === 'review-approved') {
    return 'bg-emerald-500/75'
  }
  if (row.perspective === 'participant' && row.kind === 'review-rejected') {
    return 'bg-rose-500/75'
  }
  return OWN[row.perspective].has(row.kind)
    ? 'border-[1.5px] border-muted-foreground/50 bg-background'
    : 'bg-muted-foreground/75'
}

type Lane = 'all' | 'participant' | 'reviewer'

/**
 * The user's half of the page: what needs their hand across every standing
 * they hold here, then one merged feed of what lately happened around
 * them. Full histories stay on the claim and the round; this is neither an
 * audit log nor a notification centre.
 */
function MyDesk({ batchId }: { batchId: string }) {
  const query = useApiQuery(assessmentApi)
  const api = useApi(assessmentApi)
  const run = useRunApi()
  const navigate = usePageNavigate()
  const queryClient = useQueryClient()
  const { format, formatError, locale } = useI18n()
  const [lane, setLane] = useState<Lane>('all')

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

  const overview = useQuery(query.assessment.getMyOverview.queryOptions({ params: { batchId } }))
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

  const desk = overview.data
  // both standings at once is the only desk that needs telling apart
  const mixed = desk !== undefined && desk.participant !== null && desk.reviewer !== null
  if (overview.isError) {
    return <p className="text-sm text-destructive">{formatError(overview.error)}</p>
  }
  if (desk !== undefined && desk.participant === null && desk.reviewer === null) {
    // an administrator without a standing here: the flow above is the page
    return null
  }

  const openEntry = (itemId: string, entryId: string, layer: 'detail' | 'entry') =>
    navigate('assessment/batch-my-entries', {
      params: { batchId },
      search:
        layer === 'detail' ? { open: itemId, detail: entryId } : { open: itemId, entry: entryId },
    })
  const openRow = (row: ActivityItem) => {
    if (row.perspective === 'reviewer') {
      if (row.instanceId !== null) {
        navigate('assessment/review-instance', {
          params: { batchId, instanceId: row.instanceId },
        })
      }
      return
    }
    openEntry(row.itemId, row.entryId, 'detail')
  }

  const laneTag = (which: 'participant' | 'reviewer') =>
    mixed && (
      <span className="shrink-0 text-xs text-muted-foreground/80">
        {format(which === 'participant' ? m.overviewLaneEntry : m.overviewLaneReview)}
      </span>
    )

  const actions = desk?.participant?.actions ?? []
  const pending = desk?.reviewer?.pendingCount ?? 0
  const answered = desk?.reviewer?.answeredAskCount ?? 0
  const deskRows = actions.length + (pending > 0 ? 1 : 0) + (answered > 0 ? 1 : 0)

  return (
    <>
      <section className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">{format(m.overviewActionsTitle)}</h2>
          {deskRows > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {deskRows}
            </Badge>
          )}
        </div>
        {overview.isPending ? (
          <Skeleton className="h-14 w-full" />
        ) : deskRows === 0 ? (
          // nothing to do earns one quiet line, not an empty-state monument
          <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <CheckIcon aria-hidden className="size-3.5" />
            {format(m.overviewActionsNone)}
          </p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="overview-actions">
            {actions.map((action) => (
              <li
                key={`${action.kind}:${action.entryId}`}
                data-action={action.kind}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/50 dark:bg-amber-950/25"
              >
                <div className="flex min-w-0 flex-1 basis-52 flex-col gap-0.5">
                  <span className="flex items-baseline gap-2">
                    <p className="truncate text-sm font-medium text-amber-950 dark:text-amber-100">
                      {action.itemTitle}
                    </p>
                    {laneTag('participant')}
                  </span>
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
                  {clockOf(action.at, locale)}
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
            {pending > 0 && (
              <li
                data-action="review-pending"
                data-count={pending}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3"
              >
                <span className="flex min-w-0 flex-1 basis-52 items-baseline gap-2">
                  <p className="text-sm">{format(m.overviewPendingReviews, { count: pending })}</p>
                  {laneTag('reviewer')}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => navigate('assessment/batch-reviews', { params: { batchId } })}
                >
                  {format(m.overviewGoReview)}
                  <ChevronRightIcon aria-hidden />
                </Button>
              </li>
            )}
            {answered > 0 && (
              <li
                data-action="review-answered"
                data-count={answered}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3"
              >
                <span className="flex min-w-0 flex-1 basis-52 items-baseline gap-2">
                  <p className="text-sm">{format(m.overviewAskAnswered, { count: answered })}</p>
                  {laneTag('reviewer')}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    navigate('assessment/batch-reviews', {
                      params: { batchId },
                      search: { view: 'asked' },
                    })
                  }
                >
                  {format(m.overviewGoAsked)}
                  <ChevronRightIcon aria-hidden />
                </Button>
              </li>
            )}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="text-sm font-semibold">{format(m.overviewActivityTitle)}</h2>
          {(desk?.participant?.unreadItemCount ?? 0) > 0 && (
            <span className="text-xs text-muted-foreground">
              {format(m.overviewActivityUnread, { count: desk!.participant!.unreadItemCount })}
            </span>
          )}
          <span className="flex-1" />
          {mixed && (
            <Tabs value={lane} onValueChange={(value) => setLane(value as Lane)}>
              <TabsList className="h-8">
                <TabsTrigger value="all" className="px-2.5 text-xs">
                  {format(m.overviewFilterAll)}
                </TabsTrigger>
                <TabsTrigger value="participant" className="px-2.5 text-xs">
                  {format(m.overviewLaneEntry)}
                </TabsTrigger>
                <TabsTrigger value="reviewer" className="px-2.5 text-xs">
                  {format(m.overviewLaneReview)}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          )}
        </div>

        {activity.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : activity.isError ? (
          <p className="text-sm text-destructive">{formatError(activity.error)}</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{format(m.overviewActivityNone)}</p>
        ) : (
          <div className="flex flex-col gap-4" data-testid="overview-activity">
            {groups.map((group) => (
              <section key={group.label} className="flex flex-col gap-2">
                <h3 className="text-xs font-medium text-muted-foreground">{group.label}</h3>
                <ol className="flex flex-col">
                  {group.items.map((row, index) => {
                    const sentence = SAID[row.perspective][row.kind]
                    const who =
                      (row.perspective === 'reviewer' ? row.subjectName : row.actorName) ??
                      format(m['activity.somebody'])
                    const last = index === group.items.length - 1
                    return (
                      <li
                        key={row.id + row.kind}
                        data-kind={row.kind}
                        data-perspective={row.perspective}
                        className="flex gap-3"
                      >
                        <span className="w-10 shrink-0 pt-0.5 text-right text-xs text-muted-foreground tabular-nums">
                          {clockOf(row.at, locale)}
                        </span>
                        <span aria-hidden className="flex w-3 shrink-0 flex-col items-center">
                          <span
                            className={cn('mt-1 size-2.5 shrink-0 rounded-full', markOf(row))}
                          />
                          {!last && <span className="mt-1 w-px flex-1 bg-border" />}
                        </span>
                        <button
                          type="button"
                          onClick={() => openRow(row)}
                          className={cn(
                            'group flex min-w-0 flex-1 flex-col items-start gap-0.5 text-left',
                            last ? 'pb-1' : 'pb-4',
                          )}
                        >
                          <span className="flex w-full min-w-0 items-baseline gap-2">
                            <span className="truncate text-sm font-medium group-hover:underline">
                              {row.itemTitle}
                            </span>
                            {laneTag(row.perspective)}
                          </span>
                          {sentence !== undefined && (
                            <span className="text-sm text-muted-foreground">
                              {format(sentence as (typeof m)['activity.r.review-approved'], {
                                who,
                              })}
                            </span>
                          )}
                          {row.reason !== null && (
                            <span className="text-xs text-muted-foreground/85">{row.reason}</span>
                          )}
                          {row.comment !== null && (
                            <span className="line-clamp-2 text-xs text-muted-foreground/85">
                              {row.comment}
                            </span>
                          )}
                        </button>
                      </li>
                    )
                  })}
                </ol>
              </section>
            ))}
            {activity.hasNextPage && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start"
                disabled={activity.isFetchingNextPage}
                onClick={() => void activity.fetchNextPage()}
              >
                {format(m.overviewActivityMore)}
                <ChevronRightIcon aria-hidden />
              </Button>
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
