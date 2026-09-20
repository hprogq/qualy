import { Effect } from 'effect'
import { message } from '@qualy/i18n-contract'
import type { NodeUsageReporter } from '@qualy/org-contract/plugin'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { db } from './db.ts'

// The people standing at a unit, said to whoever is about to delete it.
//
// Only the living: a removed person is detached when their unit goes, so
// they never hold one in place. The way on is the roster of exactly that
// unit, where each of them can be moved.

const EXAMPLES = 3

export const peopleAtNode: NodeUsageReporter<Orm> = {
  id: 'auth/people',
  bind: Effect.gen(function* () {
    const withDb = yield* withDatabase
    return (tenantId, orgNodeId) =>
      withDb(
        db.query(async (k) => {
          const standing = k
            .selectFrom('User')
            .where('tenantId', '=', tenantId)
            .where('primaryOrgNodeId', '=', orgNodeId)
            .where('deletedAt', 'is', null)
          const { count } = await standing
            .select((eb) => eb.fn.countAll<string>().as('count'))
            .executeTakeFirstOrThrow()
          const named = await standing
            .select('displayName')
            .orderBy('displayName')
            .limit(EXAMPLES)
            .execute()
          return [
            {
              kind: 'people',
              label: message('auth/node-usage/people', 'People standing here'),
              count: Number(count),
              clearable: true,
              examples: named.map((row) => row.displayName),
              target: { pageId: 'auth/users', search: { anchor: orgNodeId, scope: 'self' } },
            },
          ]
        }),
      ).pipe(Effect.orDie)
  }),
}
