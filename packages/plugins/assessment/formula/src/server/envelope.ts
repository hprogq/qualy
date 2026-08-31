/**
 * The one strict reading of a formula's answer.
 *
 * A wrapper the compiler generated always writes a lawful envelope - so a
 * string that does not decode as one is never "close enough": it means the
 * artifact is not the wrapper's work, or the transport mangled it, and the
 * only honest answer is to say so. The shape is CLOSED: exactly the keys
 * the protocol names, nothing riding along; a failure message is capped
 * here so a forged envelope cannot carry an unbounded string to a screen.
 *
 * One parser, two consumers: authoring records a malformed answer as that
 * one case's defect and keeps evaluating the rest; scoring turns it into
 * an execution failure. The reading itself never differs.
 */

import { FORMULA_FAILURE_MESSAGE_LIMIT } from '@qualy/formula'

export type FormulaEnvelope =
  | { readonly ok: true; readonly amount: string }
  | { readonly ok: false; readonly failure: { readonly message: string } }

export type DecodedEnvelope =
  | { readonly _tag: 'envelope'; readonly envelope: FormulaEnvelope }
  | { readonly _tag: 'malformed'; readonly reason: string }

const malformed = (reason: string): DecodedEnvelope => ({ _tag: 'malformed', reason })

export const decodeFormulaEnvelope = (output: string): DecodedEnvelope => {
  let parsed: unknown
  try {
    parsed = JSON.parse(output)
  } catch {
    return malformed('the answer is not JSON')
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return malformed('the answer is not an envelope object')
  }
  const record = parsed as Record<string, unknown>
  const keys = Object.keys(record).sort().join(',')
  if (record['ok'] === true) {
    if (keys !== 'amount,ok') return malformed('a success envelope carries exactly ok and amount')
    if (typeof record['amount'] !== 'string') return malformed('the amount is not a string')
    return { _tag: 'envelope', envelope: { ok: true, amount: record['amount'] } }
  }
  if (record['ok'] === false) {
    if (keys !== 'failure,ok') return malformed('a failure envelope carries exactly ok and failure')
    const failure = record['failure']
    if (failure === null || typeof failure !== 'object' || Array.isArray(failure)) {
      return malformed('the failure is not an object')
    }
    const failureKeys = Object.keys(failure).sort().join(',')
    if (failureKeys !== 'message') return malformed('a failure carries exactly a message')
    const message = (failure as Record<string, unknown>)['message']
    if (typeof message !== 'string') return malformed('the failure message is not a string')
    return {
      _tag: 'envelope',
      envelope: {
        ok: false,
        failure: { message: message.slice(0, FORMULA_FAILURE_MESSAGE_LIMIT) },
      },
    }
  }
  return malformed('ok is not a boolean')
}
