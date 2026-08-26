import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { assessmentMessages as m } from '../i18n.ts'
import { standingOf } from './standing.ts'

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
  /** the dot and its ground only, for a bar with no room for the word */
  compact?: boolean
  xstyle?: stylex.StyleXStyles
}) {
  const { format } = useI18n()
  const standing = standingOf(status, currentPhaseId)
  const tone = tones[standing]
  const label = {
    draft: m.statusDraft,
    pending: m.statusPending,
    active: m.statusActive,
    archived: m.statusArchived,
  }[standing]

  return (
    <Badge
      className={
        stylex.props(styles.badge, tone.badge, compact && styles.compact, xstyle).className
      }
      labelClassName={stylex.props(styles.label).className}
      // the word is what goes, not the meaning: the colour and the dot still
      // say it, and whoever cannot see them is reading this instead
      aria-label={compact ? format(label) : undefined}
    >
      <span aria-hidden {...stylex.props(styles.dotSeat)}>
        {tone.live && <span {...stylex.props(styles.pulse, tone.dot)} />}
        <span {...stylex.props(styles.dot, tone.dot)} />
      </span>
      {!compact && format(label)}
    </Badge>
  )
}
