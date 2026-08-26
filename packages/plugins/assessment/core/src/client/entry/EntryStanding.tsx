import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { entryStatusMessage, type EntryDto } from './model.ts'

/**
 * Where a claim stands, as a dot and a word.
 *
 * The dot carries the weight: filled and dark for what counts, hollow for a
 * draft nobody has been handed yet, red for whatever is waiting on the
 * reader. The pill's own edge follows, so a card can be read across the pane
 * without reading the word. One component for the card and the drawer, so
 * the two can never call the same claim two different things.
 */

const styles = stylex.create({
  pill: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: 6,
    borderRadius: '9999px',
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    paddingInline: 10,
    paddingBlock: 2,
    fontSize: 12,
    whiteSpace: 'nowrap',
  },
  pillAlert: {
    borderColor: `color-mix(in oklab, ${tokens.danger} 35%, transparent)`,
    color: tokens.danger,
  },
  pillHollow: {
    color: tokens.mutedForeground,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: '9999px',
  },
  dotHollow: {
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
  },
  dotAlert: {
    backgroundColor: tokens.danger,
  },
  dotApproved: {
    backgroundColor: tokens.foreground,
  },
  dotDefault: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
})

export function EntryStanding({
  status,
  revised,
  asked,
}: {
  status: EntryDto['status']
  revised?: boolean
  /** a reviewer is waiting for material, which outranks "in review" */
  asked?: boolean
}) {
  const { format } = useI18n()
  const word =
    asked === true
      ? m.entryStatusAwaitingSupplement
      : status === 'draft' && revised === true
        ? // a draft with a round behind it is not a fresh draft: it exists
          // because something was asked of it
          m.entryStatusRevising
        : entryStatusMessage[status]
  const alert = asked === true || status === 'rejected' || status === 'needs_revision'
  const hollow = status === 'draft' && asked !== true
  return (
    <span
      // the standing itself, beside the word for it: a test about what a
      // claim is doing asks this, not the sentence the word happens to be
      data-testid="entry-standing"
      data-entry-standing={asked === true ? 'awaiting_supplement' : status}
      {...stylex.props(styles.pill, alert && styles.pillAlert, hollow && styles.pillHollow)}
    >
      <span
        aria-hidden
        {...stylex.props(
          styles.dot,
          hollow
            ? styles.dotHollow
            : alert
              ? styles.dotAlert
              : status === 'approved'
                ? styles.dotApproved
                : styles.dotDefault,
        )}
      />
      {format(word)}
    </span>
  )
}
