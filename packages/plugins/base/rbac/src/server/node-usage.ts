import { Effect } from 'effect'
import { message } from '@qualy/i18n-contract'
import type { NodeUsageReporter } from '@qualy/org-contract/plugin'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { db } from './db.ts'

// The duties held over a unit, said to whoever is about to delete it.
//
// Two kinds, because they are dealt with differently. A grant in force can
// be withdrawn, and then it stops being one. A withdrawn grant is history -
// who held what over this unit, and until when - and history keeps the unit:
// it is reported so the reader is told why a unit with nothing visible on it
// still cannot go, rather than left to look for a holder who is not there.

const EXAMPLES = 3

export const grantsAtNode: NodeUsageReporter<Orm> = {
  id: 'rbac/grants',
  bind: Effect.gen(function* () {
    const withDb = yield* withDatabase
    return (tenantId, orgNodeId) =>
      withDb(
        db.query(async (k) => {
          const held = k
            .selectFrom('RoleGrant as g')
            .innerJoin('Role as r', (join) =>
              join.onRef('r.tenantId', '=', 'g.tenantId').onRef('r.id', '=', 'g.roleId'),
            )
            .innerJoin('User as u', (join) =>
              join.onRef('u.tenantId', '=', 'g.tenantId').onRef('u.id', '=', 'g.userId'),
            )
            .where('g.tenantId', '=', tenantId)
            .where('g.orgNodeId', '=', orgNodeId)
          const countOf = async (live: boolean) =>
            Number(
              (
                await held
                  .where('g.revokedAt', live ? 'is' : 'is not', null)
                  .select((eb) => eb.fn.countAll<string>().as('count'))
                  .executeTakeFirstOrThrow()
              ).count,
            )
          const named = await held
            .where('g.revokedAt', 'is', null)
            .select(['r.name as roleName', 'u.displayName', 'u.id as userId'])
            .orderBy('u.displayName')
            .limit(EXAMPLES)
            .execute()
          return [
            {
              kind: 'grants',
              label: message('rbac/node-usage/grants', 'Role grants in force here'),
              count: await countOf(true),
              examples: named.map((row) => `${row.displayName} ${row.roleName}`),
              // one holder's grants are withdrawn on their own record
              ...(named[0] === undefined
                ? {}
                : { target: { pageId: 'rbac/user-role-grants', params: { userId: named[0].userId } } }),
            },
            {
              kind: 'grant-history',
              label: message('rbac/node-usage/grant-history', 'Withdrawn role grants kept as history'),
              count: await countOf(false),
              examples: [],
            },
          ]
        }),
      ).pipe(Effect.orDie)
  }),
}
