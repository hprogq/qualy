import { Effect, Schema } from 'effect'
import {
  canonicalDecimal,
  compareDecimal,
  fractionalDigits,
  isDecimalString,
  normalizeAtomicSchema,
  normalizeInputSchema,
  parseDecimal,
} from '@qualy/value-schema'
import {
  SCORE_AMOUNT_BOUND,
  SCORE_AMOUNT_MAX_SCALE,
  SCORE_AMOUNT_SCHEMA,
} from '@qualy/value-schema/score'
import { canonicalizeAtomicSchema, canonicalizeInputSchema } from '@qualy/value-schema'
import { hashCanonicalJson } from '@qualy/value-schema/hash'
import { CalculatorContractError } from '../plugin.ts'
import type {
  AggregationResult,
  AggregatorDriver,
  CalculatorContract,
  CalculatorRegistration,
} from '../plugin.ts'

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
 * A signed amount as text, spelled the way the platform spells amounts.
 *
 * Four decimal places because the engine's fixed point is 1e-4; the display
 * quantum (two places) is a rule about lines, not about configuration. The
 * grammar is the value layer's own - which rejects a leading zero. Accepting
 * `"03.00"` here would let a question be saved whose only possible answer
 * the frozen output schema then refuses, and the failure would surface on a
 * student's results page rather than on the form that caused it.
 */
