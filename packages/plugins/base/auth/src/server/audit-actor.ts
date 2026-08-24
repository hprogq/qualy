import { Effect } from 'effect'
import type { AuditActor } from '@qualy/audit-contract'
import type { Principal } from '@qualy/rbac-contract'
import { db } from './db.ts'

// Who acted, with the display snapshot the trail keeps. One lookup shared by
// every recording write in this plugin, so the label is derived the same way
// everywhere - and inside a transaction it reads on that transaction's
// connection like every other query.

const displayNameOf = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('User')
      .select('displayName')
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      .executeTakeFirst(),
  )

export const actorOf = Effect.fn('Iam.actorOf')(function* (tenantId: string, as: Principal) {
  const row = yield* displayNameOf(tenantId, as.userId).pipe(Effect.orDie)
  return {
    kind: 'user',
    userId: as.userId,
    ...(row?.displayName ? { label: row.displayName } : {}),
  } satisfies AuditActor
})
