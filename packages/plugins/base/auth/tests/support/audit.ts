import { Layer } from 'effect'
import { serviceLayer as auditLayer } from '@qualy/plugin-audit/server'
import { AuditActionCatalog } from '@qualy/audit-contract/effect'
import { compileActionCatalog } from '@qualy/audit-contract/plugin'
import { userActions } from '../../src/actions.ts'

// The audit trail auth writes through, over the same database, knowing only
// auth's own actions: what a suite needs when it composes signing in without
// the rest of the plugin, now that binding an account records itself.

export const authAuditLayer = auditLayer.pipe(
  Layer.provide(
    Layer.succeed(
      AuditActionCatalog,
      compileActionCatalog([{ owner: 'auth', actions: userActions }]),
    ),
  ),
)
