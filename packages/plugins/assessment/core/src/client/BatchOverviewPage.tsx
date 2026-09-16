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
  cursorPages,
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
// Between a phone and the two-column desk. Stated as a closed range so it
// cannot overlap `wide` - two conditions that both match leave which one
// wins up to the order they were written in, which is not something a
// stylesheet should have to remember.
const roomy = '@media (min-width: 640px) and (max-width: 1023.98px)'

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
    order: { default: null, [narrow]: 1 },
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
  // One card per section, and the only white on the page.
  //
  // The shell is 0.99 throughout - top bar, batch bar, rail, band - so a
  // content area that is also 0.99 reads as one undifferentiated field. The
  // white is what says "this is the work"; the strips inside it are 0.985,
  // a shade the eye reads as a fold in the same sheet rather than a second
  // surface. Rows rule against each other and never carry their own box.
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  // The upright plan indents its own text to clear the rail, which is not the
  // same thing as standing off the card: the mark sits ON the column's leading
  // edge, so without this the dot rides the card's border and every note wraps
  // against it.
  cardPlan: {
    paddingBlock: 20,
    paddingInline: 20,
  },
  // The strip scrolls, so its air goes INSIDE the scroller (see the rail's own
  // lead-in) rather than around it. Padding here would end every stage short
  // of the card's own edge, which reads as a row that failed to fit rather
  // than as a rail there is more of.
  cardStrip: {
    paddingBlock: 16,
  },
  // what needs a hand sits a little proud of what merely happened
  cardRaised: {
    boxShadow: tokens.elevation2,
  },
  lane: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  laneRows: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  // the fold: a lane's standing, or a day, named inside the card
  strip: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceMuted,
    paddingInline: { default: 16, [wide]: 20 },
    paddingBlock: { default: 9, [wide]: 10 },
  },
  stripWord: {
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  // the day's other half: the date beside a word, or the weekday beside a
  // date. Carried by spacing, which is what this page uses for two facts
  // that sit side by side rather than one qualifying the other.
  stripAside: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 75%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
  },
  stripCount: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 80%, transparent)`,
    fontVariantNumeric: 'tabular-nums',
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
    columnGap: { default: 12, [wide]: 20 },
    rowGap: { default: 8, [wide]: 4 },
    alignItems: { default: null, [wide]: 'center' },
    borderTopWidth: { default: 1, ':first-child': 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingInline: { default: 16, [wide]: 20 },
    paddingBlock: { default: 14, [wide]: 16 },
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
    gridRowEnd: { default: null, [wide]: 'span 2' },
    alignSelf: { default: 'baseline', [wide]: 'center' },
    textAlign: 'right',
    fontSize: 12,
    whiteSpace: 'nowrap',
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  todoDetail: {
    gridColumnStart: 1,
    gridColumnEnd: { default: 'span 2', [wide]: 'auto' },
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
  // A phone puts the act on a line of its own, full width of the words above
  // it: at 390 a button sharing a row with a sentence is a target the thumb
  // has to aim for. A tablet keeps the line but not the width - a 700px
  // button is not a bigger target, only a louder one - so there it shrinks to
  // its words and sits at the end, where the desk's own column will put it.
  todoVerbSeat: {
    gridColumnStart: { default: 1, [wide]: 3 },
    gridColumnEnd: { default: 'span 2', [wide]: 'auto' },
    gridRowStart: { default: 3, [wide]: 1 },
    gridRowEnd: { default: null, [wide]: 'span 2' },
    alignSelf: { default: 'stretch', [wide]: 'center' },
    justifySelf: { default: null, [roomy]: 'end' },
  },
  todoVerb: {
    display: 'inline-flex',
    cursor: 'pointer',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 36,
    width: { default: '100%', [roomy]: 'auto' },
    minWidth: { default: null, [roomy]: '7rem' },
    paddingInline: 16,
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: 'nowrap',
    borderRadius: { default: tokens.radiusMd, [wide]: tokens.radiusLg },
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: {
      default: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    transitionProperty: 'color, background-color',
  },
  todoVerbIcon: {
    width: 12,
    height: 12,
  },
  activity: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 12,
    order: { default: null, [narrow]: 3 },
    marginTop: { default: null, [wide]: 16 },
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
  // the way on, as the card's last row rather than a link adrift under it
  moreRow: {
    display: 'flex',
    cursor: 'pointer',
    height: 44,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    borderInlineWidth: 0,
    borderBottomWidth: 0,
    fontSize: 12,
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    },
    color: { default: tokens.mutedForeground, ':hover': tokens.foreground },
    transitionProperty: 'color, background-color',
  },
  activitySkeleton: {
    height: 96,
    width: '100%',
  },
  quietNote: {
    fontSize: 14,
    color: tokens.mutedForeground,
  },
  day: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  feedRow: {
    display: 'grid',
    width: '100%',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [wide]: '3.25rem minmax(0, 1fr)',
    },
    columnGap: 20,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingInline: { default: 16, [wide]: 20 },
    paddingBlock: 12,
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
  // the parts of one claim's identity, told apart by a rule rather than by
  // punctuation: a comma between two nouns reads as prose, and this is not
  feedIdentity: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    // the air on the near side of a rule; the far side is the crumb's own
    // gap, and the two together are what make it read as a separator rather
    // than as a stroke stuck to the word before it
    columnGap: 9,
    rowGap: 2,
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  crumb: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 9,
  },
  crumbRule: {
    width: 1,
    height: 11,
    flexShrink: 0,
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 35%, transparent)`,
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
                // the same card the other two sections sit in: three parts of
                // one desk, each on its own sheet. The strip scrolls inside it
                // rather than running to the screen edge - a row that escapes
                // its card reads as a fourth thing, not as this one continuing
                <div {...stylex.props(styles.card, styles.cardStrip)}>
                  <BatchFlowStrip timeline={timeline} />
                </div>
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
              <div {...stylex.props(styles.card, styles.cardPlan)}>
                <BatchFlow timeline={timeline} keepPast={1} />
              </div>
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
    'entry-voided': m['activity.entry-voided'],
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
    ...cursorPages,
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
          <div {...stylex.props(styles.card, styles.cardRaised)} data-testid="overview-actions">
            {todoGroups.map((group) => (
              <div key={group.which ?? 'all'} {...stylex.props(styles.lane)}>
                {/* the standing each row speaks to, as a ruled strip inside the
                    card rather than a heading above a box of its own: two
                    standings are two parts of one desk, not two desks */}
                {group.which !== null && (
                  <div {...stylex.props(styles.strip)}>
                    <span {...stylex.props(styles.stripWord)}>{laneWord(group.which)}</span>
                    <span {...stylex.props(styles.stripCount)}>{group.rows.length}</span>
                  </div>
                )}
                <div {...stylex.props(styles.laneRows)}>
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
          <div {...stylex.props(styles.card)} data-testid="overview-activity">
            {groups.map((group) => (
              <section key={group.key} {...stylex.props(styles.day)}>
                <div {...stylex.props(styles.strip)}>
                  <span {...stylex.props(styles.stripWord)}>{group.label}</span>
                  {group.aside !== null && (
                    <span {...stylex.props(styles.stripAside)}>{group.aside}</span>
                  )}
                </div>
                {group.items.map((row) => {
                  const sentence = SAID[row.perspective][row.kind]
                  const who =
                    (row.perspective === 'reviewer' ? row.subjectName : row.actorName) ??
                    format(m['activity.somebody'])
                  // the server already judged which rounds are still this
                  // reader's to open; everything else is a plain line
                  const openable = row.perspective === 'participant' || row.instanceId !== null
                  // Kept as parts rather than joined into a sentence: these
                  // are coordinate facts about one claim - the group, the
                  // question, the level - and a separator between them is a
                  // rule, not a comma somebody has to read past.
                  const identity = row.summary
                    .filter((part) => part.value !== '')
                    .map((part) => part.value)
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
                        {identity.length > 0 && (
                          <span {...stylex.props(styles.feedIdentity)}>
                            {identity.map((part, at) => (
                              <span key={part + String(at)} {...stylex.props(styles.crumb)}>
                                {at > 0 && <span aria-hidden {...stylex.props(styles.crumbRule)} />}
                                {part}
                              </span>
                            ))}
                          </span>
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
                {...stylex.props(styles.moreRow)}
              >
                {format(m.overviewActivityMore)}
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
): readonly { key: string; label: string; aside: string | null; items: ActivityItem[] }[] {
  const today = new Date()
  const floor = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const todayFloor = floor(today)
  /**
   * Which day a row belongs to, said the way a person says it.
   *
   * `9/1` was the wrong answer twice over: it is the shape of a clock time,
   * which is what every row under it already carries, and a bare pair of
   * numbers is not how anybody names a day out loud. So the date is spelled
   * (`9月1日`, `September 1`) and the weekday rides beside it in a quieter
   * tone - reading a feed, which weekday something happened on is most of
   * what "when" means. Today and yesterday keep their words and take the
   * date as the quiet half instead, because those two are the days a reader
   * does not have to work out.
   */
  const dayOf = (iso: string) => {
    const at = new Date(iso)
    const diff = Math.round((todayFloor - floor(at)) / 86_400_000)
    const spelled = new Intl.DateTimeFormat(locale, {
      month: 'long',
      day: 'numeric',
      ...(at.getFullYear() === today.getFullYear() ? {} : { year: 'numeric' }),
    }).format(at)
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(at)
    if (diff === 0) return { key: 'today', label: format(m.overviewToday), aside: spelled }
    if (diff === 1) return { key: 'yesterday', label: format(m.overviewYesterday), aside: spelled }
    return { key: spelled, label: spelled, aside: weekday }
  }
  const groups: { key: string; label: string; aside: string | null; items: ActivityItem[] }[] = []
  for (const row of rows) {
    const day = dayOf(row.at)
    const last = groups[groups.length - 1]
    if (last !== undefined && last.key === day.key) last.items.push(row)
    else groups.push({ ...day, items: [row] })
  }
  return groups
}
