import { useLocale } from '@qualy/web-i18n'
import { zoneNameOf } from './zone.ts'
import * as m from '#messages'

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

export function zoneLabelOf(zone: string, locale: string, at?: number, showOffset = true) {
  const { name, offset } = zoneNameOf(zone, locale, at)
  if (!showOffset) return { label: name ?? zone }
  return { label: name === undefined ? offset : m.zone_named({ name, offset }), offset }
}
