import { sql, type SQL } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Placement } from '@qualy/auth-contract'
import type { Principal } from '@qualy/rbac-contract'
import { LegacySql, type Orm } from '@qualy/plugin-database/server'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import {
  DEFAULT_PAGE_SIZE,
  QUALY_API_ID,
  QUALY_API_PREFIX,
  encodeQueryCursor,
  readQueryCursor,
} from '@qualy/api-kit'
import { cursorUnusable, pageSize } from '@qualy/api-kit/schema'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import {
  strandedByQuery,
  usersBlockingOrgTypeQuery,
  type UserRow as UserProjection,
} from '../iam/queries.ts'
import { identityApiGroup, sessionApiGroup } from '../api.ts'
import { LoginDrivers, LoginSessions } from '@qualy/auth-contract/login'
import { AuthConfig, SignIn, layer as signInLayer } from './sign-in.ts'
import { AuthRequired, CurrentUser } from './session.ts'
import { make as makeUserTypes, type UserTypeRow } from './user-types.ts'
import { make as makeUsers } from './users.ts'
import { Authenticated, Viewer, layer as sessionLayer, viewerLayer } from './session.ts'

// auth as an Effect layer.
//
// It provides two tags from one construction. `Placement` is the port org
// holds: one question, no database types crossing it, because the connection
// travels in the fiber and there is nothing left to pass. `Iam` is auth's own
// surface, which its handlers use and no peer does.
//
// Like rbac, this reads org's tables by raw SQL and never holds the org
// service. Keeping it that way is what keeps the service graph acyclic.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

export class Iam extends Context.Service<
  Iam,
  {
    readonly placementViolations: (tenantId: string) => Effect.Effect<number>
    readonly userTypes: Effect.Success<ReturnType<typeof makeUserTypes>>
    readonly users: Effect.Success<ReturnType<typeof makeUsers>>
  }
>()('@qualy/plugin-auth/Iam') {}

export const make = Effect.fn('Auth.make')(function* () {
  const database = yield* LegacySql
  const userTypes = yield* makeUserTypes()
  const users = yield* makeUsers()

  const countStranded = (query: SQL) =>
    database.execute(query).pipe(
      Effect.orDie,
      Effect.map((result) => Number(rows<{ count: number }>(result)[0]?.count ?? 0)),
    )

  return {
    placement: {
      // org asks before it retypes a node: the people standing there do not
      // move, so the node changing under them strands them exactly as a
      // transfer would. Called inside org's locked transaction, it joins that
      // transaction and therefore sees the retype that has not committed yet.
      usersBlockingOrgType: (tenantId: string, orgNodeId: string, orgTypeId: string) =>
        countStranded(usersBlockingOrgTypeQuery(tenantId, orgNodeId, orgTypeId)),
    },
    iam: {
      // the same predicate every individual write is decided by, asked of
      // every row at once. Written through strandedByQuery rather than spelled
      // out again, because a second copy is how the rule starts answering two
      // different things.
      placementViolations: (tenantId: string) =>
        countStranded(strandedByQuery(sql`u.tenant_id = ${tenantId}`, sql`n.org_type_id`)),
      userTypes,
      users,
    },
  }
})

/**
 * What this plugin contributes.
 *
 * One construction provides both tags, so the port org holds and the surface
 * auth's own handlers use come from the same state rather than two.
 */
const tags: Layer.Layer<Placement | Iam, never, Orm | Rbac> = Layer.effectContext(
  Effect.gen(function* () {
    const { placement, iam } = yield* make()
    return Context.empty().pipe(Context.add(Placement, placement), Context.add(Iam, iam))
  }),
)

/**
 * What this plugin contributes.
 *
 * The session middleware ships with it because auth owns sessions, and any
 * plugin's endpoint may declare it. Merging it alongside is safe here for the
 * reason the ui authorizer is: it is a required service, so an endpoint that
 * declares the middleware cannot be composed into an assembly that does not
 * provide it. The requirement reaches the entry point and fails the build.
 */
export const layer: Layer.Layer<
  Placement | Iam | Authenticated | Viewer | SignIn | LoginSessions,
  never,
  Orm | Rbac | AuthConfig | LoginDrivers
> = Layer.mergeAll(tags, sessionLayer, viewerLayer, signInLayer)

// --- api ---

// Rows leave the database in snake_case; the contract describes camelCase.
/**
 * What a reader is told, which for a system identity is not what the row stores.
 *
 * The rule enforced for a system type ignores placement_mode entirely: it may
 * stand at the tenant root and nowhere else. Reporting the stored column told
 * an administrator the recovery account may stand anywhere while every write
 * refused anything but the root.
 */
