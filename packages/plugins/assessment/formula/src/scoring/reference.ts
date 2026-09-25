/**
 * The least a formula can be: one decimal in, the same decimal out.
 *
 * Publication asks a version's own examples once more under the scoring
 * budget, and the budget is wall clock, so an example that misses it may
 * mean a slow formula or a busy host. This formula tells the two apart:
 * built by the same compiler and run the way a score runs, it costs what
 * any formula costs before its own code does anything. When it fits the
 * budget and an example does not, the time is the example's own - its run,
 * or whatever its module does as it loads; when it does not fit either, the
 * host cannot say anything about the formula right now.
 */
export const REFERENCE_SOURCE = `import { Schema, defineFormula } from '@qualy/formula'

export default defineFormula({
  input: Schema.input({
    value: Schema.decimal({ minimum: '0.00', maximum: '1.00', maxScale: 2, title: 'Value' }),
  }),
  output: Schema.scoreAmount({ maxScale: 2 }),
  run(input) {
    return input.value
  },
})
`

/** what the reference formula is asked, as a score asks a formula */
export const REFERENCE_INPUT = { value: '1.00' }
