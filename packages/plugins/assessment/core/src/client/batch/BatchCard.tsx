import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ArrowRightIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Button } from '@qualy/ui/button'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@qualy/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@qualy/ui/tooltip'
import { assessmentMessages as m } from '../i18n.ts'
import { dotDay, dotMoment } from './dates.ts'
import { StatusBadge } from './StatusBadge.tsx'
import { BatchProgress } from './BatchProgress.tsx'
import { progressOf, type TimelineLike } from './progress.ts'
import type { AgendaRow as AgendaKind, BatchAgenda, BatchCardRow, HeroFrame } from './hero.ts'

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

const arrive = stylex.keyframes({
  from: { opacity: 0, transform: 'translateX(8px)' },
  to: { opacity: 1, transform: 'translateX(0)' },
})

const arriveBack = stylex.keyframes({
  from: { opacity: 0, transform: 'translateX(-8px)' },
  to: { opacity: 1, transform: 'translateX(0)' },
})

const REDUCE = '@media (prefers-reduced-motion: reduce)'

/**
 * Where the card stops having room for a column beside the plan.
 *
 * Asked of the card's own width, not the window's: the same card sits in a
 * page container that is one width on a tablet and another beside a rail,
 * and it is the card's width that decides whether two columns fit. An
 * element cannot query itself, so the width is read on the seat the card
 * sits in and the card answers for it.
 */
const NARROW = '@container (max-width: 959.98px)'

/**
 * Narrower still: where the stage's cell has no room for both halves of its
 * clock on one line.
 *
 * Measured rather than guessed. In the row-of-cells layout the cell is a
 * third of the card, and the moment plus the countdown come to about 247px:
 * at a container of 732 the cell has 244 and they wrap, at 742 it has 247
 * and they do not. The threshold sits just above that with a few pixels to
 * spare for a longer count.
 */
const TIGHT = '@container (max-width: 747.98px)'

const styles = stylex.create({
  // the seat exists to be measured; the card inside it draws
  seat: { containerType: 'inline-size' },
  card: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1.7fr) minmax(0, 1fr)',
      [NARROW]: 'minmax(0, 1fr)',
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
  // Beside the plan while there is room for it, under the plan as a row of
  // cells once there is not - the same three things either way, and the
  // cells divide themselves: two when there is one line of work, three
  // when there are two.
  side: {
    display: { default: 'flex', [NARROW]: 'grid' },
    gridAutoFlow: { default: null, [NARROW]: 'column' },
    gridAutoColumns: { default: null, [NARROW]: 'minmax(0, 1fr)' },
    flexDirection: 'column',
    justifyContent: 'center',
    paddingBlock: { default: 8, [NARROW]: 0 },
    paddingInline: { default: 26, [NARROW]: 0 },
    borderLeftWidth: { default: 1, [NARROW]: 0 },
    borderTopWidth: { default: 0, [NARROW]: 1 },
    borderStyle: 'solid',
    borderColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
  },
  // In a row of cells each one keeps its own side, and the padding that was
  // the column's becomes the cell's. It says nothing about the block
  // padding or the rule between stacked cells: those belong to the cells
  // themselves, and a `null` here would not defer to them - it would strike
  // them out, which is how the column lost its dividers once already.
  cell: {
    paddingInline: { default: null, [NARROW]: 26 },
    borderLeftWidth: { default: 0, [NARROW]: 1 },
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.divider,
  },
  // the first cell owns no dividing line: it is the one the row starts at
  cellFirst: { borderLeftWidth: { default: 0, [NARROW]: 0 } },
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
  // The moment it closes, beside how long is left - until the cell is too
  // narrow to hold both on one line. Wrapped, they stood the stage's cell
  // a line taller than the two beside it, for a date the table below
  // repeats in its own time column.
  stageWhen: { display: { default: 'inline', [TIGHT]: 'none' } },
  agendaRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBlock: { default: 14, [NARROW]: 16 },
    // stacked under the stage it belongs to, the rule above it is what
    // separates them; standing beside it in a row, the cell's own left
    // rule does that instead
    borderTopWidth: { default: 1, [NARROW]: 0 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    minWidth: 0,
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
  // a line with nothing to do about it still says where things stand, and
  // says it in the weight of a fact rather than of an instruction
  agendaValueIdle: {
    fontWeight: 400,
    color: tokens.mutedForeground,
  },
  /** a way in that is not asking: the same shape, the weight of a note */
  agendaActionIdle: { fontWeight: 400, color: tokens.mutedForeground },
  agendaAction: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
    fontSize: 13,
    fontWeight: 500,
    color: tokens.foreground,
    textDecoration: 'none',
    // it says "go", so under the pointer it goes: the words and the arrow
    // travel together, which is the whole line leaning the way it leads
    transform: { default: null, ':hover': 'translateX(2px)' },
    transitionProperty: { default: 'transform', [REDUCE]: 'none' },
    transitionDuration: { default: '120ms', [REDUCE]: '0s' },
    transitionTimingFunction: 'ease-out',
  },
})

