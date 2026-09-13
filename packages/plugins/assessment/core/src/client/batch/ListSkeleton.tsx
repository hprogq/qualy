import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Skeleton } from '@qualy/ui/skeleton'

// The batch list before its answers arrive, in the page's own shape.
//
// A placeholder is a promise about where things will be: three grey bars
// promised nothing, and the page rearranged itself around the reader when
// the answer came. These stand where the running round's card, the filter
// pills and the table will stand, at their heights, so the answer arrives
// into the room already kept for it. The card's own placeholder is shown
// for as long as the question of what is running is open - it is a
// separate question from the list's, and answered separately.

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
    gap: 10,
  },
  lanes: {
    display: 'flex',
    gap: 6,
  },
  lane: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 9,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  axis: {
    display: 'flex',
    justifyContent: 'space-between',
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
    gap: 8,
    paddingBlock: 18,
  },
  agenda: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingBlock: 16,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  words: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  track: {
    display: 'inline-flex',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: 2,
    padding: 3,
    borderRadius: tokens.radiusPill,
    backgroundColor: tokens.surfaceMuted,
  },
  sheet: {
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  row: {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 110px 150px 190px 64px',
    alignItems: 'center',
    columnGap: 24,
    paddingInlineStart: 20,
    paddingInlineEnd: 20,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  headRow: {
    paddingTop: 12,
    paddingBottom: 14,
  },
  bodyRow: {
    minHeight: 51,
    borderBottomWidth: {
      default: 1,
      ':last-child': 0,
    },
  },
  status: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  end: {
    justifySelf: 'end',
  },
})

/** the running round's card, before it is known which round that is */
export function HeroSkeleton() {
  return (
    <div data-testid="batch-hero-skeleton" aria-hidden {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.main)}>
        <div {...stylex.props(styles.head)}>
          <Skeleton height={22} width={64} radius="xl" />
          <Skeleton height={24} width="58%" radius="sm" />
          <Skeleton height={12} width="40%" radius="sm" />
        </div>
        <div>
          <div {...stylex.props(styles.lanes)}>
            {[0, 1, 2, 3, 4].map((lane) => (
              <div key={lane} {...stylex.props(styles.lane)}>
                <Skeleton height={11} width="60%" radius="sm" />
                <Skeleton height={6} radius="xl" />
              </div>
            ))}
          </div>
        </div>
        <div {...stylex.props(styles.axis)}>
          <Skeleton height={11} width={64} radius="sm" />
          <Skeleton height={11} width={64} radius="sm" />
        </div>
        <Skeleton height={36} width={104} radius="md" />
      </div>
      <div {...stylex.props(styles.side)}>
        <div {...stylex.props(styles.stage)}>
          <Skeleton height={12} width={56} radius="sm" />
          <Skeleton height={18} width={140} radius="sm" />
          <Skeleton height={13} width={168} radius="sm" />
        </div>
        {[0, 1].map((row) => (
          <div key={row} {...stylex.props(styles.agenda)}>
            <div {...stylex.props(styles.words)}>
              <Skeleton height={12} width={72} radius="sm" />
              <Skeleton height={14} width={88} radius="sm" />
            </div>
            <Skeleton height={13} width={56} radius="sm" />
          </div>
        ))}
      </div>
    </div>
  )
}

const ROWS = ['62%', '46%', '55%', '40%'] as const

/** the filter pills and the table, at their heights */
export function ListSkeleton() {
  return (
    <div data-testid="batch-list-skeleton" aria-hidden {...stylex.props(styles.list)}>
      <div {...stylex.props(styles.track)}>
        {[0, 1, 2, 3].map((pill) => (
          <Skeleton key={pill} height={30} width={72} radius="xl" />
        ))}
      </div>
      <div {...stylex.props(styles.sheet)}>
        <div {...stylex.props(styles.row, styles.headRow)}>
          <Skeleton height={12} width={32} radius="sm" />
          <Skeleton height={12} width={28} radius="sm" />
          <Skeleton height={12} width={28} radius="sm" />
          <Skeleton height={12} width={28} radius="sm" />
          <span />
        </div>
        {ROWS.map((width, row) => (
          <div key={row} {...stylex.props(styles.row, styles.bodyRow)}>
            <Skeleton height={14} width={width} radius="sm" />
            <div {...stylex.props(styles.status)}>
              <Skeleton height={6} width={6} radius="xl" />
              <Skeleton height={12} width={36} radius="sm" />
            </div>
            <Skeleton height={13} width={64} radius="sm" />
            <Skeleton height={13} width={110} radius="sm" />
            <Skeleton
              height={14}
              width={14}
              radius="sm"
              className={stylex.props(styles.end).className}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
