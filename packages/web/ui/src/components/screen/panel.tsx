import type { ReactNode } from 'react'
import { XIcon } from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '../../theme/tokens.stylex.ts'
import { breakpoints } from '../../theme/breakpoints.stylex.ts'
import { useIsBelow } from '../../hooks/use-mobile.ts'
import { Button } from '../button.tsx'
import { Sheet, SheetContent, SheetTitle } from '../sheet.tsx'

// The panel a row of a list opens into: the list stays where it was, and
// the one thing picked from it is read or changed beside it.
//
// From the side on a desk, from below on a phone - the same panel, because
// what a phone lacks is width, not the need to look at one row closely.
// The head says what is open, the body is cards on the page's own ground
// like the page behind it, and the foot - when there is one - is where an
// unsaved change is said and saved.

const styles = stylex.create({
  // the drawer sizes its panel by flex-basis, which a width can narrow but
  // never widen; both are said so the panel is the design's width whichever
  // of them the widget is listening to
  beside: {
    width: { default: 460, [breakpoints.phone]: '100%' },
    flexBasis: { default: 460, [breakpoints.phone]: '100%' },
    maxWidth: '100%',
    gap: 0,
    padding: 0,
    backgroundColor: tokens.background,
  },
  besideNarrow: {
    width: { default: 420, [breakpoints.phone]: '100%' },
    flexBasis: { default: 420, [breakpoints.phone]: '100%' },
  },
  // a record with a table of its own to show
  besideWide: {
    width: { default: 760, [breakpoints.phone]: '100%' },
    flexBasis: { default: 760, [breakpoints.phone]: '100%' },
  },
  below: {
    maxHeight: '88dvh',
    gap: 0,
    padding: 0,
    backgroundColor: tokens.background,
  },
  head: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'flex-start',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 14,
    borderBottomWidth: 1,
    borderBottomStyle: 'solid',
    borderBottomColor: tokens.border,
  },
  words: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 4 },
  titleRow: { display: 'flex', minWidth: 0, alignItems: 'center', gap: 8 },
  title: {
    margin: 0,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 15,
    lineHeight: 1.4,
    fontWeight: 600,
  },
  spacer: { flexGrow: 1 },
  close: { flexShrink: 0, color: tokens.mutedForeground },
  body: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 14,
    overflowY: 'auto',
    paddingInline: 16,
    paddingTop: 14,
    paddingBottom: 16,
  },
  foot: {
    display: 'flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 10,
    paddingInline: 16,
    paddingBlock: 10,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    flexWrap: 'wrap',
  },
  unsaved: { fontSize: 12, color: tokens.warningForeground },
  footNote: { minWidth: 0, fontSize: 12, color: tokens.mutedForeground },
})

export function DetailSheet({
  open,
  onClose,
  title,
  titleAside,
  meta,
  lead,
  actions,
  footer,
  width = 'regular',
  closeLabel,
  testId,
  children,
}: {
  /** false while it animates shut; it keeps drawing what it was showing */
  open: boolean
  onClose: () => void
  title: string
  /** beside the name: a kind, a count */
  titleAside?: ReactNode
  /** under the name: a few quiet facts */
  meta?: ReactNode
  /** before the name: a face */
  lead?: ReactNode
  /** at the far end of the head, before the way out */
  actions?: ReactNode
  footer?: ReactNode
  width?: 'regular' | 'narrow' | 'wide'
  closeLabel: string
  testId?: string
  children: ReactNode
}) {
  const phone = useIsBelow(768)
  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent
        side={phone ? 'bottom' : 'right'}
        showCloseButton={false}
        xstyle={
          phone
            ? styles.below
            : [
                styles.beside,
                width === 'narrow' && styles.besideNarrow,
                width === 'wide' && styles.besideWide,
              ]
        }
        data-testid={testId}
      >
        <div {...stylex.props(styles.head)}>
          {lead}
          <div {...stylex.props(styles.words)}>
            <div {...stylex.props(styles.titleRow)}>
              <SheetTitle {...stylex.props(styles.title)}>{title}</SheetTitle>
              {titleAside}
            </div>
            {meta}
          </div>
          <span {...stylex.props(styles.spacer)} />
          {actions}
          <Button
            variant="ghost"
            size="icon-sm"
            className={stylex.props(styles.close).className}
            onClick={onClose}
            aria-label={closeLabel}
          >
            <XIcon aria-hidden />
          </Button>
        </div>
        <div {...stylex.props(styles.body)}>{children}</div>
        {footer !== undefined && <div {...stylex.props(styles.foot)}>{footer}</div>}
      </SheetContent>
    </Sheet>
  )
}

/** said at the near end of a foot while something changed has not been saved */
export function UnsavedMark({ children }: { children: ReactNode }) {
  return (
    <span {...stylex.props(styles.unsaved)} data-testid="unsaved-mark">
      {children}
    </span>
  )
}

/** a quiet sentence at the near end of a foot */
export function FootNote({ children }: { children: ReactNode }) {
  return <span {...stylex.props(styles.footNote)}>{children}</span>
}
