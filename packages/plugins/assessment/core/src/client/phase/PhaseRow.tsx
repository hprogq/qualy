import type { ReactNode } from 'react'
import {
  CalendarClockIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { TableCell, TableRow } from '@qualy/ui/table'
import { cn } from '@qualy/ui/cn'
import { assessmentMessages as m } from '../i18n.ts'
import type { PlanRefusalLike } from '../refusals.ts'
import type { PhaseDraft, PhaseDto, PlanShape } from './model.ts'

// One phase, as a table row on a desktop and as a stacked card on a phone.
//
// Both render the same four facts - what the phase is, what it opens, when it
// begins, where it stands - and offer the same actions, which the plan's
// shape decides: only the first unscheduled phase may take a time, only the
// last scheduled one may give it back, and only the unscheduled suffix may
// still be reordered.

export interface PhaseRowProps {
  draft: PhaseDraft
  /** the stored phase, absent while the row is a local addition */
  phase: PhaseDto | undefined
  index: number
  shape: PlanShape
  total: number
  editing: boolean
  readOnly: boolean
  refusals: readonly PlanRefusalLike[]
  sentenceOf: (refusal: PlanRefusalLike) => string
  onOpens: () => void
  onDetails: () => void
  onSchedule: () => void
  onUnschedule: () => void
  onMove: (by: number) => void
  onRemove: () => void
}

/** the parts a row and a card both show, so neither can drift from the other */
function useParts(props: PhaseRowProps) {
  const { format, locale } = useI18n()
  const { draft, phase, index, shape, total, editing, readOnly } = props
  const entered = phase?.actualEntryAt ?? null
  const planned = phase?.plannedEntryAt ?? null
  const current = index === shape.currentIndex
  const ended = index < shape.currentIndex
  const isNew = draft.id === undefined
  /** past the scheduled prefix, where structure is still free */
  const structural = index >= shape.scheduled
  const name = draft.displayName || format(m.unnamedSegment)
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })
  const relative = (iso: string) => {
    const parts = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const delta = new Date(iso).getTime() - Date.now()
    const abs = Math.abs(delta)
    if (abs < 60_000) return format(m.justNow)
    const [unit, size]: [Intl.RelativeTimeFormatUnit, number] =
      abs < 3_600_000
        ? ['minute', 60_000]
        : abs < 86_400_000
          ? ['hour', 3_600_000]
          : abs < 2_592_000_000
            ? ['day', 86_400_000]
            : ['month', 2_592_000_000]
    return parts.format(Math.round(delta / size), unit)
  }

  const stage = (
    <div className="group/name flex min-w-0 items-center gap-2.5">
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium tabular-nums',
          current ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground',
        )}
      >
        {index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-0.5">
          <span className="truncate text-sm font-medium">
            {draft.displayName || (
              <span className="font-normal text-muted-foreground italic">{name}</span>
            )}
          </span>
          {/* right where the name ends: faint until wanted, never far */}
          {!readOnly && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={format(m.editDetails)}
              title={format(m.editDetails)}
              className="size-6 shrink-0 text-muted-foreground/50 transition-colors group-hover/name:text-muted-foreground hover:text-foreground"
              onClick={props.onDetails}
            >
              <PencilIcon aria-hidden className="size-3.5" />
            </Button>
          )}
        </p>
        {draft.description !== '' && (
          <p className="truncate text-xs text-muted-foreground">{draft.description}</p>
        )}
        {props.refusals.length > 0 && (
          <ul className="mt-1 space-y-0.5 text-xs text-destructive">
            {props.refusals.map((refusal, at) => (
              <li key={at}>{props.sentenceOf(refusal)}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )

  const opens = (
    <Button
      variant="link"
      className="h-auto justify-start gap-1 p-0 text-sm font-normal text-muted-foreground has-[>svg]:px-0 hover:text-foreground"
      onClick={props.onOpens}
    >
      {format(m.opensCount, { count: draft.permissionProfile.length })}
      <ChevronRightIcon aria-hidden className="size-3.5" />
    </Button>
  )

  const when =
    entered !== null ? (
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 text-sm">
          <CircleCheckIcon
            aria-hidden
            className={cn('size-3.5 shrink-0', current ? 'text-primary' : 'text-muted-foreground')}
          />
          <span className="truncate font-medium">{timeOf(entered)}</span>
        </span>
        <span className="pl-5 text-xs text-muted-foreground">{relative(entered)}</span>
      </span>
    ) : planned !== null ? (
      <span className="flex min-w-0 flex-col">
        <span className="flex items-center gap-1.5 text-sm">
          <CalendarClockIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{timeOf(planned)}</span>
        </span>
        <span className="pl-5 text-xs text-muted-foreground">{relative(planned)}</span>
      </span>
    ) : (
      <span className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <CircleDashedIcon aria-hidden className="size-3.5 shrink-0" />
          {format(m.notScheduled)}
        </span>
        {!readOnly && !editing && index === shape.frontier && (
          <Button size="sm" variant="outline" className="h-7" onClick={props.onSchedule}>
            {format(m.goSchedule)}
          </Button>
        )}
      </span>
    )

  const status = (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {current ? (
        <Badge>{format(m.currentBadge)}</Badge>
      ) : ended ? (
        <Badge variant="secondary">{format(m.endedBadge)}</Badge>
      ) : isNew ? (
        <Badge variant="outline">{format(m.newBadge)}</Badge>
      ) : !structural ? (
        <Badge variant="outline">{format(m.lockedBySchedule)}</Badge>
      ) : null}

      {!readOnly && !editing && index === shape.tail && (
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={props.onUnschedule}
        >
          {format(m.unschedule)}
        </Button>
      )}
      {!readOnly && !editing && structural && (
        <span className="text-xs text-muted-foreground">
          {format(index === shape.frontier ? m.upNextBadge : m.awaitingEarlier)}
        </span>
      )}

      {editing && structural && (
        <>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={format(m.moveUp)}
            className="text-muted-foreground"
            disabled={index === shape.scheduled}
            onClick={() => props.onMove(-1)}
          >
            ↑
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={format(m.moveDown)}
            className="text-muted-foreground"
            disabled={index === total - 1}
            onClick={() => props.onMove(1)}
          >
            ↓
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={format(m.removePhase)}
            className="text-muted-foreground hover:text-destructive"
            onClick={props.onRemove}
          >
            <Trash2Icon aria-hidden />
          </Button>
        </>
      )}
    </div>
  )

  return { stage, opens, when, status, ended, wrong: props.refusals.length > 0 }
}

export function PhaseRow(props: PhaseRowProps) {
  const { stage, opens, when, status, ended, wrong } = useParts(props)
  return (
    <TableRow className={cn(ended && 'bg-muted/30', wrong && 'bg-destructive/5')}>
      <TableCell className="h-16 py-2">{stage}</TableCell>
      <TableCell className="h-16 py-2">{opens}</TableCell>
      <TableCell className="h-16 py-2">{when}</TableCell>
      <TableCell className="h-16 py-2">{status}</TableCell>
    </TableRow>
  )
}

/** the same row where there is no room for columns */
export function PhaseCard(props: PhaseRowProps) {
  const { format } = useI18n()
  const { stage, opens, when, status, ended, wrong } = useParts(props)
  const line = (label: string, body: ReactNode) => (
    <div className="flex items-start justify-between gap-3">
      <span className="shrink-0 pt-px text-xs text-muted-foreground">{label}</span>
      <div className="min-w-0 text-right">{body}</div>
    </div>
  )
  return (
    <li
      className={cn(
        'rounded-lg border bg-background',
        ended && 'bg-muted/30',
        wrong && 'border-destructive bg-destructive/5',
      )}
    >
      <div className="p-3">{stage}</div>
      <div className="space-y-2 border-t p-3">
        {line(format(m.colPlannedStart), when)}
        {line(format(m.colOpens), opens)}
      </div>
      <div className="border-t px-3 py-2">{status}</div>
    </li>
  )
}
