import { Effect } from 'effect'
import { kyselyOf, query, transaction, withDatabase } from '@qualy/plugin-database/server'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import { db, type Db, lockTenant, userTypeGuard } from './db.ts'
import { sql } from 'kysely'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import { scopeCoverage, type AuthorizationScope, type Principal } from '@qualy/rbac-contract'
import { placementAllowed } from './placement.ts'
import { Audit } from '@qualy/audit-contract/effect'
import type { AuditActor } from '@qualy/audit-contract'
import {
  UserCreated,
  UserDeleted as UserDeletedAction,
  UserDisabled,
  UserEnabled,
  UserMoved,
  UserRestored,
  UserUpdated,
} from '../actions.ts'
import {
  GrantIncompatible,
  PlacementNotAllowed,
  SystemAccountProtected,
  UserDeleted,
  UserNotDisabled,
  UserNotFound,
  UserPlacementNotFound,
  UserTypeDisabled,
  UserTypeNotFound,
  UserVersionConflict,
  businessNoConstraints,
  userConstraints,
} from './errors.ts'

// People, and where they stand.
//
// Authority over a person is authority over the node they stand at, so every
// write here re-decides that on the locked connection rather than trusting a
// check made before the lock. A transfer needs it at both ends, because moving
// someone changes who administers them.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

/**
 * The user with the system flag their type carries, which every write guard
 * reads. Deleted rows come back too - the lifecycle transition decides what a
 * deleted person may become, so the guard cannot pre-decide they are gone.
 * The type join is outer because a deleted person's type may itself be gone.
 */
const userGuard = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('User as u')
      .leftJoin('UserType as t', (join) =>
        join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
      )
      .select([
        'u.id',
        'u.displayName',
        'u.userTypeId',
        'u.primaryOrgNodeId',
        'u.enabled',
        'u.deletedAt',
        'u.version',
        't.isSystem',
      ])
      .where('u.tenantId', '=', tenantId)
      .where('u.id', '=', userId)
      .executeTakeFirst(),
  )

const orgNodeExists = (tenantId: string, orgNodeId: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgNode')
      .select('id')
      .where('tenantId', '=', tenantId)
      .where('id', '=', orgNodeId)
      .executeTakeFirst(),
  )

/**
 * What a user row carries, and whether this caller may change it.
 *
 * One builder for the list and the single read, so the two cannot disagree
 * about which columns a caller is shown or when the row counts as manageable.
 */
const people = (k: Db, manage: AuthorizationScope) =>
  k
    .selectFrom('User as u')
    // outer joins, because a DELETED person may have lost their type or unit
    // to a later cleanup; a live person always has both (schema check)
    .leftJoin('UserType as t', (join) =>
      join.onRef('t.tenantId', '=', 'u.tenantId').onRef('t.id', '=', 'u.userTypeId'),
    )
    .leftJoin('OrgNode as n', (join) =>
      join.onRef('n.tenantId', '=', 'u.tenantId').onRef('n.id', '=', 'u.primaryOrgNodeId'),
    )
    .select((eb) => [
      'u.id',
      'u.businessNo',
      'u.displayName',
      'u.enabled',
      'u.deletedAt',
      'u.version',
      'u.userTypeId',
      't.code as userTypeCode',
      't.name as userTypeName',
      'u.primaryOrgNodeId',
      'n.name as primaryOrgNodeName',
      // the ways in that still work; a revoked binding is history, not a way in
      sql<number>`(select count(*)::int from user_identities i
        where i.tenant_id = ${eb.ref('u.tenantId')} and i.user_id = ${eb.ref('u.id')}
          and i.revoked_at is null)`.as('identityCount'),
      sql<boolean>`coalesce(${scopeCoverage(manage, {
        id: eb.ref('n.id'),
        tenantId: eb.ref('n.tenantId'),
        path: eb.ref('n.path'),
      })}, false)`.as('manageable'),
    ])

/**
 * Users of one node or of its subtree, intersected with what the caller reaches.
 *
 * The requested scope alone decided this once, which meant a bare self grant at
 * a node returned every user below it. A partial subtree is the correct answer
 * here, not an error.
 */
