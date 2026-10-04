import * as stylex from '@stylexjs/stylex'
import { CircleArrowUpIcon } from 'lucide-react'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import type { ReviewDto } from './model.ts'
import * as m from '#messages'

const lg = '@media (min-width: 1024px)'

const styles = stylex.create({
  // the escalation environment's one card: the standing colour carries the
  // asking-to-be-read-closely tone, mixed over the scheme's own ground
  escalationCard: {
    margin: 0,
    display: 'flex',
    minWidth: 0,
    flexShrink: 0,
    alignItems: 'flex-start',
    gap: { default: 8, [lg]: 12 },
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: `color-mix(in oklab, ${tokens.warning} 35%, ${tokens.background})`,
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 12%, ${tokens.background})`,
    paddingInline: { default: 12, [lg]: 16 },
    paddingBlock: { default: 12, [lg]: 14 },
  },
  escalationIcon: {
    marginTop: 2,
    width: 16,
    height: 16,
    flexShrink: 0,
    color: tokens.warningForeground,
  },
  escalationWords: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 4,
  },
  escalationTitle: {
    fontSize: 14,
    fontWeight: 500,
    letterSpacing: '-0.025em',
    color: tokens.foreground,
  },
  groundsLabel: {
    marginRight: 8,
    fontSize: 12,
    fontWeight: 500,
    color: tokens.mutedForeground,
  },
  escalationGrounds: {
    fontSize: 14,
    lineHeight: 1.625,
    textWrap: 'pretty',
    color: tokens.foreground,
  },
  escalationBody: {
    fontSize: 13,
    lineHeight: 1.625,
    color: `color-mix(in oklab, ${tokens.foreground} 75%, transparent)`,
  },
})

/**
 * The escalation environment's one card: an amber tinted notice - the two
 * colours already spoken on this desk are the verdicts, and this is
 * neither, it is the round asking to be read more closely - leading with
 * the appellant's own grounds where the round is an appeal.
 */
export function EscalationNotice({ review }: { review: ReviewDto }) {
  // the guard lives here, once: only a live escalation round carries the
  // card, wherever the layout chooses to stand it
  if (review.state === 'completed' || review.chain.route !== 'escalation') return null
  // an appeal and a staff reopening both contest a conclusion, and both
  // lead with the grounds given for it
  const appealed = review.events.find(
    (event) => event.kind === 'appealed' || event.kind === 'reopened',
  )
  const reopened = appealed?.kind === 'reopened'
  // an administrator sending it up says why too, and that sentence was the
  // one thing the card never showed
  const escalated = review.events.find((event) => event.kind === 'escalated')
  return (
    <div data-testid="escalation-card" {...stylex.props(styles.escalationCard)}>
      <CircleArrowUpIcon aria-hidden className={stylex.props(styles.escalationIcon).className} />
      <div {...stylex.props(styles.escalationWords)}>
        <p {...stylex.props(styles.escalationTitle)}>
          {(reopened
            ? m.review_reopenBannerTitle
            : appealed !== undefined
              ? m.review_appealBannerTitle
              : m.review_escBannerTitle)()}
        </p>
        {/* What this round is, before what anybody said in it: a title and a
            quotation with nothing between them read as the system saying
            "测试申诉", and the reviewer had to work out whose sentence it
            was. The grounds are still their own words - named. */}
        <p {...stylex.props(styles.escalationBody)}>
          {(reopened
            ? m.review_reopenBannerBody
            : appealed !== undefined
              ? m.review_appealBannerBody
              : m.review_escBannerBody)()}
        </p>
        {appealed !== undefined && appealed.comment !== null && appealed.comment !== '' && (
          <p {...stylex.props(styles.escalationGrounds)}>
            <span {...stylex.props(styles.groundsLabel)}>
              {(reopened ? m.staff_reopenReason : m.entry_appealReason)()}
            </span>
            {appealed.comment}
          </p>
        )}
        {appealed === undefined && escalated?.comment != null && escalated.comment !== '' && (
          <p {...stylex.props(styles.escalationGrounds)}>
            <span {...stylex.props(styles.groundsLabel)}>{m.review_escalateReason()}</span>
            {escalated.comment}
          </p>
        )}
      </div>
    </div>
  )
}
