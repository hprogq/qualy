import { memo } from 'react'
import { ArrowLeftIcon, ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { useDayClock, type InboxItemDto } from './model.ts'

const wide = '@media (min-width: 84rem)'

const styles = stylex.create({
  aside: {
    position: 'relative',
    display: {
      default: 'none',
      [wide]: 'flex',
    },
    minHeight: 0,
    flexShrink: 0,
    overflow: 'hidden',
    transitionProperty: 'width',
    transitionDuration: '200ms',
    transitionTimingFunction: 'linear',
  },
  asideOpen: {
    width: 224,
  },
  asideFolded: {
    width: 44,
  },
  list: {
    display: 'flex',
    height: '100%',
    width: 224,
    flexShrink: 0,
    flexDirection: 'column',
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  listHidden: {
    opacity: 0,
  },
  head: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 4,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
    paddingBlock: 8,
    paddingRight: 6,
    paddingLeft: 4,
  },
  headTitle: {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 600,
  },
  headCount: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  spacer: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  scroller: {
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  rowList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    padding: 6,
  },
  row: {
    display: 'flex',
    width: '100%',
    alignItems: 'center',
    gap: 8,
    borderRadius: tokens.radiusLg,
    borderLeftWidth: 2,
    borderLeftStyle: 'solid',
    paddingInline: 10,
    paddingBlock: 8,
    textAlign: 'left',
    transitionProperty: 'color, background-color, border-color',
  },
  rowCurrent: {
    borderLeftColor: tokens.foreground,
    backgroundColor: tokens.surfaceMuted,
  },
  rowIdle: {
    borderLeftColor: 'transparent',
    backgroundColor: {
      default: 'transparent',
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  rowWords: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 1,
  },
  rowName: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
  },
  rowNameCurrent: {
    fontWeight: 600,
  },
  rowItem: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  rowClock: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  folded: {
    position: 'absolute',
    insetBlock: 0,
    left: 0,
    display: 'flex',
    width: 44,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    paddingBlock: 8,
    transitionProperty: 'opacity',
    transitionDuration: '150ms',
    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
  foldedHidden: {
    pointerEvents: 'none',
    opacity: 0,
  },
  foldedRule: {
    marginBlock: 2,
    height: 1,
    width: 20,
    backgroundColor: tokens.border,
  },
  foldedCount: {
    borderRadius: '9999px',
    backgroundColor: tokens.surfaceMuted,
    paddingInline: 6,
    paddingBlock: 2,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
})

/**
 * What is still to do in this run, down the left.
 *
 * A filing leaves the list the moment its disposition is staged, not when
 * the five seconds are up: from the reviewer's side it is dealt with, and a
 * row that lingers greyed out for five seconds reads as one that did not
 * take. Taking it back with ⌘Z puts it back, because then it really was not
 * dealt with.
 */
// The four panes are memoized: the root re-renders on every keystroke in
// the decision bar and on every overlay opening or closing, and each of
// those re-rendered three columns and a queue for nothing - the sibling
// dialog's entrance visibly lost its first frames to that commit.
export const QueueRail = memo(function QueueRail({
  rows,
  currentId,
  remainingCount,
  open,
  onToggle,
  onOpen,
  onBack,
}: {
  rows: readonly InboxItemDto[]
  currentId: string
  remainingCount: number
  /** whether the column is showing its list, or folded to a strip */
  open: boolean
  onToggle: () => void
  onOpen: (id: string) => void
  onBack: () => void
}) {
  const { format } = useI18n()
  const dayClock = useDayClock()
  return (
    // The rail is always its full width; the aside around it is what
    // narrows and clips. Animating the contents' own layout warped every
    // row mid-flight - the shell's rail solved this the same way, and the
    // two folds should feel like one mechanism.
    <aside {...stylex.props(styles.aside, open ? styles.asideOpen : styles.asideFolded)}>
      <nav
        {...(!open ? { inert: true, 'aria-hidden': true } : {})}
        {...stylex.props(styles.list, !open && styles.listHidden)}
      >
        <div {...stylex.props(styles.head)}>
          {/* the way out: a workbench with no door back is a dead end */}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={format(m.reviewBackToQueue)}
            onClick={onBack}
          >
            <ArrowLeftIcon aria-hidden />
          </Button>
          <p {...stylex.props(styles.headTitle)}>{format(m.reviewQueueTitle)}</p>
          <span {...stylex.props(styles.headCount)}>{remainingCount}</span>
          <span {...stylex.props(styles.spacer)} />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={format(m.reviewQueueFold)}
            onClick={onToggle}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
        </div>
        <ScrollArea className={stylex.props(styles.scroller).className}>
          <ul {...stylex.props(styles.rowList)}>
            {rows.map((row) => {
              const current = row.instanceId === currentId
              return (
                <li key={row.instanceId}>
                  <button
                    type="button"
                    onClick={() => onOpen(row.instanceId)}
                    {...stylex.props(styles.row, current ? styles.rowCurrent : styles.rowIdle)}
                  >
                    <span {...stylex.props(styles.rowWords)}>
                      <span {...stylex.props(styles.rowName, current && styles.rowNameCurrent)}>
                        {row.participantName}
                      </span>
                      <span {...stylex.props(styles.rowItem)}>{row.itemTitle}</span>
                    </span>
                    <span {...stylex.props(styles.rowClock)}>{dayClock(row.submittedAt)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
      </nav>
      {/* Folded, the rail is a handle and a number - nothing more. It used
          to keep a column of grey faces, which at 32px against a dark ring
          read like a wall of memorial portraits; who is waiting is the open
          list's answer, and folded only "how many" fits honestly. */}
      <div
        {...(open ? { inert: true, 'aria-hidden': true } : {})}
        {...stylex.props(styles.folded, open && styles.foldedHidden)}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={format(m.reviewQueueUnfold)}
          onClick={onToggle}
        >
          <ChevronRightIcon aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={format(m.reviewBackToQueue)}
          onClick={onBack}
        >
          <ArrowLeftIcon aria-hidden />
        </Button>
        <span aria-hidden {...stylex.props(styles.foldedRule)} />
        <span {...stylex.props(styles.foldedCount)}>{remainingCount}</span>
      </div>
    </aside>
  )
})
