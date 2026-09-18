import * as stylex from '@stylexjs/stylex'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

/**
 * A list arriving, in the shape of the list.
 *
 * One grey slab the height of the whole card says only "something is
 * happening"; rows of the right height and the right number of columns say
 * what is about to be there, and the page does not jump when it lands. The
 * bones are the same widths as the real cells, so the eye lands in the same
 * three places before and after.
 */

const wide = '@media (min-width: 900px)'

const styles = stylex.create({
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: {
      default: 'minmax(0, 1fr) 4rem',
      [wide]: 'minmax(0, 1.3fr) minmax(0, 1.2fr) 6.5rem 9rem',
    },
    alignItems: 'center',
    columnGap: 12,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: 16,
    paddingBlock: 12,
  },
  who: { display: 'flex', flexDirection: 'column', gap: 6 },
  name: { height: 14, width: '6rem' },
  under: { height: 10, width: '9rem' },
  cell: { height: 14, width: '70%' },
  chip: { height: 22, width: '4rem', borderRadius: tokens.radiusSm },
  aside: { display: { default: 'none', [wide]: 'flex' }, flexDirection: 'column', gap: 6 },
  asideTop: { height: 12, width: '4.5rem', marginLeft: 'auto' },
  asideLow: { height: 10, width: '3.5rem', marginLeft: 'auto' },
  hideNarrow: { display: { default: 'none', [wide]: 'block' } },
})

export function ListSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div {...stylex.props(styles.card)} aria-hidden data-testid="list-skeleton">
      {Array.from({ length: rows }, (_, at) => (
        <div key={at} {...stylex.props(styles.row)}>
          <span {...stylex.props(styles.who)}>
            <Skeleton className={stylex.props(styles.name).className} />
            <Skeleton className={stylex.props(styles.under).className} />
          </span>
          <Skeleton className={stylex.props(styles.cell, styles.hideNarrow).className} />
          <Skeleton className={stylex.props(styles.chip).className} />
          <span {...stylex.props(styles.aside)}>
            <Skeleton className={stylex.props(styles.asideTop).className} />
            <Skeleton className={stylex.props(styles.asideLow).className} />
          </span>
        </div>
      ))}
    </div>
  )
}