const placementModeOf = (row: { is_system: boolean; placement_mode: string }) =>
  row.is_system ? ('tenant-root' as const) : (row.placement_mode as 'unrestricted' | 'allow-list')

const toUserTypeDto = (row: UserTypeRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  allowLocalLogin: row.allow_local_login,
  allowSsoLogin: row.allow_sso_login,
  status: row.enabled ? ('active' as const) : ('disabled' as const),
  isSystem: row.is_system,
  sortOrder: row.sort_order,
  version: row.version,
  userCount: row.user_count,
  placementPolicy:
    placementModeOf(row) === 'allow-list'
      ? { mode: 'allow-list' as const, orgTypeIds: row.allowed_org_types }
      : { mode: placementModeOf(row) as 'unrestricted' | 'tenant-root' },
})

// see QUALY_API_ID: implemented against a local api so this plugin does not
// import the aggregate it is part of
const local = HttpApi.make(QUALY_API_ID)
  .add(identityApiGroup)
  .add(sessionApiGroup)
  .prefix(QUALY_API_PREFIX)

export const sessionApiHandlers = HttpApiBuilder.group(local, 'auth', (handlers) =>
  handlers
    .handle(
      'listLoginMethods',
      Effect.fn('auth.listLoginMethods.handler')(function* () {
        const signIn = yield* SignIn
        return { methods: yield* signIn.loginMethods() }
      }),
    )
    .handle(
      'getSession',
      Effect.fn('auth.getSession.handler')(function* () {
        const signIn = yield* SignIn
        const principal = yield* CurrentUser
        const user = yield* signIn.loadUser(principal.tenantId, principal.userId)
        // the middleware resolved the session a moment ago; if the account is
        // gone now, that is a lapsed session rather than a missing person
        if (!user) return yield* new AuthRequired()
        return { user }
      }),
    )
    .handle(
      'endSession',
      Effect.fn('auth.endSession.handler')(function* () {
        const signIn = yield* SignIn
        // the caller may or may not have had one; either way they end up
        // without one, which is what they asked for
        yield* signIn.endSession()
        return { ok: true as const }
      }),
    ),
)

/**
 * How much of a tree a picker will render before it says it stopped.
 *
 * Not a page: this list is a tree the screen expands, so a cursor would be
 * meaningless. It reports truncation instead, which lets the screen ask for a
 * search rather than quietly presenting a prefix as the whole.
 */
const USER_OPTIONS_LIMIT = 200

/**
 * Reading users is org-scope and held per anchor, so the gate is "anywhere at
 * all"; which users come back is the query's own decision.
 *
 * `require` refuses an org-node code as a caller mistake and dies, so using it
 * here answered 500 for everyone, including a tenant administrator holding the
 * permission tenant-wide.
 */
const requireUserRead = Effect.fn('iam.requireUserRead')(function* (principal: Principal) {
  const rbac = yield* Rbac
  if (!(yield* rbac.hasPermission(principal, 'auth.user.read'))) {
    return yield* new AccessDenied({ reason: 'permission not held' })
  }
})

const toUserDto = (row: UserProjection) => ({
  id: row.id,
  businessNo: row.business_no,
  displayName: row.display_name,
  status: row.enabled ? ('active' as const) : ('disabled' as const),
  userType: { id: row.user_type_id, code: row.user_type_code, name: row.user_type_name },
  primaryOrgNode: { id: row.primary_org_node_id, name: row.primary_org_node_name },
  identityCount: row.identity_count,
  manageable: row.manageable,
})

