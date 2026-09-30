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

import { kindWords } from './kind-words.ts'
import { CASE_NOT_RUN, FAILED_UNDER_SCORING_BUDGET, OVER_SCORING_BUDGET } from '../report-codes.ts'
import * as m from '#messages'

// What a run, a publication's report or a refused contract says, in the
// author's language rather than the validator's. The draft's examples and a
// publication's frozen report speak about the same kinds of outcome, so both
// read them through these.

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

export const reasonWords = (problem: ReportProblem): string => {
  const constraint = problem.constraint ?? ''
  switch (problem.reason) {
    case 'x-qualy-maximum':
    case 'maximum':
      return m.reason_overMax({ constraint })
    case 'x-qualy-minimum':
    case 'minimum':
      return m.reason_underMin({ constraint })
    case 'x-qualy-maxScale':
      return m.reason_scale({ constraint })
    case 'maxLength':
      return m.reason_tooLong({ constraint })
    case 'minLength':
      return m.reason_tooShort({ constraint })
    case 'enum':
      return m.reason_enum({ constraint })
    case 'type':
    case 'format':
      return m.reason_kind({ kind: kindWords(problem.constraint) })
    case 'pattern':
      return m.reason_pattern({ constraint })
    case 'required':
      return m.reason_missing()
    case 'additionalProperties':
      return m.reason_extra()
    default:
      return m.reason_other({ reason: problem.reason })
  }
}

// every reason a publish can realistically raise gets its own words, and the
// most common one - an unbounded output - says exactly what to type
export const contractReasonWords = (reason: string): string => {
  switch (reason) {
    case 'max-scale-invalid':
      return m.contract_maxScale()
    case 'bounds-inverted':
      return m.contract_boundsInverted()
    case 'integer-bound-missing':
      return m.contract_integerBounds()
    case 'integer-bound-unsafe':
      return m.contract_integerUnsafe()
    case 'decimal-bound-not-lexical':
      return m.contract_decimalBound()
    case 'decimal-bound-exceeds-scale':
      return m.contract_decimalScale()
    case 'length-bound-invalid':
      return m.contract_lengthBounds()
    case 'choice-empty':
      return m.contract_choiceEmpty()
    case 'choice-duplicate':
      return m.contract_choiceDuplicate()
    case 'choice-too-many':
      return m.contract_choiceTooMany()
    case 'choice-value-invalid':
    case 'choice-not-a-string':
      return m.contract_choiceValue()
    case 'parameter-name-invalid':
      return m.contract_parameterName()
    case 'too-many-parameters':
      return m.contract_tooManyParameters()
    case 'unknown-kind':
      return m.contract_unknownKind()
    case 'unknown-key':
      return m.contract_unknownKey()
    case 'annotation-too-long':
    case 'label-too-long':
      return m.contract_wordsTooLong()
    case 'parameter-title-missing':
      return m.contract_parameterTitleMissing()
    case 'parameter-title-duplicate':
      return m.contract_parameterTitleDuplicate()
    case 'choice-label-missing':
      return m.contract_choiceLabelMissing()
    case 'choice-label-duplicate':
      return m.contract_choiceLabelDuplicate()
    case 'not-a-score-amount':
      return m.contract_notScoreAmount()
    case 'not-a-decimal':
      return m.contract_notDecimal()
    case 'contract-too-large':
      return m.contract_tooLarge()
    case 'contract-error':
      return m.contract_error()
    case 'pattern-invalid':
      return m.contract_patternInvalid()
    case 'pattern-too-large':
      return m.contract_patternTooLarge()
    case 'pattern-too-complex':
      return m.contract_patternTooComplex()
    default:
      return m.reason_other({ reason })
  }
}

/** a row's defect: the host's own verdicts in words, anything else as the engine said it */
export const defectWords = (defect: string): string => {
  switch (defect) {
    case CASE_NOT_RUN:
      return m.report_notRun()
    case OVER_SCORING_BUDGET:
      return m.report_overScoringBudget()
    case FAILED_UNDER_SCORING_BUDGET:
      return m.report_failedUnderScoringBudget()
    default:
      return m.report_defect({ message: defect })
  }
}

/** what a finished run says beyond its verdict, or nothing */
export const outcomeWords = (outcome: OutcomeLike): string | null => {
  const problems = Array.isArray(outcome.problems) ? (outcome.problems as ReportProblem[]) : []
  if (problems.length > 0)
    return problems
      .map((problem) =>
        problem.at === 'input'
          ? m.report_problemInput({
              parameter: problem.parameter ?? '',
              detail: reasonWords(problem),
            })
          : problem.at === 'output'
            ? m.report_problemOutput({ detail: reasonWords(problem) })
            : m.report_problemExpected({ detail: reasonWords(problem) }),
      )
      .join('; ')
  if (outcome.refusal !== undefined) return m.report_refusal({ message: outcome.refusal })
  if (outcome.defect !== undefined) return defectWords(outcome.defect)
  if (outcome.passed === false)
    return m.editor_resultFailed({ actual: outcome.actual ?? m.examples_actualNone() })
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
        ? (one ? m.value_yes : m.value_no)()
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
export const fieldIssueWords = (schema: AtomicSchema | undefined, reason: string): string => {
  switch (reason) {
    case 'required':
      return m.editor_fieldRequired()
    case 'not-an-integer':
      return m.editor_fieldNotInteger()
    case 'not-a-decimal':
      return m.editor_fieldNotDecimal()
    default: {
      const constraint = schema === undefined ? undefined : constraintOf(schema, reason)
      return reasonWords({
        at: 'input',
        reason,
        ...(constraint === undefined ? {} : { constraint }),
      })
    }
  }
}

/** a form's field problems, keyed by parameter, worded against the input contract */
export const inputIssueWords = (
  schema: NormalizedInputSchema,
  issues: ReadonlyMap<string, string>,
): ReadonlyMap<string, string> =>
  new Map(
    [...issues].map(([field, reason]) => [
      field,
      fieldIssueWords(field === '' ? undefined : parameterSchemaAt(schema, `/${field}`), reason),
    ]),
  )
