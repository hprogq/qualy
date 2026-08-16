import { Effect, Schema } from 'effect'
import type { ItemTypeDriver } from '../plugin.ts'

// The question nobody answers: whoever stands on the roster is granted its
// amount. This is what "base points" is (terms.md: 基础分) - not a filing,
// not a review, not a button, a rule of the round. It exists as an Item so
// the account can name it line by line; a lump on the group would be nine
// points nobody can explain (§32.65).

export const constantDriver: ItemTypeDriver = {
  id: 'constant',
  configSchema: Schema.Struct({}),
  // derived questions take no filings; the guards refuse an entry long
  // before a payload could reach this
  decodePayload: (_config, payload) => Effect.succeed(payload),
  attachmentRefs: () => [],
  interaction: 'derived',
  scoring: { calculator: 'fixed@1', aggregator: 'sum@1' },
}
