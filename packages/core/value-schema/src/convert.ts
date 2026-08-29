/**
 * The one representation converter the profile admits. Mathematically the
 * widening is lossless; the JSON representation still changes (3 → "3"), so
 * it is named and versioned rather than performed silently, and a compiled
 * scoring plan records it by name.
 */

export const INTEGER_TO_DECIMAL = 'integer-to-decimal@1'

export type ConverterRef = typeof INTEGER_TO_DECIMAL

/** 3 → "3"; an integer rendered in decimal syntax is already canonical */
export const integerToDecimal = (value: number): string | null =>
  Number.isSafeInteger(value) ? String(value) : null
