import type { useI18n } from '@qualy/web-i18n'
import { formulaMessages as m } from './i18n.ts'

type Format = ReturnType<typeof useI18n>['format']

/** the words for a kind, in the author's language */
export const kindWords = (format: Format, kind: string | undefined): string => {
  switch (kind) {
    case 'text':
      return format(m.kindText)
    case 'integer':
      return format(m.kindInteger)
    case 'decimal':
      return format(m.kindDecimal)
    case 'choice':
      return format(m.kindChoice)
    case 'boolean':
      return format(m.kindBoolean)
    case 'date':
      return format(m.kindDate)
    default:
      return kind ?? ''
  }
}
