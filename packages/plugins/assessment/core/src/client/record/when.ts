import { useCallback } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { assessmentMessages as m } from '../i18n.ts'
import { calendarDaysBetween, inZone, useBatchZone, yearOf } from '../batch/zone.ts'

// When something was filed, written the way somebody checking this round's
// work reads it.
//
// The two days a recorder is actually working in get named and keep their
// hour, because "today 10:24" answers "is this mine, from this morning";
// anything older drops the hour, which had stopped meaning anything, and
// keeps the year only once it is no longer this one.
//
// The line between them is midnight on the batch's clock, not a span of
// hours: a record filed at 23:50 reads as yesterday the next morning rather
// than as nine hours ago.

export function useWhen() {
  const { format, locale } = useI18n()
  const zone = useBatchZone()
  return useCallback(
    (iso: string): string => {
      const at = new Date(iso)
      if (Number.isNaN(at.getTime())) return ''
      const now = Date.now()
      const days = calendarDaysBetween(at.getTime(), now, zone)

      if (days <= 1) {
        const time = new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          ...inZone(zone),
        }).format(at)
        return format(days <= 0 ? m.recordWhenToday : m.recordWhenYesterday, { time })
      }
      return new Intl.DateTimeFormat(locale, {
        ...(yearOf(at.getTime(), zone) === yearOf(now, zone) ? {} : { year: 'numeric' }),
        month: 'long',
        day: 'numeric',
        ...inZone(zone),
      }).format(at)
    },
    [format, locale, zone],
  )
}
