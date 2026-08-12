import { ArrowRightIcon, CalendarRangeIcon, LayersIcon, UsersIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'
import { StatusBadge } from './StatusBadge.tsx'
import { standingOf } from './standing.ts'
import { BatchProgress } from './BatchProgress.tsx'
import type { TimelineLike } from './progress.ts'

// One batch, as somebody choosing between them reads it.
//
// The question a card answers is which assessment this is, how far along it
// is, and whether anything is about to happen. It is deliberately narrow -
// two to a row on a desktop - because a card the width of the window is a
// line of six words with half a metre of nothing after them, and because the
// eye compares things that stand side by side.
//
// Who takes part and which materials count are facts about the round rather
// than about the reader, so they sit as a quiet line of three; a person's own
// role in it belongs inside the batch, not on every card in a list.

export interface BatchCardRow {
  id: string
  name: string
  status: 'draft' | 'active' | 'archived'
  currentPhaseId: string | null
  currentPhaseName: string | null
  participantCount: number
  materialRange: { start: string; end: string }
  timeline: readonly TimelineLike[]
}

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span aria-hidden className="shrink-0 text-muted-foreground/70 *:size-3.5">
        {icon}
      </span>
      <span className="truncate">{children}</span>
    </span>
  )
}

const SEGMENTS = {
  ended: 'bg-muted-foreground/40 group-hover/segment:bg-muted-foreground/70',
  current: 'bg-emerald-500 group-hover/segment:bg-emerald-500',
  future: 'bg-muted group-hover/segment:bg-muted-foreground/30',
} as const

/**
 * The plan as a bar of segments, one per stage.
 *
 * Names would need a card twice this wide and would be truncated to
 * uselessness at six stages, so the shape carries the meaning - how much is
 * behind, where it is now, how much is left - and the current stage's name is
 * said in full above it.
 *
 * A segment gives its own name when the pointer rests on it: the segment
 * itself only thickens, and the name appears above it as a line of small
 * text. Neither costs the card a pixel of height - the row is one line of
 * cards, and a card that grows on hover moves its neighbours.
 *
 * Nothing of this happens without a pointer. A touch screen has nowhere to
 * rest one, and the stage the batch is in is already named in full higher up
 * the card, so a phone gets the plain bar.
 */
function StageBar({ timeline, batchId }: { timeline: readonly TimelineLike[]; batchId: string }) {
  return (
    // above the card's own overlay so the pointer reaches a segment at all,
    // and a link of its own so that reaching it costs nothing: a strip in the
    // middle of a card that swallows clicks reads as broken
    <PageLink
      page="assessment/batch"
      params={{ batchId }}
      tabIndex={-1}
      aria-hidden
      className="relative z-10 block"
    >
      <div className="flex h-1 items-end gap-1">
        {timeline.map((entry, index) => (
          <span
            key={entry.displayName + String(index)}
            // The strip itself is four pixels tall with four between them, so
            // a pointer crossing it enters and leaves a dozen times on the
            // way: every crossing restarts two transitions, and the flicker
            // that comes of it is what reads as stutter. The hit area is a
            // band around the segment, half the gap wide, so one pass over
            // the bar is one hover.
            className="group/segment relative h-1 min-w-0 flex-1 before:absolute before:-inset-x-0.5 before:-top-4 before:-bottom-2 before:content-['']"
          >
            {/* wider than the segment it belongs to and centred on it, so a
                four-character name is legible over a bar six pixels wide */}
            <span
              className={cn(
                'pointer-events-none absolute bottom-full left-1/2 mb-1 max-w-40 -translate-x-1/2 translate-y-1 transform-gpu truncate text-[10px] leading-none whitespace-nowrap text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 will-change-[opacity,transform] group-hover/segment:translate-y-0 group-hover/segment:opacity-100',
              )}
            >
              {entry.displayName}
            </span>
            <span
              className={cn(
                // scaled rather than grown: height is a layout property, and
                // a card list relaying itself out on every frame of a hover
                // is the one animation here that cannot run on the compositor
                'absolute inset-x-0 bottom-0 h-1 origin-bottom transform-gpu rounded-[2px] transition-[transform,background-color] duration-150 will-change-transform group-hover/segment:scale-y-150',
                SEGMENTS[entry.status],
              )}
            />
          </span>
        ))}
      </div>
    </PageLink>
  )
}

export function BatchCard({ row }: { row: BatchCardRow }) {
  const { format, locale } = useI18n()
  const standing = standingOf(row.status, row.currentPhaseId)
  const starting = row.timeline.find((entry) => entry.entry.kind === 'planned')
  const at = row.timeline.findIndex((entry) => entry.status === 'current')

  // the one thing this card is mostly about: which stage, or when it begins,
  // or that nobody has arranged it yet
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
        : { label: null, value: format(m.noStagesYet) }

  return (
    <li className="group relative flex flex-col gap-4 rounded-xl border bg-background p-5 transition-[color,background-color,border-color,box-shadow] hover:border-foreground/12 hover:bg-muted/10 hover:shadow-xs">
      <div className="flex items-start justify-between gap-3">
        {/* the whole card is the target; the link carries the name so it is
            also reachable by keyboard and readable out of context */}
        <h3 className="min-w-0 text-base leading-snug font-semibold">
          <PageLink
            page="assessment/batch"
            params={{ batchId: row.id }}
            className="before:absolute before:inset-0 before:content-['']"
          >
            {row.name}
          </PageLink>
        </h3>
        <StatusBadge status={row.status} currentPhaseId={row.currentPhaseId} className="shrink-0" />
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <Fact icon={<CalendarRangeIcon />}>
          {format(m.materialWindow, {
            from: row.materialRange.start,
            until: row.materialRange.end,
          })}
        </Fact>
        <Fact icon={<UsersIcon />}>{format(m.enrolled, { count: row.participantCount })}</Fact>
        {row.timeline.length > 0 && (
          <Fact icon={<LayersIcon />}>
            {at === -1
              ? format(m.stageCount, { total: row.timeline.length })
              : format(m.stagePosition, { current: at + 1, total: row.timeline.length })}
          </Fact>
        )}
      </div>

      <div
        className={cn(
          'flex flex-wrap items-end justify-between gap-x-4 gap-y-1 rounded-lg px-3 py-2.5',
          standing === 'active' ? 'bg-emerald-500/8' : 'bg-muted/50',
        )}
      >
        <div className="min-w-0">
          {lead.label !== null && (
            <p className="text-[11px] tracking-wide text-muted-foreground uppercase">
              {lead.label}
            </p>
          )}
          <p className="truncate text-sm font-medium">{lead.value}</p>
        </div>
        {standing === 'active' ? (
          <BatchProgress timeline={row.timeline} className="text-sm" />
        ) : (
          standing === 'draft' && (
            <p className="text-xs text-muted-foreground">{format(m.draftHint)}</p>
          )
        )}
      </div>

      {row.timeline.length > 0 && <StageBar timeline={row.timeline} batchId={row.id} />}

      <p className="mt-auto flex items-center justify-end gap-1 text-sm text-muted-foreground transition-colors group-hover:text-foreground">
        {format(standing === 'draft' ? m.configureBatch : m.enterBatch)}
        <ArrowRightIcon
          aria-hidden
          className="size-3.5 transition-transform group-hover:translate-x-0.5"
        />
      </p>
    </li>
  )
}