const listUsers = (
  tenantId: string,
  scopes: { read: AuthorizationScope; manage: AuthorizationScope },
  input: {
    orgNodeId: string
    scope: 'self' | 'subtree'
    /** absent = the living (active and disabled); 'deleted' = the removed */
    status?: 'active' | 'disabled' | 'deleted'
    search?: string
    /** narrows to one kind of person, which is what a picker filters by */
    userTypeId?: string
    after?: readonly string[]
    limit: number
  },
) =>
  db.query((k) => {
    let found = people(k, scopes.manage)
      .innerJoin('OrgNode as requested', (join) =>
        join
          .onRef('requested.tenantId', '=', 'u.tenantId')
          .on('requested.id', '=', input.orgNodeId),
      )
      .where('u.tenantId', '=', tenantId)
      .where((eb) =>
        input.status === 'deleted'
          ? // A removed person whose unit was itself removed anchors nowhere,
            // so only a tenant-wide reader sees them - a subtree reader's
            // authority is defined by nodes, and there is no node to define
            // it over.
            eb.or([
              eb.and([
                eb('n.id', 'is not', null),
                input.scope === 'subtree'
                  ? sql<boolean>`${eb.ref('n.path')} <@ ${eb.ref('requested.path')}`
                  : eb('n.id', '=', eb.ref('requested.id')),
                sql<boolean>`coalesce(${scopeCoverage(scopes.read, {
                  id: eb.ref('n.id'),
                  tenantId: eb.ref('n.tenantId'),
                  path: eb.ref('n.path'),
                })}, false)`,
              ]),
              eb.and([
                eb('n.id', 'is', null),
                sql<boolean>`${scopes.read.tenantWide ? sql`true` : sql`false`}`,
              ]),
            ])
          : eb.and([
              input.scope === 'subtree'
                ? sql<boolean>`${eb.ref('n.path')} <@ ${eb.ref('requested.path')}`
                : eb('n.id', '=', eb.ref('requested.id')),
              scopeCoverage(scopes.read, {
                id: eb.ref('n.id'),
                tenantId: eb.ref('n.tenantId'),
                path: eb.ref('n.path'),
              }),
            ]),
      )
      .where((eb) =>
        input.status === 'deleted'
          ? eb('u.deletedAt', 'is not', null)
          : input.status === undefined
            ? eb('u.deletedAt', 'is', null)
            : eb.and([
                eb('u.deletedAt', 'is', null),
                eb('u.enabled', '=', input.status === 'active'),
              ]),
      )
      .orderBy('u.displayName')
      .orderBy('u.id')
      .limit(input.limit)

    if (input.userTypeId !== undefined) {
      found = found.where('u.userTypeId', '=', input.userTypeId)
    }
    if (input.search !== undefined) {
      const like = `%${input.search}%`
      // through the builder rather than one sql fragment holding an `or`: a
      // raw fragment is spliced in unparenthesised, so `and` binds tighter and
      // the clauses after it end up as alternatives to this one
      found = found.where((eb) =>
        eb.or([
          eb('u.displayName', 'ilike', like),
          sql<boolean>`coalesce(${eb.ref('u.businessNo')}, '') ilike ${like}`,
        ]),
      )
    }
    if (input.after !== undefined) {
      // the sort key in full, so a page boundary between two people sharing a
      // display name does not repeat or skip either of them
      const [name, id] = [input.after[0] ?? '', input.after[1] ?? '']
      found = found.where(
        (eb) =>
          sql<boolean>`(${eb.ref('u.displayName')}, ${eb.ref('u.id')}::text) > (${name}, ${id})`,
      )
    }
    return found.execute()
  })

export type UserProjection = Effect.Success<ReturnType<typeof listUsers>>[number]

/** one user, visible only through the caller's read scope */
const oneUser = (
  tenantId: string,
  userId: string,
  scopes: { read: AuthorizationScope; manage: AuthorizationScope },
) =>
  db.query((k) =>
    people(k, scopes.manage)
      .where('u.tenantId', '=', tenantId)
      .where('u.id', '=', userId)
      // deleted rows stay readable here - a restore screen has to show who it
      // is restoring - under the same authority: their surviving unit, or
      // tenant-wide reach when the unit is gone
      .where((eb) =>
        eb.or([
          sql<boolean>`coalesce(${scopeCoverage(scopes.read, {
            id: eb.ref('n.id'),
            tenantId: eb.ref('n.tenantId'),
            path: eb.ref('n.path'),
          })}, false)`,
          eb.and([
            eb('n.id', 'is', null),
            sql<boolean>`${scopes.read.tenantWide ? sql`true` : sql`false`}`,
          ]),
        ]),
      )
      .executeTakeFirst(),
  )

