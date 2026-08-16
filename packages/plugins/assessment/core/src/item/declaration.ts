import { Effect, Schema } from 'effect'
import type { ItemTypeDriver } from '../plugin.ts'

// The question answered by claiming it: no fields, no files, one press.
// Different from a constant on purpose - a constant is granted to everybody,
// a declaration is a person saying "this is true of me", which still walks
// whatever review the question configured (§32.65). Evidence deliberately
// requires at least one field, so this is its own kind rather than a
// loosened one.

export const declarationDriver: ItemTypeDriver = {
  id: 'declaration',
  configSchema: Schema.Struct({}),
  // there is nothing to read: the claim is the payload
  decodePayload: (_config, payload) => Effect.succeed(payload ?? {}),
  attachmentRefs: () => [],
  interaction: 'entry',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}
