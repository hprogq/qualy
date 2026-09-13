import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { assessmentMessages as m } from '../i18n.ts'
import { StatusBadge } from './StatusBadge.tsx'
import { BatchProgress } from './BatchProgress.tsx'
import type { TimelineLike } from './progress.ts'

// The batch that is running, as the thing the page leads with.
//
// One card, the width of the page, in two columns. The left says which
// round this is and how far along: the name, the material window, the run
// of stages as a bar with the current one lit and a mark for today, and
// the way in. The right says what this reader has to do about it: the
// stage that is open and when it closes, then at most two lines of work -
// what is waiting on them for other people first, their own second,
// because a queue that blocks somebody else outranks one that blocks only
// oneself. A reader with nothing to do sees the stage alone.
//
// When several rounds run at once the card shows one of them and says
// which: arrows for a few, a name to pick from once there are many. It
// never turns on its own - a page that rearranges itself while somebody
// reads it is a page nobody trusts.

export interface BatchCardRow {
  id: string
  name: string
  status: 'draft' | 'active' | 'archived'
  currentPhaseId: string | null
  currentPhaseName: string | null
  participantCount: number
  materialRange: { start: string; end: string }
  timeline: readonly TimelineLike[]
}

/**
 * What this reader has to do in the round.
 *
 * `review` is other people's work waiting on them and is only ever present
 * for somebody who reviews here; `own` is their own filing. The api that
 * answers this arrives with the next step; until then a page hands the card
 * `NO_AGENDA` and the right column says only where the round stands.
 */
export interface BatchAgenda {
  readonly review: { readonly count: number } | null
  readonly own: { readonly count: number } | null
}

export const NO_AGENDA: BatchAgenda = { review: null, own: null }

/** how the card says which of several running rounds it is showing */
export type HeroFrame =
  | { readonly kind: 'single' }
  | {
      readonly kind: 'arrows'
      readonly index: number
      readonly total: number
      readonly onPrevious: () => void
      readonly onNext: () => void
    }
  | {
      readonly kind: 'picker'
      readonly options: readonly { readonly id: string; readonly name: string }[]
      readonly onPick: (id: string) => void
    }

const arrive = stylex.keyframes({
  from: { opacity: 0, transform: 'translateX(8px)' },
  to: { opacity: 1, transform: 'translateX(0)' },
})

const arriveBack = stylex.keyframes({
  from: { opacity: 0, transform: 'translateX(-8px)' },
  to: { opacity: 1, transform: 'translateX(0)' },
})

const REDUCE = '@media (prefers-reduced-motion: reduce)'