// The same round on a phone, in the order somebody holding one reads it.
//
// A student opens this page to find their own filing, so what they have to
// do comes second, straight after the name - before the run of stages,
// which is context for it rather than the point. The card is not a link:
// it already holds two targets of its own, and a card that is also a
// target puts a third one two pixels outside them (§2d).
const phone = stylex.create({
  card: {
    display: 'flex',
    boxSizing: 'border-box',
    // The cards in a deck are as tall as the tallest of them: side by side
    // in a track somebody flicks through, a short one would leave its way
    // in floating at a different height on every card. The difference goes
    // above the way in and nowhere else - spread across the card's own
    // gaps it moved every line a little, and a line that sits at a
    // different height on every card is what the eye follows across a
    // flick. Empty space is not followed.
    height: '100%',
    flexDirection: 'column',
    // as much air between the card's parts as around them: at 14 against
    // an inset of 20 the stack read tighter than the sides, which is the
    // one place a reader notices a card being cramped
    gap: 16,
    paddingInline: 20,
    paddingTop: 20,
    paddingBottom: 18,
    borderRadius: 16,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation2,
  },
  head: { display: 'flex', flexDirection: 'column', gap: 8 },
  title: {
    margin: 0,
    // two lines at most, and no room held for a second one: a name that
    // takes one line moves what is under it by a line, which is cheaper
    // than holding a strip of nothing open on every card that has a short
    // name. A third line is refused - past two it stops being a name
    display: '-webkit-box',
    overflow: 'hidden',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    fontSize: 18,
    lineHeight: 1.35,
    fontWeight: 600,
    letterSpacing: '-0.02em',
    textWrap: 'pretty',
  },
  // the two lines of work as one block, so they read as a pair of things
  // to do rather than two unrelated strips
  // the two or three lines of the round as one block, at the height its
  // lines come to
  agenda: {
    display: 'flex',
    flexDirection: 'column',
    borderRadius: 10,
    backgroundColor: tokens.surfaceInset,
  },
  agendaRow: {
    display: 'flex',
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingInline: 16,
    paddingBlock: 10,
    color: tokens.foreground,
    textDecoration: 'none',
    // the whole row is the target, which is what makes it big enough
    borderTopWidth: { default: 0, ':not(:first-child)': 1 },
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  agendaWords: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 2 },
  agendaLabel: { fontSize: 12, color: tokens.mutedForeground },
  agendaValue: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 15,
    fontWeight: 600,
  },
  agendaValueIdle: { fontWeight: 500, color: tokens.mutedForeground },
  agendaGlyph: { flexShrink: 0, color: tokens.foreground },
  agendaGlyphIdle: { color: tokens.mutedForeground },
  // Where the round stands and the way into it are one thing, and that
  // thing is the foot of the card: on the tall card they already sit
  // together above the bottom edge, so on a short one they stay there and
  // the spare height falls above them - between what the reader has to do
  // and where the round has got to, which is where the card's own break
  // already is.
  // Where the round stands and the way into it are one thing, and that
  // thing is the foot of the card. Whatever height a card has spare falls
  // above them, in one place - a line's worth of it now that the lines are
  // single, which reads as spacing rather than as something missing.
  foot: { display: 'flex', marginTop: 'auto', flexDirection: 'column', gap: 14 },
  plan: { display: 'flex', flexDirection: 'column', gap: 8 },
  // no labels: at this width a name under every stage is a row of cut-off
  // words, and the one that matters is said in full on the line below
  lanes: { display: 'flex', alignItems: 'flex-end', gap: 4 },
  lane: { minWidth: 0, flexGrow: 1, flexShrink: 1, flexBasis: '0%', height: 4, borderRadius: 2 },
  laneEnded: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
  },
  laneCurrent: { height: 6, borderRadius: 3, backgroundColor: tokens.success },
  laneFuture: { backgroundColor: tokens.surfaceMuted },
  meta: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  // the name is the part that can run long - it is whatever somebody called
  // the stage - so it is the part that gives way, never the clock
  metaWhere: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'baseline',
    gap: 8,
  },
  metaAt: { flexShrink: 0 },
  metaStage: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
    color: tokens.foreground,
  },
  metaClock: { flexShrink: 0 },
  enter: { width: '100%', height: 44 },
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
  const dates = timeline.map((entry) =>
    entry.entry.at === null ? null : Date.parse(entry.entry.at),
  )
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
      <span
        data-testid="hero-position"
        data-index={String(frame.index + 1)}
        data-total={String(frame.total)}
        {...stylex.props(styles.frameCount)}
      >
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

