import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { breakpoints } from '@qualy/ui/theme/breakpoints.stylex'
import { Badge } from '@qualy/ui/badge'

import { standingOf } from './standing.ts'
import * as m from '#messages'

// Where a batch stands, as a badge.
//
// Four words for three stored values: a batch that has promised to start but
// has not arrived there yet is neither a draft nor under way, and calling it
// "in progress" while nobody can do anything in it reads as a bug.
//
// The dot is not decoration either: a running batch is the only one whose
// screen can change under the reader, and it is the only one whose dot moves.

const ping = stylex.keyframes({
  '75%': { transform: 'scale(2)', opacity: 0 },
  '100%': { transform: 'scale(2)', opacity: 0 },
})

const styles = stylex.create({
  badge: {
    gap: 6,
    fontWeight: 500,
    borderColor: 'transparent',
    // the live dot's halo grows past the dot's own box; a badge that clips
    // its overflow cuts the ring off mid-breath
    overflow: 'visible',
  },
  quietTone: {
    backgroundColor: tokens.surfaceMuted,
    color: tokens.mutedForeground,
  },
  pendingTone: {
    backgroundColor: `color-mix(in oklab, ${tokens.warning} 15%, transparent)`,
    color: tokens.warningForeground,
  },
  activeTone: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 15%, transparent)`,
    color: tokens.successForeground,
  },
  // with the word gone the badge is only a dot in a ground, and a ground
  // longer than it is tall reads as a label that failed to load - and a
  // ground the row is allowed to squeeze reads as an ellipse
  compact: {
    width: 16,
    height: 16,
    flexShrink: 0,
    justifyContent: 'center',
    padding: 0,
  },
  // the same, only below a tablet: which width that is, the stylesheet says
  compactPhone: {
    width: { default: null, [breakpoints.phone]: 16 },
    height: { default: null, [breakpoints.phone]: 16 },
    flexShrink: { default: null, [breakpoints.phone]: 0 },
    justifyContent: { default: null, [breakpoints.phone]: 'center' },
    padding: { default: null, [breakpoints.phone]: 0 },
    gap: { default: 6, [breakpoints.phone]: 0 },
  },
  // the word, kept for whoever reads rather than looks where it is not shown
  wordPhone: {
    position: { default: null, [breakpoints.phone]: 'absolute' },
    width: { default: null, [breakpoints.phone]: 1 },
    height: { default: null, [breakpoints.phone]: 1 },
    overflow: { default: null, [breakpoints.phone]: 'hidden' },
    clipPath: { default: null, [breakpoints.phone]: 'inset(50%)' },
    whiteSpace: { default: null, [breakpoints.phone]: 'nowrap' },
  },
  // the widget's own label span clips its overflow, which cut the live
  // dot's halo into a rectangle mid-breath
  label: {
    overflow: 'visible',
    display: 'flex',
    alignItems: 'center',
  },
  // never squeezed: inside a tight row a flexible seat flattens the dot
  // into an ellipse
  dotSeat: {
    position: 'relative',
    display: 'flex',
    width: 6,
    height: 6,
    flexShrink: 0,
  },
  pulse: {
    position: 'absolute',
    display: 'inline-flex',
    width: '100%',
    height: '100%',
    borderRadius: '9999px',
    opacity: 0.75,
    animationName: {
      default: ping,
      '@media (prefers-reduced-motion: reduce)': 'none',
    },
    animationDuration: '1s',
    animationTimingFunction: 'cubic-bezier(0, 0, 0.2, 1)',
    animationIterationCount: 'infinite',
  },
  dot: {
    position: 'relative',
    display: 'inline-flex',
    width: 6,
    height: 6,
    borderRadius: '9999px',
  },
  quietDot: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 60%, transparent)`,
  },
  pendingDot: {
    backgroundColor: tokens.warning,
  },
  activeDot: {
    backgroundColor: tokens.success,
  },
})

const tones = {
  draft: { badge: styles.quietTone, dot: styles.quietDot, live: false },
  pending: { badge: styles.pendingTone, dot: styles.pendingDot, live: false },
  active: { badge: styles.activeTone, dot: styles.activeDot, live: true },
  archived: { badge: styles.quietTone, dot: styles.quietDot, live: false },
} as const

export function StatusBadge({
  status,
  currentPhaseId = null,
  compact = false,
  xstyle,
}: {
  status: 'draft' | 'active' | 'archived'
  currentPhaseId?: string | null
  /**
   * The dot and its ground only, for a bar with no room for the word -
   * always, or (`'phone'`) below a tablet.
   */
  compact?: boolean | 'phone'
  xstyle?: stylex.StyleXStyles
}) {
  const standing = standingOf(status, currentPhaseId)
  const tone = tones[standing]
  const label = {
    draft: m.status_draft,
    pending: m.status_pending,
    active: m.status_active,
    archived: m.status_archived,
  }[standing]

  return (
    <Badge
      className={
        // one compact form or the other, never both in one composition
        stylex.props(
          styles.badge,
          tone.badge,
          compact === 'phone' ? styles.compactPhone : compact && styles.compact,
          xstyle,
        ).className
      }
      labelXstyle={styles.label}
      // where the round stands, said as a fact: the badge's word is copy and
      // the colour is not readable by a test, but which of the four this is
      // is neither
      data-testid="batch-standing"
      data-standing={standing}
      // the word is what goes, not the meaning: the colour and the dot still
      // say it, and whoever cannot see them is reading this instead
      aria-label={compact === true ? label() : undefined}
    >
      <span aria-hidden {...stylex.props(styles.dotSeat)}>
        {tone.live && <span {...stylex.props(styles.pulse, tone.dot)} />}
        <span {...stylex.props(styles.dot, tone.dot)} />
      </span>
      {compact === 'phone' ? (
        <span {...stylex.props(styles.wordPhone)}>{label()}</span>
      ) : (
        !compact && label()
      )}
    </Badge>
  )
}
