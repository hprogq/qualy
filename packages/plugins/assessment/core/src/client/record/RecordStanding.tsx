import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import type { EntryDto } from '../entry/model.ts'
import * as m from '#messages'

/**
 * Where an administrative finding stands, in this screen's own words.
 *
 * The same four states an entry always has, said the way this page means
 * them. A record is approved the moment it is written and no reviewer ever
 * sees it, so calling that state "已通过" would name a review that never
 * happened; what the office did was settle it. By the same token `rejected`
 * here is not a submission being turned away - it is an appeal that went
 * against the finding, so the finding was not upheld.
 *
 * A filled chip rather than the dot-and-outline the claim screens use: those
 * distinguish a draft nobody has handed in from work in flight, a
 * distinction this page does not have - every line here is a settled fact,
 * and what varies is only whether it still counts.
 */

const styles = stylex.create({
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    height: 22,
    borderRadius: tokens.radiusSm,
    paddingInline: 8,
    fontSize: 12,
    fontWeight: 500,
    whiteSpace: 'nowrap',
  },
  settled: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 15%, transparent)`,
    color: tokens.successForeground,
  },
  appealed: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 18%, transparent)`,
    color: tokens.warningForeground,
  },
  overturned: {
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 14%, transparent)`,
    color: tokens.danger,
  },
  withdrawn: { backgroundColor: tokens.surfaceMuted, color: tokens.surfaceMutedForeground },
})

const said = {
  approved: m.record_standingSettled,
  in_review: m.record_standingAppealed,
  needs_revision: m.record_standingAppealed,
  rejected: m.record_standingOverturned,
  voided: m.record_standingWithdrawn,
  draft: m.record_standingSettled,
} as const

const tone = {
  approved: styles.settled,
  in_review: styles.appealed,
  needs_revision: styles.appealed,
  rejected: styles.overturned,
  voided: styles.withdrawn,
  draft: styles.settled,
} as const

export function RecordStanding({ status }: { status: EntryDto['status'] }) {
  return (
    <span
      // the standing itself, beside the word for it: a test about what a
      // finding is doing asks this, not the sentence it happens to read
      data-testid="entry-standing"
      data-entry-standing={status}
      {...stylex.props(styles.chip, tone[status])}
    >
      {said[status]()}
    </span>
  )
}
