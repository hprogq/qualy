import * as stylex from '@stylexjs/stylex'
import { motion, useReducedMotion } from 'motion/react'
import { useI18n } from '@qualy/web-i18n'
import { VisuallyHidden } from '@qualy/ui/visually-hidden'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../../i18n.ts'

// The small marks the workspace sets beside a row's name.
//
// The dot at the head of a question's row says where it stands, and nothing
// else. News the owner has not read is the red of a message count: a count
// after a question's name, how many of its claims hold news, and a dot at
// the head of each such claim. It is read one claim at a time, by opening
// that claim, and the standing stays exactly as it was. A count rather than
// a word: a word after a question's name reads as something said about the
// question - "new" as in a question just added.
//
// A section's fill is a small pie beside its figure rather than a line under
// its row: a line along the foot of a row reads as the rule between two
// rows, and a full one reads as nothing else. A pie rather than a ring,
// because a part-drawn ring is what a screen shows while it is loading. The
// same pie wherever a section's figure stands - the structure, a section's
// own page and the sections a question's requirements list - so a section
// looks the same wherever it is met.

/** the wedge is drawn as a stroke as wide as its own radius, twice over */
const WEDGE = 2.5
const ROUND = 2 * Math.PI * WEDGE

const styles = stylex.create({
  count: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 16,
    height: 16,
    borderRadius: 9999,
    backgroundColor: tokens.danger,
    paddingInline: 4.5,
    fontSize: 10.5,
    lineHeight: 1,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: 'white',
  },
  dot: {
    display: 'inline-block',
    width: 6,
    height: 6,
    flexShrink: 0,
    borderRadius: 9999,
    backgroundColor: tokens.danger,
  },
  pie: { width: 14, height: 14, flexShrink: 0 },
  // beside a section's own heading figure, which is set larger
  pieLarge: { width: 20, height: 20 },
  rim: { stroke: `color-mix(in oklab, ${tokens.foreground} 45%, ${tokens.background})` },
  wedge: { stroke: `color-mix(in oklab, ${tokens.foreground} 45%, ${tokens.background})` },
  full: { stroke: tokens.success },
})

/** how many claims under a question, or a folded section, hold news their owner has not read */
export function UnreadCount({ count }: { count: number }) {
  const { format } = useI18n()
  return (
    <span data-testid="unread-mark" data-count={count} {...stylex.props(styles.count)}>
      <span aria-hidden>{count > 99 ? '99+' : count}</span>
      <VisuallyHidden>{format(m.rowUnreadCount, { count })}</VisuallyHidden>
    </span>
  )
}

/**
 * One claim with news its owner has not read. Drawn where the caller puts
 * it, and hidden from assistive technology: the caller says "unread" in
 * words where it reads the claim out.
 */
export function UnreadDot({ xstyle }: { xstyle?: stylex.StyleXStyles }) {
  return <span aria-hidden data-testid="unread-dot" {...stylex.props(styles.dot, xstyle)} />
}

/**
 * How far a section has got against its limit, as a pie beside its figure.
 * The figure itself is said in words next to it; the pie is that figure
 * drawn, so it is hidden from assistive technology.
 */
export function SectionMeter({
  got,
  cap,
  large = false,
}: {
  got: number
  cap: number
  /** beside a heading's figure rather than a row's */
  large?: boolean
}) {
  const reduced = useReducedMotion() === true
  const share = cap <= 0 ? 0 : Math.max(0, Math.min(1, got / cap))
  const full = got >= cap
  return (
    <svg
      viewBox="0 0 14 14"
      aria-hidden
      data-testid="section-meter"
      data-share={Math.round(share * 100)}
      data-full={full}
      {...stylex.props(styles.pie, large && styles.pieLarge)}
    >
      <circle
        cx="7"
        cy="7"
        r="6"
        fill="none"
        strokeWidth="1.25"
        {...stylex.props(styles.rim, full && styles.full)}
      />
      {share > 0 && (
        <motion.circle
          cx="7"
          cy="7"
          r={WEDGE}
          fill="none"
          strokeWidth={WEDGE * 2}
          strokeDasharray={ROUND}
          transform="rotate(-90 7 7)"
          initial={reduced ? false : { strokeDashoffset: ROUND }}
          animate={{ strokeDashoffset: ROUND * (1 - share) }}
          transition={{ duration: reduced ? 0 : 0.5, ease: [0.22, 0.61, 0.36, 1] }}
          {...stylex.props(styles.wedge, full && styles.full)}
        />
      )}
    </svg>
  )
}
