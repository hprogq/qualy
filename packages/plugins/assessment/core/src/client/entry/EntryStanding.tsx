import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { entryStatusMessage, type EntryDto } from './model.ts'

/**
 * Where a claim stands, as one word on a tinted chip.
 *
 * The tint carries the weight, the same four tones everywhere a claim is
 * listed: amber for what waits on its owner, green for what counts, grey for
 * what is moving or kept, and a bare outline for what ended without counting.
 * Red is kept for news nobody has seen and for deductions, so a refusal reads
 * as an outcome rather than an alarm. One component for the list and the
 * drawer, so the two can never call the same claim two different things.
 */

const styles = stylex.create({
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 20,
    borderRadius: 6,
    paddingInline: 7,
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1,
    whiteSpace: 'nowrap',
  },
  roomy: {
    height: 24,
    paddingInline: 9,
    fontSize: 12.5,
  },
  waits: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 16%, transparent)`,
    color: tokens.warningForeground,
  },
  counts: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 15%, transparent)`,
    color: tokens.successForeground,
  },
  moving: {
    backgroundColor: tokens.surfaceMuted,
    color: tokens.surfaceMutedForeground,
  },
  ended: {
    boxShadow: `inset 0 0 0 1px ${tokens.border}`,
    color: tokens.mutedForeground,
  },
})

/** the same six states, in the words an administrative finding uses */
const recordWord = {
  draft: m.recordStandingSettled,
  in_review: m.recordStandingAppealed,
  needs_revision: m.recordStandingAppealed,
  approved: m.recordStandingSettled,
  rejected: m.recordStandingOverturned,
  voided: m.recordStandingWithdrawn,
} as const

export function EntryStanding({
  status,
  revised,
  asked,
  source,
  openRound,
  size = 'default',
}: {
  status: EntryDto['status']
  revised?: boolean
  /**
   * The round running right now, where one is.
   *
   * An appeal leaves the claim standing where it stood (§32.21), so the
   * status alone reads "已认定" all through the appeal it is the subject of -
   * which says the argument is over while it is being had.
   */
  openRound?: EntryDto['openRound']
  /** a reviewer is waiting for material, which outranks "in review" */
  asked?: boolean
  /**
   * How the fact arrived, when the caller knows.
   *
   * The same six states mean different things depending on it. A claim that
   * is `approved` passed a review; a fact the office recorded was settled
   * the moment it was written and no reviewer ever saw it, so "已通过" names
   * a review that never happened. Told by the fact's own origin rather than
   * by the item's type, because one question may accept both.
   */
  source?: EntryDto['source']
  /** `roomy` where the chip stands in a column of its own */
  size?: 'default' | 'roomy'
}) {
  const { format } = useI18n()
  const administrative = source === 'record' || source === 'import'
  const contested = openRound?.origin === 'appeal' || openRound?.origin === 'reopen'
  const word =
    asked === true
      ? m.entryStatusAwaitingSupplement
      : contested
        ? openRound?.origin === 'appeal'
          ? administrative
            ? m.recordStandingAppealed
            : m.entryStatusAppealing
          : m.entryStatusReopened
        : administrative
          ? recordWord[status]
          : status === 'draft' && revised === true
            ? // a draft with a round behind it is not a fresh draft: it
              // exists because something was asked of it
              m.entryStatusRevising
            : entryStatusMessage[status]
  const standing = asked === true ? 'awaiting_supplement' : contested ? 'contested' : status
  const tone =
    asked === true || (status === 'needs_revision' && !administrative)
      ? styles.waits
      : contested
        ? styles.moving
        : status === 'approved' || (administrative && status === 'draft')
          ? styles.counts
          : status === 'rejected' || status === 'voided'
            ? styles.ended
            : styles.moving
  return (
    <span
      // the standing itself, beside the word for it: a test about what a
      // claim is doing asks this, not the sentence the word happens to be
      data-testid="entry-standing"
      data-entry-standing={standing}
      {...(openRound === null || openRound === undefined
        ? {}
        : { 'data-open-round': openRound.origin })}
      {...stylex.props(styles.chip, size === 'roomy' && styles.roomy, tone)}
    >
      {format(word)}
    </span>
  )
}