/**
 * Where somebody stands, said the way an address is: school, college, class.
 *
 * The node's own name answers "which class" but never "whose", and a reader
 * meeting an unfamiliar name needs the second more than the first.
 */
const ancestryOf = (tenantId: string, orgNodeId: string, read: AuthorizationScope) =>
  db.query((k) =>
    k
      .selectFrom('OrgNode as a')
      .innerJoin('OrgNode as n', (join) =>
        join.onRef('n.tenantId', '=', 'a.tenantId').on('n.id', '=', orgNodeId),
      )
      .select(['a.id', 'a.name', 'a.depth'])
      .where('a.tenantId', '=', tenantId)
      .where(sql<boolean>`a.path @> n.path`)
      // trimmed to the reader's own reach: being allowed to read a person is
      // not being allowed to walk the organization above them
      .where((eb) =>
        scopeCoverage(read, {
          id: eb.ref('a.id'),
          tenantId: eb.ref('a.tenantId'),
          path: eb.ref('a.path'),
        }),
      )
      .orderBy('a.depth')
      .execute(),
  )

/**
 * The ways one person can sign in, as somebody administering them reads it.
 *
 * The identifier is shown because an administrator looking at a stale
 * binding needs to know which account it points at; the credential itself is
 * never selected. `lastUsedAt` is the only evidence available that a binding
 * still works, and a null one is a binding nobody has ever come through.
 */
const identitiesOf = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .selectFrom('UserIdentity as i')
      .innerJoin('AuthProvider as p', (join) =>
        join.onRef('p.tenantId', '=', 'i.tenantId').onRef('p.id', '=', 'i.authProviderId'),
      )
      .select((eb) => [
        'i.id',
        'i.identifier',
        'i.boundAt',
        'i.lastUsedAt',
        'p.id as providerId',
        'p.name as providerName',
        'p.type as providerType',
        'p.enabled as providerEnabled',
        // whether the binding carries a secret of its own, which is what
        // separates a local account from a federated one
        eb('i.credentialHash', 'is not', null).as('hasCredential'),
      ])
      .where('i.tenantId', '=', tenantId)
      .where('i.userId', '=', userId)
      // the ways in that still work; withdrawn bindings are history
      .where('i.revokedAt', 'is', null)
      .orderBy('p.sortOrder')
      .orderBy('p.name')
      .execute(),
  )

/**
 * The nodes a caller may place people at.
 *
 * These are the nodes actually inside the caller's coverage, not the anchors
 * their grants happen to sit on: a subtree grant at a college means every
 * department under it is a place a user may stand, and returning only the
 * anchor made those unreachable.
 */
const placeableNodes = (
  tenantId: string,
  scopes: { read: AuthorizationScope; manage: AuthorizationScope },
  search: string | undefined,
  limit: number,
) =>
  db.query((k) => {
    let found = k
      .selectFrom('OrgNode as n')
      .select((eb) => [
        'n.id',
        'n.name',
        'n.depth',
        'n.orgTypeId',
        // the parent, not the path: a picker needs the shape of the tree, and
        // the materialized path is the database's own addressing - handing it
        // over publishes the shape of an organization to whoever holds a leaf
        'n.parentId',
        // how many people stand here, at this node itself. A tree of names
        // with no numbers on it cannot answer "is this unit empty", which is
        // the question every reader arrives at it with - and the one that
        // decides whether a unit may be deleted.
        sql<number>`(select count(*)::int from users u
          where u.tenant_id = ${eb.ref('n.tenantId')} and u.primary_org_node_id = ${eb.ref('n.id')}
            and u.deleted_at is null)`.as('userCount'),
        scopeCoverage(scopes.manage, {
          id: eb.ref('n.id'),
          tenantId: eb.ref('n.tenantId'),
          path: eb.ref('n.path'),
        }).as('manageable'),
      ])
      .where('n.tenantId', '=', tenantId)
      .where((eb) =>
        scopeCoverage(scopes.read, {
          id: eb.ref('n.id'),
          tenantId: eb.ref('n.tenantId'),
          path: eb.ref('n.path'),
        }),
      )
      .orderBy('n.path')
      // one more than asked for, which is how the caller knows to say so
      .limit(limit + 1)
    if (search !== undefined) found = found.where('n.name', 'ilike', `%${search}%`)
    return found.execute()
  })

