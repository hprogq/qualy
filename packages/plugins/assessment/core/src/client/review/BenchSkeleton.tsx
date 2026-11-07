import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Skeleton } from '@qualy/ui/skeleton'

// The workbench before its answer, in the workbench's own shape: whose
// filing it is across the top, then what was filed on one side, how it has
// been handled in the middle, what to do about it at the end, and the keys
// that decide it along the foot. A grey slab said only that something was
// coming; the outline says what, and the answer lands in it instead of
// replacing it - the bars above and below included, which the answer would
// otherwise push in from both edges.

const LG = '@media (min-width: 1024px)'
const PHONE = '@media (max-width: 767.98px)'

const styles = stylex.create({
  seat: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
  },
  // the person's bar: the way back, a face, the name and number, and the
  // way along the run at the far end (PersonStrip)
  strip: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: { default: 8, [LG]: 10 },
    minHeight: 56,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: { default: 12, [LG]: 16 },
  },
  face: { display: { default: 'block', [PHONE]: 'none' } },
  who: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 6 },
  along: { display: 'flex', flexShrink: 0, alignItems: 'center', gap: 6 },
  // the keys that decide it (DecisionBar): the routing pair, room, and the
  // two verdicts; on a phone two rows of two
  foot: {
    display: 'flex',
    flexShrink: 0,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: { default: 12, [LG]: 16 },
    paddingBlock: { default: 10, [LG]: 12 },
  },
  keys: {
    display: { default: 'flex', [PHONE]: 'grid' },
    flexGrow: 1,
    gridTemplateColumns: { default: null, [PHONE]: 'repeat(2, minmax(0, 1fr))' },
    alignItems: 'center',
    gap: 8,
  },
  keysRoom: { flexGrow: 1, display: { default: 'block', [PHONE]: 'none' } },
  bench: {
    display: 'grid',
    minHeight: 0,
    flexGrow: 1,
    gap: 0,
    gridTemplateColumns: {
      default: 'minmax(0, 1fr)',
      [LG]: 'minmax(0, 0.9fr) minmax(0, 1.1fr) 19rem',
    },
  },
  column: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 18,
    padding: 20,
    borderLeftWidth: { default: 0, [LG]: 1 },
    borderLeftStyle: 'solid',
    borderLeftColor: tokens.divider,
  },
  first: { borderLeftWidth: 0 },
  // the two columns a phone shows one at a time
  wideOnly: { display: { default: 'none', [LG]: 'flex' } },
  field: { display: 'flex', flexDirection: 'column', gap: 7 },
  step: { display: 'flex', alignItems: 'flex-start', gap: 10 },
  stepWords: { display: 'flex', minWidth: 0, flexGrow: 1, flexDirection: 'column', gap: 7 },
})

const bar = (width: string, height = 11) => <Skeleton height={height} width={width} radius={4} />

export function BenchSkeleton() {
  return (
    <div
      {...stylex.props(styles.seat)}
      role="presentation"
      aria-hidden
      data-testid="bench-skeleton"
    >
      <div {...stylex.props(styles.strip)}>
        <Skeleton height={32} width={32} radius={8} />
        <span {...stylex.props(styles.face)}>
          <Skeleton height={36} width={36} radius={9999} />
        </span>
        <div {...stylex.props(styles.who)}>
          {bar('9rem', 14)}
          {bar('14rem', 10)}
        </div>
        <div {...stylex.props(styles.along)}>
          {bar('3.5rem', 12)}
          <Skeleton height={32} width={32} radius={8} />
          <Skeleton height={32} width={32} radius={8} />
        </div>
      </div>
      <Columns />
      <div {...stylex.props(styles.foot)}>
        <div {...stylex.props(styles.keys)}>
          <Skeleton height={34} width="5.5rem" radius={8} />
          <Skeleton height={34} width="5.5rem" radius={8} />
          <span {...stylex.props(styles.keysRoom)} />
          <Skeleton height={38} width="6rem" radius={8} />
          <Skeleton height={38} width="6rem" radius={8} />
        </div>
      </div>
    </div>
  )
}

function Columns() {
  return (
    <div {...stylex.props(styles.bench)}>
      <div {...stylex.props(styles.column, styles.first)}>
        {bar('42%', 16)}
        {['58%', '74%', '46%', '66%'].map((width, index) => (
          <div key={index} {...stylex.props(styles.field)}>
            {bar('5rem', 9)}
            {bar(width, 13)}
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.column, styles.wideOnly)}>
        {bar('6rem', 13)}
        {['70%', '52%', '64%'].map((width, index) => (
          <div key={index} {...stylex.props(styles.step)}>
            <Skeleton height={22} width={22} radius={9999} />
            <div {...stylex.props(styles.stepWords)}>
              {bar(width, 12)}
              {bar('38%', 9)}
            </div>
          </div>
        ))}
      </div>
      <div {...stylex.props(styles.column, styles.wideOnly)}>
        {bar('5rem', 13)}
        {bar('90%')}
        {bar('76%')}
      </div>
    </div>
  )
}
