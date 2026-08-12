import { Schema } from 'effect'
import type { ScoringDriver } from '../plugin.ts'

// The two pieces of arithmetic every deployment starts with, declared here
// and computed in the scoring milestone.
//
// What is frozen now is the wire between configuration and arithmetic: an
// item revision stores `{ calculator: 'fixed@1', config: { value: '3.00' } }`
// and the reference plus its config shape must already be checkable when the
// configuration API arrives - which is one conversation before any score is
// computed. Amounts are decimal strings from the very first config saved,
// because a JSON float in a stored config is a rounding error somebody will
// eventually have to explain to a student.

/**
 * A signed amount as text, up to four decimal places.
 *
 * Four because the engine's fixed point is 1e-4; the display quantum (two
 * places) is a rule about lines, not about configuration.
 */
export const decimalString = Schema.String.check(
  Schema.makeFilter((value: string) => /^-?\d+(?:\.\d{1,4})?$/.test(value), {
    identifier: 'DecimalString',
    description: 'a decimal amount as a string, like "3.00"',
  }),
)

/** approved entry = this amount, exactly as configured */
export const fixed1: ScoringDriver = {
  kind: 'calculator',
  ref: 'fixed@1',
  configSchema: Schema.Struct({ value: decimalString }),
}

/** entry lines add up; the group tree's floor and cap do the rest */
export const sum1: ScoringDriver = {
  kind: 'aggregator',
  ref: 'sum@1',
  // nothing to configure: what sum@1 does is its name, and the limits it
  // honors live on the score groups
  configSchema: Schema.Struct({}),
}

export const builtinScoringDrivers = [fixed1, sum1] as const
