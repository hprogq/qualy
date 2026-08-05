import { sql, type SQL } from 'drizzle-orm'
import { Context, Effect, Layer } from 'effect'
import { Placement } from '@qualy/auth-contract'
import { Database } from '@qualy/plugin-database/effect'
import { HttpApi, HttpApiBuilder } from 'effect/unstable/httpapi'
import { QUALY_API_ID, QUALY_API_PREFIX } from '@qualy/api-kit'
import { Rbac } from '@qualy/rbac-contract/effect'
import { strandedByQuery, usersBlockingOrgTypeQuery } from '../iam/queries.ts'
import { identityApiGroup } from '../api.ts'
import { CurrentUser } from './session.ts'
import { make as makeUserTypes, type UserTypeRow } from './user-types.ts'
import { make as makeUsers } from './users.ts'
import { Authenticated, layer as sessionLayer } from './session.ts'

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
  const database = yield* Database
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
const tags: Layer.Layer<Placement | Iam, never, Database | Rbac> = Layer.effectContext(
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
export const layer: Layer.Layer<Placement | Iam | Authenticated, never, Database | Rbac> =
  Layer.merge(tags, sessionLayer)

// --- api ---

// Rows leave the database in snake_case; the contract describes camelCase.
const toUserTypeDto = (row: UserTypeRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  allowLocalLogin: row.allow_local_login,
  allowSsoLogin: row.allow_sso_login,
  enabled: row.enabled,
  isSystem: row.is_system,
  sortOrder: row.sort_order,
  version: row.version,
  placementMode: row.placement_mode,
  userCount: row.user_count,
  allowedOrgTypeIds: row.allowed_org_types,
})

// see QUALY_API_ID: implemented against a local api so this plugin does not
// import the aggregate it is part of
const local = HttpApi.make(QUALY_API_ID).add(identityApiGroup).prefix(QUALY_API_PREFIX)

export const identityApiHandlers = HttpApiBuilder.group(local, 'identity', (handlers) =>
  handlers
    .handle(
      'listUserTypes',
      Effect.fn('iam.listUserTypes.handler')(function* () {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.user-type.read')
        const userTypes = yield* iam.userTypes.list(principal.tenantId)
        return { userTypes: userTypes.map(toUserTypeDto) }
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
          userType: toUserTypeDto(
            yield* iam.userTypes.get(principal.tenantId, params.userTypeId),
          ),
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
        return {
          mode: type.placement_mode as 'unrestricted' | 'allow-list',
          orgTypeIds: type.allowed_org_types,
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
            { mode: payload.mode, orgTypeIds: payload.orgTypeIds },
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
