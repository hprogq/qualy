import { constraintOf, type AtomicSchema } from '@qualy/value-schema'
import type { useI18n } from '@qualy/web-i18n'
import { assessmentMessages as m } from '../i18n.ts'

// The words for what stops a recognition field, mapped from the machine
// reasons the shared value form emits. The form renders structure and hands
// back reasons; every consumer owns its own sentences - this is the review
// screen's set.

type Format = ReturnType<typeof useI18n>['format']

export const recognitionProblemText = (
  format: Format,
  schema: AtomicSchema | undefined,
  reason: string,
): string => {
  switch (reason) {
    case 'required':
      return format(m.recognitionFieldRequired)
    case 'not-an-integer':
      return format(m.recognitionNotInteger)
    case 'not-a-decimal':
      return format(m.recognitionNotDecimal)
    default: {
      const constraint = (schema === undefined ? undefined : constraintOf(schema, reason)) ?? ''
      switch (reason) {
        case 'x-qualy-maximum':
        case 'maximum':
          return format(m.recognitionOverMax, { constraint })
        case 'x-qualy-minimum':
        case 'minimum':
          return format(m.recognitionUnderMin, { constraint })
        case 'x-qualy-maxScale':
          return format(m.recognitionScale, { constraint })
        case 'maxLength':
          return format(m.recognitionTooLong, { constraint })
        case 'minLength':
          return format(m.recognitionTooShort, { constraint })
        case 'enum':
          return format(m.recognitionEnum)
        case 'type':
        case 'format':
          return format(m.recognitionKind)
        case 'pattern':
          return format(m.recognitionPattern)
        default:
          return format(m.recognitionOther, { reason })
      }
    }
  }
}

/**
 * Which of the seeded facts this confirmation overturns.
 *
 * Mirrors the server's own `contradicted`: only a key the seed already
 * carries, submitted with a different value, is a change - filling in a
 * fact nobody had determined is doing the job and owes no explanation.
 */
export const changedSeedKeys = (
  seed: Readonly<Record<string, unknown>>,
  value: Readonly<Record<string, unknown>>,
): readonly string[] =>
  Object.keys(seed).filter(
    (key) => Object.hasOwn(value, key) && JSON.stringify(value[key]) !== JSON.stringify(seed[key]),
  )
