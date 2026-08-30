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

import { canonicalizeValues } from '@qualy/value-schema/values'
import { applyAssignment, inputOrder } from '@qualy/value-schema'
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

/**
 * A determination spelled the one way its contract says it means.
 *
 * Everything downstream - comparing, hashing, storing - goes through here
 * first, so `"3.0"` and `"3.00"` are one determination rather than two that
 * happen to score the same. Storing the canonical form matters as much as
 * hashing it: a value written one way and read back another would make the
 * hash a fact about the writer instead of about the determination.
 */
export const canonicalRecognition = (
  schemas: Readonly<Record<string, NormalizedAtomicSchema>>,
  values: RecognitionValues,
): RecognitionValues => canonicalizeValues(schemas, values)

/** the identity of a determination; key order and spelling never change it */
export const recognitionHash = (values: RecognitionValues): string => hashCanonicalJson(values)

/** whether two determinations say the same thing */
export const sameRecognition = (a: RecognitionValues, b: RecognitionValues): boolean =>
  canonicalJson(a) === canonicalJson(b)

/**
 * Which determinations this reviewer changed, as opposed to made.
 *
 * Filling in a fact nobody had determined yet is the ordinary work of the
 * first person to look at a claim - a reviewer-only field has no default by
 * design, so the seed simply does not carry it. Contradicting a fact
 * somebody already determined is a different act, and the only one that owes
 * the next reader an explanation. Treating both as "changed" would demand a
 * reason for doing the job.
 */
export const contradicted = (
  seed: RecognitionValues,
  candidate: RecognitionValues,
): readonly string[] =>
  Object.keys(seed).filter(
    (recognitionId) =>
      Object.hasOwn(candidate, recognitionId) &&
      canonicalJson(candidate[recognitionId]) !== canonicalJson(seed[recognitionId]),
  )

/**
 * The plan's recognition contract as form fields, in the order a reviewer
 * should meet them.
 *
 * Null for the empty contract, so a screen never wonders whether an empty
 * object is a form. Order comes from the calculator's own input order:
 * walk the parameters as the arithmetic declares them and take each
 * recognition the first time it appears - the question's shape decides the
 * form's shape, not object-key luck. Ids stay exactly what they are:
 * opaque stable identities, never identifiers.
 */
export const recognitionFormFields = (
  plan: ScoringPlan,
): readonly { readonly id: string; readonly schema: NormalizedAtomicSchema }[] | null => {
  const order: string[] = []
  const seen = new Set<string>()
  const declared = inputOrder(plan.inputSchema)
  for (const parameter of declared) {
    const binding = Object.hasOwn(plan.parameters, parameter)
      ? plan.parameters[parameter]
      : undefined
    if (binding === undefined || binding.kind !== 'recognition') continue
    if (seen.has(binding.recognitionId)) continue
    seen.add(binding.recognitionId)
    order.push(binding.recognitionId)
  }
  if (order.length === 0) return null
  return order.flatMap((id) => {
    const schema = Object.hasOwn(plan.recognitionSchemas, id)
      ? plan.recognitionSchemas[id]
      : undefined
    return schema === undefined ? [] : [{ id, schema }]
  })
}

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
    // The payload address, not the identity. A field keeps its id across
    // revisions while its key stays pinned to the slot payloads use; plans
    // compiled before the two were told apart froze only the id, and for
    // them the id IS the address - that is what the fallback preserves.
    const slot = binding.payloadKey ?? binding.fieldId
    const value = Object.hasOwn(evidence, slot) ? evidence[slot] : undefined
    if (value === undefined) continue
    // through the one interpreter: what a plan's converter refuses (a
    // fractional or unsafe number out of stored data) is not seeded, never
    // rendered into a string no schema would accept
    const carried = applyAssignment(binding.assignment, value)
    if (carried === null || carried === undefined) continue
    seed[recognitionId] = carried
  }
  return seed
}
