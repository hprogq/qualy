import { Schema } from 'effect'
import type { AggregatorDriver, CalculatorDriver, ScoringDriver } from '../plugin.ts'

// The two pieces of arithmetic every deployment starts with, declared here
// and computed by the scoring engine.
//
// What is frozen now is the wire between configuration and arithmetic: an
// item revision stores `{ calculator: 'fixed@1', config: { value: '3.00' } }`,
// and saving a configuration has to be able to check the reference and its
// config shape long before anything computes a score. Amounts are decimal
// strings from the very first config saved, because a JSON float in a stored
// config is a rounding error somebody will eventually have to explain to a
// student.

/**
 * A signed amount as text, up to four decimal places.
 *
 * Four because the engine's fixed point is 1e-4; the display quantum (two
 * places) is a rule about lines, not about configuration.
 */
export const decimalString = Schema.String.check(
  Schema.makeFilter((value: string) => /^-?\d{1,8}(?:\.\d{1,4})?$/.test(value), {
    identifier: 'DecimalString',
    description: 'a decimal amount as a string, like "3.00"',
  }),
)

/**
 * A decimal string as the engine's own integer, scaled by 1e4.
 *
 * The only way amounts are ever compared or added: parsing to a float here
 * would quietly open a second arithmetic besides the engine's, and the two
 * would eventually disagree in front of a student.
 */
export const scaledAmount = (value: string): bigint => {
  const match = /^(-?)(\d{1,8})(?:\.(\d{1,4}))?$/.exec(value)
  if (!match) throw new Error(`not a decimal amount: ${value}`)
  const sign = match[1] === '-' ? -1n : 1n
  const whole = BigInt(match[2]!)
  const fraction = BigInt((match[3] ?? '').padEnd(4, '0') || '0')
  return sign * (whole * 10000n + fraction)
}

/**
 * A scaled integer back as canonical text: at least two decimal places, and
 * exactly as many more as the amount actually carries. `30000n` is `"3.00"`
 * on every machine, every time - string equality is amount equality.
 */
export const formatAmount = (value: bigint): string => {
  const sign = value < 0n ? '-' : ''
  const magnitude = value < 0n ? -value : value
  const whole = magnitude / 10000n
  const fraction = (magnitude % 10000n)
    .toString()
    .padStart(4, '0')
    .replace(/0{1,2}$/, '')
  return `${sign}${whole}.${fraction.padEnd(2, '0')}`
}

/** approved entry = this amount, exactly as configured */
export const fixed1: CalculatorDriver = {
  kind: 'calculator',
  ref: 'fixed@1',
  configSchema: Schema.Struct({ value: decimalString }),
  amountOf: (config) => scaledAmount((config as { value: string }).value),
}

/** entry lines add up; the group tree's floor and cap do the rest */
export const sum1: AggregatorDriver = {
  kind: 'aggregator',
  ref: 'sum@1',
  // nothing to configure: what sum@1 does is its name, and the limits it
  // honors live on the score groups
  configSchema: Schema.Struct({}),
  fold: (_config, amounts) => amounts.reduce((total, amount) => total + amount, 0n),
}

export const builtinScoringDrivers = [fixed1, sum1] as const
