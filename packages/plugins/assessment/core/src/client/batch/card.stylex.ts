import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'

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
 * Measured, and measured again. In the row-of-cells layout the cell is a
 * third of the card; the threshold was first set from a container of 742
 * holding the moment and the countdown, and a card of 752 with two lines of
 * work still wrapped them - the words differ from one stage to the next.
 * So it sits well clear of that, and the line itself no longer wraps (see
 * stageClock): what this decides is only whether the moment is said at all.
 */
const TIGHT = '@container (max-width: 799.98px)'

export const styles = stylex.create({
  // the seat exists to be measured; the card inside it draws
  seat: { containerType: 'inline-size' },
  card: {
    // Wide, the plan beside the work sets a floor the loading card shares.
    // Stacked, the card is as tall as what it holds: a floor for the tallest
    // shape left a strip of nothing on every card that was not it, and the
    // page eases from the loading card's height to the card's instead
    // (EasedHeight around the hero).
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
  // Straight under the plan. Pushed to the foot of the column, it took
  // whatever the work beside it had over the plan's height - a line, with
  // two lines of work - as a gap above itself; at the foot of the column
  // that height reads as the card's own margin.
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
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
    // One line, whatever the words: wrapped, the moment and the countdown
    // stood the cell a line taller than the cells beside it, and the card
    // that much taller than the skeleton drawn for it. A moment the line
    // cannot hold is cut short; the countdown never is.
    minWidth: 0,
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
  stageWhen: {
    display: { default: 'block', [TIGHT]: 'none' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  stageCountdown: { flexShrink: 0 },
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
  // why a line says what it says, under it, in the size of a hint
  agendaNote: {
    fontSize: 12,
    lineHeight: 1.5,
    textWrap: 'pretty',
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
export const phone = stylex.create({
  card: {
    // As tall as what it holds, with no floor: the loading card is drawn in
    // the shape most cards take, and the page eases between the two heights.
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
  agendaNote: {
    fontSize: 12,
    lineHeight: 1.5,
    textWrap: 'pretty',
    color: tokens.mutedForeground,
  },
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
    // Centred, not on the baseline: the clock leads with its ring, which
    // has no text to give it a baseline, so the line took the ring's
    // bottom edge for one and stood 2.3px taller than its own line height -
    // and so did the skeleton drawn to match it. One size of text runs
    // through the line, so centring sets the words where the baseline did.
    alignItems: 'center',
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