export const decimalString = Schema.String.check(
  Schema.makeFilter(
    (value: string) => {
      const parts = parseDecimal(value)
      return (
        parts !== null &&
        isDecimalString(value) &&
        fractionalDigits(parts) <= SCORE_AMOUNT_MAX_SCALE &&
        compareDecimal(parts, parseDecimal(`-${SCORE_AMOUNT_BOUND}`)!) >= 0 &&
        compareDecimal(parts, parseDecimal(SCORE_AMOUNT_BOUND)!) <= 0
      )
    },
    {
      identifier: 'DecimalString',
      description: 'a decimal amount as a string, like "3.00"',
    },
  ),
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

/**
 * A scaled amount held to the display quantum of one hundredth, rounded
 * HALF_AWAY_FROM_ZERO (§16): 83.245 gives 83.25 and -0.125 gives -0.13, the
 * answers a pocket calculator and the old Excel sheets both give. Banker's
 * rounding would answer -0.12 there, and a deduction nobody can reproduce by
 * hand is an appeal waiting to be filed.
 *
 * Configuration admits four decimals, so a line's contribution can carry
 * amounts finer than the account is ever printed in; quantizing each line
 * before it is added is what keeps the printed lines adding up to the
 * printed subtotal.
 */
export const quantizeAmount = (value: bigint): bigint => {
  const negative = value < 0n
  const magnitude = negative ? -value : value
  const remainder = magnitude % 100n
  const rounded = magnitude - remainder + (remainder >= 50n ? 100n : 0n)
  return negative ? -rounded : rounded
}

/** approved entry = this amount, exactly as configured */
/**
 * The identity of a contract: the two schemas' semantic bodies, and nothing
 * else. Deliberately NOT `hashCanonicalJson(schemas)` - the canonical forms
 * strip annotations, so renaming a parameter's label leaves every frozen
 * plan that cites this contract exactly where it was.
 */
export const contractHashOf = (contract: {
  readonly inputSchema: Parameters<typeof canonicalizeInputSchema>[0]
  readonly outputSchema: Parameters<typeof canonicalizeAtomicSchema>[0]
}): string =>
  hashCanonicalJson([
    canonicalizeInputSchema(contract.inputSchema),
    canonicalizeAtomicSchema(contract.outputSchema),
  ])

/**
 * The whole of `fixed@1`: it needs nothing about the entry to answer.
 *
 * Its input contract is the empty object, which is what makes a fixed item's
 * recognition the empty recognition - there is no fact a reviewer could be
 * asked to determine. The answer is the configured amount, verbatim: the
 * exact decimal string an administrator typed, never a float on the way.
 */
const fixedContract: CalculatorContract = (() => {
  const inputSchema = normalizeInputSchema({
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  })
  const outputSchema = normalizeAtomicSchema(SCORE_AMOUNT_SCHEMA)
  return { inputSchema, outputSchema, contractHash: contractHashOf({ inputSchema, outputSchema }) }
})()

export const fixed1: CalculatorRegistration = {
  kind: 'calculator',
  ref: 'fixed@1',
  configSchema: Schema.Struct({ value: decimalString }),
  // nothing to acquire: the whole binding is pure arithmetic, so bind
  // succeeds immediately, verify has no runtime fact to prove, and prepare
  // closes over the already-canonical amount
  bind: Effect.succeed({
    ref: 'fixed@1',
    compile: (config) => {
      const written = (config as { value?: unknown }).value
      // the compiler validated the shape first; this is the calculator saying
      // what it will execute, and "3.00" and "3.0" are one amount to it
      const canonical = typeof written === 'string' ? canonicalDecimal(written) : null
      return canonical === null
        ? Effect.fail(new CalculatorContractError('invariant', 'value is not a decimal amount'))
        : Effect.succeed({ ...fixedContract, config: { value: canonical } })
    },
    verify: () => Effect.void,
    prepare: (frozen) =>
      Effect.succeed({
        evaluate: () => Effect.succeed((frozen.config as { value: string }).value),
      }),
  }),
}

/**
 * The chosen few, everything else at zero with its reason. Selection is by
 * amount, ties by input order - the scorer feeds entries in its one
 * deterministic order, so the same facts pick the same lines every time.
 */
const pick = (
  entries: readonly { readonly entryId: string; readonly amount: bigint }[],
  most: number,
): AggregationResult => {
  const chosen = new Set(
    [...entries.entries()]
      .sort(([ai, a], [bi, b]) => (a.amount === b.amount ? ai - bi : a.amount > b.amount ? -1 : 1))
      .slice(0, most)
      .map(([index]) => index),
  )
  let total = 0n
  const explained = entries.map((entry, index) => {
    const included = chosen.has(index)
    if (included) total += entry.amount
    return included
      ? { entryId: entry.entryId, included, effectiveAmount: entry.amount }
      : { entryId: entry.entryId, included, effectiveAmount: 0n, reason: 'not-selected' as const }
  })
  return { total, entries: explained }
}

/** entry lines add up; the group tree's floor and cap do the rest */
export const sum1: AggregatorDriver = {
  kind: 'aggregator',
  ref: 'sum@1',
  // nothing to configure: what sum@1 does is its name, and the limits it
  // honors live on the score groups
  configSchema: Schema.Struct({}),
  aggregate: (_config, entries) => ({
    total: entries.reduce((total, entry) => total + entry.amount, 0n),
    entries: entries.map((entry) => ({
      entryId: entry.entryId,
      included: true,
      effectiveAmount: entry.amount,
    })),
  }),
}

/**
 * Only the highest counts (terms.md: an officer holding several posts is
 * scored by the highest office, never cumulatively). A cap cannot say this -
 * min(2 + 2, 3) is 3 where the policy answer is 2.
 */
export const max1: AggregatorDriver = {
  kind: 'aggregator',
  ref: 'max@1',
  configSchema: Schema.Struct({}),
  aggregate: (_config, entries) => pick(entries, 1),
}

/** the best few count: config says how many */
export const topNSum1: AggregatorDriver = {
  kind: 'aggregator',
  ref: 'top-n-sum@1',
  configSchema: Schema.Struct({
    n: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 99 })),
  }),
  aggregate: (config, entries) => pick(entries, (config as { n: number }).n),
}

export const builtinCalculators = [fixed1] as const
export const builtinAggregators = [sum1, max1, topNSum1] as const
