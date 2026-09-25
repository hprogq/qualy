import type { useI18n } from '@qualy/web-i18n'
import {
  choiceLabel,
  constraintOf,
  displayTitle,
  inputOrder,
  kindOf,
  parameterSchemaAt,
  type AtomicSchema,
  type ChoiceSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { formulaMessages as m } from './i18n.ts'
import { kindWords } from './kind-words.ts'
import { CASE_NOT_RUN, FAILED_UNDER_SCORING_BUDGET, OVER_SCORING_BUDGET } from '../report-codes.ts'

// What a run, a publication's report or a refused contract says, in the
// author's language rather than the validator's. The draft's examples and a
// publication's frozen report speak about the same kinds of outcome, so both
// read them through these.

type Format = ReturnType<typeof useI18n>['format']

export interface ReportProblem {
  readonly at: 'input' | 'expected' | 'output'
  readonly parameter?: string
  readonly reason: string
  readonly constraint?: string
}

/** an example's outcome, from a run or from a frozen report alike */
export interface OutcomeLike {
  readonly passed?: boolean
  readonly actual?: string
  readonly refusal?: string
  readonly defect?: string
  readonly problems?: unknown
}

export const reasonWords = (format: Format, problem: ReportProblem): string => {
  const constraint = problem.constraint ?? ''
  switch (problem.reason) {
    case 'x-qualy-maximum':
    case 'maximum':
      return format(m.reasonOverMax, { constraint })
    case 'x-qualy-minimum':
    case 'minimum':
      return format(m.reasonUnderMin, { constraint })
    case 'x-qualy-maxScale':
      return format(m.reasonScale, { constraint })
    case 'maxLength':
      return format(m.reasonTooLong, { constraint })
    case 'minLength':
      return format(m.reasonTooShort, { constraint })
    case 'enum':
      return format(m.reasonEnum, { constraint })
    case 'type':
    case 'format':
      return format(m.reasonKind, { kind: kindWords(format, problem.constraint) })
    case 'pattern':
      return format(m.reasonPattern, { constraint })
    case 'required':
      return format(m.reasonMissing)
    case 'additionalProperties':
      return format(m.reasonExtra)
    default:
      return format(m.reasonOther, { reason: problem.reason })
  }
}

// every reason a publish can realistically raise gets its own words, and the
// most common one - an unbounded output - says exactly what to type
export const contractReasonWords = (format: Format, reason: string): string => {
  switch (reason) {
    case 'max-scale-invalid':
      return format(m.profileMaxScale)
    case 'bounds-inverted':
      return format(m.profileBoundsInverted)
    case 'integer-bound-missing':
      return format(m.profileIntegerBounds)
    case 'integer-bound-unsafe':
      return format(m.profileIntegerUnsafe)
    case 'decimal-bound-not-lexical':
      return format(m.profileDecimalBound)
    case 'decimal-bound-exceeds-scale':
      return format(m.profileDecimalScale)
    case 'length-bound-invalid':
      return format(m.profileLengthBounds)
    case 'choice-empty':
      return format(m.profileChoiceEmpty)
    case 'choice-duplicate':
      return format(m.profileChoiceDuplicate)
    case 'choice-too-many':
      return format(m.profileChoiceTooMany)
    case 'choice-value-invalid':
    case 'choice-not-a-string':
      return format(m.profileChoiceValue)
    case 'parameter-name-invalid':
      return format(m.profileParameterName)
    case 'too-many-parameters':
      return format(m.profileTooManyParameters)
    case 'unknown-kind':
      return format(m.profileUnknownKind)
    case 'unknown-key':
      return format(m.profileUnknownKey)
    case 'annotation-too-long':
    case 'label-too-long':
      return format(m.profileWordsTooLong)
    case 'parameter-title-missing':
      return format(m.contractParameterTitleMissing)
    case 'parameter-title-duplicate':
      return format(m.contractParameterTitleDuplicate)
    case 'choice-label-missing':
      return format(m.contractChoiceLabelMissing)
    case 'choice-label-duplicate':
      return format(m.contractChoiceLabelDuplicate)
    case 'not-a-score-amount':
      return format(m.contractNotScoreAmount)
    case 'not-a-decimal':
      return format(m.contractNotDecimal)
    case 'contract-too-large':
      return format(m.contractTooLarge)
    case 'contract-error':
      return format(m.contractError)
    case 'pattern-invalid':
      return format(m.contractPatternInvalid)
    case 'pattern-too-large':
      return format(m.contractPatternTooLarge)
    case 'pattern-too-complex':
      return format(m.contractPatternTooComplex)
    default:
      return format(m.reasonOther, { reason })
  }
}

/** a row's defect: the host's own verdicts in words, anything else as the engine said it */
export const defectWords = (format: Format, defect: string): string => {
  switch (defect) {
    case CASE_NOT_RUN:
      return format(m.caseNotRun)
    case OVER_SCORING_BUDGET:
      return format(m.overScoringBudget)
    case FAILED_UNDER_SCORING_BUDGET:
      return format(m.failedUnderScoringBudget)
    default:
      return format(m.defectPrefix, { message: defect })
  }
}

/** what a finished run says beyond its verdict, or nothing */
export const outcomeWords = (format: Format, outcome: OutcomeLike): string | null => {
  const problems = Array.isArray(outcome.problems) ? (outcome.problems as ReportProblem[]) : []
  if (problems.length > 0)
    return problems
      .map((problem) =>
        problem.at === 'input'
          ? format(m.problemInput, {
              parameter: problem.parameter ?? '',
              detail: reasonWords(format, problem),
            })
          : problem.at === 'output'
            ? format(m.problemOutput, { detail: reasonWords(format, problem) })
            : format(m.problemExpected, { detail: reasonWords(format, problem) }),
      )
      .join('; ')
  if (outcome.refusal !== undefined) return format(m.refusalPrefix, { message: outcome.refusal })
  if (outcome.defect !== undefined) return defectWords(format, outcome.defect)
  if (outcome.passed === false)
    return format(m.resultFailed, { actual: outcome.actual ?? format(m.actualNone) })
  return null
}

/**
 * A case's input in brief, for a table line: the parameters and their values
 * as the author would write them, without the quotes JSON puts on every key.
 * Anything that is not an object of values is shown as JSON.
 */
export const inputSummaryOf = (value: unknown): string => {
  if (value === undefined) return ''
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return JSON.stringify(value)
  const pairs = Object.entries(value).map(
    ([key, one]) => `${key}: ${typeof one === 'string' ? one : JSON.stringify(one)}`,
  )
  return pairs.length === 0 ? '{}' : `{ ${pairs.join(', ')} }`
}

/** one parameter of a case, as a reader of the form would name it */
export interface InputFact {
  readonly label: string
  readonly value: string
}

/**
 * A case's input as the author reads it: the parameters under the titles the
 * contract declared, in the order it declares them, with choices and
 * yes-or-no answers in words. Without a contract the keys stand in for the
 * titles - a record kept from a structure that has since changed still says
 * what was asked.
 */
export const inputFactsOf = (
  format: Format,
  locale: string,
  schema: NormalizedInputSchema | null,
  value: unknown,
): readonly InputFact[] => {
  if (value === undefined) return []
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return [{ label: '', value: JSON.stringify(value) }]
  const held = value as Record<string, unknown>
  const keys =
    schema === null
      ? Object.keys(held)
      : [
          ...inputOrder(schema).filter((key) => Object.hasOwn(held, key)),
          ...Object.keys(held).filter((key) => !Object.hasOwn(schema.properties, key)),
        ]
  return keys.map((key) => {
    const field = schema?.properties[key]
    const one = held[key]
    const words =
      typeof one === 'boolean'
        ? format(one ? m.valueYes : m.valueNo)
        : field !== undefined && typeof one === 'string' && kindOf(field) === 'choice'
          ? choiceLabel(field as ChoiceSchema, one, locale)
          : typeof one === 'string'
            ? one
            : JSON.stringify(one)
    return {
      label: field === undefined ? key : displayTitle(field, key, locale),
      value: words,
    }
  })
}

/** what stops one field of a try or an example, in the author's words */
export const fieldIssueWords = (
  format: Format,
  schema: AtomicSchema | undefined,
  reason: string,
): string => {
  switch (reason) {
    case 'required':
      return format(m.fieldRequired)
    case 'not-an-integer':
      return format(m.fieldNotInteger)
    case 'not-a-decimal':
      return format(m.fieldNotDecimal)
    default: {
      const constraint = schema === undefined ? undefined : constraintOf(schema, reason)
      return reasonWords(format, {
        at: 'input',
        reason,
        ...(constraint === undefined ? {} : { constraint }),
      })
    }
  }
}

/** a form's field problems, keyed by parameter, worded against the input contract */
export const inputIssueWords = (
  format: Format,
  schema: NormalizedInputSchema,
  issues: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> =>
  new Map(
    [...issues].map(([field, reason]) => [
      field,
      fieldIssueWords(
        format,
        field === '' ? undefined : parameterSchemaAt(schema, `/${field}`),
        reason,
      ),
    ]),
  )
