/**
 * The one structured way a formula refuses its input. `q.fail(message)`
 * throws this; the trusted artifact wrapper catches exactly this and encodes
 * it as a formula failure, distinct in the result protocol from an ordinary
 * JS exception (a defect in the formula) and from a sandbox resource verdict
 * (timeout, memory) — three different audiences, three different answers.
 *
 * Recognition survives bundling: the marker is a property contract rather
 * than an instanceof, so a wrapper compiled into one artifact recognizes a
 * failure thrown by the SDK copy in the same artifact, and host-side code
 * recognizes one that crossed a JSON boundary too.
 */

const MARKER = 'qualyFormulaFailure'

/**
 * The refusal is words for a screen, and the whole envelope has an output
 * budget: an unbounded message could turn a plain business refusal into
 * SandboxOutputTooLarge. Capped at creation, in code units - the earliest
 * point that owns the string.
 */
export const FORMULA_FAILURE_MESSAGE_LIMIT = 2048

export class FormulaFailure extends Error {
  readonly [MARKER] = true as const

  constructor(message: string) {
    super(
      message.length > FORMULA_FAILURE_MESSAGE_LIMIT
        ? message.slice(0, FORMULA_FAILURE_MESSAGE_LIMIT)
        : message,
    )
    // defineProperty, not assignment: under the sandbox's intrinsic lockdown
    // Error.prototype is frozen, and a strict-mode assignment through a
    // read-only inherited property throws instead of shadowing it
    Object.defineProperty(this, 'name', { value: 'FormulaFailure', configurable: true })
  }
}

export const isFormulaFailure = (value: unknown): value is FormulaFailure =>
  typeof value === 'object' && value !== null && (value as Record<string, unknown>)[MARKER] === true