/**
 * One agenda line, in words.
 *
 * `action` is what the reader would go and do, and `null` where there is
 * nowhere to go: an empty queue holds nothing to look at, and the line
 * that says so is the whole answer.
 *
 * Every line leads somewhere, because every line is about something the
 * reader has a place for: a queue, their own filings. A block in which
 * some lines that look alike can be pressed and others cannot is a block
 * whose rule nobody can state.
 *
 * `quiet` carries the difference instead: a line that asks nothing is
 * drawn in the weight of a fact rather than of an instruction, so it
 * neither calls out nor stands in the way.
 */
function wordsOf(
  row: AgendaKind,
  format: ReturnType<typeof useI18n>['format'],
): {
  label: string
  value: string
  action: string
  quiet: boolean
  page: 'assessment/batch-reviews' | 'assessment/batch-my-entries'
  state: string
} {
  if (row.kind === 'review') {
    return {
      label: format(m.awaitingReview),
      value:
        row.waiting > 0
          ? format(m.submissionsCount, { count: row.waiting })
          : format(m.reviewsClear),
      action: row.waiting > 0 ? format(m.startReview) : format(m.viewLine),
      quiet: row.waiting === 0,
      page: 'assessment/batch-reviews',
      state: row.waiting > 0 ? 'waiting' : 'clear',
    }
  }
  const [value, action] =
    row.state === 'toFix'
      ? [format(m.toRevise, { count: row.count }), format(m.continueEntries)]
      : row.state === 'draft'
        ? [format(m.toSubmit, { count: row.count }), format(m.continueDraft)]
        : row.state === 'submitted'
          ? [format(m.underReview, { count: row.count }), format(m.viewLine)]
          : [format(m.entriesNone), format(m.startEntries)]
  return {
    label: format(m.myEntries),
    value,
    action,
    quiet: row.state === 'submitted',
    page: 'assessment/batch-my-entries',
    state: row.state,
  }
}

function AgendaRow({
  row,
  batchId,
  format,
}: {
  row: AgendaKind
  batchId: string
  format: ReturnType<typeof useI18n>['format']
}) {
  const { label, value, action, quiet, page, state } = wordsOf(row, format)
  const softly = quiet && styles.agendaActionIdle
  return (
    <div
      data-testid="hero-agenda"
      data-agenda={page}
      data-agenda-state={state}
      {...stylex.props(styles.agendaRow, styles.cell)}
    >
      <div {...stylex.props(styles.agendaWords)}>
        <span {...stylex.props(styles.agendaLabel)}>{label}</span>
        <span {...stylex.props(styles.agendaValue, quiet && styles.agendaValueIdle)}>{value}</span>
      </div>
      <PageLink
        page={page}
        params={{ batchId }}
        className={stylex.props(styles.agendaAction, softly).className}
        unavailable={<span {...stylex.props(styles.agendaAction, softly)}>{action}</span>}
      >
        {action}
        <ArrowRightIcon size={13} aria-hidden />
      </PageLink>
    </div>
  )
}

