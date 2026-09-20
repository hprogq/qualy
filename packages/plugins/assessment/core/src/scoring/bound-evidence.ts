import type { ScoringPlan } from './plan.ts'

// A field bound to a determination is one fact wearing two addresses.
//
// A participant files it on the form; the reviewer's determination starts
// from what they filed. When the office records the fact directly there is
// no filing to start from - the office IS the determination - so asking the
// registrar for the field and then for the determination is asking the same
// question twice, and the second answer can only agree with the first or
// contradict it. So the office is asked once, and the filing side is written
// from the determination. Only where the two carry the value the same way:
// a determination converted out of the filing (a whole number read as a
// decimal) has no single way back, and that field stays asked.

/** the payload addresses that a determination fills in for the office */
export const boundEvidenceKeys = (plan: ScoringPlan): ReadonlySet<string> =>
  new Set(
    Object.values(plan.defaultBindings)
      .filter((binding) => binding.assignment.kind === 'direct')
      .map((binding) => binding.payloadKey ?? binding.fieldId),
  )

/**
 * The payload with every bound field the office left blank filled from the
 * determination it stands for. What the office did write stays as written:
 * the decoder, not this, says whether the two agree.
 */
export const fillBoundEvidence = (
  plan: ScoringPlan,
  payload: Readonly<Record<string, unknown>>,
  recognition: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const filled: Record<string, unknown> = { ...payload }
  for (const [recognitionId, binding] of Object.entries(plan.defaultBindings)) {
    if (binding.assignment.kind !== 'direct') continue
    const key = binding.payloadKey ?? binding.fieldId
    if (Object.hasOwn(filled, key) && filled[key] !== undefined && filled[key] !== null) continue
    if (!Object.hasOwn(recognition, recognitionId)) continue
    const value = recognition[recognitionId]
    if (value === undefined || value === null) continue
    filled[key] = value
  }
  return filled
}
