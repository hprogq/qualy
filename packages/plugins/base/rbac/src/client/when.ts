import { useI18n } from '@qualy/web-i18n'

// An instant as a grant's window is read: the day and the minute, the year
// only when it is not this one. Through Intl, so the reader's locale decides
// the order of the parts and the words between them.

export const useMoment = () => {
  const { locale } = useI18n()
  const thisYear = new Date().getFullYear()
  return (iso: string) => {
    const at = new Date(iso)
    return at.toLocaleString(locale, {
      ...(at.getFullYear() === thisYear ? {} : { year: 'numeric' }),
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }
}
