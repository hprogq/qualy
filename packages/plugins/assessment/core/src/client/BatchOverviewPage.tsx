import { useMemo, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, ChevronRightIcon } from 'lucide-react'
import {
  useApi,
  useApiQuery,
  usePageNavigate,
  usePageRouteParams,
  useRunApi,
} from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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

const wide = '@media (min-width: 1024px)'
const narrow = '@media (max-width: 1023.98px)'

const styles = stylex.create({
  desk: {
    display: 'grid',
    gap: {
      default: 24,
      [wide]: 48,
    },
    gridTemplateColumns: {
      default: null,
      [wide]: 'minmax(0, 1fr) 17.25rem',
    },
  },
  main: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: {
      default: 20,
      [wide]: 32,
    },
  },
  // the stage plan on a phone: the same strip, laid over the desk rather
  // than beside it
  planPhone: {
    display: {
      default: 'flex',
      [wide]: 'none',
    },
    flexDirection: 'column',
    gap: 10,
    order: {
      default: null,
      [narrow]: 2,
    },
    marginTop: {
      default: null,
      [narrow]: 8,
    },
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: 600,
  },
  planSkeleton: {
    height: 64,
    width: '100%',
  },
  aside: {
    display: {
      default: 'none',
      [wide]: 'block',
    },
  },
  asideTitle: {
    paddingBottom: 12,
    fontSize: 14,
    fontWeight: 600,
  },
  asideSkeletons: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  asideSkeletonLine: {
    height: 20,
    width: '100%',
  },
  failNote: {
    fontSize: 14,
    color: tokens.danger,
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    order: {
      default: null,
      [narrow]: 1,
    },
  },
  actionsHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  actionsCount: {
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 6,
    fontSize: 12,
    fontVariantNumeric: 'tabular-nums',
  },
  actionsSkeleton: {
    height: 64,
    width: '100%',
  },
  clearCard: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 24,
    paddingBlock: 36,
  },
  clearMark: {
    display: 'flex',
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
    color: tokens.mutedForeground,
  },
  clearIcon: {
    width: 15,
    height: 15,
  },
  clearWord: {
    fontSize: 14,
    fontWeight: 500,
  },
  todoGroups: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  todoGroup: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 8,
  },
  laneHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  laneWord: {
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  laneCount: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 80%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  laneRule: {
    height: 1,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    backgroundColor: tokens.border,
  },
  todoBox: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  // the whole line is the way in; the verb inside is the same door with a
  // keyboard-reachable handle
  todoRow: {
    display: 'grid',
    cursor: 'pointer',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) auto',
      [wide]: 'minmax(0, 1fr) 3.5rem 7rem',
    },
    columnGap: {
      default: 16,
      [wide]: 20,
    },
    rowGap: 4,
    alignItems: {
      default: null,
      [wide]: 'center',
    },
    borderTopWidth: {
      default: 1,
      ':first-child': 0,
    },
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: {
      default: 16,
      [wide]: 20,
    },
    paddingBlock: {
      default: 14,
      [wide]: 16,
    },
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  todoSubject: {
    gridColumnStart: 1,
    gridRowStart: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  todoAt: {
    gridColumnStart: 2,
    gridRowStart: 1,
    gridRowEnd: {
      default: null,
      [wide]: 'span 2',
    },
    alignSelf: {
      default: null,
      [wide]: 'center',
    },
    textAlign: 'right',
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  todoDetail: {
    gridColumnStart: 1,
    gridRowStart: 2,
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
    minWidth: 0,
    fontSize: 13,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
  todoVerbSeat: {
    gridColumnStart: {
      default: 2,
      [wide]: 3,
    },
    gridRowStart: {
      default: 2,
      [wide]: 1,
    },
    gridRowEnd: {
      default: null,
      [wide]: 'span 2',
    },
    alignSelf: {
      default: 'flex-end',
      [wide]: 'center',
    },
  },
  todoVerb: {
    display: 'inline-flex',
    cursor: 'pointer',
    alignItems: 'center',
    gap: {
      default: 2,
      [wide]: 4,
    },
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    height: {
      default: null,
      [wide]: 36,
    },
    width: {
      default: null,
      [wide]: '100%',
    },
    justifyContent: {
      default: null,
      [wide]: 'center',
    },
    borderRadius: {
      default: null,
      [wide]: tokens.radiusLg,
    },
    borderWidth: {
      default: 0,
      [wide]: 1,
    },
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: {
      default: null,
      [wide]: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    transitionProperty: {
      default: null,
      [wide]: 'color, background-color',
    },
  },
  todoVerbIcon: {
    width: {
      default: 14,
      [wide]: 12,
    },
    height: {
      default: 14,
      [wide]: 12,
    },
  },
  activity: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 20,
    order: {
      default: null,
      [narrow]: 3,
    },
    marginTop: {
      default: null,
      [wide]: 16,
    },
  },
  // the header holds the filter, and on a phone it stays put while the days
  // scroll under it
  activityHead: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 10,
    rowGap: 8,
    backgroundColor: tokens.background,
    position: {
      default: null,
      [narrow]: 'sticky',
    },
    top: {
      default: null,
      [narrow]: -24,
    },
    zIndex: {
      default: null,
      [narrow]: 10,
    },
    paddingBlock: {
      default: null,
      [narrow]: 6,
    },
  },
  activityTitle: {
    flexShrink: 0,
    fontSize: 14,
    fontWeight: 600,
  },
  unreadNote: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  headSpacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  activitySkeleton: {
    height: 96,
    width: '100%',
  },
  quietNote: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  feed: {
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
  },
  day: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  dayHead: {
    marginBottom: 6,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  dayLabel: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  feedRow: {
    marginInline: -12,
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [wide]: '3.25rem minmax(0, 1fr)',
    },
    columnGap: 20,
    borderRadius: tokens.radiusLg,
    paddingInline: 12,
    paddingBlock: 6,
    textAlign: 'left',
  },
  feedRowOpenable: {
    cursor: 'pointer',
    transitionProperty: 'color, background-color',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
  },
  feedClockWide: {
    display: {
      default: 'none',
      [wide]: 'block',
    },
    paddingTop: 1,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  feedBody: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 6,
  },
  feedTitleLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 10,
  },
  feedTitleSeat: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  unreadDot: {
    width: 7,
    height: 7,
    flexShrink: 0,
    borderRadius: '9999px',
    backgroundColor: tokens.danger,
  },
  feedTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  feedLaneWord: {
    display: {
      default: 'none',
      [wide]: 'inline',
    },
    marginLeft: 'auto',
    flexShrink: 0,
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 80%, transparent)`,
  },
  feedClockNarrow: {
    display: {
      default: 'inline',
      [wide]: 'none',
    },
    marginLeft: 'auto',
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  feedIdentity: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 1,
    overflow: 'hidden',
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  feedSentence: {
    fontSize: 13,
    lineHeight: 1.625,
    color: tokens.mutedForeground,
  },
  feedQuote: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.border,
    paddingLeft: 10,
    fontSize: 12,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: `color-mix(in oklab, ${tokens.foreground} 70%, transparent)`,
  },
  feedComment: {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    overflow: 'hidden',
  },
  moreButton: {
    display: 'inline-flex',
    cursor: 'pointer',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    fontSize: 12,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    transitionProperty: 'color',
  },
  moreIcon: {
    width: 12,
    height: 12,
  },
})

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
      kind !== 'phase-changed' &&
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
        <div {...stylex.props(styles.desk)}>
          <div {...stylex.props(styles.main)}>
            <section {...stylex.props(styles.planPhone)}>
              <h2 {...stylex.props(styles.sectionTitle)}>{format(m.flowTitle)}</h2>
              {plan.isPending ? (
                <Skeleton className={stylex.props(styles.planSkeleton).className} />
              ) : (
                <BatchFlowStrip timeline={timeline} />
              )}
            </section>

            <MyDesk batchId={batchId} overview={overview} />
          </div>

          <aside {...stylex.props(styles.aside)}>
            <h2 {...stylex.props(styles.asideTitle)}>{format(m.flowTitle)}</h2>
            {plan.isPending ? (
              <div {...stylex.props(styles.asideSkeletons)}>
                <Skeleton className={stylex.props(styles.asideSkeletonLine).className} />
                <Skeleton className={stylex.props(styles.asideSkeletonLine).className} />
                <Skeleton className={stylex.props(styles.asideSkeletonLine).className} />
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
    'review-vote-approved': m['activity.r.review-vote-approved'],
    'review-vote-rejected': m['activity.r.review-vote-rejected'],
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
    return <p {...stylex.props(styles.failNote)}>{formatError(overview.error as never)}</p>
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
      <section {...stylex.props(styles.actions)}>
        <div {...stylex.props(styles.actionsHead)}>
          <h2 {...stylex.props(styles.sectionTitle)}>{format(m.overviewActionsTitle)}</h2>
          {todo.length > 0 && <span {...stylex.props(styles.actionsCount)}>{todo.length}</span>}
        </div>
        {overview.isPending ? (
          <Skeleton className={stylex.props(styles.actionsSkeleton).className} />
        ) : todo.length === 0 ? (
          <div {...stylex.props(styles.clearCard)}>
            <span {...stylex.props(styles.clearMark)}>
              <CheckIcon aria-hidden className={stylex.props(styles.clearIcon).className} />
            </span>
            <p {...stylex.props(styles.clearWord)}>{format(m.overviewActionsNone)}</p>
          </div>
        ) : (
          <div {...stylex.props(styles.todoGroups)} data-testid="overview-actions">
            {todoGroups.map((group) => (
              <div key={group.which ?? 'all'} {...stylex.props(styles.todoGroup)}>
                {group.which !== null && (
                  <div {...stylex.props(styles.laneHead)}>
                    <span {...stylex.props(styles.laneWord)}>{laneWord(group.which)}</span>
                    <span {...stylex.props(styles.laneCount)}>{group.rows.length}</span>
                    <span aria-hidden {...stylex.props(styles.laneRule)} />
                  </div>
                )}
                <div {...stylex.props(styles.todoBox)}>
                  {group.rows.map((row) => (
                    <div
                      key={row.key}
                      data-action={row.action}
                      {...(row.count !== undefined ? { 'data-count': row.count } : {})}
                      onClick={row.go}
                      {...stylex.props(styles.todoRow)}
                    >
                      <span {...stylex.props(styles.todoSubject)}>{row.subject}</span>
                      <span {...stylex.props(styles.todoAt)}>{row.at}</span>
                      {row.detail !== null && (
                        <span {...stylex.props(styles.todoDetail)}>{row.detail}</span>
                      )}
                      <span {...stylex.props(styles.todoVerbSeat)}>
                        <button type="button" onClick={row.go} {...stylex.props(styles.todoVerb)}>
                          {row.verb}
                          <ChevronRightIcon
                            aria-hidden
                            className={stylex.props(styles.todoVerbIcon).className}
                          />
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

      <section {...stylex.props(styles.activity)}>
        <div {...stylex.props(styles.activityHead)}>
          <h2 {...stylex.props(styles.activityTitle)}>{format(m.overviewActivityTitle)}</h2>
          {(desk?.participant?.unreadItemIds.length ?? 0) > 0 && (
            <span {...stylex.props(styles.unreadNote)}>
              {format(m.overviewActivityUnread, {
                count: desk!.participant!.unreadItemIds.length,
              })}
            </span>
          )}
          <span {...stylex.props(styles.headSpacer)} />
          {mixed && (
            <Tabs
              variant="segmented"
              value={lane}
              onValueChange={(value) => setLane(value as Lane)}
            >
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
          <Skeleton className={stylex.props(styles.activitySkeleton).className} />
        ) : activity.isError ? (
          <p {...stylex.props(styles.failNote)}>{formatError(activity.error as never)}</p>
        ) : rows.length === 0 ? (
          <p {...stylex.props(styles.quietNote)}>{format(m.overviewActivityNone)}</p>
        ) : (
          <div {...stylex.props(styles.feed)} data-testid="overview-activity">
            {groups.map((group) => (
              <section key={group.label} {...stylex.props(styles.day)}>
                <div {...stylex.props(styles.dayHead)}>
                  <span {...stylex.props(styles.dayLabel)}>{group.label}</span>
                  <span aria-hidden {...stylex.props(styles.laneRule)} />
                </div>
                {group.items.map((row) => {
                  const sentence = SAID[row.perspective][row.kind]
                  const who =
                    (row.perspective === 'reviewer' ? row.subjectName : row.actorName) ??
                    format(m['activity.somebody'])
                  // the server already judged which rounds are still this
                  // reader's to open; everything else is a plain line
                  const openable = row.perspective === 'participant' || row.instanceId !== null
                  const identity = row.summary
                    .filter((part) => part.value !== '')
                    .map((part) => part.value)
                    .join(listJoin)
                  return (
                    <button
                      key={row.id + row.kind}
                      type="button"
                      data-kind={row.kind}
                      data-perspective={row.perspective}
                      data-unread={freshRowIds.has(row.id + row.kind) || undefined}
                      onClick={() => {
                        if (!openable) return
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
                      {...stylex.props(styles.feedRow, openable && styles.feedRowOpenable)}
                    >
                      <span {...stylex.props(styles.feedClockWide)}>{clockOf(row.at, locale)}</span>
                      <span {...stylex.props(styles.feedBody)}>
                        <span {...stylex.props(styles.feedTitleLine)}>
                          <span {...stylex.props(styles.feedTitleSeat)}>
                            {freshRowIds.has(row.id + row.kind) && (
                              <span
                                role="status"
                                aria-label={format(m.rowUnread)}
                                {...stylex.props(styles.unreadDot)}
                              />
                            )}
                            <span {...stylex.props(styles.feedTitle)}>{row.itemTitle}</span>
                          </span>
                          {mixed && (
                            <span {...stylex.props(styles.feedLaneWord)}>
                              {laneWord(row.perspective)}
                            </span>
                          )}
                          <span {...stylex.props(styles.feedClockNarrow)}>
                            {clockOf(row.at, locale)}
                          </span>
                        </span>
                        {identity !== '' && (
                          <span {...stylex.props(styles.feedIdentity)}>{identity}</span>
                        )}
                        <span {...stylex.props(styles.feedSentence)}>
                          {sentence !== undefined &&
                            format(sentence as (typeof m)['activity.r.review-approved'], { who })}
                        </span>
                        {(row.reason !== null || row.comment !== null) && (
                          <span {...stylex.props(styles.feedQuote)}>
                            {row.reason !== null && <span>{row.reason}</span>}
                            {row.comment !== null && (
                              <span {...stylex.props(styles.feedComment)}>{row.comment}</span>
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
                {...stylex.props(styles.moreButton)}
              >
                {format(m.overviewActivityMore)}
                <ChevronRightIcon aria-hidden className={stylex.props(styles.moreIcon).className} />
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
