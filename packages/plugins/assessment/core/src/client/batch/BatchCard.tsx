import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { assessmentMessages as m } from '../i18n.ts'
import { dotDay, dotMoment } from './dates.ts'
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
  // one lane per stage, all the same width: the bar counts steps, it does
  // not measure days - the days are said in words beside it
  lane: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 7,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  // a name its lane cannot hold is cut short with an ellipsis, and the lane
  // says the whole of it on request
  laneName: {
    display: 'block',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11,
    color: tokens.mutedForeground,
  },
  // the current stage is always named, whole, whatever its lane's width -
  // it may run over the lanes beside it, whose names then stand down
  laneNameCurrent: {
    position: 'relative',
    zIndex: 1,
    overflow: 'visible',
    fontWeight: 600,
    color: tokens.foreground,
  },
  // a name the current one runs over: kept in the tree for whoever reads
  // without eyes, out of the picture for everyone else
  laneNameCovered: {
    opacity: 0,
    pointerEvents: 'none',
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
    borderColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
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
    borderTopColor: tokens.divider,
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

/**
 * The plan along the bar: where today falls, and the dates at its ends.
 *
 * The lanes are equal, so today's place is the current stage's index plus
 * how far through that stage the clock is - measured against the next
 * stage's planned start when there is one, and taken as halfway when
 * nothing after it has a date yet. A plan that has not begun has no today.
 */
function planOf(timeline: readonly TimelineLike[], now: number) {
  const dates = timeline.map((entry) => (entry.entry.at === null ? null : Date.parse(entry.entry.at)))
  const dated = dates.filter((date): date is number => date !== null)
  const start = dates[0] ?? null
  const end = dated.length > 0 ? dated[dated.length - 1]! : null
  const current = timeline.findIndex((entry) => entry.status === 'current')
  let today: number | null = null
  if (current !== -1 && timeline.length > 0) {
    const from = dates[current] ?? null
    const until = dates[current + 1] ?? null
    const share =
      from !== null && until !== null && until > from
        ? Math.min(1, Math.max(0, (now - from) / (until - from)))
        : 0.5
    today = (current + share) / timeline.length
  }
  return { start, end, today }
}

interface LaneFit {
  /** the name is no wider than its lane */
  readonly fits: readonly boolean[]
  /** the current stage's name runs over this lane */
  readonly covered: readonly boolean[]
}

/**
 * Which names their lanes can hold, and which the current name runs over.
 *
 * Measured, not guessed: six lanes on a tablet are narrower than a
 * six-character name, and the current name is drawn whole whatever its
 * lane's width. Its extent is read from a range over its text, because
 * with overflow visible the element's own box is still only the lane.
 * Re-read whenever the bar is resized.
 */
function useLaneFit(lanes: RefObject<HTMLDivElement | null>, count: number): LaneFit {
  const [fit, setFit] = useState<LaneFit>({ fits: [], covered: [] })
  useLayoutEffect(() => {
    const root = lanes.current
    if (root === null) return
    const measure = () => {
      const names = [...root.querySelectorAll<HTMLElement>('[data-lane-name]')]
      const fits = names.map((name) => name.scrollWidth <= name.clientWidth + 1)
      const current = names.find((name) => name.hasAttribute('data-current'))
      let reach: DOMRect | null = null
      if (current !== undefined) {
        const range = document.createRange()
        range.selectNodeContents(current)
        reach = range.getBoundingClientRect()
      }
      const covered = names.map((name) => {
        if (reach === null || name === current) return false
        const box = name.getBoundingClientRect()
        return box.left < reach.right + 4 && box.right > reach.left - 4
      })
      setFit((prev) =>
        prev.fits.length === fits.length &&
        prev.fits.every((value, index) => value === fits[index]) &&
        prev.covered.every((value, index) => value === covered[index])
          ? prev
          : { fits, covered },
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    return () => observer.disconnect()
  }, [lanes, count])
  return fit
}

function StageLanes({ timeline, now }: { timeline: readonly TimelineLike[]; now: number }) {
  const { format } = useI18n()
  const plan = planOf(timeline, now)
  const at = (fraction: number) => `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(2)}%`
  const lanesRef = useRef<HTMLDivElement>(null)
  const fit = useLaneFit(lanesRef, timeline.length)
  return (
    <div {...stylex.props(styles.plan)}>
      <TooltipProvider>
        <div ref={lanesRef} {...stylex.props(styles.lanes)}>
          {timeline.map((entry, index) => {
            const current = entry.status === 'current'
            const covered = !current && (fit.covered[index] ?? false)
            const whole = current || ((fit.fits[index] ?? true) && !covered)
            const lane = (
              <div
                key={entry.displayName + String(index)}
                data-lane
                data-stage-status={entry.status}
                data-named={whole ? '' : undefined}
                {...stylex.props(styles.lane)}
              >
                <span
                  data-lane-name
                  data-current={current ? '' : undefined}
                  {...stylex.props(
                    styles.laneName,
                    current && styles.laneNameCurrent,
                    covered && styles.laneNameCovered,
                  )}
                >
                  {entry.displayName}
                </span>
                <span
                  {...stylex.props(
                    styles.segment,
                    entry.status === 'ended' && styles.segmentEnded,
                    current && styles.segmentCurrent,
                    entry.status === 'future' && styles.segmentFuture,
                  )}
                />
              </div>
            )
            return whole ? (
              lane
            ) : (
              <Tooltip key={entry.displayName + String(index)}>
                <TooltipTrigger asChild>{lane}</TooltipTrigger>
                <TooltipContent>{entry.displayName}</TooltipContent>
              </Tooltip>
            )
          })}
          {plan.today !== null && (
            <span aria-hidden {...stylex.props(styles.todayMark(at(plan.today)))} />
          )}
        </div>
      </TooltipProvider>
      {plan.start !== null && (
        <div {...stylex.props(styles.axis)}>
          <span {...stylex.props(styles.axisStart)}>{dotDay(plan.start)}</span>
          {plan.today !== null && (
            <span {...stylex.props(styles.axisToday(at(plan.today)))}>{format(m.today)}</span>
          )}
          {plan.end !== null && plan.end > plan.start && (
            <span {...stylex.props(styles.axisEnd)}>{dotDay(plan.end)}</span>
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
  entered = null,
  now = Date.now(),
}: {
  row: BatchCardRow
  agenda: BatchAgenda
  frame: HeroFrame
  /** which way the card was stepped to, for the slide that says so; a card
   * the page opened with arrives with the page and does not slide */
  entered?: 'forward' | 'backward' | null
  /** the clock, for a test that wants to hold it still */
  now?: number
}): ReactNode {
  const { format } = useI18n()
  const at = row.timeline.findIndex((entry) => entry.status === 'current')
  const next = at === -1 ? undefined : row.timeline[at + 1]
  const closes = next?.entry.kind === 'planned' && next.entry.at !== null ? Date.parse(next.entry.at) : null

  return (
    <article
      data-testid="batch-hero"
      data-batch={row.id}
      {...stylex.props(
        styles.card,
        entered === 'forward' && styles.arriveForward,
        entered === 'backward' && styles.arriveBackward,
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
                from: dotDay(row.materialRange.start),
                until: dotDay(row.materialRange.end),
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
            {/* the close and what is left to it, one unit: "03.01 23:59
                截止 · 12 days left"; a stage with no close only says how
                long it has run */}
            {closes !== null && <span>{format(m.stageDeadline, { when: dotMoment(closes) })}</span>}
            <BatchProgress timeline={row.timeline} single />
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
