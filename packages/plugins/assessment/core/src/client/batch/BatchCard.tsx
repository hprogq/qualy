import { ArrowRightIcon, CheckIcon } from 'lucide-react'
import { PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'
import { StatusBadge, standingOf } from './StatusBadge.tsx'
import { BatchProgress } from './BatchProgress.tsx'
import type { TimelineLike } from './progress.ts'

// One batch, as somebody choosing between them reads it.
//
// The question this answers is which assessment this is, how far along it is,
// and whether anything is about to happen - not who takes part or how it is
// configured. Coverage and roles are administration, and putting them here
// made every reader pay for a decision only an administrator makes.

export interface BatchCardRow {
  id: string
  name: string
  status: 'draft' | 'active' | 'archived'
  currentPhaseId: string | null
  currentPhaseName: string | null
  timeline: readonly TimelineLike[]
}

/** the run of stages, small enough to read at a glance and no smaller */
function MiniTimeline({ timeline }: { timeline: readonly TimelineLike[] }) {
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-1.5 text-xs">
      {timeline.map((entry, index) => (
        <li key={entry.displayName + String(index)} className="flex items-center gap-1">
          {index > 0 && <span aria-hidden className="mr-1 h-px w-5 bg-border sm:w-8" />}
          {entry.status === 'ended' ? (
            <CheckIcon aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          ) : (
            <span
              aria-hidden
              className={cn(
                'size-1.5 shrink-0 rounded-full',
                entry.status === 'current' ? 'bg-emerald-500' : 'border border-muted-foreground/40',
              )}
            />
          )}
          <span
            className={cn(
              'truncate',
              entry.status === 'current' ? 'font-medium text-foreground' : 'text-muted-foreground',
            )}
          >
            {entry.displayName}
          </span>
        </li>
      ))}
    </ol>
  )
}

export function BatchCard({ row }: { row: BatchCardRow }) {
  const { format, locale } = useI18n()
  const standing = standingOf(row.status, row.currentPhaseId)
  const starting = row.timeline.find((entry) => entry.entry.kind === 'planned')

  // three things a batch can be in the middle of saying: which stage it is
  // in, when it is due to begin, or that it has not been arranged at all
  const lead =
    standing === 'active'
      ? { label: format(m.currentStage), value: row.currentPhaseName ?? format(m.notScheduled) }
      : starting?.entry.at != null
        ? {
            label: format(m.plannedStart),
            value: new Date(starting.entry.at).toLocaleString(locale, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          }
        : {
            label: null,
            value: format(row.timeline.length === 0 ? m.noStagesYet : m.notStartedYet),
          }

  return (
    <li className="group relative rounded-xl border bg-background p-5 transition-colors hover:border-foreground/20 hover:bg-muted/30">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        {/* the whole card is the target; the link carries the name so it is
            also reachable by keyboard and readable out of context */}
        <h3 className="min-w-0 text-base font-semibold">
          <PageLink
            page="assessment/batch-phases"
            params={{ batchId: row.id }}
            className="before:absolute before:inset-0 before:content-['']"
          >
            {row.name}
          </PageLink>
        </h3>
        <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} />
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          {lead.label !== null && <p className="text-xs text-muted-foreground">{lead.label}</p>}
          <p className="truncate text-sm font-medium">{lead.value}</p>
        </div>
        {standing === 'active' && (
          <BatchProgress timeline={row.timeline} className="text-sm text-muted-foreground" />
        )}
      </div>

      {row.timeline.length > 0 && (
        <div className="mt-4 border-t pt-3">
          <MiniTimeline timeline={row.timeline} />
        </div>
      )}

      <p className="mt-4 flex items-center justify-end gap-1 text-sm text-muted-foreground transition-colors group-hover:text-foreground">
        {format(m.enterBatch)}
        <ArrowRightIcon aria-hidden className="size-3.5" />
      </p>
    </li>
  )
}
