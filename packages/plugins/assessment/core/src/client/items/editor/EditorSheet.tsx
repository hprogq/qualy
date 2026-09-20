import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { Button } from '@qualy/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@qualy/ui/sheet'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { assessmentMessages as m } from '../../i18n.ts'
import { Tag } from './Rows.tsx'

// The panel every row of the editor opens into: a name, what kind of thing
// it is, its place among its siblings, and a way to the next one without
// closing and reopening.

const styles = stylex.create({
  panel: {
    width: { default: null, [breakpoints.phone]: '100%' },
    maxWidth: { default: null, [breakpoints.tablet]: '27.5rem', [breakpoints.desktop]: '27.5rem' },
  },
  head: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  title: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  spacer: { flexGrow: 1 },
  pager: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    fontSize: 12,
    color: tokens.mutedForeground,
    fontVariantNumeric: 'tabular-nums',
  },
  body: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    overflowY: 'auto',
    paddingInline: 20,
    paddingBottom: 20,
  },
  stack: { display: 'flex', flexDirection: 'column', gap: 24 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backSeat: { marginLeft: -8 },
})

export function EditorSheet({
  open,
  title,
  tag,
  pager,
  onBack,
  onClose,
  children,
  footer,
  testId,
}: {
  open: boolean
  title: string
  tag?: string
  /** this one's place among its siblings, and the way to the neighbours */
  pager?: { index: number; total: number; onPrevious: () => void; onNext: () => void }
  /** a step back inside the same panel, for a panel with an inner view */
  onBack?: () => void
  onClose: () => void
  children: ReactNode
  /** the footer's own controls; the leftmost may sit before a spacer */
  footer?: ReactNode
  testId?: string
}) {
  const { format } = useI18n()
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" xstyle={styles.panel} data-testid={testId}>
        <SheetHeader>
          <div {...stylex.props(styles.head)}>
            {onBack !== undefined && (
              <Button
                variant="ghost"
                size="icon-sm"
                className={stylex.props(styles.backSeat).className}
                onClick={onBack}
                aria-label={format(m.itemsBackToTypes)}
              >
                <ChevronLeftIcon aria-hidden />
              </Button>
            )}
            <SheetTitle className={stylex.props(styles.title).className}>{title}</SheetTitle>
            {tag !== undefined && <Tag tall>{tag}</Tag>}
            <span {...stylex.props(styles.spacer)} />
            {pager !== undefined && pager.total > 1 && (
              <span {...stylex.props(styles.pager)} data-testid="sheet-pager">
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={pager.index <= 0}
                  onClick={pager.onPrevious}
                  aria-label={format(m.itemsPrevious)}
                >
                  <ChevronLeftIcon aria-hidden />
                </Button>
                <span>
                  {pager.index + 1} / {pager.total}
                </span>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  disabled={pager.index >= pager.total - 1}
                  onClick={pager.onNext}
                  aria-label={format(m.itemsNext)}
                >
                  <ChevronRightIcon aria-hidden />
                  <VisuallyHidden>{format(m.itemsNext)}</VisuallyHidden>
                </Button>
              </span>
            )}
          </div>
        </SheetHeader>
        <div {...stylex.props(styles.body)}>
          <div {...stylex.props(styles.stack)}>{children}</div>
        </div>
        {footer !== undefined && <SheetFooter xstyle={styles.footer}>{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  )
}
