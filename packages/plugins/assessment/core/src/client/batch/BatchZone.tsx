import { formatDateTime, useLocale } from '@qualy/web-i18n'
import { useEffect, useRef, type ReactNode } from 'react'
import * as stylex from '@stylexjs/stylex'
import { toast } from '@qualy/ui/toast'
import { Tooltip, TooltipContent, TooltipTrigger } from '@qualy/ui/tooltip'
import { tokens } from '@qualy/ui/theme/tokens.stylex'

import {
  BatchZoneContext,
  deviceDiffers,
  deviceEverDiffers,
  readableZone,
  useBatchZone,
  zoneNameOf,
} from './zone.ts'
import { useHydrating } from '@qualy/web-runtime'
import * as m from '#messages'

// The batch's clock, handed down and said out loud.
//
// `BatchZone` is placed by whatever loaded the batch, so every time drawn
// under it is read on the batch's wall (see zone.ts). Plan and schedule
// notes name the clock; a local-time tooltip can show the same instant on
// the device's clock.

const styles = stylex.create({
  note: {
    fontSize: '0.75rem',
    lineHeight: '1rem',
    color: tokens.mutedForeground,
  },
  localTime: {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dashed',
    textDecorationColor: tokens.mutedForeground,
    textUnderlineOffset: '0.22em',
  },
})

/**
 * The zone said the way its reader names it, with its offset at `at` (now
 * when no moment is named), or nothing outside a batch.
 */
export function useZoneLabel(
  zone: string | undefined,
  at?: number,
  showOffset = true,
): { readonly label: string; readonly offset?: string } | null {
  const locale = useLocale()
  return zone === undefined ? null : zoneLabelOf(zone, locale, at, showOffset)
}

function zoneLabelOf(zone: string, locale: string, at?: number, showOffset = true) {
  const { name, offset } = zoneNameOf(zone, locale, at)
  if (!showOffset) return { label: name ?? zone }
  return { label: name === undefined ? offset : m.zone_named({ name, offset }), offset }
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
   * out, an input names only its zone; a plan uses today's offset.
   */
  at?: number | string | null
  xstyle?: stylex.StyleXStyles
}) {
  const zone = useBatchZone()
  const moment = momentOf(at)
  const said = useZoneLabel(zone, moment, purpose === 'read' || moment !== undefined)
  // the device is the browser's to say, never the server's that drew the page
  const hydrating = useHydrating()
  if (zone === undefined || said === null) return null
  return (
    <span
      // the zone itself, as the fact the sentence carries
      data-testid="batch-zone"
      data-zone={zone}
      data-offset={said.offset}
      data-device={!hydrating && deviceDiffers(zone, moment) ? 'different' : 'same'}
      {...stylex.props(styles.note, xstyle)}
    >
      {(purpose === 'enter' ? m.zone_enter : m.zone_note)({ zone: said.label })}
    </span>
  )
}

/**
 * Keep the batch time in the layout. Only the decoration and its tooltip
 * depend on the device, so they can be enabled after hydration without
 * changing the text or the width of the cell.
 */
export function BatchLocalTime({
  at,
  until,
  zone,
  children,
}: {
  at: number | string
  until?: number | null
  zone?: string | null | undefined
  children: ReactNode
}) {
  const batchZone = useBatchZone()
  const locale = useLocale()
  const hydrating = useHydrating()
  const moment = momentOf(at)
  const end = momentOf(until)
  const clock = zone === undefined ? batchZone : readableZone(zone)
  const different =
    !hydrating &&
    moment !== undefined &&
    (deviceDiffers(clock, moment) || (end !== undefined && deviceDiffers(clock, end)))

  // No tooltip is mounted for matching offsets, or before the device is known.
  const trigger = (
    <span
      data-local-time={different ? '' : undefined}
      tabIndex={different ? 0 : undefined}
      {...stylex.props(different && styles.localTime)}
    >
      {children}
    </span>
  )
  if (!different) return trigger

  const local = (at: number) => formatDateTime(new Date(at), locale, 'date-time')
  return (
    <Tooltip>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent>
        {end === undefined
          ? m.zone_localTime({ time: local(moment) })
          : m.zone_localRange({ start: local(moment), end: local(end) })}
      </TooltipContent>
    </Tooltip>
  )
}

/** A workspace entry, not a section change, can announce a different clock. */
export function useBatchZoneNotice(batchId: string, storedZone: string | undefined) {
  const locale = useLocale()
  const visit = useRef({ batchId, announced: false })

  useEffect(() => {
    if (visit.current.batchId !== batchId) visit.current = { batchId, announced: false }
    if (visit.current.announced || storedZone === undefined) return

    let toastId: string | number | undefined
    // The document mounts the shared toaster in a portal after hydration.
    // Defer the notice briefly so the portal is ready and quick exits stay quiet.
    const timer = window.setTimeout(() => {
      visit.current.announced = true
      const zone = readableZone(storedZone)
      const now = Date.now()
      if (zone === undefined || !deviceEverDiffers(zone, now)) return
      const { label } = zoneLabelOf(zone, locale, now)
      toastId = toast.info(m.zone_away({ zone: label }))
    }, 180)
    return () => {
      window.clearTimeout(timer)
      if (toastId !== undefined) toast.dismiss(toastId)
    }
  }, [batchId, locale, storedZone])
}
