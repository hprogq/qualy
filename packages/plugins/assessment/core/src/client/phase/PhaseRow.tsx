import { useLocale, useList } from '@qualy/web-i18n'
import { useId, type ReactNode } from 'react'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarClockIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  Trash2Icon,
} from 'lucide-react'
import * as stylex from '@stylexjs/stylex'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import { Button } from '@qualy/ui/button'
import { Cell, Status, Tag, TableRow } from '@qualy/ui/screen'

import { type PlanRefusalLike } from '../refusals.ts'
import { type PhaseDraft, type PhaseDto, type PlanShape } from './model.ts'
import { inZone, useBatchZone } from '../batch/zone.ts'
import * as m from '#messages'

// One phase, as a table row on a desktop and as a stacked card on a phone.
//
// Both render the same facts - what the phase is and what it is for, what it
// opens, when it begins, where it stands - and offer the same actions, which
// the plan's shape decides: only the first unscheduled phase may take a time,
// only the last scheduled one may give it back, and only the unscheduled
// suffix may still be reordered. The whole row opens the phase's details.

const styles = stylex.create({
  nameRow: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    alignItems: 'center',
    gap: 10,
  },
  ordinal: {
    display: 'flex',
    width: 22,
    height: 22,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    fontSize: 11.5,
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
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    flexDirection: 'column',
    gap: 2,
  },
  // the tags keep whole words and take a line of their own when the column
  // is too narrow for them beside the prose, rather than being cut off at
  // the column's edge
  nameLine: {
    display: 'flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: 6,
    rowGap: 4,
    margin: 0,
  },
  // a stage is told apart by its name, most of all while the plan is being
  // reordered and the column is at its narrowest: two lines before any of
  // it gives way, and the whole of it on a pointer's rest
  name: {
    display: '-webkit-box',
    minWidth: 0,
    overflow: 'hidden',
    overflowWrap: 'anywhere',
    whiteSpace: 'normal',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    fontSize: 13.5,
    lineHeight: 1.45,
    fontWeight: 500,
    color: tokens.foreground,
  },
  nameAbsent: {
    fontWeight: 400,
    fontStyle: 'italic',
    color: tokens.mutedForeground,
  },
  tags: {
    display: 'inline-flex',
    minWidth: 0,
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  descriptionLine: {
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '8rem',
    margin: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 12,
    lineHeight: 1.45,
    color: tokens.mutedForeground,
  },
  refusals: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    margin: 0,
    marginTop: 2,
    paddingInlineStart: 0,
    listStyleType: 'none',
    whiteSpace: 'normal',
    fontSize: 12,
    lineHeight: 1.45,
    color: tokens.danger,
  },
  // the column gives up room to the name and the time while an edit adds
  // its controls, so what the stage opens takes a second line rather than
  // losing its end
  opens: {
    display: '-webkit-box',
    overflow: 'hidden',
    whiteSpace: 'normal',
    WebkitBoxOrient: 'vertical',
    WebkitLineClamp: 2,
    fontVariantNumeric: 'tabular-nums',
  },
  whenRow: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
  },
  whenCol: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    gap: 1,
  },
  whenLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
    fontSize: 12.5,
    color: tokens.foreground,
  },
  whenQuiet: {
    color: tokens.mutedForeground,
  },
  whenGlyph: {
    width: 13,
    height: 13,
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
    fontVariantNumeric: 'tabular-nums',
  },
  whenRelative: {
    paddingInlineStart: 19,
    fontSize: 11.5,
    color: tokens.mutedForeground,
  },
  whenNote: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  whenRelativeRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 10,
  },
  // a stage whose name and its standing are both worth saying: the one it is
  // in, and that it has an edit not saved yet, under it rather than instead
  standing: {
    display: 'flex',
    minWidth: 0,
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 3,
  },
  inlineAction: {
    flexShrink: 0,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    fontSize: 11.5,
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
    textDecorationLine: 'underline',
    textDecorationColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
    textUnderlineOffset: 2,
    cursor: 'pointer',
  },
  rowAction: {
    height: 26,
    flexShrink: 0,
    paddingInline: 8,
    fontSize: 12,
  },
  quietAction: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.foreground,
    },
  },
  removeAction: {
    color: {
      default: tokens.mutedForeground,
      ':hover': tokens.danger,
    },
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 2,
  },
  glyph: {
    width: 15,
    height: 15,
  },
  row: {
    paddingBlock: 10,
  },
  leadStack: {
    display: 'flex',
    minWidth: 0,
    flexGrow: 1,
    flexDirection: 'column',
    gap: 2,
  },
  cardRefusals: {
    paddingInline: 14,
    paddingBottom: 10,
  },
  rowEnded: {
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.surfaceMuted} 28%, transparent)`,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 55%, transparent)`,
    },
  },
  rowWrong: {
    backgroundColor: {
      default: `color-mix(in oklab, ${tokens.danger} 5%, transparent)`,
      ':hover': `color-mix(in oklab, ${tokens.danger} 8%, transparent)`,
    },
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    borderRadius: 14,
    backgroundColor: tokens.surface,
    boxShadow: `0 0 0 1px ${tokens.border}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  cardEnded: {
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 28%, ${tokens.surface})`,
  },
  cardWrong: {
    boxShadow: `0 0 0 1px ${tokens.danger}, 0 1px 2px rgb(0 0 0 / 0.04)`,
  },
  cardHead: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 8,
    width: '100%',
    margin: 0,
    paddingInline: 14,
    paddingBlock: 12,
    borderWidth: 0,
    backgroundColor: 'transparent',
    fontFamily: 'inherit',
    textAlign: 'start',
    color: 'inherit',
    cursor: 'pointer',
  },
  cardChevron: {
    width: 14,
    height: 14,
    flexShrink: 0,
    color: tokens.mutedForeground,
  },
  cardFacts: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingInline: 14,
    paddingBlock: 10,
  },
  cardLine: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    fontSize: 12.5,
  },
  cardLineLabel: {
    flexShrink: 0,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  cardLineBody: {
    display: 'flex',
    minWidth: 0,
    justifyContent: 'flex-end',
    color: tokens.mutedForeground,
  },
  cardFoot: {
    display: 'flex',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    borderTopWidth: 1,
    borderTopStyle: 'solid',
    borderTopColor: tokens.divider,
    paddingInline: 14,
    paddingBlock: 4,
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
  /** the row says something the server does not hold yet */
  unsaved: boolean
  /** the titles of the items the row alone opens, in paper order */
  scopeTitles: readonly string[]
  refusals: readonly PlanRefusalLike[]
  sentenceOf: (refusal: PlanRefusalLike) => string
  onDetails: () => void
  onSchedule: () => void
  onUnschedule: () => void
  onMove: (by: number) => void
  onRemove: () => void
}

/** the parts a row and a card both show, so neither can drift from the other */
function useParts(props: PhaseRowProps) {
  const locale = useLocale()
  const listOf = useList()
  const zone = useBatchZone()
  const { draft, phase, index, shape, total, editing, readOnly } = props
  // what the row is called is its stage's name; what it says about the
  // stage - where it stands, when it runs, what it is limited to, what was
  // refused - is read after it rather than instead of it
  const base = useId()
  const ids = {
    name: `${base}-name`,
    standing: `${base}-standing`,
    when: `${base}-when`,
    scope: `${base}-scope`,
    scopeNames: `${base}-scope-names`,
    refused: `${base}-refused`,
  }
  const entered = phase?.actualEntryAt ?? null
  const planned = phase?.plannedEntryAt ?? null
  const current = index === shape.currentIndex
  const ended = index < shape.currentIndex
  const isNew = draft.id === undefined
  /** past the scheduled prefix, where structure is still free */
  const structural = index >= shape.scheduled
  const name = draft.displayName || m.plan_unnamed()
  // on the batch's clock: a stage starts at the school's midnight, not the reader's
  const timeOf = (iso: string) =>
    new Date(iso).toLocaleString(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      ...inZone(zone),
    })
  const relative = (iso: string) => {
    const parts = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const delta = new Date(iso).getTime() - Date.now()
    const abs = Math.abs(delta)
    if (abs < 60_000) return m.plan_justNow()
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

  const itemsLimited = draft.itemScope.length > 0
  const peopleLimited = draft.participantScope.length > 0
  const named = props.scopeTitles.length > 0 ? listOf(props.scopeTitles) : undefined
  const scope = (itemsLimited || peopleLimited) && (
    <span
      id={ids.scope}
      // what the stage narrows filing to, said as facts: how many items, and
      // whether it admits only some of the roster
      data-testid="phase-scope"
      data-items={String(draft.itemScope.length)}
      data-people={peopleLimited ? 'limited' : 'all'}
      title={named}
      {...stylex.props(styles.tags)}
    >
      {itemsLimited && <Tag>{m.plan_scopeItemsTag({ count: draft.itemScope.length })}</Tag>}
      {peopleLimited && <Tag>{m.plan_scopePeopleTag()}</Tag>}
      {/* the names a pointer reads by resting on the tags, for a reader
          with no pointer to rest; the panel the row opens lists them too.
          Hidden text is read into a description only when the description
          names it itself, not when it sits inside something named, so the
          names are their own node and the row points at them directly */}
      {named !== undefined && (
        <span id={ids.scopeNames} hidden>
          {named}
        </span>
      )}
    </span>
  )

  const stage = (
    <span {...stylex.props(styles.nameRow)}>
      <span {...stylex.props(styles.ordinal, current && styles.ordinalCurrent)}>{index + 1}</span>
      <span {...stylex.props(styles.nameCol)}>
        <span
          id={ids.name}
          title={name}
          data-slot="phase-name"
          {...stylex.props(styles.name, draft.displayName === '' && styles.nameAbsent)}
        >
          {name}
        </span>
        {/* the name has its line to itself; what the stage is limited to
            leads the line under it, ahead of the prose that gives way first */}
        {(scope || draft.description !== '') && (
          <span {...stylex.props(styles.nameLine)}>
            {scope}
            {draft.description !== '' && (
              <span {...stylex.props(styles.descriptionLine)}>{draft.description}</span>
            )}
          </span>
        )}
      </span>
    </span>
  )

  const refused = props.refusals.length > 0 && (
    <ul id={ids.refused} {...stylex.props(styles.refusals)}>
      {props.refusals.map((refusal, at) => (
        // the ground it was refused on, beside the sentence that says it:
        // which refusal landed on which stage is the fact
        <li key={at} data-testid="phase-refusal" data-reason={refusal.reason}>
          {props.sentenceOf(refusal)}
        </li>
      ))}
    </ul>
  )

  const opens = (
    <span data-slot="phase-opens" {...stylex.props(styles.opens)}>
      {m.phase_opensCount({ count: draft.permissionProfile.length })}
    </span>
  )

  // under the time it takes back, on the line that says how far off it is:
  // beside the time it cut the time short wherever the column was narrow
  const unschedule = !readOnly && !editing && index === shape.tail && (
    <button type="button" onClick={props.onUnschedule} {...stylex.props(styles.inlineAction)}>
      {m.schedule_unschedule()}
    </button>
  )

  // a stage further down than the one that may take a time next has no way
  // to take one yet; said where the time would be, since the button that
  // the row above has is exactly what this one lacks
  const waiting = !readOnly && !editing && shape.frontier !== -1 && index > shape.frontier && !isNew

  const when =
    entered !== null ? (
      <span
        id={ids.when}
        data-testid="phase-when"
        data-when="entered"
        {...stylex.props(styles.whenCol)}
      >
        <span {...stylex.props(styles.whenLine)}>
          <CircleCheckIcon
            aria-hidden
            {...stylex.props(styles.whenGlyph, current && styles.whenGlyphCurrent)}
          />
          <span data-slot="phase-time" {...stylex.props(styles.whenTime)}>
            {timeOf(entered)}
          </span>
        </span>
        <span {...stylex.props(styles.whenRelative)}>{relative(entered)}</span>
      </span>
    ) : planned !== null ? (
      <span
        id={ids.when}
        data-testid="phase-when"
        data-when="planned"
        {...stylex.props(styles.whenCol)}
      >
        <span {...stylex.props(styles.whenLine)}>
          <CalendarClockIcon aria-hidden {...stylex.props(styles.whenGlyph)} />
          <span data-slot="phase-time" {...stylex.props(styles.whenTime)}>
            {timeOf(planned)}
          </span>
        </span>
        <span {...stylex.props(styles.whenRelative, styles.whenRelativeRow)}>
          {relative(planned)}
          {unschedule}
        </span>
      </span>
    ) : (
      <span {...stylex.props(styles.whenRow)}>
        <span
          id={ids.when}
          data-testid="phase-when"
          data-when="unscheduled"
          data-waits={waiting ? 'earlier' : undefined}
          {...stylex.props(styles.whenCol)}
        >
          <span {...stylex.props(styles.whenLine, styles.whenQuiet)}>
            <CircleDashedIcon aria-hidden {...stylex.props(styles.whenGlyph)} />
            {m.plan_notScheduled()}
          </span>
          {/* what participants are told it waits on, where its time will be;
              without one, what the administrator has to do first */}
          {draft.entryNote !== '' ? (
            <span title={draft.entryNote} {...stylex.props(styles.whenRelative, styles.whenNote)}>
              {draft.entryNote}
            </span>
          ) : (
            waiting && (
              <span {...stylex.props(styles.whenRelative, styles.whenNote)}>
                {m.plan_waitsForEarlier()}
              </span>
            )
          )}
        </span>
        {!readOnly && !editing && index === shape.frontier && (
          <Button
            data-testid="phase-schedule"
            size="sm"
            variant="outline"
            className={stylex.props(styles.rowAction).className}
            onClick={props.onSchedule}
          >
            {m.schedule_go()}
          </Button>
        )}
      </span>
    )

  const standing = current
    ? 'current'
    : ended
      ? 'ended'
      : isNew
        ? 'new'
        : structural
          ? 'open'
          : 'locked'
  const status = (
    <span
      id={ids.standing}
      // which standing this stage is in, said as a fact: the word beside the
      // dot is copy, "this stage is the current one" is not
      data-testid="phase-standing"
      data-standing={standing}
      data-unsaved={props.unsaved}
      {...stylex.props(styles.standing)}
    >
      {current ? (
        <Status tone="ok">{m.flow_statusCurrent()}</Status>
      ) : (
        <Status>{(ended ? m.flow_statusEnded : m.flow_statusFuture)()}</Status>
      )}
      {props.unsaved && <Status tone="warn">{m.plan_newBadge()}</Status>}
    </span>
  )

  const actions = editing && structural && !readOnly && (
    <span {...stylex.props(styles.actions)}>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={m.plan_moveUp()}
        title={m.plan_moveUp()}
        className={stylex.props(styles.quietAction).className}
        disabled={index === shape.scheduled}
        onClick={() => props.onMove(-1)}
      >
        <ArrowUpIcon aria-hidden {...stylex.props(styles.glyph)} />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={m.plan_moveDown()}
        title={m.plan_moveDown()}
        className={stylex.props(styles.quietAction).className}
        disabled={index === total - 1}
        onClick={() => props.onMove(1)}
      >
        <ArrowDownIcon aria-hidden {...stylex.props(styles.glyph)} />
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label={m.phase_remove()}
        title={m.phase_remove()}
        className={stylex.props(styles.removeAction).className}
        onClick={props.onRemove}
      >
        <Trash2Icon aria-hidden {...stylex.props(styles.glyph)} />
      </Button>
    </span>
  )

  const described = [
    ids.standing,
    ids.when,
    ...(scope ? [ids.scope] : []),
    ...(scope && named !== undefined ? [ids.scopeNames] : []),
    ...(refused ? [ids.refused] : []),
  ].join(' ')

  return {
    ids,
    described,
    stage,
    refused,
    opens,
    when,
    status,
    actions,
    ended,
    wrong: props.refusals.length > 0,
  }
}

export function PhaseRow(props: PhaseRowProps) {
  const { ids, described, stage, refused, opens, when, status, actions, ended, wrong } =
    useParts(props)
  return (
    <TableRow
      nested
      onOpen={props.onDetails}
      aria-labelledby={ids.name}
      aria-describedby={described}
      data-testid="phase-row"
      data-phase-key={props.draft.phaseKey}
      xstyle={[styles.row, ended && styles.rowEnded, wrong && styles.rowWrong]}
    >
      <Cell lead>
        <span {...stylex.props(styles.leadStack)}>
          {stage}
          {refused}
        </span>
      </Cell>
      <Cell>{opens}</Cell>
      <Cell>{when}</Cell>
      <Cell>{status}</Cell>
      {props.editing && <Cell end>{actions}</Cell>}
    </TableRow>
  )
}

/** the same row where there is no room for columns */
export function PhaseCard(props: PhaseRowProps) {
  const { ids, described, stage, refused, opens, when, status, actions, ended, wrong } =
    useParts(props)
  const line = (label: string, body: ReactNode) => (
    <div {...stylex.props(styles.cardLine)}>
      <span {...stylex.props(styles.cardLineLabel)}>{label}</span>
      <div {...stylex.props(styles.cardLineBody)}>{body}</div>
    </div>
  )
  return (
    <li
      data-testid="phase-row"
      data-phase-key={props.draft.phaseKey}
      {...stylex.props(styles.card, ended && styles.cardEnded, wrong && styles.cardWrong)}
    >
      <button
        type="button"
        aria-labelledby={ids.name}
        aria-describedby={described}
        onClick={props.onDetails}
        {...stylex.props(styles.cardHead)}
      >
        {stage}
        <ChevronRightIcon aria-hidden {...stylex.props(styles.cardChevron)} />
      </button>
      {refused && <div {...stylex.props(styles.cardRefusals)}>{refused}</div>}
      <div {...stylex.props(styles.cardFacts)}>
        {line(m.plan_colStart(), when)}
        {line(m.plan_colOpens(), opens)}
      </div>
      <div {...stylex.props(styles.cardFoot)}>
        {status}
        {actions}
      </div>
    </li>
  )
}