/** one line of work, the whole of it a way to that work */
function PhoneAgendaRow({
  row,
  batchId,
  format,
}: {
  row: AgendaKind
  batchId: string
  format: ReturnType<typeof useI18n>['format']
}) {
  const { label, value, quiet, page, state } = wordsOf(row, format)
  const words = (
    <>
      <span {...stylex.props(phone.agendaWords)}>
        <span {...stylex.props(phone.agendaLabel)}>{label}</span>
        <span {...stylex.props(phone.agendaValue, quiet && phone.agendaValueIdle)}>{value}</span>
      </span>
      <ArrowRightIcon
        size={16}
        aria-hidden
        {...stylex.props(phone.agendaGlyph, quiet && phone.agendaGlyphIdle)}
      />
    </>
  )
  const marks = { 'data-testid': 'hero-agenda', 'data-agenda': page, 'data-agenda-state': state }
  return (
    <PageLink
      page={page}
      params={{ batchId }}
      {...marks}
      className={stylex.props(phone.agendaRow).className}
      unavailable={
        <span {...marks} {...stylex.props(phone.agendaRow)}>
          {words}
        </span>
      }
    >
      {words}
    </PageLink>
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
  // the card's own shape changes, not just its width, so the choice is made
  // here rather than in a media query
  const narrow = useIsMobile()
  const at = row.timeline.findIndex((entry) => entry.status === 'current')
  // asked of the clock rather than worked out here: a stage ends when the
  // next one begins, and this card used to say so in its own words - the
  // same reasoning written a second time, and only one of the two knew
  // what to do with a round that is unscheduled or has not begun
  const where = progressOf(row.timeline, now)
  const closes = where.kind === 'until' ? where.at : null

  // The phone card is a different order, not a narrower one: what the
  // reader has to do moves above the run of stages. Two orders cannot be
  // one tree reflowed, because the work belongs to the right-hand column
  // on a wide window and to the middle of the card on a narrow one.
  if (narrow) {
    return (
      <article
        data-testid="batch-hero"
        data-batch={row.id}
        {...stylex.props(
          phone.card,
          entered === 'forward' && styles.arriveForward,
          entered === 'backward' && styles.arriveBackward,
        )}
      >
        <div {...stylex.props(phone.head)}>
          <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} />
          <h2 {...stylex.props(phone.title)}>{row.name}</h2>
        </div>

        {/* the reader's own business, and only that: somebody the round is
            neither about nor answerable to gets no block at all rather
            than a sentence made up to fill one */}
        {agenda.rows.length > 0 && (
          <div {...stylex.props(phone.agenda)}>
            {agenda.rows.map((line) => (
              <PhoneAgendaRow key={line.kind} row={line} batchId={row.id} format={format} />
            ))}
          </div>
        )}

        <div {...stylex.props(phone.foot)}>
          {row.timeline.length > 0 && (
            <div {...stylex.props(phone.plan)}>
              <div {...stylex.props(phone.lanes)} aria-hidden>
                {row.timeline.map((entry, index) => (
                  <span
                    key={entry.displayName + String(index)}
                    {...stylex.props(
                      phone.lane,
                      entry.status === 'ended'
                        ? phone.laneEnded
                        : entry.status === 'current'
                          ? phone.laneCurrent
                          : phone.laneFuture,
                    )}
                  />
                ))}
              </div>
              {/* Where the round stands, in one line under the bar it
                  belongs to: which stage of how many, its name, and the
                  clock. The clock is the shared one - it tells a stage
                  that has not been scheduled from one that has not begun,
                  and it turns amber and then red as the close comes up,
                  which is the thing on this card worth noticing. */}
              <div {...stylex.props(phone.meta)}>
                <span {...stylex.props(phone.metaWhere)}>
                  {/* the bar above has just drawn the stages, so the count
                      needs no noun after it */}
                  <span {...stylex.props(phone.metaAt)}>
                    {at === -1
                      ? format(m.stageCount, { total: row.timeline.length })
                      : format(m.stageAt, { current: at + 1, total: row.timeline.length })}
                  </span>
                  {row.currentPhaseName !== null && (
                    <span {...stylex.props(phone.metaStage)}>{row.currentPhaseName}</span>
                  )}
                </span>
                <BatchProgress timeline={row.timeline} single xstyle={phone.metaClock} />
              </div>
            </div>
          )}

          <Button asChild className={stylex.props(phone.enter).className}>
            <PageLink page="assessment/batch" params={{ batchId: row.id }}>
              {format(m.enterBatch)}
              <ArrowRightIcon aria-hidden />
            </PageLink>
          </Button>
        </div>
      </article>
    )
  }

  return (
    <div {...stylex.props(styles.seat)}>
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
          <div {...stylex.props(styles.stage, styles.cell, styles.cellFirst)}>
            <span {...stylex.props(styles.stageLabel)}>{format(m.currentStage)}</span>
            <span {...stylex.props(styles.stageName)}>
              {row.currentPhaseName ?? format(m.notScheduled)}
            </span>
            <span {...stylex.props(styles.stageClock)}>
              {/* the close and what is left to it, one unit: "03.01 23:59
                截止 　 12 days left"; a stage with no close only says how
                long it has run */}
              {closes !== null && (
                <span {...stylex.props(styles.stageWhen)}>
                  {format(m.stageDeadline, { when: dotMoment(closes) })}
                </span>
              )}
              <BatchProgress timeline={row.timeline} single />
            </span>
          </div>
          {agenda.rows.map((line) => (
            <AgendaRow key={line.kind} row={line} batchId={row.id} format={format} />
          ))}
        </aside>
      </article>
    </div>
  )
}
