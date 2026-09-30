import * as m from '#messages'

/** the words for a kind, in the author's language */
export const kindWords = (kind: string | undefined): string => {
  switch (kind) {
    case 'text':
      return m.kind_text()
    case 'integer':
      return m.kind_integer()
    case 'decimal':
      return m.kind_decimal()
    case 'choice':
      return m.kind_choice()
    case 'boolean':
      return m.kind_boolean()
    case 'date':
      return m.kind_date()
    default:
      return kind ?? ''
  }
}