/**
 * Assignable types with the org types each may stand at.
 *
 * One statement so the screen can pair a person with a place without a second
 * round trip. A system type is provisioned rather than assigned, so it never
 * appears.
 */
/** the kinds of unit there are, so a picker can label and filter by them */
const orgTypesOf = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('OrgType')
      .select(['id', 'name'])
      .where('tenantId', '=', tenantId)
      .orderBy('name')
      .execute(),
  )

const assignableUserTypes = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('UserType as t')
      .select((eb) => [
        't.id',
        't.code',
        't.name',
        sql<'unrestricted' | 'allow-list'>`t.placement_mode`.as('placementMode'),
        sql<string[]>`coalesce(
          (select array_agg(a.org_type_id::text) from user_type_allowed_org_types a
           where a.tenant_id = ${eb.ref('t.tenantId')} and a.user_type_id = ${eb.ref('t.id')}),
          '{}')`.as('allowedOrgTypeIds'),
      ])
      .where('t.tenantId', '=', tenantId)
      .where('t.enabled', '=', true)
      .where('t.isSystem', '=', false)
      .orderBy('t.sortOrder')
      .orderBy('t.code')
      .execute(),
  )

const insertUser = (input: {
  tenantId: string
  displayName: string
  userTypeId: string
  primaryOrgNodeId: string
  businessNo: string | null
}) => db.query((k) => k.insertInto('User').values(input).returning('id').executeTakeFirstOrThrow())

// every lifecycle write bumps the version, so a stale-read edit is refused
const bump = { version: sql<number>`version + 1`, updatedAt: sql<Date>`now()` }

