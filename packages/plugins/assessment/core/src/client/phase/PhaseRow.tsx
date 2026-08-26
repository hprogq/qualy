import { useState, type ReactNode } from 'react'
import {
  CalendarClockIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  PencilIcon,
  Trash2Icon,
} from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { useI18n } from '@qualy/web-i18n'
import { Badge } from '@qualy/ui/badge'
import { Button } from '@qualy/ui/button'
import { TableCell, TableRow } from '@qualy/ui/table'
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

const styles = stylex.create({
  nameRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 10,
  },
  ordinal: {
    display: 'flex',
    width: 24,
    height: 24,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    fontVariantNumeric: 'tabular-nums',
    backgroundColor: tokens.surfaceMuted,
    color: tokens.mutedForeground,
  },
  ordinalCurrent: {
    backgroundColor: tokens.primary,
    color: tokens.primaryForeground,
  },
  nameCol: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
  },
  nameLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 2,
  },
  name: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 500,
  },
  nameAbsent: {
    fontWeight: 400,
    fontStyle: 'italic',
    color: tokens.mutedForeground,
  },
  // faint until the name is pointed at, never far: the row tracks its own
  // hover as state instead of a group-hover selector
  pencil: {
    width: 24,
    height: 24,
    flexShrink: 0,
    color: {
      default: `color-mix(in oklab, ${tokens.mutedForeground} 50%, transparent)`,
      ':hover': tokens.foreground,
    },
  },
  pencilNear: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  pencilGlyph: {
    width: 14,
    height: 14,
  },
  descriptionLine: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  refusals: {
    marginTop: 4,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.danger,
  },
  opensLink: {
    height: 'auto',
    justifyContent: 'flex-start',
    gap: 4,
    padding: 0,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 400,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  chevron: {
    width: 14,
    height: 14,
  },
  whenCol: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
  },
  whenLine: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
  },
  whenQuiet: {
    color: tokens.mutedForeground,
  },
  whenGlyph: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  whenGlyphCurrent: {
    color: tokens.primary,
  },
  whenTime: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontWeight: 500,
  },
  whenRelative: {
    paddingLeft: 20,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  whenWrap: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  scheduleButton: {
    height: 28,
  },
  statusRow: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 6,
  },
  quietAction: {
    color: tokens.mutedForeground,
  },
  removeAction: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.danger,
    },
  },
  quietNote: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  rowCell: {
    height: 64,
    paddingBlock: 8,
  },
  rowEnded: {
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.surfaceMuted} 30%, transparent)`,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
    },
  },
  rowWrong: {
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.danger} 5%, transparent)`,
      ':hover': `color-mix(in oklab, ${tokens.danger} 5%, transparent)`,
    },
  },
  card: {
    borderRadius: tokens.radiusLg,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: tokens.border,
    backgroundColor: tokens.background,
  },
  cardEnded: {
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 30%, transparent)`,
  },
  cardWrong: {
    borderColor: tokens.danger,
    backgroundColor: `color-mix(in oklab, ${tokens.danger} 5%, transparent)`,
  },
  cardHead: {
    padding: 12,
  },
  cardFacts: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    padding: 12,
  },
  cardFoot: {
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.border,
    paddingInline: 12,
    paddingBlock: 8,
  },
  cardLine: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardLineLabel: {
    flexShrink: 0,
    paddingTop: 1,
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  cardLineBody: {
    minWidth: 0,
    textAlign: 'right',
  },
})

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
  const [nameNear, setNameNear] = useState(false)
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
    <div {...stylex.props(styles.nameRow)}>
      <span {...stylex.props(styles.ordinal, current && styles.ordinalCurrent)}>{index + 1}</span>
      <div {...stylex.props(styles.nameCol)}>
        <p
          {...stylex.props(styles.nameLine)}
          onMouseEnter={() => setNameNear(true)}
          onMouseLeave={() => setNameNear(false)}
        >
          <span {...stylex.props(styles.name)}>
            {draft.displayName || <span {...stylex.props(styles.nameAbsent)}>{name}</span>}
          </span>
          {/* right where the name ends: faint until wanted, never far */}
          {!readOnly && (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={format(m.editDetails)}
              title={format(m.editDetails)}
              className={stylex.props(styles.pencil, nameNear && styles.pencilNear).className}
              onClick={props.onDetails}
            >
              <PencilIcon aria-hidden className={stylex.props(styles.pencilGlyph).className} />
            </Button>
          )}
        </p>
        {draft.description !== '' && (
          <p {...stylex.props(styles.descriptionLine)}>{draft.description}</p>
        )}
        {props.refusals.length > 0 && (
          <ul {...stylex.props(styles.refusals)}>
            {props.refusals.map((refusal, at) => (
              // the ground it was refused on, beside the sentence that says
              // it: which refusal landed on which stage is the fact
              <li key={at} data-testid="phase-refusal" data-reason={refusal.reason}>
                {props.sentenceOf(refusal)}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )

  const opens = (
    <Button
      variant="link"
      className={stylex.props(styles.opensLink).className}
      onClick={props.onOpens}
    >
      {format(m.opensCount, { count: draft.permissionProfile.length })}
      <ChevronRightIcon aria-hidden className={stylex.props(styles.chevron).className} />
    </Button>
  )

  const when =
    entered !== null ? (
      <span data-testid="phase-when" data-when="entered" {...stylex.props(styles.whenCol)}>
        <span {...stylex.props(styles.whenLine)}>
          <CircleCheckIcon
            aria-hidden
            {...stylex.props(styles.whenGlyph, current && styles.whenGlyphCurrent)}
          />
          <span {...stylex.props(styles.whenTime)}>{timeOf(entered)}</span>
        </span>
        <span {...stylex.props(styles.whenRelative)}>{relative(entered)}</span>
      </span>
    ) : planned !== null ? (
      <span data-testid="phase-when" data-when="planned" {...stylex.props(styles.whenCol)}>
        <span {...stylex.props(styles.whenLine)}>
          <CalendarClockIcon aria-hidden {...stylex.props(styles.whenGlyph)} />
          <span {...stylex.props(styles.whenTime)}>{timeOf(planned)}</span>
        </span>
        <span {...stylex.props(styles.whenRelative)}>{relative(planned)}</span>
      </span>
    ) : (
      <span data-testid="phase-when" data-when="unscheduled" {...stylex.props(styles.whenWrap)}>
        <span {...stylex.props(styles.whenLine, styles.whenQuiet)}>
          <CircleDashedIcon aria-hidden {...stylex.props(styles.whenGlyph)} />
          {format(m.notScheduled)}
        </span>
        {!readOnly && !editing && index === shape.frontier && (
          <Button
            data-testid="phase-schedule"
            size="sm"
            variant="outline"
            className={stylex.props(styles.scheduleButton).className}
            onClick={props.onSchedule}
          >
            {format(m.goSchedule)}
          </Button>
        )}
      </span>
    )

  const status = (
    <div
      // which standing this stage is in, said as a fact: the badges' words
      // are copy, "this stage is the current one" is not
      data-testid="phase-standing"
      data-standing={
        current ? 'current' : ended ? 'ended' : isNew ? 'new' : structural ? 'open' : 'locked'
      }
      {...stylex.props(styles.statusRow)}
    >
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
          className={stylex.props(styles.quietAction).className}
          onClick={props.onUnschedule}
        >
          {format(m.unschedule)}
        </Button>
      )}
      {!readOnly && !editing && structural && (
        <span {...stylex.props(styles.quietNote)}>
          {format(index === shape.frontier ? m.upNextBadge : m.awaitingEarlier)}
        </span>
      )}

      {editing && structural && (
        <>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={format(m.moveUp)}
            className={stylex.props(styles.quietAction).className}
            disabled={index === shape.scheduled}
            onClick={() => props.onMove(-1)}
          >
            ↑
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={format(m.moveDown)}
            className={stylex.props(styles.quietAction).className}
            disabled={index === total - 1}
            onClick={() => props.onMove(1)}
          >
            ↓
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label={format(m.removePhase)}
            className={stylex.props(styles.removeAction).className}
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
    <TableRow xstyle={[ended && styles.rowEnded, wrong && styles.rowWrong]}>
      <TableCell xstyle={styles.rowCell}>{stage}</TableCell>
      <TableCell xstyle={styles.rowCell}>{opens}</TableCell>
      <TableCell xstyle={styles.rowCell}>{when}</TableCell>
      <TableCell xstyle={styles.rowCell}>{status}</TableCell>
    </TableRow>
  )
}

/** the same row where there is no room for columns */
export function PhaseCard(props: PhaseRowProps) {
  const { format } = useI18n()
  const { stage, opens, when, status, ended, wrong } = useParts(props)
  const line = (label: string, body: ReactNode) => (
    <div {...stylex.props(styles.cardLine)}>
      <span {...stylex.props(styles.cardLineLabel)}>{label}</span>
      <div {...stylex.props(styles.cardLineBody)}>{body}</div>
    </div>
  )
  return (
    <li {...stylex.props(styles.card, ended && styles.cardEnded, wrong && styles.cardWrong)}>
      <div {...stylex.props(styles.cardHead)}>{stage}</div>
      <div {...stylex.props(styles.cardFacts)}>
        {line(format(m.colPlannedStart), when)}
        {line(format(m.colOpens), opens)}
      </div>
      <div {...stylex.props(styles.cardFoot)}>{status}</div>
    </li>
  )
}
