import { useState } from 'react'
import * as stylex from '@stylexjs/stylex'
import { ArrowRightIcon, CalendarRangeIcon, LayersIcon, UsersIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { PageLink } from '@qualy/web-runtime'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
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

const styles = stylex.create({
  card: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    borderRadius: `calc(${tokens.radiusLg} + 4px)`,
    borderWidth: 1,
    borderStyle: 'solid',
    borderColor: {
      default: tokens.border,
      ':hover': `color-mix(in oklab, ${tokens.foreground} 12%, transparent)`,
    },
    backgroundColor: {
      default: tokens.background,
      ':hover': `color-mix(in oklab, ${tokens.surfaceMuted} 10%, transparent)`,
    },
    boxShadow: {
      default: '0 0 rgb(0 0 0 / 0)',
      ':hover': '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    },
    padding: 20,
    transitionProperty: 'color, background-color, border-color, box-shadow',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    minWidth: 0,
    fontSize: 16,
    lineHeight: 1.375,
    fontWeight: 600,
  },
  titleLink: {
    '::before': {
      content: '""',
      position: 'absolute',
      inset: 0,
    },
  },
  badgeSeat: {
    flexShrink: 0,
  },
  facts: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: 16,
    rowGap: 4,
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  fact: {
    display: 'flex',
    minWidth: 0,
    alignItems: 'center',
    gap: 6,
  },
  factIcon: {
    display: 'flex',
    flexShrink: 0,
    color: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  truncate: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  band: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    columnGap: 16,
    rowGap: 4,
    borderRadius: tokens.radiusLg,
    paddingInline: 12,
    paddingBlock: 10,
  },
  bandActive: {
    backgroundColor: `color-mix(in oklab, ${tokens.success} 8%, transparent)`,
  },
  bandQuiet: {
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 50%, transparent)`,
  },
  lead: {
    minWidth: 0,
  },
  leadLabel: {
    fontSize: 11,
    letterSpacing: '0.025em',
    color: tokens.mutedForeground,
    textTransform: 'uppercase',
  },
  leadValue: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 14,
    fontWeight: 500,
  },
  progressText: {
    fontSize: 14,
  },
  draftHint: {
    fontSize: 12,
    color: tokens.mutedForeground,
  },
  footer: {
    marginTop: 'auto',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    fontSize: 14,
    color: tokens.mutedForeground,
    transitionProperty: 'color',
  },
  footerNear: {
    color: tokens.foreground,
  },
  arrow: {
    width: 14,
    height: 14,
    transitionProperty: 'transform',
  },
  arrowNudged: {
    transform: 'translateX(2px)',
  },
  stageLink: {
    position: 'relative',
    zIndex: 10,
    display: 'block',
  },
  bar: {
    display: 'flex',
    height: 4,
    alignItems: 'flex-end',
    gap: 4,
  },
  // The strip itself is four pixels tall with four between them, so a
  // pointer crossing it enters and leaves a dozen times on the way: every
  // crossing restarts two transitions, and the flicker that comes of it is
  // what reads as stutter. The hit area is a band around the segment, half
  // the gap wide, so one pass over the bar is one hover.
  segment: {
    position: 'relative',
    height: 4,
    minWidth: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: '0%',
    '::before': {
      content: '""',
      position: 'absolute',
      insetInline: -2,
      top: -16,
      bottom: -8,
    },
  },
  // wider than the segment it belongs to and centred on it, so a
  // four-character name is legible over a bar six pixels wide. The transform
  // is one declaration for both axes: a transition animates only properties
  // it names, and splitting the translate across two would move one axis in
  // a step. No will-change either - switching it on with the hover and off
  // again drops the layer as the way back begins.
  segmentName: {
    pointerEvents: 'none',
    position: 'absolute',
    bottom: '100%',
    left: '50%',
    marginBottom: 4,
    maxWidth: 160,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 10,
    lineHeight: 1,
    color: tokens.mutedForeground,
    opacity: 0,
    transform: 'translate(-50%, 4px)',
    transitionProperty: 'opacity, transform',
    transitionDuration: '200ms',
    transitionTimingFunction: 'ease-out',
  },
  segmentNameShown: {
    opacity: 1,
    transform: 'translate(-50%, 0)',
  },
  // Height rather than a scale: two pixels of growth scaled out of four
  // leaves the rounded ends landing between pixels, and the shimmer of that
  // is worse than the layout this costs - the bar is absolutely positioned,
  // so nothing else moves.
  segmentFill: {
    position: 'absolute',
    insetInline: 0,
    bottom: 0,
    height: 4,
    borderRadius: 2,
    transitionProperty: 'height, background-color',
    transitionDuration: '200ms',
    transitionTimingFunction: 'ease-out',
  },
  fillTall: {
    height: 6,
  },
  fillEnded: {
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 40%, transparent)`,
  },
  fillEndedNear: {
    height: 6,
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 70%, transparent)`,
  },
  fillCurrent: {
    backgroundColor: tokens.success,
  },
  fillFuture: {
    backgroundColor: tokens.surfaceMuted,
  },
  fillFutureNear: {
    height: 6,
    backgroundColor: `color-mix(in oklab, ${tokens.mutedForeground} 30%, transparent)`,
  },
})

const FILLS = {
  ended: styles.fillEnded,
  current: styles.fillCurrent,
  future: styles.fillFuture,
} as const

const NEAR_FILLS = {
  ended: styles.fillEndedNear,
  current: styles.fillTall,
  future: styles.fillFutureNear,
} as const

function Fact({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span {...stylex.props(styles.fact)}>
      <span aria-hidden {...stylex.props(styles.factIcon)}>
        {icon}
      </span>
      <span {...stylex.props(styles.truncate)}>{children}</span>
    </span>
  )
}

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
  // which segment the pointer rests on, held as state rather than asked of a
  // selector: the name and the fill answer to the same crossing
  const [near, setNear] = useState<number | null>(null)
  return (
    // above the card's own overlay so the pointer reaches a segment at all,
    // and a link of its own so that reaching it costs nothing: a strip in the
    // middle of a card that swallows clicks reads as broken
    <PageLink
      page="assessment/batch"
      params={{ batchId }}
      tabIndex={-1}
      aria-hidden
      className={stylex.props(styles.stageLink).className}
    >
      <div {...stylex.props(styles.bar)}>
        {timeline.map((entry, index) => (
          <span
            key={entry.displayName + String(index)}
            {...stylex.props(styles.segment)}
            onMouseEnter={() => setNear(index)}
            onMouseLeave={() => setNear((rested) => (rested === index ? null : rested))}
          >
            <span {...stylex.props(styles.segmentName, near === index && styles.segmentNameShown)}>
              {entry.displayName}
            </span>
            <span
              {...stylex.props(
                styles.segmentFill,
                FILLS[entry.status],
                near === index && NEAR_FILLS[entry.status],
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
  // whether the pointer is anywhere on the card: the footer brightens and
  // its arrow leans with it, and both read that from here rather than from a
  // selector on an ancestor
  const [rested, setRested] = useState(false)

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
    <li
      {...stylex.props(styles.card)}
      onMouseEnter={() => setRested(true)}
      onMouseLeave={() => setRested(false)}
    >
      <div {...stylex.props(styles.header)}>
        {/* the whole card is the target; the link carries the name so it is
            also reachable by keyboard and readable out of context */}
        <h3 {...stylex.props(styles.title)}>
          <PageLink
            page="assessment/batch"
            params={{ batchId: row.id }}
            className={stylex.props(styles.titleLink).className}
          >
            {row.name}
          </PageLink>
        </h3>
        <StatusBadge
          status={row.status}
          currentPhaseId={row.currentPhaseId}
          xstyle={styles.badgeSeat}
        />
      </div>

      <div {...stylex.props(styles.facts)}>
        <Fact icon={<CalendarRangeIcon size={14} />}>
          {format(m.materialWindow, {
            from: row.materialRange.start,
            until: row.materialRange.end,
          })}
        </Fact>
        <Fact icon={<UsersIcon size={14} />}>
          {format(m.enrolled, { count: row.participantCount })}
        </Fact>
        {row.timeline.length > 0 && (
          <Fact icon={<LayersIcon size={14} />}>
            {at === -1
              ? format(m.stageCount, { total: row.timeline.length })
              : format(m.stagePosition, { current: at + 1, total: row.timeline.length })}
          </Fact>
        )}
      </div>

      <div
        {...stylex.props(styles.band, standing === 'active' ? styles.bandActive : styles.bandQuiet)}
      >
        <div {...stylex.props(styles.lead)}>
          {lead.label !== null && <p {...stylex.props(styles.leadLabel)}>{lead.label}</p>}
          <p {...stylex.props(styles.leadValue)}>{lead.value}</p>
        </div>
        {standing === 'active' ? (
          <BatchProgress timeline={row.timeline} xstyle={styles.progressText} />
        ) : (
          standing === 'draft' && <p {...stylex.props(styles.draftHint)}>{format(m.draftHint)}</p>
        )}
      </div>

      {row.timeline.length > 0 && <StageBar timeline={row.timeline} batchId={row.id} />}

      <p {...stylex.props(styles.footer, rested && styles.footerNear)}>
        {format(standing === 'draft' ? m.configureBatch : m.enterBatch)}
        <ArrowRightIcon
          aria-hidden
          className={stylex.props(styles.arrow, rested && styles.arrowNudged).className}
        />
      </p>
    </li>
  )
}