const updateUser = (
  tenantId: string,
  userId: string,
  fields: { displayName?: string; userTypeId?: string; businessNo?: string },
) =>
  db.query((k) =>
    k
      .updateTable('User')
      .set({
        ...(fields.displayName === undefined ? {} : { displayName: fields.displayName }),
        ...(fields.userTypeId === undefined ? {} : { userTypeId: fields.userTypeId }),
        ...(fields.businessNo === undefined ? {} : { businessNo: fields.businessNo }),
        ...bump,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      .execute(),
  )

const setUserPlacement = (tenantId: string, userId: string, primaryOrgNodeId: string) =>
  db.query((k) =>
    k
      .updateTable('User')
      .set({ primaryOrgNodeId, ...bump })
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      .execute(),
  )

const setUserEnabled = (tenantId: string, userId: string, enabled: boolean) =>
  db.query((k) =>
    k
      .updateTable('User')
      .set({ enabled, ...bump })
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      .execute(),
  )

/** the person leaves; the row stays, because history names it */
const markUserDeleted = (tenantId: string, userId: string) =>
  db.query((k) =>
    k
      .updateTable('User')
      .set({ deletedAt: sql<Date>`now()`, ...bump })
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      .execute(),
  )

/** back to DISABLED, on the stated standing; enabling is a second, explicit act */
const markUserRestored = (
  tenantId: string,
  userId: string,
  placement: { userTypeId: string; primaryOrgNodeId: string },
) =>
  db.query((k) =>
    k
      .updateTable('User')
      .set({
        deletedAt: null,
        enabled: false,
        userTypeId: placement.userTypeId,
        primaryOrgNodeId: placement.primaryOrgNodeId,
        ...bump,
      })
      .where('tenantId', '=', tenantId)
      .where('id', '=', userId)
      .execute(),
  )

/**
 * Withdraws every live way in, attributed to whoever deleted the person.
 * Restore does not undo this: a door that stopped being theirs must not
 * open again on its own.
 */
const revokeUserIdentities = (tenantId: string, userId: string, actorId: string) =>
  db
    .query((k) =>
      k
        .updateTable('UserIdentity')
        .set({ revokedAt: sql<Date>`now()`, revokedBy: actorId })
        .where('tenantId', '=', tenantId)
        .where('userId', '=', userId)
        .where('revokedAt', 'is', null)
        .returning('id')
        .execute(),
    )
    .pipe(Effect.map((found) => found.length))

/** a disabled user loses access now, not when their session happens to expire */
const deleteUserSessions = (tenantId: string, userId: string) =>
  db
    .query((k) =>
      k
        .deleteFrom('Session')
        .where('tenantId', '=', tenantId)
        .where('userId', '=', userId)
        .returning('id')
        .execute(),
    )
    .pipe(Effect.map((found) => found.length))

/** the display snapshot an audit event keeps of whoever acted */
const actorLabelOf = (tenantId: string, userId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('User')
        .select('displayName')
        .where('tenantId', '=', tenantId)
        .where('id', '=', userId)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.displayName))

type TypeRow = NonNullable<Effect.Success<ReturnType<typeof userTypeGuard>>>

export const make = Effect.fn('Iam.users.make')(function* () {
  const rbac = yield* Rbac
  const audit = yield* Audit
  // a plain read opens no transaction, so it has nothing to take a database
  // from; supplying it here keeps the requirement off everybody who calls
  const withDb = yield* withDatabase

  const write = <A, E, R>(tenantId: string, body: () => Effect.Effect<A, E, R>) =>
    withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          return yield* body()
        }),
      ),
    ).pipe(
      translateConstraints(userConstraints),
      Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
    )

  /** authority over a person is authority over the node they stand at */
  const manages = Effect.fn('Iam.users.manages')(function* (as: Principal, orgNodeId: string) {
    if (!(yield* rbac.canAt(as, 'auth.user.manage', orgNodeId))) {
      return yield* new AccessDenied({ reason: 'not allowed to administer users at this node' })
    }
  })

  const requireUser = Effect.fn('Iam.users.require')(function* (tenantId: string, userId: string) {
    const row = yield* userGuard(tenantId, userId)
    if (!row) return yield* new UserNotFound()
    return row
  })

  type GuardRow = NonNullable<Effect.Success<ReturnType<typeof userGuard>>>

  /** every path but the lifecycle transition refuses a deleted person */
  const requireLiveUser = Effect.fn('Iam.users.requireLive')(function* (
    tenantId: string,
    userId: string,
  ) {
    const row = yield* requireUser(tenantId, userId)
    if (row.deletedAt !== null) return yield* new UserDeleted()
    return row
  })

  /** the row moved since the caller read it; they re-read and decide again */
  const requireVersion = Effect.fn('Iam.users.requireVersion')(function* (
    row: GuardRow,
    expected: number,
  ) {
    if (row.version !== expected) return yield* new UserVersionConflict()
  })

  /** who acted, with the display snapshot the trail keeps */
  const actorOf = Effect.fn('Iam.users.actorOf')(function* (tenantId: string, as: Principal) {
    const label = yield* actorLabelOf(tenantId, as.userId).pipe(Effect.orDie)
    return { kind: 'user', userId: as.userId, ...(label ? { label } : {}) } satisfies AuditActor
  })

  const requireType = Effect.fn('Iam.users.requireType')(function* (
    tenantId: string,
    userTypeId: string,
  ) {
    const row = yield* userTypeGuard(tenantId, userTypeId)
    if (!row) return yield* new UserTypeNotFound()
    return row
  })

  /** a system user type is provisioned, not assigned */
  const mayAssignType = Effect.fn('Iam.users.mayAssignType')(function* (type: TypeRow) {
    if (type.isSystem) {
      return yield* new AccessDenied({ reason: 'a system user type is provisioned, not assigned' })
    }
  })

  const requirePlacement = Effect.fn('Iam.users.requirePlacement')(function* (
    tenantId: string,
    userTypeId: string,
    orgNodeId: string,
  ) {
    const legal = yield* placementAllowed(tenantId, userTypeId, orgNodeId)
    // no row is not the same answer as a refusal: it means there is no such
    // type or node to judge in the first place
    if (legal === undefined) return yield* new UserTypeNotFound()
    if (!legal) return yield* new PlacementNotAllowed()
  })

  const requireOrgNode = Effect.fn('Iam.users.requireOrgNode')(function* (
    tenantId: string,
    orgNodeId: string,
  ) {
    if (!(yield* orgNodeExists(tenantId, orgNodeId))) {
      return yield* new UserPlacementNotFound()
    }
  })

  /**
   * Which users the caller may see, and which they may change.
   *
   * Two permissions, two answers: a read-only administrator gets a screen
   * without buttons rather than buttons that answer 403. Both are resolved
   * once and pushed into the statement, so the page is never assembled and
   * then filtered.
   */
  const scopes = Effect.fn('Iam.users.scopes')(function* (principal: Principal) {
    return {
      read: yield* rbac.listAuthorizedScope(principal, 'auth.user.read'),
      manage: yield* rbac.listAuthorizedScope(principal, 'auth.user.manage'),
    }
  })

  const readable = (scope: { read: { tenantWide: boolean; anchors: readonly unknown[] } }) =>
    scope.read.tenantWide || scope.read.anchors.length > 0

  /** the same effect, with this layer's database supplied */
  const bound =
    <Args extends unknown[], A, E, R>(fn: (...args: Args) => Effect.Effect<A, E, R>) =>
    (...args: Args) =>
      withDb(fn(...args))

  return {
    list: bound(
      Effect.fn('Iam.users.list')(function* (
        principal: Principal,
        input: {
          orgNodeId: string
          scope: 'self' | 'subtree'
          status?: 'active' | 'disabled' | 'deleted'
          search?: string
          userTypeId?: string
          after?: readonly string[]
          limit: number
        },
      ) {
        const held = yield* scopes(principal)
        if (!readable(held)) return []
        return yield* listUsers(principal.tenantId, held, input).pipe(Effect.orDie)
      }),
    ),

    get: bound(
      Effect.fn('Iam.users.get')(function* (principal: Principal, userId: string) {
        const held = yield* scopes(principal)
        const row = yield* oneUser(principal.tenantId, userId, held).pipe(Effect.orDie)
        // not-found and not-readable are indistinguishable on purpose
        if (!row) return yield* new UserNotFound()
        return row
      }),
    ),

    /**
     * One person as somebody who does not know them reads it: where they
     * stand, spelled out from the top, and what they have been given.
     *
     * Behind the same read authority as the person themselves - it says more
     * about them, not less - and the duties come from whoever owns them.
     */
    detail: bound(
      Effect.fn('Iam.users.detail')(function* (principal: Principal, userId: string) {
        const held = yield* scopes(principal)
        const row = yield* oneUser(principal.tenantId, userId, held).pipe(Effect.orDie)
        if (!row) return yield* new UserNotFound()
        const rbac = yield* Rbac
        const [orgPath, roles, identities] = yield* Effect.all([
          row.primaryOrgNodeId === null
            ? Effect.succeed([])
            : ancestryOf(principal.tenantId, row.primaryOrgNodeId, held.read).pipe(Effect.orDie),
          rbac.listUserRoles(principal.tenantId, userId),
          identitiesOf(principal.tenantId, userId).pipe(Effect.orDie),
        ])
        return { user: row, orgPath, roles, identities }
      }),
    ),

    /**
     * Where the caller may administer users, and which types they may hand out.
     *
     * One call, so the screen needs no permission but its own: making it also
     * carry the org-tree and user-type read permissions would sit a legitimate
     * org administrator in front of an empty picker.
     */
    options: bound(
      Effect.fn('Iam.users.options')(function* (
        principal: Principal,
        search: string | undefined,
        limit: number,
      ) {
        const held = yield* scopes(principal)
        if (!readable(held)) {
          return { nodes: [], truncated: false, orgTypes: [], userTypes: [] }
        }
        const nodes = yield* placeableNodes(principal.tenantId, held, search, limit).pipe(
          Effect.orDie,
        )
        const userTypes = yield* assignableUserTypes(principal.tenantId).pipe(Effect.orDie)
        const orgTypes = yield* orgTypesOf(principal.tenantId).pipe(Effect.orDie)
        return {
          nodes: nodes.slice(0, limit).map((row) => ({
            orgNodeId: row.id,
            name: row.name,
            // a parent outside the caller's reach is not named: the tree they
            // are shown starts where their authority does
            parentId: nodes.some((other) => other.id === row.parentId) ? row.parentId : null,
            depth: row.depth,
            orgTypeId: row.orgTypeId,
            userCount: row.userCount,
            manageable: row.manageable,
          })),
          // a picker that quietly showed the first five hundred of a large tree
          // looked complete; saying so lets the screen ask for a search instead
          truncated: nodes.length > limit,
          orgTypes: orgTypes.map((row) => ({ id: row.id as string, name: row.name as string })),
          userTypes: userTypes.map((row) => ({
            id: row.id,
            code: row.code,
            name: row.name,
            placementPolicy:
              row.placementMode === 'allow-list'
                ? { mode: 'allow-list' as const, orgTypeIds: row.allowedOrgTypeIds }
                : { mode: 'unrestricted' as const },
          })),
        }
      }),
    ),

    create: Effect.fn('Iam.users.create')(function* (
      tenantId: string,
      input: {
        displayName: string
        userTypeId: string
        primaryOrgNodeId: string
        businessNo?: string
      },
      as: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          // authority follows the node the user will stand on
          yield* manages(as, input.primaryOrgNodeId)
          const type = yield* requireType(tenantId, input.userTypeId)
          if (!type.enabled) return yield* new UserTypeDisabled()
          yield* mayAssignType(type)
          yield* requireOrgNode(tenantId, input.primaryOrgNodeId)
          yield* requirePlacement(tenantId, type.id, input.primaryOrgNodeId)
          const created = yield* insertUser({
            tenantId,
            displayName: input.displayName,
            userTypeId: type.id,
            primaryOrgNodeId: input.primaryOrgNodeId,
            businessNo: input.businessNo ?? null,
          })
          yield* audit.record(UserCreated, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: created.id, label: input.displayName },
            details: { userTypeId: type.id, orgNodeId: input.primaryOrgNodeId },
          })
          return created.id
          // the business-number index is only reachable from the two
          // statements that write it, so its translation lives with them
        }).pipe(translateConstraints(businessNoConstraints)),
      )
    }),

    /**
     * Changing someone's type is the cross-domain case.
     *
     * It has to stay compatible with the grants they already hold, and it must
     * not take away the tenant's last way in.
     */
    update: Effect.fn('Iam.users.update')(function* (
      tenantId: string,
      userId: string,
      fields: { displayName?: string; userTypeId?: string; businessNo?: string },
      expectedVersion: number,
      as: Principal,
    ) {
      yield* write(tenantId, () =>
        Effect.gen(function* () {
          const user = yield* requireLiveUser(tenantId, userId)
          yield* requireVersion(user, expectedVersion)
          yield* manages(as, user.primaryOrgNodeId!)
          const changingType =
            fields.userTypeId !== undefined && fields.userTypeId !== user.userTypeId
          if (changingType) {
            if (user.isSystem) return yield* new SystemAccountProtected()
            const type = yield* requireType(tenantId, fields.userTypeId!)
            if (!type.enabled) return yield* new UserTypeDisabled()
            yield* mayAssignType(type)
            // the new type must also permit where this person already stands
            yield* requirePlacement(tenantId, type.id, user.primaryOrgNodeId!)
            // asked of rbac rather than read here: these are its tables, and
            // it answers on this transaction because the connection is in the
            // fiber
            const blocking = yield* rbac.grantsBlockingUserType(tenantId, user.id, type.id)
            if (blocking > 0) return yield* new GrantIncompatible({ grantCount: blocking })
          }
          yield* updateUser(tenantId, user.id, fields)
          yield* audit.record(UserUpdated, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: user.id, label: user.displayName },
            details: {
              fields: (['displayName', 'userTypeId', 'businessNo'] as const).filter(
                (field) => fields[field] !== undefined,
              ),
            },
          })
          // a type change can move the last administrator onto a type that
          // cannot sign in at all
          if (changingType) yield* rbac.assertTenantKeepsAdministrator(tenantId)
        }).pipe(translateConstraints(businessNoConstraints)),
      )
    }),

    /**
     * Moving someone is not an ordinary field edit.
     *
     * It changes who administers them, so both ends must be inside the
     * caller's own authority.
     */
    setPlacement: Effect.fn('Iam.users.setPlacement')(function* (
      tenantId: string,
      userId: string,
      primaryOrgNodeId: string,
      expectedVersion: number,
      as: Principal,
    ) {
      yield* write(tenantId, () =>
        Effect.gen(function* () {
          const user = yield* requireLiveUser(tenantId, userId)
          yield* requireVersion(user, expectedVersion)
          if (user.isSystem) return yield* new SystemAccountProtected()
          yield* manages(as, user.primaryOrgNodeId!)
          yield* manages(as, primaryOrgNodeId)
          yield* requireOrgNode(tenantId, primaryOrgNodeId)
          // a transfer may not put someone where their kind of person may not be
          yield* requirePlacement(tenantId, user.userTypeId!, primaryOrgNodeId)
          yield* setUserPlacement(tenantId, user.id, primaryOrgNodeId)
          yield* audit.record(UserMoved, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: user.id, label: user.displayName },
            organizationId: primaryOrgNodeId,
            details: { fromOrgNodeId: user.primaryOrgNodeId!, toOrgNodeId: primaryOrgNodeId },
          })
        }),
      )
    }),

    /**
     * The whole lifecycle through one door: active <-> disabled, disabled ->
     * deleted, deleted -> disabled. Deletion starts from disabled and restore
     * lands on disabled, so "can they act right now" never changes by more
     * than one step, and each step is its own permission.
     */
    setStatus: Effect.fn('Iam.users.setStatus')(function* (
      tenantId: string,
      userId: string,
      input: {
        status: 'active' | 'disabled' | 'deleted'
        expectedVersion: number
        /** restore only: where the person comes back, when the old standing is gone */
        userTypeId?: string
        primaryOrgNodeId?: string
      },
      as: Principal,
    ) {
      yield* write(tenantId, () =>
        Effect.gen(function* () {
          const user = yield* requireUser(tenantId, userId)
          yield* requireVersion(user, input.expectedVersion)

          if (user.deletedAt !== null) {
            // asking for what is already true is agreement, not an error
            if (input.status === 'deleted') return
            // there is no shortcut past disabled: restore hands back the
            // person, not their access
            if (input.status === 'active') return yield* new UserDeleted()

            const userTypeId = input.userTypeId ?? user.userTypeId
            const orgNodeId = input.primaryOrgNodeId ?? user.primaryOrgNodeId
            if (userTypeId === null) return yield* new UserTypeNotFound()
            if (orgNodeId === null) return yield* new UserPlacementNotFound()
            if (!(yield* rbac.canAt(as, 'auth.user.restore', orgNodeId))) {
              return yield* new AccessDenied({ reason: 'not allowed to restore users here' })
            }
            const type = yield* requireType(tenantId, userTypeId)
            if (!type.enabled) return yield* new UserTypeDisabled()
            yield* mayAssignType(type)
            yield* requireOrgNode(tenantId, orgNodeId)
            yield* requirePlacement(tenantId, type.id, orgNodeId)
            yield* markUserRestored(tenantId, user.id, {
              userTypeId: type.id,
              primaryOrgNodeId: orgNodeId,
            })
            // identities and grants stay withdrawn: what comes back is the
            // person's continuity, not their access
            yield* audit.record(UserRestored, {
              tenantId,
              actor: yield* actorOf(tenantId, as),
              target: { id: user.id, label: user.displayName },
              organizationId: orgNodeId,
              details: { userTypeId: type.id, orgNodeId },
            })
            return
          }

          if (input.status === 'deleted') {
            if (user.isSystem) return yield* new SystemAccountProtected()
            if (user.enabled) return yield* new UserNotDisabled()
            if (!(yield* rbac.canAt(as, 'auth.user.delete', user.primaryOrgNodeId!))) {
              return yield* new AccessDenied({ reason: 'not allowed to delete users here' })
            }
            // authority falls first, then the ways in, then the person; all
            // of it one transaction, so no order is ever observable
            const revokedGrants = yield* rbac.revokeAllGrantsOfUser(tenantId, user.id, as.userId)
            const revokedIdentities = yield* revokeUserIdentities(tenantId, user.id, as.userId)
            const endedSessions = yield* deleteUserSessions(tenantId, user.id)
            yield* markUserDeleted(tenantId, user.id)
            yield* audit.record(UserDeletedAction, {
              tenantId,
              actor: yield* actorOf(tenantId, as),
              target: { id: user.id, label: user.displayName },
              ...(user.primaryOrgNodeId === null ? {} : { organizationId: user.primaryOrgNodeId }),
              details: {
                userTypeId: user.userTypeId,
                orgNodeId: user.primaryOrgNodeId,
                revokedGrants,
                revokedIdentities,
                endedSessions,
              },
            })
            // no administrator check: deletion starts from disabled, and a
            // disabled person was already no survivor
            return
          }

          const enabled = input.status === 'active'
          if (user.enabled === enabled) return
          if (!enabled && user.isSystem) return yield* new SystemAccountProtected()
          yield* manages(as, user.primaryOrgNodeId!)
          yield* setUserEnabled(tenantId, user.id, enabled)
          yield* audit.record(enabled ? UserEnabled : UserDisabled, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: user.id, label: user.displayName },
            details: {},
          })
          if (!enabled) {
            // a disabled user loses access now, not when their session
            // happens to expire
            yield* deleteUserSessions(tenantId, user.id)
            yield* rbac.assertTenantKeepsAdministrator(tenantId)
          }
        }),
      )
    }),
  }
})
