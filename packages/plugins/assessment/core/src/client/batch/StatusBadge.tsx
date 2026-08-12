import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { cn } from '@qualy/ui/cn'
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

const tones = {
  draft: {
    badge: 'border-transparent bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/60',
    live: false,
  },
  pending: {
    badge: 'border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
    live: false,
  },
  active: {
    badge: 'border-transparent bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
    dot: 'bg-emerald-500',
    live: true,
  },
  archived: {
    badge: 'border-transparent bg-muted text-muted-foreground',
    dot: 'bg-muted-foreground/60',
    live: false,
  },
} as const

export function StatusBadge({
  status,
  currentPhaseId = null,
  compact = false,
  className,
}: {
  status: 'draft' | 'active' | 'archived'
  currentPhaseId?: string | null
  /** the dot and its ground only, for a bar with no room for the word */
  compact?: boolean
  className?: string
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
      className={cn('gap-1.5 font-medium', tone.badge, compact && 'px-1.5', className)}
      // the word is what goes, not the meaning: the colour and the dot still
      // say it, and whoever cannot see them is reading this instead
      aria-label={compact ? format(label) : undefined}
    >
      <span aria-hidden className="relative flex size-1.5">
        {tone.live && (
          <span
            className={cn(
              'absolute inline-flex size-full animate-ping rounded-full opacity-75 motion-reduce:animate-none',
              tone.dot,
            )}
          />
        )}
        <span className={cn('relative inline-flex size-1.5 rounded-full', tone.dot)} />
      </span>
      {!compact && format(label)}
    </Badge>
  )
}
