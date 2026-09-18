import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { StampIcon, TriangleAlertIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@qualy/ui/empty'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'

// One sheet of paper, read top to bottom.
//
// A form that settles something has parts that come from different places -
// which question and about whom, what the file in hand says, what the office
// determines by filing it - and a single column of identical inputs hides
// that. So the parts are separated by a tinted bar naming the part and,
// where it earns its line, saying where the part's values came from.
//
// The bar is a heading, not a step. There is no "previous": changing the
// question at the top changes what every field below it even is, so the
// sheet starts over rather than remembering.
//
// How wide it is is not this file's business. `PageContainer` already
// decided that for the whole product - 72rem for a page somebody reads and
// fills in - and the heading above this sheet is sitting on that decision.
// A second width invented here only moved the sheet away from the heading
// and left a gutter on either side of it that meant nothing.

const wide = '@media (min-width: 900px)'

const styles = stylex.create({
  column: { display: 'flex', width: '100%', minWidth: 0, flexDirection: 'column', gap: 16 },
  // the one line that says what this screen is asking, above the thing it
  // asks with
  lead: { fontSize: 14, fontWeight: 500 },
  sheet: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
  },
  block: { display: 'flex', flexDirection: 'column', gap: 14, padding: 16 },
  // Three to a row once there is room. The sheet is as wide as the banner
  // above it - one width for the page, not two - so the reading length is
  // fixed here instead: three fields across put an input back at about
  // 360px, where a line of it is readable, rather than stretching one box
  // over the whole page.
  grid: {
    display: 'grid',
    gap: 14,
    gridTemplateColumns: { default: null, [wide]: 'repeat(3, minmax(0, 1fr))' },
    alignItems: 'start',
  },
  // a field and the sentence that explains it, side by side: the words use
  // the width the input does not want
  aside: {
    display: 'grid',
    gap: { default: 6, [wide]: 16 },
    gridTemplateColumns: { default: null, [wide]: 'minmax(0, 1fr) minmax(0, 2fr)' },
    alignItems: 'start',
  },
  asideText: {
    fontSize: 12,
    lineHeight: 1.7,
    color: tokens.mutedForeground,
    textWrap: 'pretty',
  },
  blockRuled: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
  },
  bar: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'baseline',
    gap: 8,
    borderBlockWidth: 1,
    borderBlockStyle: 'solid',
    borderBlockColor: tokens.divider,
    backgroundColor: tokens.surfaceInset,
    paddingInline: 16,
    paddingBlock: 9,
  },
  barTitle: { fontSize: 12, fontWeight: 500, color: tokens.surfaceMutedForeground },
  barNote: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  foot: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    backgroundColor: tokens.surfaceInset,
    paddingInline: 16,
    paddingBlock: 12,
  },
  footNote: { minWidth: 0, flexGrow: 1, fontSize: 12, color: tokens.mutedForeground },
  footState: { display: 'flex', minWidth: 0, flexGrow: 1, alignItems: 'center', gap: 8 },
  footDot: {
    flexShrink: 0,
    width: 6,
    height: 6,
    borderRadius: '9999px',
    backgroundColor: tokens.success,
  },
  footDotWaiting: { backgroundColor: tokens.warning },
  footStatus: { minWidth: 0, fontSize: 13, color: tokens.foreground },
  // what the reader is about to do, said before they do it rather than in
  // the confirmation afterwards
  notice: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 8%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.warning} 28%, transparent)`,
    paddingInline: 14,
    paddingBlock: 12,
  },
  noticeIcon: { flexShrink: 0, marginTop: 2, width: 15, height: 15, color: tokens.warning },
  noticeText: { fontSize: 13, lineHeight: 1.625, textWrap: 'pretty' },
  empty: {
    borderRadius: tokens.radiusLg,
    backgroundColor: tokens.surface,
    boxShadow: tokens.elevation1,
    paddingBlock: 48,
  },
})

/** the centred column a record sheet and its notices share */
export function RecordColumn({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} {...stylex.props(styles.column)}>
      {children}
    </div>
  )
}

export function RecordSheet({ children }: { children: ReactNode }) {
  return <section {...stylex.props(styles.sheet)}>{children}</section>
}

export function SheetLead({ children }: { children: ReactNode }) {
  return <p {...stylex.props(styles.lead)}>{children}</p>
}

/** one part of the sheet; `ruled` draws the hairline a bar would have drawn */
export function SheetBlock({ children, ruled }: { children: ReactNode; ruled?: boolean }) {
  return <div {...stylex.props(styles.block, ruled === true && styles.blockRuled)}>{children}</div>
}

/** several fields on one line, so no single one becomes a metre wide */
export function SheetRow({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.grid)}>{children}</div>
}

/** a field with the sentence that explains it beside it */
export function SheetAside({ children, said }: { children: ReactNode; said: string }) {
  return (
    <div {...stylex.props(styles.aside)}>
      {children}
      <p {...stylex.props(styles.asideText)}>{said}</p>
    </div>
  )
}

export function SheetBar({ title, note }: { title: string; note?: string }) {
  return (
    <div {...stylex.props(styles.bar)}>
      <span {...stylex.props(styles.barTitle)}>{title}</span>
      {note !== undefined && <span {...stylex.props(styles.barNote)}>{note}</span>}
    </div>
  )
}

/**
 * What is stopping the button, and the button.
 *
 * A key that is grey in five different circumstances is a key that tells
 * nobody which of the five they are in, so the state says it in words and
 * the dot carries whether anything is outstanding at all.
 */
export function SheetFoot({
  note,
  status,
  blocked,
  children,
}: {
  note: string
  /** what is still missing, or what it is ready to do */
  status?: string
  /** true while something is still outstanding */
  blocked?: boolean
  children: ReactNode
}) {
  return (
    <div {...stylex.props(styles.foot)}>
      {status === undefined ? (
        <span {...stylex.props(styles.footNote)}>{note}</span>
      ) : (
        <span {...stylex.props(styles.footState)}>
          <span
            aria-hidden
            {...stylex.props(styles.footDot, blocked === true && styles.footDotWaiting)}
          />
          <span {...stylex.props(styles.footStatus)} data-testid="record-foot-status">
            {status}
          </span>
        </span>
      )}
      {children}
    </div>
  )
}

export function SheetNotice({ children }: { children: ReactNode }) {
  return (
    <div {...stylex.props(styles.notice)} data-testid="record-notice">
      <TriangleAlertIcon aria-hidden {...stylex.props(styles.noticeIcon)} />
      <span {...stylex.props(styles.noticeText)}>{children}</span>
    </div>
  )
}

/**
 * Nothing in this batch is settled by the institution.
 *
 * Not an error and not this reader's doing: it is how the batch is
 * configured, so the line under it says what would change that rather than
 * offering a button this screen has no business owning.
 */
export function NoAdministrativeItems() {
  const { format } = useI18n()
  return (
    <Empty xstyle={styles.empty} data-testid="record-no-items">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <StampIcon />
        </EmptyMedia>
        <EmptyTitle>{format(m.recordEmpty)}</EmptyTitle>
        <EmptyDescription>{format(m.recordEmptyHint)}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  )
}
