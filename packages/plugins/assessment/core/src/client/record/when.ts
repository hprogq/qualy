import { useCallback } from 'react'
import { useI18n } from '@qualy/web-i18n'
import { assessmentMessages as m } from '../i18n.ts'

// When something was filed, written the way somebody checking this round's
// work reads it.
//
// The two days a recorder is actually working in get named and keep their
// hour, because "today 10:24" answers "is this mine, from this morning";
// anything older drops the hour, which had stopped meaning anything, and
// keeps the year only once it is no longer this one.
//
// The line between them is midnight where the reader is, not a span of
// hours: a record filed at 23:50 reads as yesterday the next morning rather
// than as nine hours ago.

export function useWhen() {
  const { format, locale } = useI18n()
  return useCallback(
    (iso: string): string => {
      const at = new Date(iso)
      if (Number.isNaN(at.getTime())) return ''
      const now = new Date()
      const midnight = new Date(now)
      midnight.setHours(0, 0, 0, 0)
      const before = new Date(midnight)
      before.setDate(before.getDate() - 1)

      if (at.getTime() >= midnight.getTime() || at.getTime() >= before.getTime()) {
        const time = new Intl.DateTimeFormat(locale, {
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(at)
        return format(
          at.getTime() >= midnight.getTime() ? m.recordWhenToday : m.recordWhenYesterday,
          {
            time,
          },
        )
      }
      return new Intl.DateTimeFormat(locale, {
        ...(at.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
        month: 'long',
        day: 'numeric',
      }).format(at)
    },
    [format, locale],
  )
}
