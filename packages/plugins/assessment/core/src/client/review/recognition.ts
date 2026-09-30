import { constraintOf, type AtomicSchema } from '@qualy/value-schema'
import * as m from '#messages'

// The words for what stops a recognition field, mapped from the machine
// reasons the shared value form emits. The form renders structure and hands
// back reasons; every consumer owns its own sentences - this is the review
// screen's set.

export const recognitionProblemText = (
  schema: AtomicSchema | undefined,
  reason: string,
): string => {
  switch (reason) {
    case 'required':
      return m.review_recognitionFieldRequired()
    case 'not-an-integer':
      return m.review_recognitionNotInteger()
    case 'not-a-decimal':
      return m.review_recognitionNotDecimal()
    case 'not-a-boolean':
      return m.review_recognitionNotBoolean()
    case 'out-of-material-range':
      return m.review_recognitionOutOfMaterialRange()
    default: {
      const constraint = (schema === undefined ? undefined : constraintOf(schema, reason)) ?? ''
      switch (reason) {
        case 'x-qualy-dateMaximum':
          return m.review_recognitionAfterLatest({ constraint })
        case 'x-qualy-dateMinimum':
          return m.review_recognitionBeforeEarliest({ constraint })
        case 'x-qualy-maximum':
        case 'maximum':
          return m.review_recognitionOverMax({ constraint })
        case 'x-qualy-minimum':
        case 'minimum':
          return m.review_recognitionUnderMin({ constraint })
        case 'x-qualy-maxScale':
          return m.review_recognitionScale({ constraint })
        case 'maxLength':
          return m.review_recognitionTooLong({ constraint })
        case 'minLength':
          return m.review_recognitionTooShort({ constraint })
        case 'enum':
          return m.review_recognitionEnum()
        case 'type':
        case 'format':
          return m.review_recognitionKind()
        case 'pattern':
          return m.review_recognitionPattern()
        default:
          return m.review_recognitionOther({ reason })
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
