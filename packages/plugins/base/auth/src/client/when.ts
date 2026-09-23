/**
 * An instant as a reader wants it in a record of sign-ins: the day and the
 * minute, and the year only when it is not this one.
 */
export const instantWords = (locale: string, iso: string) => {
  const at = new Date(iso)
  return new Intl.DateTimeFormat(locale, {
    ...(at.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }),
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(at)
}
