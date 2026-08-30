/**
 * The one representation converter the profile admits. Mathematically the
 * widening is lossless; the JSON representation still changes (3 → "3"), so
 * it is named and versioned rather than performed silently, and a compiled
 * scoring plan records it by name.
 */

import type { AssignmentPlan } from './assignment.ts'

export const INTEGER_TO_DECIMAL = 'integer-to-decimal@1'

export type ConverterRef = typeof INTEGER_TO_DECIMAL

/** 3 → "3"; an integer rendered in decimal syntax is already canonical */
export const integerToDecimal = (value: number): string | null =>
  Number.isSafeInteger(value) ? String(value) : null

/**
 * The one runtime interpreter of a compiled assignment.
 *
 * Evidence seeding, scoring input assembly and the browser preview all
 * carry values through THIS function - a compiled plan names its converter,
 * and what that name does is decided in exactly one place. `null` is the
 * sign the value cannot be carried: a converter refuses input outside its
 * own guard (a fractional or unsafe "integer" out of stored data is
 * refused, never rendered), and an incompatible assignment cannot be in a
 * compiled plan at all - the compiler refuses the revision first.
 */
export const applyAssignment = (assignment: AssignmentPlan, value: unknown): unknown => {
  if (assignment.kind === 'direct') return value
  if (assignment.kind === 'convert' && assignment.converter === INTEGER_TO_DECIMAL) {
    return typeof value === 'number' ? integerToDecimal(value) : null
  }
  return null
}
