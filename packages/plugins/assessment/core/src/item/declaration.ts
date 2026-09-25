import { Effect, Schema } from 'effect'
import { ItemPayloadInvalid, type ItemTypeDriver } from '../plugin.ts'

// The question answered by claiming it: no fields, no files, one press.
// Different from a constant on purpose - a constant is granted to everybody,
// a declaration is a person saying "this is true of me", which still walks
// whatever review the question configured (§32.65). Evidence deliberately
// requires at least one field, so this is its own kind rather than a
// loosened one.

const isEmptyObject = (payload: unknown) =>
  typeof payload === 'object' &&
  payload !== null &&
  !Array.isArray(payload) &&
  Object.keys(payload).length === 0

export const declarationDriver: ItemTypeDriver = {
  id: 'declaration',
  configSchema: Schema.Struct({}),
  // The claim is the press itself, so the payload is empty. Anything else
  // sent along would be stored with every revision and served to every
  // reviewer, for nobody to read.
  decodePayload: (_config, payload) =>
    payload === undefined || payload === null || isEmptyObject(payload)
      ? Effect.succeed({})
      : Effect.fail(new ItemPayloadInvalid([{ field: '', reason: 'not-empty' }])),
  attachmentRefs: () => [],
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}
