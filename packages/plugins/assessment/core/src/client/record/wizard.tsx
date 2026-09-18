import { Fragment, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { CheckIcon, StampIcon, TriangleAlertIcon } from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@qualy/ui/empty'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'

// An errand in three moves: choose, fill in, confirm.
//
// The shape is the same for both errands the office runs from this page, so
// it is one shell and they differ only in what each move holds. Three things
// make it a wizard rather than a long form in a box:
//
// The rail says how far along the reader is and how much is left, which a
// scroll bar cannot - a form that grows as it is filled in has a scroll bar
// that means nothing. Steps already passed are pressable, because a reader
// who wants to see what they chose should not have to guess which button
// goes back.
//
// The body is the only thing that scrolls. The rail and the footer stay
// where they are, so the pair of buttons never has to be hunted for and the
// panel never changes height while somebody is typing in it.
//
// The footer carries one forward move and one back. What is stopping the
// forward move is said in words beside it: a key that greys out for five
// different reasons tells nobody which of the five they are in.

const wide = '@media (min-width: 640px)'

// The panel an errand runs in hands its side padding over to the bands
// inside it, because the rule above the keys divides the whole panel rather
// than the text column. Reaching back out with a negative margin does draw
// the same line, and puts a sideways scrollbar under a dialog that has
// nothing to scroll to.
const PANEL_PAD = 24

const styles = stylex.create({
  wizard: {
    display: 'flex',
    minHeight: 0,
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 16,
  },
  rail: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    margin: 0,
    paddingInline: PANEL_PAD,
    paddingBlock: 0,
    listStyle: 'none',
  },
  seat: { display: 'flex', minWidth: 0, alignItems: 'center' },
  step: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    borderWidth: 0,
    borderRadius: '9999px',
    backgroundColor: 'transparent',
    paddingInline: 0,
    paddingBlock: 0,
    fontFamily: 'inherit',
    cursor: { default: 'default', ':enabled': 'pointer' },
  },
  mark: {
    display: 'inline-flex',
    flexShrink: 0,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    backgroundColor: 'transparent',
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    color: tokens.mutedForeground,
    fontSize: 12,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
  markNow: {
    backgroundColor: tokens.primary,
    boxShadow: 'none',
    color: tokens.primaryForeground,
  },
  markDone: {
    backgroundColor: `color-mix(in oklab, ${tokens.primary} 12%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.primary} 35%, transparent)`,
    color: tokens.primary,
  },
  markIcon: { width: 13, height: 13 },
  // narrow, only the step being worked on is named: three labels and two
  // rules do not fit across a phone, and the numbers alone still carry how
  // far along this is
  label: {
    display: { default: 'none', [wide]: 'inline' },
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 13,
    color: tokens.mutedForeground,
  },
  labelNow: { display: 'inline', color: tokens.foreground, fontWeight: 500 },
  link: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 12,
    height: 1,
    backgroundColor: tokens.divider,
  },
  linkDone: { backgroundColor: `color-mix(in oklab, ${tokens.primary} 35%, transparent)` },
  body: {
    display: 'flex',
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 20,
    paddingInline: PANEL_PAD,
    overflowY: 'auto',
    // The room a focus ring needs is the panel's own, not borrowed with a
    // negative margin: a box wider than what holds it is what puts a
    // sideways scrollbar under a dialog that has nothing to scroll to.
    overflowX: 'hidden',
  },
  foot: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    flexShrink: 0,
    alignItems: 'center',
    gap: 12,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingInline: PANEL_PAD,
    paddingTop: 16,
  },
  footState: { display: 'flex', minWidth: 0, flexGrow: 1, alignItems: 'center', gap: 8 },
  footDot: {
    flexShrink: 0,
    width: 6,
    height: 6,
    borderRadius: '9999px',
    backgroundColor: tokens.success,
  },
  footDotWaiting: { backgroundColor: tokens.warning },
  footStatus: { minWidth: 0, fontSize: 13, color: tokens.mutedForeground },
  footKeys: { display: 'flex', flexShrink: 0, gap: 8, marginLeft: 'auto' },
  section: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 12 },
  sectionHead: { display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: 8 },
  sectionTitle: { margin: 0, fontSize: 14, fontWeight: 600 },
  sectionNote: {
    fontSize: 12,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 85%, transparent)`,
  },
  sectionBody: { display: 'flex', minWidth: 0, flexDirection: 'column', gap: 14 },
  recap: {
    display: 'grid',
    gridTemplateColumns: { default: 'minmax(0, 1fr)', [wide]: 'max-content minmax(0, 1fr)' },
    columnGap: 20,
    rowGap: { default: 4, [wide]: 10 },
    margin: 0,
    borderRadius: tokens.radiusMd,
    backgroundColor: tokens.surfaceInset,
    boxShadow: `inset 0 0 0 1px ${tokens.divider}`,
    paddingInline: 16,
    paddingBlock: 14,
    fontSize: 13,
    lineHeight: '1.25rem',
  },
  recapTerm: { color: tokens.mutedForeground },
  recapValue: {
    minWidth: 0,
    margin: 0,
    marginBottom: { default: 8, [wide]: 0 },
    overflowWrap: 'anywhere',
  },
  // a field and the sentence that explains it, side by side: the words use
  // the width the input does not want
  aside: {
    display: 'grid',
    gap: { default: 6, [wide]: 16 },
    gridTemplateColumns: { default: null, [wide]: 'minmax(0, 1fr) minmax(0, 2fr)' },
    alignItems: 'start',
  },
  asideText: { fontSize: 12, lineHeight: 1.7, color: tokens.mutedForeground, textWrap: 'pretty' },
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
  noticeBad: {
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 7%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${tokens.danger} 30%, transparent)`,
  },
  noticeIcon: { flexShrink: 0, marginTop: 2, width: 15, height: 15, color: tokens.warning },
  noticeIconBad: { color: tokens.danger },
  noticeTextBad: { color: tokens.danger, fontWeight: 500 },
  noticeText: { fontSize: 13, lineHeight: 1.625, textWrap: 'pretty' },
  empty: { paddingBlock: 48 },
})

