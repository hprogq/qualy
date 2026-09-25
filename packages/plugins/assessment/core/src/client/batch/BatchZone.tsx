import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import {
  BatchZoneContext,
  deviceDiffers,
  deviceEverDiffers,
  readableZone,
  useBatchZone,
  zoneNameOf,
} from './zone.ts'

// The batch's clock, handed down and said out loud.
//
// `BatchZone` is placed by whatever loaded the batch, so every time drawn
// under it is read on the batch's wall (see zone.ts). The two notes say
// which wall that is: one quietly, beside a plan or a time being set, and
// one only for a reader whose device keeps another zone, because for them
// every time on the screen would otherwise be off by the difference.

const styles = stylex.create({
  note: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  away: {
    borderRadius: tokens.radiusMd,
    backgroundColor: `color-mix(in oklab, ${tokens.surfaceMuted} 60%, transparent)`,
    paddingInline: 12,
    paddingBlock: 8,
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    color: tokens.mutedForeground,
  },
})

/**
 * The zone said the way its reader names it, with its offset at `at` (now
 * when no moment is named), or nothing outside a batch.
 */
function useZoneLabel(
  zone: string | undefined,
  at?: number,
): { readonly label: string; readonly offset: string } | null {
  const { format, locale } = useI18n()
  if (zone === undefined) return null
  const { name, offset } = zoneNameOf(zone, locale, at)
  return { label: name === undefined ? offset : format(m.zoneNamed, { name, offset }), offset }
}

/** a moment as a number, or undefined when there is none or it does not parse */
const momentOf = (at: number | string | null | undefined): number | undefined => {
  if (at === null || at === undefined) return undefined
  const moment = new Date(at).getTime()
  return Number.isNaN(moment) ? undefined : moment
}

export function BatchZone({
  zone,
  children,
}: {
  /** the batch's stored zone; unset while the batch is still loading */
  zone: string | null | undefined
  children: ReactNode
}) {
  return (
    <BatchZoneContext.Provider value={readableZone(zone)}>{children}</BatchZoneContext.Provider>
  )
}

/** which zone the times beside it are in: read against, or typed in */
export function ZoneNote({
  purpose = 'read',
  at,
  xstyle,
}: {
  purpose?: 'read' | 'enter'
  /**
   * The one moment the note stands beside, such as the time being typed: its
   * offset is the one said, since a zone that keeps summer time has two. Left
   * out, the offset is today's.
   */
  at?: number | string | null
  xstyle?: stylex.StyleXStyles
}) {
  const { format } = useI18n()
  const zone = useBatchZone()
  const moment = momentOf(at)
  const said = useZoneLabel(zone, moment)
  if (zone === undefined || said === null) return null
  return (
    <span
      // the zone itself, as the fact the sentence carries
      data-testid="batch-zone"
      data-zone={zone}
      data-offset={said.offset}
      data-device={deviceDiffers(zone, moment) ? 'different' : 'same'}
      {...stylex.props(styles.note, xstyle)}
    >
      {format(purpose === 'enter' ? m.zoneEnter : m.zoneNote, { zone: said.label })}
    </span>
  )
}

/**
 * Said once at the head of a batch screen, and only to a reader elsewhere:
 * one whose device reads the batch's times differently at any time of the
 * year, not only today, since the screen shows times from both halves of it.
 */
export function ZoneAwayNotice({ xstyle }: { xstyle?: stylex.StyleXStyles }) {
  const { format } = useI18n()
  const zone = useBatchZone()
  const said = useZoneLabel(zone)
  if (!deviceEverDiffers(zone) || said === null) return null
  return (
    <p data-testid="batch-zone-away" data-zone={zone} {...stylex.props(styles.away, xstyle)}>
      {format(m.zoneAway, { zone: said.label })}
    </p>
  )
}
