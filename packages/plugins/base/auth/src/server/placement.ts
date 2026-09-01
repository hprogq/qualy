import { Effect } from 'effect'
import { sql, type Expression } from 'kysely'
import { db, type Db } from './db.ts'

// The placement rule, owned in one place because four callers decide by it and
// both plugins that can break it consult it.
//
// auth breaks it by placing or retyping a person; org breaks it by retyping the
// node they already stand at. Both diagnose it here. A second copy of this
// predicate would not fail loudly, it would answer differently, and a placement
// rule that answers differently in two places is not a rule.

/**
 * The user_types columns the rule reads, wherever the caller aliased that row.
 *
 * References rather than an alias string: the caller passes `eb.ref('t.isSystem')`
 * and a name that is not in scope, or a column that is not on that row, stops
 * compiling. The predicate used to take the alias as text, so a join could be
 * renamed with nothing noticing.
 */
export interface UserTypeRef {
  readonly isSystem: Expression<boolean>
  readonly placementMode: Expression<string>
  readonly tenantId: Expression<string>
  readonly id: Expression<string>
}

/**
 * Where a kind of person may stand.
 *
 * The type states its policy rather than having it inferred from an empty
 * list. Reading "no rows" as "anywhere" meant unchecking the last box widened
 * the rule instead of narrowing it, silently and with no stranded-user check.
 */
export const placementLegal = (
  type: UserTypeRef,
  orgTypeId: Expression<string>,
  atRoot: Expression<boolean>,
) => sql<boolean>`
  case
    -- a system identity is the tenant's way back in, so it stands at the root
    -- and nowhere else: authority over a person is authority over the node
    -- they stand at, and every node below the root has managers who are not
    -- the tenant's own administrators
    when ${type.isSystem} then ${atRoot}
    when ${type.placementMode} = 'unrestricted' then true
    else exists (
      select 1 from user_type_allowed_org_types a
      where a.tenant_id = ${type.tenantId} and a.user_type_id = ${type.id}
        and a.org_type_id = ${orgTypeId})
  end`

/** every living person, joined to the type that rules them and the node they stand at */
const standing = (k: Db) =>
  k
    .selectFrom('User as u')
    .innerJoin('UserType as t', (join) =>
      join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
    )
    .innerJoin('OrgNode as n', (join) =>
      join.onRef('n.tenantId', '=', 'u.tenantId').onRef('n.id', '=', 'u.primaryOrgNodeId'),
    )
    // a deleted person stands nowhere: they must not block a retype or a
    // policy change, and the full scan must not count them either
    .where('u.deletedAt', 'is', null)

type Standing = ReturnType<typeof standing>

/**
 * Which org type the rule is asked about.
 *
 * `standing` means the node each person is already on, which is the question a
 * full scan asks. A named type is the one a retype would move that node to,
 * which is the question org asks before it commits.
 */
type Against = { readonly at: 'standing' } | { readonly at: 'type'; readonly id: string }

/**
 * How many people a narrowed set leaves standing where their type forbids.
 *
 * A count rather than a list: which people they are is not the caller's
 * business, only that the change would strand them.
 */
const countStranded = (narrow: (query: Standing) => Standing, against: Against) =>
  db
    .query((k) =>
      narrow(standing(k))
        .select(sql<number>`count(*)::int`.as('count'))
        .where((eb) =>
          eb.not(
            placementLegal(
              {
                isSystem: eb.ref('t.isSystem'),
                placementMode: eb.ref('t.placementMode'),
                tenantId: eb.ref('t.tenantId'),
                id: eb.ref('t.id'),
              },
              against.at === 'standing' ? eb.ref('n.orgTypeId') : sql<string>`${against.id}::uuid`,
              sql<boolean>`${eb.ref('n.parentId')} is null`,
            ),
          ),
        )
        .executeTakeFirst(),
    )
    .pipe(
      Effect.orDie,
      Effect.map((row) => row?.count ?? 0),
    )

/** the people a node retype would strand, which is what org asks before it retypes */
export const usersBlockingOrgType = (tenantId: string, orgNodeId: string, orgTypeId: string) =>
  countStranded(
    (found) => found.where('u.tenantId', '=', tenantId).where('u.primaryOrgNodeId', '=', orgNodeId),
    { at: 'type', id: orgTypeId },
  )

/**
 * Where one person stands, as a peer plugin asks it.
 *
 * A fact rather than a rule: the four predicates around it answer whether a
 * KIND of person may stand somewhere, and this answers where a PARTICULAR
 * one actually does. Null covers both "no such user here" and "detached" -
 * a deleted unit sets the column null - and neither of them is a place, so
 * a caller reading an audience from this reaches nothing.
 */
export const primaryNode = (tenantId: string, userId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('User')
        .select(['primaryOrgNodeId'])
        .where('tenantId', '=', tenantId)
        .where('id', '=', userId)
        .executeTakeFirst(),
    )
    .pipe(
      Effect.orDie,
      Effect.map((row) => {
        const nodeId = (row as { primaryOrgNodeId: string | null } | undefined)?.primaryOrgNodeId
        return nodeId === null || nodeId === undefined ? null : { nodeId }
      }),
    )

/** the same predicate every individual write is decided by, asked of every row at once */
export const placementViolations = (tenantId: string) =>
  countStranded((found) => found.where('u.tenantId', '=', tenantId), {
    at: 'standing',
  })

/** the people this type would leave standing illegally, under the policy as written */
export const strandedByPolicy = (tenantId: string, userTypeId: string) =>
  countStranded(
    (found) => found.where('u.tenantId', '=', tenantId).where('u.userTypeId', '=', userTypeId),
    { at: 'standing' },
  )

/**
 * Whether this kind of person may stand at this node, by the one predicate.
 *
 * `undefined` when there is no such pairing to judge, which is a different
 * answer from "not allowed" and the caller reports it differently.
 */
export const placementAllowed = (tenantId: string, userTypeId: string, orgNodeId: string) =>
  Effect.gen(function* () {
    const row = yield* db
      .query((k) =>
        k
          .selectFrom('UserType as t')
          .innerJoin('OrgNode as n', (join) =>
            join.onRef('n.tenantId', '=', 't.tenantId').on('n.id', '=', orgNodeId),
          )
          .where('t.tenantId', '=', tenantId)
          .where('t.id', '=', userTypeId)
          .select((eb) =>
            placementLegal(
              {
                isSystem: eb.ref('t.isSystem'),
                placementMode: eb.ref('t.placementMode'),
                tenantId: eb.ref('t.tenantId'),
                id: eb.ref('t.id'),
              },
              eb.ref('n.orgTypeId'),
              sql<boolean>`${eb.ref('n.parentId')} is null`,
            ).as('legal'),
          )
          .executeTakeFirst(),
      )
      .pipe(Effect.orDie)
    return row?.legal
  })
