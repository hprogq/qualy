import { format } from 'date-fns/format'
import { tz } from '@date-fns/tz'
import { dateLanguages, type DateTimeStyle } from './patterns.ts'

export type { DateTimeStyle } from './patterns.ts'

/** Fixed presentation templates and locale data on every rendering host. */
export function formatDateTime(
  at: Date,
  language: string,
  style: DateTimeStyle = 'date-time',
  timeZone?: string,
): string {
  if (!Object.hasOwn(dateLanguages, language))
    throw new RangeError(`Unsupported date locale: ${language}`)
  const selected = dateLanguages[language as keyof typeof dateLanguages]
  return format(at, selected.patterns[style], {
    locale: selected.locale,
    ...(timeZone === undefined ? {} : { in: tz(timeZone) }),
  })
}