const styles = stylex.create({
  card: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1.7fr) minmax(0, 1fr)',
      [breakpoints.phone]: 'minmax(0, 1fr)',
    },
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation2,
    animationDuration: '180ms',
    animationTimingFunction: 'ease-out',
    animationFillMode: 'both',
  },
  arriveForward: {
    animationName: { default: arrive, [REDUCE]: 'none' },
  },
  arriveBackward: {
    animationName: { default: arriveBack, [REDUCE]: 'none' },
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    paddingBlock: 22,
    paddingInline: {
      default: 26,
      [breakpoints.phone]: 20,
    },
  },
  head: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  headRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  frame: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  frameCount: {
    paddingInline: 4,
    color: tokens.surfaceMutedForeground,
  },
  frameArrow: {
    display: 'inline-flex',
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: tokens.radiusMd,
    borderWidth: 0,
    backgroundColor: {
      default: 'transparent',
      ':hover': tokens.surfaceMuted,
    },
    color: 'inherit',
    cursor: 'pointer',
    transitionProperty: 'background-color',
    transitionDuration: '150ms',
  },
  picker: {
    width: 240,
  },
  title: {
    margin: 0,
    fontSize: 20,
    lineHeight: 1.35,
    fontWeight: 600,
    letterSpacing: '-0.02em',
  },
  facts: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 4,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  plan: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  lanes: {
    position: 'relative',
    display: 'flex',
    alignItems: 'flex-end',
    gap: 6,
  },
  lane: (weight: number) => ({
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 7,
    flexGrow: weight,
    flexShrink: 1,
    flexBasis: '0%',
  }),
  laneName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  laneNameCurrent: {
    fontWeight: 600,
    color: tokens.foreground,
  },
  segment: {
    height: 6,
    borderRadius: 3,
  },
  segmentEnded: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
  },
  segmentCurrent: {
    height: 8,
    borderRadius: 4,
    backgroundColor: tokens.success,
  },
  segmentFuture: {
    backgroundColor: tokens.surfaceMuted,
  },
  todayMark: (left: string) => ({
    position: 'absolute',
    left,
    bottom: -3,
    height: 14,
    width: 2,
    borderRadius: 1,
    backgroundColor: tokens.foreground,
  }),
  axis: {
    position: 'relative',
    height: 16,
    fontSize: 11,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  axisStart: {
    position: 'absolute',
    left: 0,
    top: 3,
  },
  axisEnd: {
    position: 'absolute',
    right: 0,
    top: 3,
  },
  axisToday: (left: string) => ({
    position: 'absolute',
    left,
    top: 3,
    transform: 'translateX(-50%)',
    fontWeight: 500,
    color: tokens.foreground,
  }),
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginTop: 'auto',
  },
  side: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    paddingBlock: 8,
    paddingInline: 26,
    borderLeftWidth: {
      default: 1,
      [breakpoints.phone]: 0,
    },
    borderTopWidth: {
      default: 0,
      [breakpoints.phone]: 1,
    },
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 40%, ${tokens.surface})`,
  },
  stage: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    paddingBlock: 16,
  },
  stageLabel: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  stageName: {
    fontSize: 18,
    fontWeight: 600,
  },
  stageClock: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
    fontSize: 13,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  agendaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBlock: 14,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
  },
  agendaWords: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  agendaLabel: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  agendaValue: {
    fontSize: 14,
    fontWeight: 500,
  },
  agendaAction: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
    fontWeight: 500,
    color: tokens.foreground,
  },
})

/** a day with its year, in the reader's own notation */
const dayOf = (at: number, locale: string) => new Date(at).toLocaleDateString(locale)

/**
 * The plan as lanes: one per stage, as wide as the stage is long.
 *
 * A stage's length is the time between its entry and the next one's; a
 * stage without dates on both sides takes the middle length of the ones
 * that have them, so an unscheduled tail still has a lane. Today's mark is
 * placed along the same scale, which is what makes the bar a calendar
 * rather than a count.
 */
function planOf(timeline: readonly TimelineLike[], now: number) {
  const dates = timeline.map((entry) => (entry.entry.at === null ? null : Date.parse(entry.entry.at)))
  const spans = timeline.map((_, index) => {
    const from = dates[index] ?? null
    const until = dates[index + 1] ?? null
    return from !== null && until !== null && until > from ? until - from : null
  })
  const known = spans.filter((span): span is number => span !== null).sort((a, b) => a - b)
  const typical = known.length === 0 ? 1 : known[Math.floor(known.length / 2)]!
  const weights = spans.map((span) => (span === null ? typical : span))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const start = dates[0] ?? null
  const dated = dates.filter((date): date is number => date !== null)
  const end = dated.length > 0 ? dated[dated.length - 1]! : null
  // where today falls along the lanes: inside a dated stage by its share
  // of that stage, and in the middle of an undated one
  let today: number | null = null
  if (start !== null && now >= start) {
    let before = 0
    for (let index = 0; index < timeline.length; index += 1) {
      const from = dates[index] ?? null
      const until = dates[index + 1] ?? null
      const lane = weights[index]!
      const inside = from !== null && now >= from && (until === null || now < until)
      if (inside) {
        const share = until !== null && until > from ? (now - from) / (until - from) : 0.5
        today = (before + lane * share) / total
        break
      }
      before += lane
    }
  }
  return { weights: weights.map((weight) => weight / total), start, end, today }
}

function StageLanes({ timeline, now }: { timeline: readonly TimelineLike[]; now: number }) {
  const { locale, format } = useI18n()
  const plan = planOf(timeline, now)
  const at = (fraction: number) => `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(2)}%`
  return (
    <div {...stylex.props(styles.plan)}>
      <div {...stylex.props(styles.lanes)}>
        {timeline.map((entry, index) => (
          <div key={entry.displayName + String(index)} {...stylex.props(styles.lane(plan.weights[index]!))}>
            <span
              {...stylex.props(styles.laneName, entry.status === 'current' && styles.laneNameCurrent)}
            >
              {entry.displayName}
            </span>
            <span
              data-stage-status={entry.status}
              {...stylex.props(
                styles.segment,
                entry.status === 'ended' && styles.segmentEnded,
                entry.status === 'current' && styles.segmentCurrent,
                entry.status === 'future' && styles.segmentFuture,
              )}
            />
          </div>
        ))}
        {plan.today !== null && <span aria-hidden {...stylex.props(styles.todayMark(at(plan.today)))} />}
      </div>
      {plan.start !== null && (
        <div {...stylex.props(styles.axis)}>
          <span {...stylex.props(styles.axisStart)}>{dayOf(plan.start, locale)}</span>
          {plan.today !== null && (
            <span {...stylex.props(styles.axisToday(at(plan.today)))}>{format(m.today)}</span>
          )}
          {plan.end !== null && plan.end > plan.start && (
            <span {...stylex.props(styles.axisEnd)}>{dayOf(plan.end, locale)}</span>
          )}
        </div>
      )}
    </div>
  )
}

function Frame({ frame, current }: { frame: HeroFrame; current: string }) {
  const { format } = useI18n()
  if (frame.kind === 'single') return null
  if (frame.kind === 'picker') {
    return (
      <Select value={current} onValueChange={frame.onPick}>
        <SelectTrigger aria-label={format(m.pickBatch)} xstyle={styles.picker}>
          <SelectValue placeholder={format(m.pickBatch)} />
        </SelectTrigger>
        <SelectContent>
          {frame.options.map((option) => (
            <SelectItem key={option.id} value={option.id}>
              {option.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return (
    <div {...stylex.props(styles.frame)}>
      <button
        type="button"
        aria-label={format(m.previousBatch)}
        onClick={frame.onPrevious}
        {...stylex.props(styles.frameArrow)}
      >
        <ChevronLeftIcon size={14} aria-hidden />
      </button>
      <span data-testid="hero-position" data-index={String(frame.index + 1)} data-total={String(frame.total)} {...stylex.props(styles.frameCount)}>
        {`${String(frame.index + 1)} / ${String(frame.total)}`}
      </span>
      <button
        type="button"
        aria-label={format(m.nextBatch)}
        onClick={frame.onNext}
        {...stylex.props(styles.frameArrow)}
      >
        <ChevronRightIcon size={14} aria-hidden />
      </button>
    </div>
  )
}

function AgendaRow({
  label,
  value,
  action,
  page,
  batchId,
}: {
  label: string
  value: string
  action: string
  page: 'assessment/batch-reviews' | 'assessment/batch-my-entries'
  batchId: string
}) {
  return (
    <div data-testid="hero-agenda" data-agenda={page} {...stylex.props(styles.agendaRow)}>
      <div {...stylex.props(styles.agendaWords)}>
        <span {...stylex.props(styles.agendaLabel)}>{label}</span>
        <span {...stylex.props(styles.agendaValue)}>{value}</span>
      </div>
      <PageLink
        page={page}
        params={{ batchId }}
        className={stylex.props(styles.agendaAction).className}
        unavailable={<span {...stylex.props(styles.agendaAction)}>{action}</span>}
      >
        {action}
        <ArrowRightIcon size={13} aria-hidden />
      </PageLink>
    </div>
  )
}

export function BatchCard({
  row,
  agenda,
  frame,
  entered = 'forward',
  now = Date.now(),
}: {
  row: BatchCardRow
  agenda: BatchAgenda
  frame: HeroFrame
  /** which way the card came in, for the slide that says so */
  entered?: 'forward' | 'backward'
  /** the clock, for a test that wants to hold it still */
  now?: number
}): ReactNode {
  const { format, locale } = useI18n()
  const at = row.timeline.findIndex((entry) => entry.status === 'current')
  const next = at === -1 ? undefined : row.timeline[at + 1]
  const closes = next?.entry.kind === 'planned' && next.entry.at !== null ? Date.parse(next.entry.at) : null

  return (
    <article
      data-testid="batch-hero"
      data-batch={row.id}
      {...stylex.props(
        styles.card,
        entered === 'forward' ? styles.arriveForward : styles.arriveBackward,
      )}
    >
      <div {...stylex.props(styles.main)}>
        <div {...stylex.props(styles.head)}>
          <div {...stylex.props(styles.headRow)}>
            <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} />
            <Frame frame={frame} current={row.id} />
          </div>
          <h2 {...stylex.props(styles.title)}>{row.name}</h2>
          <div {...stylex.props(styles.facts)}>
            <span>
              {format(m.materialWindow, {
                from: row.materialRange.start,
                until: row.materialRange.end,
              })}
            </span>
            {row.timeline.length > 0 && (
              <span>
                {at === -1
                  ? format(m.stageCount, { total: row.timeline.length })
                  : format(m.stagePosition, { current: at + 1, total: row.timeline.length })}
              </span>
            )}
          </div>
        </div>

        {row.timeline.length > 0 && <StageLanes timeline={row.timeline} now={now} />}

        <div {...stylex.props(styles.actions)}>
          <Button asChild>
            <PageLink page="assessment/batch" params={{ batchId: row.id }}>
              {format(m.enterBatch)}
              <ArrowRightIcon aria-hidden />
            </PageLink>
          </Button>
        </div>
      </div>

      <aside {...stylex.props(styles.side)}>
        <div {...stylex.props(styles.stage)}>
          <span {...stylex.props(styles.stageLabel)}>{format(m.currentStage)}</span>
          <span {...stylex.props(styles.stageName)}>
            {row.currentPhaseName ?? format(m.notScheduled)}
          </span>
          <span {...stylex.props(styles.stageClock)}>
            {closes !== null && (
              <span>
                {format(m.stageDeadline, {
                  when: new Date(closes).toLocaleString(locale, {
                    month: '2-digit',
                    day: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                })}
              </span>
            )}
            <BatchProgress timeline={row.timeline} />
          </span>
        </div>
        {/* other people's work first: it blocks them, one's own blocks only oneself */}
        {agenda.review !== null && (
          <AgendaRow
            label={format(m.awaitingReview)}
            value={format(m.submissionsCount, { count: agenda.review.count })}
            action={format(m.startReview)}
            page="assessment/batch-reviews"
            batchId={row.id}
          />
        )}
        {agenda.own !== null && (
          <AgendaRow
            label={format(m.myEntries)}
            value={format(m.toRevise, { count: agenda.own.count })}
            action={format(m.continueEntries)}
            page="assessment/batch-my-entries"
            batchId={row.id}
          />
        )}
      </aside>
    </article>
  )
}
