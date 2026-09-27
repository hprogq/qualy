import * as stylex from '@stylexjs/stylex'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { recordColumns } from './columns.stylex.ts'

/**
 * A list arriving, in the shape of the list.
 *
 * One grey slab the height of the whole card says only "something is
 * happening"; rows of the right height and the right number of columns say
 * what is about to be there, and the page does not jump when it lands. The
 * bones sit in the columns the real cells will take - one line a record
 * across, the stacked card on a phone - so the eye lands in the same places
 * before and after. Each table's bones take that table's own templates.
 */

const styles = stylex.create({
  card: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    containerType: 'inline-size',
  },
  // the band the column names sit in, there before the names are
  head: {
    display: { default: 'block', [recordColumns.stacked]: 'none' },
    height: 39,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
  },
  row: {
    display: 'grid',
    alignItems: 'center',
    columnGap: 12,
    rowGap: 8,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: 16,
    paddingBlock: { default: 13, [recordColumns.stacked]: 12 },
  },
  entries: {
    gridTemplateColumns: {
      default: recordColumns.entries,
      [recordColumns.stacked]: recordColumns.entriesStacked,
      [recordColumns.desk]: recordColumns.entriesDesk,
    },
  },
  acts: {
    gridTemplateColumns: {
      default: recordColumns.acts,
      [recordColumns.stacked]: recordColumns.historyStacked,
      [recordColumns.desk]: recordColumns.actsDesk,
    },
  },
  imports: {
    gridTemplateColumns: {
      default: recordColumns.imports,
      [recordColumns.stacked]: recordColumns.historyStacked,
      [recordColumns.desk]: recordColumns.importsDesk,
    },
  },
  // the name, where it stands on a phone
  lead: { height: 14, width: '6rem' },
  // a phone's second and third lines, under the name
  under: {
    display: { default: 'none', [recordColumns.stacked]: 'block' },
    gridColumn: '1 / -1',
    height: 10,
  },
  underItem: { width: '11rem' },
  underMeta: { width: '8rem' },
  // a column across, nothing on a phone
  cell: { display: { default: 'block', [recordColumns.stacked]: 'none' }, height: 12 },
  cellDesk: { display: { default: 'none', [recordColumns.desk]: 'block' } },
  short: { width: '4.5rem' },
  long: { width: '70%' },
  end: { width: '4rem', marginLeft: 'auto' },
  chip: { height: 20, width: '3.75rem', borderRadius: tokens.radiusSm },
  chipHistory: { display: { default: 'block', [recordColumns.stacked]: 'none' }, width: '4.5rem' },
  // the chevron's seat, so the columns line up with the rows' own
  seat: { width: 16 },
})

export function ListSkeleton({
  rows = 5,
  kind = 'entries',
}: {
  rows?: number
  /** the record book, or one of its two histories */
  kind?: 'entries' | 'acts' | 'imports'
}) {
  return (
    <div {...stylex.props(styles.card)} aria-hidden data-testid="list-skeleton" data-kind={kind}>
      <div {...stylex.props(styles.head)} />
      {Array.from({ length: rows }, (_, at) => (
        <div key={at} {...stylex.props(styles.row, styles[kind])} data-testid="list-skeleton-row">
          <Skeleton className={stylex.props(styles.lead).className} />
          {kind === 'entries' ? (
            <>
              <Skeleton className={stylex.props(styles.cell, styles.short).className} />
              <Skeleton className={stylex.props(styles.cell, styles.long).className} />
              <Skeleton
                className={stylex.props(styles.cell, styles.cellDesk, styles.short).className}
              />
              <Skeleton className={stylex.props(styles.chip).className} />
              <Skeleton className={stylex.props(styles.cell, styles.short).className} />
              <Skeleton className={stylex.props(styles.cell, styles.end).className} />
            </>
          ) : (
            <>
              <Skeleton className={stylex.props(styles.cell, styles.long).className} />
              <Skeleton className={stylex.props(styles.chip, styles.chipHistory).className} />
              <Skeleton className={stylex.props(styles.cell, styles.short).className} />
              <Skeleton className={stylex.props(styles.cell, styles.end).className} />
            </>
          )}
          <span {...stylex.props(styles.seat)} />
          <Skeleton className={stylex.props(styles.under, styles.underItem).className} />
          <Skeleton className={stylex.props(styles.under, styles.underMeta).className} />
        </div>
      ))}
    </div>
  )
}
