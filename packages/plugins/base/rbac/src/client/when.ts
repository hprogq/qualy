import { useLocale } from '@qualy/web-i18n'
import { useDocumentNow, useHydrating } from '@qualy/web-runtime'

// An instant as a grant's window is read: the day and the minute, the year
// only when it is not this one. Through Intl, so the reader's locale decides
// the order of the parts and the words between them.

export const useMoment = () => {
  const locale = useLocale()
  const hydrating = useHydrating()
  const now = new Date(useDocumentNow())
  const thisYear = hydrating ? now.getUTCFullYear() : now.getFullYear()
  return (iso: string) => {
    const at = new Date(iso)
    return at.toLocaleString(locale, {
      ...((hydrating ? at.getUTCFullYear() : at.getFullYear()) === thisYear
        ? {}
        : { year: 'numeric' }),
      ...(hydrating ? { timeZone: 'UTC' } : {}),
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
}
