import type { useI18n } from '@qualy/web-i18n'
import {
  constraintOf,
  parameterSchemaAt,
  type AtomicSchema,
  type NormalizedInputSchema,
} from '@qualy/value-schema'
import { formulaMessages as m } from './i18n.ts'
import { kindWords } from './kind-words.ts'

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
  if (outcome.defect !== undefined) return format(m.defectPrefix, { message: outcome.defect })
  if (outcome.passed === false) return format(m.resultFailed, { actual: outcome.actual ?? '—' })
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
