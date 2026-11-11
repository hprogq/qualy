import { choiceLabel, displayTitle, kindOf, type AtomicSchema } from '@qualy/value-schema'
import * as m from '#messages'

export interface RecognitionSnapshot {
  readonly fields: readonly { readonly id: string; readonly schema: unknown }[]
  readonly values: unknown
}

export function recognitionRows(snapshot: RecognitionSnapshot, locale: 'zh-CN' | 'en-US') {
  const values = snapshot.values as Record<string, unknown>
  return snapshot.fields.flatMap((field) => {
    if (values === null || !Object.hasOwn(values, field.id)) return []
    const value = values[field.id]
    if (value === null || value === undefined || value === '') return []
    const schema = field.schema as AtomicSchema
    return [
      {
        id: field.id,
        label: displayTitle(schema, field.id, locale),
        text:
          kindOf(schema) === 'choice'
            ? (choiceLabel(schema as never, String(value), locale) ?? String(value))
            : typeof value === 'boolean'
              ? (value ? m.recognition_yes : m.recognition_no)()
              : String(value),
      },
    ]
  })
}
