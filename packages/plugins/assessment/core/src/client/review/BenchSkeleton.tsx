import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Skeleton } from '@qualy/ui/skeleton'

// The workbench before its answer, in the workbench's own shape: what was
// filed on one side, how it has been handled in the middle, what to do about
// it at the end. A grey slab said only that something was coming; the outline
// says what, and the answer lands in it instead of replacing it.

const LG = '@media (min-width: 1024px)'

const styles = stylex.create({
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
  foot: { display: 'flex', gap: 8, marginTop: 'auto' },
})

const bar = (width: string, height = 11) => <Skeleton height={height} width={width} radius={4} />

export function BenchSkeleton() {
  return (
    <div
      {...stylex.props(styles.bench)}
      role="presentation"
      aria-hidden
      data-testid="bench-skeleton"
    >
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
        <div {...stylex.props(styles.foot)}>
          <Skeleton height={32} width="5rem" radius={8} />
          <Skeleton height={32} width="5rem" radius={8} />
        </div>
      </div>
    </div>
  )
}
