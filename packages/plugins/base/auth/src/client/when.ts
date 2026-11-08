import { formatDateTime } from '@qualy/web-i18n'
import type { SupportedLocale } from '@qualy/i18n-contract'

/**
 * An instant as a reader wants it in a record of sign-ins: the day and the
 * minute, and the year only when it is not this one.
 */
export const instantWords = (locale: SupportedLocale, iso: string) => {
  const at = new Date(iso)
  return formatDateTime(
    at,
    locale,
    {
      ...(at.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
      month: 'long',
      day: 'numeric',
    },
    { hour: '2-digit', minute: '2-digit' },
  )
}
