import type { SupportedLocale } from '@qualy/i18n-contract'
import * as m from '#messages'

/** The product owns the date/time join; ICU versions disagree on English "at". */
export function formatDateTime(
  at: Date,
  locale: SupportedLocale,
  date: Intl.DateTimeFormatOptions,
  time: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
): string {
  return m.date_time(
    {
      date: new Intl.DateTimeFormat(locale, date).format(at),
      time: new Intl.DateTimeFormat(locale, time).format(at),
    },
    { locale },
  )
}
