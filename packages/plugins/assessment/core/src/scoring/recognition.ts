/**
 * What a determination has to be, and what it is worth as an identity.
 *
 * A recognition is judged against the schemas the item revision froze - not
 * against whatever the calculator happens to want today - so a round that
 * began under one contract is finished under that same one. The rules are
 * deliberately exact rather than lenient: every recognition the plan names
 * must be present, nothing else may be, and each value must satisfy its own
 * frozen schema. A determination that is almost complete is not a
 * determination; somebody would have to guess the rest later.
 *
 * The hash is over the canonical form, so two reviewers who determined the
 * same thing in a different key order agree, and a panel voting on "the same
 * recognition" is voting on the same bytes.
 */

import { validateValue } from '@qualy/value-schema/validate'
import { hashCanonicalJson, canonicalJson } from '@qualy/value-schema/hash'
import type { NormalizedAtomicSchema } from '@qualy/value-schema'
import type { ScoringPlan } from './plan.ts'

export type RecognitionValues = Readonly<Record<string, unknown>>

export interface RecognitionIssue {
  /** the recognition this is about; '' when it is about the set itself */
  readonly recognitionId: string
  readonly reason: string
}

/**
 * Judge a candidate against the frozen contract; an empty list means it is
 * a complete and legal determination.
 */
export const judgeRecognition = (
  schemas: Readonly<Record<string, NormalizedAtomicSchema>>,
  candidate: unknown,
): readonly RecognitionIssue[] => {
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return [{ recognitionId: '', reason: 'not-an-object' }]
  }
  const values = candidate as Record<string, unknown>
  const issues: RecognitionIssue[] = []
  for (const [recognitionId, schema] of Object.entries(schemas)) {
    if (!Object.hasOwn(values, recognitionId)) {
      issues.push({ recognitionId, reason: 'missing' })
      continue
    }
    const wrong = validateValue(schema, values[recognitionId])
    if (wrong.length > 0) issues.push({ recognitionId, reason: wrong[0]!.reason })
  }
  for (const recognitionId of Object.keys(values)) {
    if (!Object.hasOwn(schemas, recognitionId)) {
      issues.push({ recognitionId, reason: 'unknown' })
    }
  }
  return issues
}

/** the identity of a determination; key order never changes it */
export const recognitionHash = (values: RecognitionValues): string => hashCanonicalJson(values)

/** whether two determinations say the same thing */
export const sameRecognition = (a: RecognitionValues, b: RecognitionValues): boolean =>
  canonicalJson(a) === canonicalJson(b)

/**
 * What a reviewer is shown before they have determined anything.
 *
 * The first stage of a round seeds from the filing: whatever the item's plan
 * says a recognition defaults from, read out of the evidence through the
 * conversion the plan recorded. A later stage does not - it inherits what
 * the previous stage approved, because a correction made upstairs must not
 * be undone by re-reading the student's original claim.
 */
export const seedFromEvidence = (plan: ScoringPlan, payload: unknown): RecognitionValues => {
  const evidence =
    typeof payload === 'object' && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : {}
  // keyed by recognition ids out of a stored plan: a null prototype so a
  // name like `__proto__` is a key rather than an assignment nobody sees
  const seed: Record<string, unknown> = Object.create(null)
  for (const [recognitionId, binding] of Object.entries(plan.defaultBindings)) {
    const value = Object.hasOwn(evidence, binding.fieldId) ? evidence[binding.fieldId] : undefined
    if (value === undefined) continue
    seed[recognitionId] =
      binding.assignment.kind === 'direct'
        ? value
        : binding.assignment.kind === 'convert' && typeof value === 'number'
          ? String(value)
          : undefined
    if (seed[recognitionId] === undefined) delete seed[recognitionId]
  }
  return seed
}
