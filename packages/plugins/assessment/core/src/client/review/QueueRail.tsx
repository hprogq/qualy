import { memo } from 'react'
import { ArrowLeftIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { Button } from '@qualy/ui/button'
import { ScrollArea } from '@qualy/ui/scroll-area'
import { Sheet, SheetContent, SheetTitle } from '@qualy/ui/sheet'
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
  sheet: { width: { default: 320, '@media (max-width: 480px)': '100%' }, maxWidth: '100%', padding: 0, gap: 0 },
  list: {
    display: 'flex',
    height: '100%',
    width: '100%',
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
  // a tint and a heavier name say which one is open; the rule that ran down
  // its rounded edge bent into a bracket
  rowCurrent: {
    borderLeftColor: 'transparent',
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
    // Beside the workbench it stood there all session to be used a few times
    // in it, and took a column from the three that are read on every filing.
    // Who else is waiting is looked up when the reviewer wants to jump, so it
    // comes out from the side when asked for and goes away again.
    <Sheet open={open} onOpenChange={(next) => !next && onToggle()}>
      <SheetContent side="left" showCloseButton={false} xstyle={styles.sheet} data-testid="queue-sheet">
        <nav {...stylex.props(styles.list)}>
          <div {...stylex.props(styles.head)}>
            <SheetTitle {...stylex.props(styles.headTitle)}>{format(m.reviewQueueTitle)}</SheetTitle>
            <span {...stylex.props(styles.headCount)}>{remainingCount}</span>
            <span {...stylex.props(styles.spacer)} />
            <Button variant="ghost" size="sm" onClick={onBack}>
              <ArrowLeftIcon aria-hidden />
              {format(m.reviewBackToQueue)}
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
                      aria-current={current || undefined}
                      onClick={() => {
                        onOpen(row.instanceId)
                        onToggle()
                      }}
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
      </SheetContent>
    </Sheet>
  )
})