/** the column an errand fills: rail on top, one scrolling body, keys below */
export function Wizard({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} {...stylex.props(styles.wizard)}>
      {children}
    </div>
  )
}

/**
 * How far along, and how much is left.
 *
 * Every step already passed is pressable; the one being worked on and the
 * ones ahead are not, because arriving at a step early would mean confirming
 * something that has not been filled in.
 */
export function WizardRail({
  steps,
  at,
  onGo,
}: {
  steps: readonly string[]
  at: number
  onGo: (step: number) => void
}) {
  return (
    <ol {...stylex.props(styles.rail)} data-testid="record-steps" data-at={at}>
      {steps.map((label, index) => (
        <Fragment key={label}>
          {index > 0 && (
            <li aria-hidden {...stylex.props(styles.link, index <= at && styles.linkDone)} />
          )}
          <li {...stylex.props(styles.seat)}>
            <button
              type="button"
              disabled={index >= at}
              aria-current={index === at ? 'step' : undefined}
              onClick={() => onGo(index)}
              {...stylex.props(styles.step)}
            >
              <span
                {...stylex.props(
                  styles.mark,
                  index === at && styles.markNow,
                  index < at && styles.markDone,
                )}
              >
                {index < at ? (
                  <CheckIcon aria-hidden {...stylex.props(styles.markIcon)} />
                ) : (
                  index + 1
                )}
              </span>
              <span {...stylex.props(styles.label, index === at && styles.labelNow)}>{label}</span>
            </button>
          </li>
        </Fragment>
      ))}
    </ol>
  )
}

/** the one part that scrolls */
export function WizardBody({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.body)}>{children}</div>
}

/** what is stopping the next move, and the moves */
export function WizardFoot({
  status,
  blocked,
  children,
}: {
  /** what is still missing, or what the next press will do */
  status?: string
  /** true while something is still outstanding */
  blocked?: boolean
  children: ReactNode
}) {
  return (
    <div {...stylex.props(styles.foot)}>
      {status !== undefined && (
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
      <span {...stylex.props(styles.footKeys)}>{children}</span>
    </div>
  )
}

/** one part of a step, named */
export function WizardSection({
  title,
  note,
  children,
}: {
  title: string
  note?: string
  children: ReactNode
}) {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHead)}>
        <h3 {...stylex.props(styles.sectionTitle)}>{title}</h3>
        {note !== undefined && <span {...stylex.props(styles.sectionNote)}>{note}</span>}
      </div>
      <div {...stylex.props(styles.sectionBody)}>{children}</div>
    </section>
  )
}

/** what is about to be settled, read back in one block before it is */
export function WizardRecap({ children }: { children: ReactNode }) {
  return <dl {...stylex.props(styles.recap)}>{children}</dl>
}

export function WizardRecapRow({ term, children }: { term: string; children: ReactNode }) {
  return (
    <>
      <dt {...stylex.props(styles.recapTerm)}>{term}</dt>
      <dd {...stylex.props(styles.recapValue)}>{children}</dd>
    </>
  )
}

/** a field with the sentence that explains it beside it */
export function WizardAside({ children, said }: { children: ReactNode; said: string }) {
  return (
    <div {...stylex.props(styles.aside)}>
      {children}
      <p {...stylex.props(styles.asideText)}>{said}</p>
    </div>
  )
}

/**
 * What the next press comes to, said before it is pressed.
 *
 * `bad` is for what has already gone wrong rather than what is about to
 * happen: the same box in the colour of a refusal, because a line telling
 * somebody their file cannot be imported should not read like the grey
 * caption under a field.
 */
export function WizardNotice({ children, bad }: { children: ReactNode; bad?: boolean }) {
  return (
    <div
      {...stylex.props(styles.notice, bad === true && styles.noticeBad)}
      data-testid="record-notice"
    >
      <TriangleAlertIcon
        aria-hidden
        {...stylex.props(styles.noticeIcon, bad === true && styles.noticeIconBad)}
      />
      <span {...stylex.props(styles.noticeText, bad === true && styles.noticeTextBad)}>
        {children}
      </span>
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
