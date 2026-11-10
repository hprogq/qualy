import { Effect } from 'effect'
import type { NodeUsageReporter } from '@qualy/org-contract/plugin'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import { db, inForce } from './db.ts'
import { text } from '@qualy/text'
import { messageRefs } from '@qualy/text/node'
import type * as M from '#messages'

// this package's messages, by name (docs/adr/0011-i18n-paraglide.md)
const m = messageRefs<typeof M>(import.meta.url)

// The duties held over a unit, said to whoever is about to delete it.
//
// Two kinds, because they are dealt with differently. A grant in force can
// be withdrawn, and then it stops being one. A withdrawn, expired or not-yet-active grant is retained history -
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
          const standing = held.where((eb) =>
            inForce({
              revokedAt: eb.ref('g.revokedAt'),
              validFrom: eb.ref('g.validFrom'),
              validUntil: eb.ref('g.validUntil'),
            }),
          )
          const history = held.where((eb) =>
            eb.not(
              inForce({
                revokedAt: eb.ref('g.revokedAt'),
                validFrom: eb.ref('g.validFrom'),
                validUntil: eb.ref('g.validUntil'),
              }),
            ),
          )
          const countOf = async (live: boolean) =>
            Number(
              (
                await (live ? standing : history)
                  .select((eb) => eb.fn.countAll<string>().as('count'))
                  .executeTakeFirstOrThrow()
              ).count,
            )
          const named = await standing
            .select(['r.name as roleName', 'u.displayName', 'u.id as userId'])
            .orderBy('u.displayName')
            .limit(EXAMPLES)
            .execute()
          return [
            {
              kind: 'grants',
              label: text(m.nodeUsage_grants),
              count: await countOf(true),
              clearable: true,
              examples: named.map((row) => `${row.displayName} ${row.roleName}`),
              // one holder's grants are withdrawn on their own record
              ...(named[0] === undefined
                ? {}
                : {
                    target: {
                      pageId: 'rbac/user-role-grants',
                      params: { userId: named[0].userId },
                    },
                  }),
            },
            {
              kind: 'grant-history',
              label: text(m.nodeUsage_grantHistory),
              count: await countOf(false),
              clearable: false,
              examples: [],
            },
          ]
        }),
      ).pipe(Effect.orDie)
  }),
}
