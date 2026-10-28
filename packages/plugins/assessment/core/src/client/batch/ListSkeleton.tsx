import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Skeleton } from '@qualy/ui/skeleton'
import { useIsMobile } from '@qualy/ui/use-mobile'
import { styles as card, phone as phoneCard } from './card.stylex.ts'

// The batch list before its answers arrive, in the page's own shape.
//
// A placeholder is a promise about where things will be: three grey bars
// promised nothing, and the page rearranged itself around the reader when
// the answer came. These stand where the running round's card, the list's
// name, the filter pills and the rows will stand, at their heights and in
// the shape the width gives them - a phone's card and rows are not the wide
// ones narrowed - so the answer arrives into the room already kept for it.
// The card's own placeholder is shown for as long as the question of what
// is running is open - it is a separate question from the list's, and
// answered separately.

const styles = stylex.create({
  axisBones: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  // A line of the card's text, as tall as that text's own line: the bone is
  // given the text's style and one line height of it, so a size or line
  // height the card's words change is the skeleton's at once. Rounded
  // numbers here were what put the skeleton 3.6px short of the card.
  textBone: { display: 'flex', alignItems: 'center', height: '1lh' },
  list: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  listHead: {
    display: 'flex',
    flexDirection: { default: 'row', [breakpoints.phone]: 'column' },
    alignItems: { default: 'center', [breakpoints.phone]: 'stretch' },
    gap: { default: 16, [breakpoints.phone]: 8 },
  },
  // one line of the list's name, at the name's own size
  label: {
    display: 'flex',
    height: '1lh',
    alignItems: 'center',
    fontSize: 13,
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

// the phone's card and rows, as BatchCard and the page draw them there
const phone = stylex.create({
  rows: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  row: {
    display: 'flex',
    minHeight: 64,
    alignItems: 'center',
    gap: 12,
    paddingBlock: 12,
    paddingLeft: 20,
    paddingRight: 16,
    borderBottomWidth: { default: 1, ':last-child': 0 },
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.divider,
  },
  words: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 4,
  },
  name: {
    display: 'flex',
    height: '1lh',
    alignItems: 'center',
    fontSize: 15,
  },
  line: {
    display: 'flex',
    height: '1lh',
    alignItems: 'center',
    fontSize: 12,
  },
})

/**
 * The pending card, in the container and spacing of the card and the shape
 * most cards take: one line of name and two lines of work. Stacked, neither
 * holds room for a taller shape; the hero eases from one height to the other.
 */
export function HeroSkeleton() {
  const narrow = useIsMobile()
  if (narrow) {
    return (
      <div data-testid="batch-hero-skeleton" aria-hidden {...stylex.props(phoneCard.card)}>
        <div {...stylex.props(phoneCard.head)}>
          {/* the standing badge is 20 tall */}
          <Skeleton height={20} width={64} radius="xl" />
          <span {...stylex.props(phoneCard.title, styles.textBone)}>
            <Skeleton height={20} width="70%" radius="sm" />
          </span>
        </div>
        <div {...stylex.props(phoneCard.agenda)}>
          {[0, 1].map((row) => (
            <div key={row} {...stylex.props(phoneCard.agendaRow)}>
              <div {...stylex.props(phoneCard.agendaWords)}>
                <span {...stylex.props(phoneCard.agendaLabel, styles.textBone)}>
                  <Skeleton height={12} width={72} radius="sm" />
                </span>
                <span {...stylex.props(phoneCard.agendaValue, styles.textBone)}>
                  <Skeleton height={15} width={120} radius="sm" />
                </span>
              </div>
              <Skeleton height={14} width={14} radius="sm" />
            </div>
          ))}
        </div>
        <div {...stylex.props(phoneCard.foot)}>
          <div {...stylex.props(phoneCard.plan)}>
            <Skeleton height={6} radius="xl" />
            <span {...stylex.props(phoneCard.meta, styles.textBone, styles.axisBones)}>
              <Skeleton height={11} width={96} radius="sm" />
              <Skeleton height={11} width={56} radius="sm" />
            </span>
          </div>
          <Skeleton height={44} radius="md" />
        </div>
      </div>
    )
  }
  return (
    <div {...stylex.props(card.seat)}>
      <div data-testid="batch-hero-skeleton" aria-hidden {...stylex.props(card.card)}>
        <div {...stylex.props(card.main)}>
          <div {...stylex.props(card.head)}>
            <div {...stylex.props(card.headRow)}>
              <Skeleton height={20} width={64} radius="xl" />
            </div>
            <span {...stylex.props(card.title, styles.textBone)}>
              <Skeleton height={24} width="58%" radius="sm" />
            </span>
            <span {...stylex.props(card.facts, styles.textBone)}>
              <Skeleton height={12} width="40%" radius="sm" />
            </span>
          </div>
          <div {...stylex.props(card.plan)}>
            <div {...stylex.props(card.lanes)}>
              {[0, 1, 2, 3, 4].map((lane) => (
                <div key={lane} {...stylex.props(card.lane)}>
                  <span {...stylex.props(card.laneName, styles.textBone)}>
                    <Skeleton height={11} width="60%" radius="sm" />
                  </span>
                  <Skeleton height={lane === 1 ? 8 : 6} radius="xl" />
                </div>
              ))}
            </div>
            <div {...stylex.props(card.axis, styles.axisBones)}>
              <Skeleton height={11} width={64} radius="sm" />
              <Skeleton height={11} width={64} radius="sm" />
            </div>
          </div>
          <div {...stylex.props(card.actions)}>
            <Skeleton height={36} width={104} radius="md" />
          </div>
        </div>
        <div {...stylex.props(card.side)}>
          <div {...stylex.props(card.stage, card.cell, card.cellFirst)}>
            <span {...stylex.props(card.stageLabel, styles.textBone)}>
              <Skeleton height={12} width={56} radius="sm" />
            </span>
            <span {...stylex.props(card.stageName, styles.textBone)}>
              <Skeleton height={18} width="70%" radius="sm" />
            </span>
            <span {...stylex.props(card.stageClock, styles.textBone)}>
              <Skeleton height={13} width="84%" radius="sm" />
            </span>
          </div>
          {[0, 1].map((row) => (
            <div key={row} {...stylex.props(card.agendaRow, card.cell)}>
              <div {...stylex.props(card.agendaWords)}>
                <span {...stylex.props(card.agendaLabel, styles.textBone)}>
                  <Skeleton height={12} width={72} radius="sm" />
                </span>
                <span {...stylex.props(card.agendaValue, styles.textBone)}>
                  <Skeleton height={14} width={88} radius="sm" />
                </span>
              </div>
              <Skeleton height={13} width={40} radius="sm" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const ROWS = ['62%', '46%', '55%', '40%'] as const

/**
 * The list's name, its filter pills and its rows, at their heights;
 * `labelled` when the page will give the list a name.
 */
export function ListSkeleton({ labelled }: { labelled: boolean }) {
  const narrow = useIsMobile()
  const head = (
    <div {...stylex.props(styles.listHead)}>
      {labelled && (
        <span {...stylex.props(styles.label)}>
          <Skeleton height={12} width={52} radius="sm" />
        </span>
      )}
      <div {...stylex.props(styles.track)}>
        {[0, 1, 2, 3].map((pill) => (
          <Skeleton key={pill} height={30} width={72} radius="xl" />
        ))}
      </div>
    </div>
  )
  if (narrow) {
    return (
      <div data-testid="batch-list-skeleton" aria-hidden {...stylex.props(styles.list)}>
        {head}
        <div {...stylex.props(phone.rows)}>
          {ROWS.map((width, row) => (
            <div key={row} {...stylex.props(phone.row)}>
              <div {...stylex.props(phone.words)}>
                <span {...stylex.props(phone.name)}>
                  <Skeleton height={14} width={width} radius="sm" />
                </span>
                <span {...stylex.props(phone.line)}>
                  <Skeleton height={11} width="52%" radius="sm" />
                </span>
              </div>
              <Skeleton height={14} width={14} radius="sm" />
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <div data-testid="batch-list-skeleton" aria-hidden {...stylex.props(styles.list)}>
      {head}
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
