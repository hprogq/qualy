import { normalizeAtomicSchema } from './profile.ts'
import type { AtomicSchema } from './profile.ts'

/**
 * What a score is allowed to be, as a value schema.
 *
 * This is the platform's amount contract, not any one calculator's: every
 * piece of arithmetic that produces a score - a fixed amount, an authored
 * formula, whatever comes later - must prove its answer fits inside this.
 * It lives here, in the neutral value layer, because both the side that
 * declares an amount and the side that accepts one need it, and neither
 * should have to depend on the other to say what a score is.
 *
 * The bounds are `numeric(12,4)`'s widest magnitude spelled at four places:
 * the engine's fixed point. Display quantizes to two, which is a rule about
 * printed lines rather than about what may be computed.
 */
export const SCORE_AMOUNT_MAX_SCALE = 4

export const SCORE_AMOUNT_BOUND = '99999999.9999'

export const SCORE_AMOUNT_SCHEMA: AtomicSchema = normalizeAtomicSchema({
  type: 'string',
  format: 'qualy-decimal',
  'x-qualy-maxScale': SCORE_AMOUNT_MAX_SCALE,
  'x-qualy-minimum': `-${SCORE_AMOUNT_BOUND}`,
  'x-qualy-maximum': SCORE_AMOUNT_BOUND,
})