export const identityApiHandlers = HttpApiBuilder.group(local, 'identity', (handlers) =>
  handlers
    .handle(
      'createUserType',
      Effect.fn('iam.createUserType.handler')(function* ({ payload }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.manage')
        return { id: yield* iam.userTypes.create(principal.tenantId, payload) }
      }),
    )
    .handle(
      'getUserTypeOptions',
      Effect.fn('iam.getUserTypeOptions.handler')(function* () {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.read')
        return { orgTypes: yield* iam.userTypes.orgTypeOptions(principal.tenantId) }
      }),
    )
    .handle(
      'getUserOptions',
      Effect.fn('iam.getUserOptions.handler')(function* ({ query }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* requireUserRead(principal)
        return yield* iam.users.options(
          principal,
          query.search,
          pageSize(query.limit, USER_OPTIONS_LIMIT),
        )
      }),
    )
    .handle(
      'listUsers',
      Effect.fn('iam.listUsers.handler')(function* ({ query }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* requireUserRead(principal)
        const limit = pageSize(query.limit, DEFAULT_PAGE_SIZE)
        const scope = query.scope ?? 'subtree'
        // the cursor belongs to this anchor, scope and search and no other
        const fingerprint = `users:${query.orgNodeId}:${scope}:${query.search ?? ''}`
        const key = readQueryCursor(query.cursor, fingerprint, 2)
        if (key === null) return yield* cursorUnusable()
        const found = yield* iam.users.list(principal, {
          orgNodeId: query.orgNodeId,
          scope,
          search: query.search,
          after: key,
          limit: limit + 1,
        })
        const items = found.slice(0, limit)
        const last = items.at(-1)
        return {
          items: items.map(toUserDto),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.display_name, last.id])
              : null,
        }
      }),
    )
    .handle(
      'getUser',
      Effect.fn('iam.getUser.handler')(function* ({ params }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* requireUserRead(principal)
        return { user: toUserDto(yield* iam.users.get(principal, params.userId)) }
      }),
    )
    .handle(
      'listUserTypes',
      Effect.fn('iam.listUserTypes.handler')(function* () {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.read')
        const userTypes = yield* iam.userTypes.list(principal.tenantId)
        return {
          userTypes: userTypes.map(toUserTypeDto),
          capabilities: {
            canManage: yield* rbac.hasPermission(principal, 'auth.user-type.manage'),
          },
        }
      }),
    )
    .handle(
      'getUserType',
      Effect.fn('iam.getUserType.handler')(function* ({ params }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.read')
        return {
          userType: toUserTypeDto(yield* iam.userTypes.get(principal.tenantId, params.userTypeId)),
        }
      }),
    )
    .handle(
      'updateUserType',
      Effect.fn('iam.updateUserType.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.manage')
        const { version, ...fields } = payload
        return {
          version: yield* iam.userTypes.update(
            principal.tenantId,
            params.userTypeId,
            fields,
            version,
          ),
        }
      }),
    )
    .handle(
      'setUserTypeStatus',
      Effect.fn('iam.setUserTypeStatus.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.manage')
        return {
          version: yield* iam.userTypes.setEnabled(
            principal.tenantId,
            params.userTypeId,
            payload.status === 'active',
            payload.version,
          ),
        }
      }),
    )
    .handle(
      'createUser',
      Effect.fn('iam.createUser.handler')(function* ({ payload }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        // authorization is per node and decided in the service, on the locked
        // connection, so there is no tenant-wide pre-check to make here
        return { id: yield* iam.users.create(principal.tenantId, payload, principal) }
      }),
    )
    .handle(
      'updateUser',
      Effect.fn('iam.updateUser.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* iam.users.update(principal.tenantId, params.userId, payload, principal)
        return { ok: true as const }
      }),
    )
    .handle(
      'setUserPlacement',
      Effect.fn('iam.setUserPlacement.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* iam.users.setPlacement(
          principal.tenantId,
          params.userId,
          payload.primaryOrgNodeId,
          principal,
        )
        return { ok: true as const }
      }),
    )
    .handle(
      'setUserStatus',
      Effect.fn('iam.setUserStatus.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* iam.users.setEnabled(
          principal.tenantId,
          params.userId,
          payload.status === 'active',
          principal,
        )
        return { ok: true as const }
      }),
    )
    .handle(
      'getPlacementPolicy',
      Effect.fn('iam.getPlacementPolicy.handler')(function* ({ params }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.read')
        const type = yield* iam.userTypes.get(principal.tenantId, params.userTypeId)
        const mode = placementModeOf(type)
        return {
          policy: mode === 'allow-list' ? { mode, orgTypeIds: type.allowed_org_types } : { mode },
          version: type.version,
        }
      }),
    )
    .handle(
      'setPlacementPolicy',
      Effect.fn('iam.setPlacementPolicy.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.manage')
        return {
          version: yield* iam.userTypes.setPlacementPolicy(
            principal.tenantId,
            params.userTypeId,
            payload.policy.mode === 'allow-list'
              ? { mode: 'allow-list', orgTypeIds: payload.policy.orgTypeIds }
              : { mode: 'unrestricted', orgTypeIds: [] },
            payload.version,
          ),
        }
      }),
    )
    .handle(
      'deleteUserType',
      Effect.fn('iam.deleteUserType.handler')(function* ({ params, query }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.manage')
        yield* iam.userTypes.remove(principal.tenantId, params.userTypeId, Number(query.version))
        return { ok: true as const }
      }),
    ),
)
