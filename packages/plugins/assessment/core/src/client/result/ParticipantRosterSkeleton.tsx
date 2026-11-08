'use client'
import * as stylex from '@stylexjs/stylex'
import { Skeleton } from '@qualy/ui/skeleton'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import * as m from '#messages'

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    paddingInline: { default: 24, [breakpoints.phone]: 16 },
    paddingTop: { default: 18, [breakpoints.phone]: 14 },
    paddingBottom: 16,
  },
  head: { display: 'flex', alignItems: 'center', minHeight: 34 },
  title: {
    margin: 0,
    fontSize: { default: 18, [breakpoints.phone]: 17 },
    lineHeight: '1.5rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  toolbar: { display: 'flex', gap: 8, minHeight: 36, alignItems: 'center' },
  body: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', [breakpoints.wide]: '312px minmax(0, 1fr)' },
    gap: 20,
    alignItems: 'start',
  },
  tree: {
    display: { default: 'none', [breakpoints.wide]: 'flex' },
    flexDirection: 'column',
    gap: 18,
    padding: 16,
  },
  list: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 10 },
  frame: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
  },
  row: {
    display: 'grid',
    alignItems: 'center',
    gap: 16,
    gridTemplateColumns: {
      default: '6.5rem minmax(0, 1fr) 6rem 7.5rem',
      [breakpoints.phone]: 'minmax(0, 1fr) 4rem',
    },
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
    paddingInline: 16,
    paddingBlock: 14,
    ':last-child': { borderBottomWidth: 0 },
  },
  tableHead: { backgroundColor: tokens.surfaceInset, paddingBlock: 9 },
  wide: { display: { default: null, [breakpoints.phone]: 'none' } },
  bone: { height: 13, borderRadius: 4 },
  chip: { height: 13, width: '3rem', borderRadius: 4 },
})

/** The same rows while the server prepares the page and while its query reads. */
export function ParticipantRosterRows() {
  return (
    <div data-testid="roster-skeleton" {...stylex.props(styles.frame)}>
      {['60%', '45%', '70%', '52%', '64%', '48%'].map((width, index) => (
        <div key={index} {...stylex.props(styles.row, index === 0 && styles.tableHead)}>
          <Skeleton className={stylex.props(styles.bone, styles.wide).className} width="70%" />
          <Skeleton className={stylex.props(styles.bone).className} width={width} />
          <Skeleton className={stylex.props(styles.chip, styles.wide).className} />
          <Skeleton className={stylex.props(styles.bone).className} width="60%" />
        </div>
      ))}
    </div>
  )
}

/** Read-only streaming outline: the page's heading stays visible throughout. */
export function ParticipantRosterSkeleton() {
  return (
    <div data-testid="roster-pending" aria-busy {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.head)}>
        <h1 {...stylex.props(styles.title)}>{m.participantResults_tab()}</h1>
      </header>
      <div {...stylex.props(styles.body)}>
        <div aria-hidden {...stylex.props(styles.tree)}>
          <Skeleton height={18} width="40%" />
          {[0, 1, 2, 3, 4, 5].map((key) => (
            <Skeleton key={key} height={14} width="75%" />
          ))}
        </div>
        <div {...stylex.props(styles.list)}>
          <div {...stylex.props(styles.toolbar)}>
            <Skeleton height={32} width="40%" />
            <Skeleton height={32} width="20%" />
          </div>
          <ParticipantRosterRows />
        </div>
      </div>
    </div>
  )
}
