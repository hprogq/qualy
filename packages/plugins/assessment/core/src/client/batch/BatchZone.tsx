import type { ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { useI18n } from '@qualy/web-i18n'
import { tokens } from '@qualy/ui/theme/tokens.stylex'
import { assessmentMessages as m } from '../i18n.ts'
import { BatchZoneContext, deviceDiffers, readableZone, useBatchZone, zoneNameOf } from './zone.ts'

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

/** the zone said the way its reader names it, or nothing outside a batch */
function useZoneLabel(zone: string | undefined): string | null {
  const { format, locale } = useI18n()
  if (zone === undefined) return null
  const { name, offset } = zoneNameOf(zone, locale)
  return name === undefined ? offset : format(m.zoneNamed, { name, offset })
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
  xstyle,
}: {
  purpose?: 'read' | 'enter'
  xstyle?: stylex.StyleXStyles
}) {
  const { format } = useI18n()
  const zone = useBatchZone()
  const label = useZoneLabel(zone)
  if (zone === undefined || label === null) return null
  return (
    <span
      // the zone itself, as the fact the sentence carries
      data-testid="batch-zone"
      data-zone={zone}
      data-device={deviceDiffers(zone) ? 'different' : 'same'}
      {...stylex.props(styles.note, xstyle)}
    >
      {format(purpose === 'enter' ? m.zoneEnter : m.zoneNote, { zone: label })}
    </span>
  )
}

/** said once at the head of a batch screen, and only to a reader elsewhere */
export function ZoneAwayNotice({ xstyle }: { xstyle?: stylex.StyleXStyles }) {
  const { format } = useI18n()
  const zone = useBatchZone()
  const label = useZoneLabel(zone)
  if (!deviceDiffers(zone) || label === null) return null
  return (
    <p data-testid="batch-zone-away" data-zone={zone} {...stylex.props(styles.away, xstyle)}>
      {format(m.zoneAway, { zone: label })}
    </p>
  )
}
