import { Context, Effect, Layer } from 'effect'
import { UserProvisioning } from '@qualy/auth-contract/provisioning'
import { Placement, UserPlacement } from '@qualy/auth-contract'
import type { Principal } from '@qualy/rbac-contract'
import { withDatabase, type Orm } from '@qualy/plugin-database/server'
import type { Secrets } from '@qualy/plugin-secrets/plugin'
import { HttpApiBuilder } from 'effect/unstable/httpapi'
import { DEFAULT_PAGE_SIZE, encodeQueryCursor, readQueryCursor } from '@qualy/api-kit'
import { Api } from '@qualy/api-kit/plugin'
import { codeFrom, cursorUnusable, pageNumber, pageSize } from '@qualy/api-kit/schema'
import { AccessDenied, Rbac } from '@qualy/rbac-contract/effect'
import { Audit } from '@qualy/audit-contract/effect'

import { placementViolations, primaryNode, usersBlockingOrgType } from './placement.ts'
import { makeProviders } from './providers.ts'
import { identityApiGroup, sessionApiGroup } from '../api.ts'
import { LoginDrivers, LoginSessions } from '@qualy/auth-contract/login'
import { AuthConfig, SignIn, layer as signInLayer } from './sign-in.ts'
import { AuthRequired, Authenticated, CurrentUser, Viewer } from '@qualy/auth-contract/session'
import { make as makeUserTypes, type UserTypeRow } from './user-types.ts'
import { make as makeUsers, type UserProjection } from './users.ts'
import { layer as sessionLayer, viewerLayer } from './session.ts'
import { recoveryBootCheck } from './recovery.ts'

// auth as an Effect layer.
//
// It provides three tags from one construction. `Placement` and
// `UserPlacement` are the ports peers hold: one question each, no database
// types crossing them, because the connection travels in the fiber and there
// is nothing left to pass. `Iam` is auth's own surface, which its handlers
// use and no peer does.
//
// Like rbac, this reads org's tables directly and never holds the org
// service. Keeping it that way is what keeps the service graph acyclic.

const rows = <Row extends Record<string, unknown>>(result: unknown) =>
  (result as { rows: readonly Row[] }).rows

export class Iam extends Context.Service<
  Iam,
  {
    readonly placementViolations: (tenantId: string) => Effect.Effect<number>
    readonly userTypes: Effect.Success<ReturnType<typeof makeUserTypes>>
    readonly users: Effect.Success<ReturnType<typeof makeUsers>>
    readonly providers: Effect.Success<ReturnType<typeof makeProviders>>
  }
>()('@qualy/plugin-auth/Iam') {}

export const make = Effect.fn('Auth.make')(function* () {
  const withDb = yield* withDatabase
  const userTypes = yield* makeUserTypes()
  const users = yield* makeUsers()
  const providers = yield* makeProviders()

  return {
    placement: {
      // org asks before it retypes a node: the people standing there do not
      // move, so the node changing under them strands them exactly as a
      // transfer would. Called inside org's locked transaction, it joins that
      // transaction and therefore sees the retype that has not committed yet.
      usersBlockingOrgType: (tenantId: string, orgNodeId: string, orgTypeId: string) =>
        withDb(usersBlockingOrgType(tenantId, orgNodeId, orgTypeId)),
    },
    userPlacement: {
      // where one person stands, which is a fact rather than the rule
      // above it. Null when nobody stands anywhere: a deleted unit detaches
      // a deleted user, and a caller reading an audience from this should
      // read that as reaching nothing rather than as reaching everything.
      primaryNode: (tenantId: string, userId: string) => withDb(primaryNode(tenantId, userId)),
    },
    iam: {
      // the same predicate every individual write is decided by, asked of
      // every row at once
      placementViolations: (tenantId: string) => withDb(placementViolations(tenantId)),
      userTypes,
      providers,
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
const tags: Layer.Layer<
  Placement | UserPlacement | UserProvisioning | Iam,
  never,
  Orm | Rbac | Audit | LoginDrivers | Secrets
> = Layer.effectContext(
  Effect.gen(function* () {
    const { placement, userPlacement, iam } = yield* make()
    return Context.empty().pipe(
      Context.add(Placement, placement),
      Context.add(UserPlacement, userPlacement),
      // the bulk door a directory import provisions through
      Context.add(UserProvisioning, iam.users.provisioning),
      Context.add(Iam, iam),
    )
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
export { config } from './auth-config.ts'

/** the services alone; the entry composes them with what the plugin registers */
export const serviceLayer: Layer.Layer<
  Placement | UserPlacement | UserProvisioning | Iam | Authenticated | Viewer | SignIn | LoginSessions,
  never,
  Orm | Rbac | Audit | AuthConfig | LoginDrivers | Secrets
> = Layer.mergeAll(tags, sessionLayer, viewerLayer, signInLayer)

/**
 * The services and the checks the host runs before serving.
 *
 * Kept apart from `serviceLayer` so a stack that composes auth's services
 * for a test does not also have to stand up the boot barrier.
 */
export const pluginLayer = Layer.mergeAll(serviceLayer, recoveryBootCheck)

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
const placementModeOf = (row: { isSystem: boolean; placementMode: string }) =>
  row.isSystem ? ('tenant-root' as const) : (row.placementMode as 'unrestricted' | 'allow-list')

const toUserTypeDto = (row: UserTypeRow) => ({
  id: row.id,
  code: row.code,
  name: row.name,
  description: row.description,
  status: row.enabled ? ('active' as const) : ('disabled' as const),
  isSystem: row.isSystem,
  sortOrder: row.sortOrder,
  version: row.version,
  userCount: row.userCount,
  placementPolicy:
    placementModeOf(row) === 'allow-list'
      ? { mode: 'allow-list' as const, orgTypeIds: row.allowedOrgTypes }
      : { mode: placementModeOf(row) as 'unrestricted' | 'tenant-root' },
})

const local = Api.local(identityApiGroup, sessionApiGroup)

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

/** a timestamp as the wire carries it; the driver hands back either shape */
const instant = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : String(value)

const toUserDto = (row: UserProjection) => ({
  id: row.id,
  businessNo: row.businessNo,
  email: row.email,
  emailVerifiedAt: instant(row.emailVerifiedAt),
  displayName: row.displayName,
  status: row.enabled ? ('active' as const) : ('disabled' as const),
  version: row.version,
  userType: { id: row.userTypeId, code: row.userTypeCode, name: row.userTypeName },
  primaryOrgNode: { id: row.primaryOrgNodeId, name: row.primaryOrgNodeName },
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
        return {
          id: yield* iam.userTypes.create(
            principal.tenantId,
            {
              ...payload,
              code: payload.code ?? codeFrom(payload.name, 'user-type'),
            },
            principal,
          ),
        }
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
        if (query.page !== undefined) {
          const found = yield* iam.users.page(principal, {
            orgNodeId: query.orgNodeId,
            scope,
            status: query.status,
            search: query.search,
            userTypeId: query.userTypeId,
            page: pageNumber(query.page),
            limit,
          })
          return {
            items: found.items.map(toUserDto),
            nextCursor: null,
            total: found.total,
            page: found.page,
            pageSize: limit,
          }
        }
        const status = query.status
        // the cursor belongs to this anchor, scope and search and no other
        // every filter is in the fingerprint: a cursor from one question
        // applied to another silently skips or repeats people
        const fingerprint = `users:${query.orgNodeId}:${scope}:${query.search ?? ''}:${query.userTypeId ?? ''}:${query.status ?? ''}`
        const key = readQueryCursor(query.cursor, fingerprint, ['text', 'text', 'uuid'])
        if (key === null) return yield* cursorUnusable()
        const found = yield* iam.users.list(principal, {
          orgNodeId: query.orgNodeId,
          scope,
          status,
          search: query.search,
          userTypeId: query.userTypeId,
          after: key,
          limit: limit + 1,
        })
        const items = found.slice(0, limit)
        const last = items.at(-1)
        return {
          items: items.map(toUserDto),
          nextCursor:
            found.length > limit && last
              ? encodeQueryCursor(fingerprint, [last.businessNo ?? '', last.displayName, last.id])
              : null,
          total: null,
          page: null,
          pageSize: null,
        }
      }),
    )
    .handle(
      'getUser',
      Effect.fn('iam.getUser.handler')(function* ({ params }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* requireUserRead(principal)
        const detail = yield* iam.users.detail(principal, params.userId)
        return {
          ...detail,
          user: toUserDto(detail.user),
          lastSignInAt: instant(detail.lastSignInAt),
        }
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
      'listAuthProviders',
      Effect.fn('iam.listAuthProviders.handler')(function* () {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.read')
        return { providers: yield* iam.providers.list(principal.tenantId) }
      }),
    )
    .handle(
      'listAuthProviderKinds',
      Effect.fn('iam.listAuthProviderKinds.handler')(function* () {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.read')
        return { kinds: yield* iam.providers.kinds }
      }),
    )
    .handle(
      'createAuthProvider',
      Effect.fn('iam.createAuthProvider.handler')(function* ({ payload }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.manage')
        return {
          id: yield* iam.providers.create(
            principal.tenantId,
            { type: payload.type, code: payload.code, name: payload.name },
            principal,
          ),
        }
      }),
    )
    .handle(
      'getAuthProvider',
      Effect.fn('iam.getAuthProvider.handler')(function* ({ params }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.read')
        return yield* iam.providers.detail(principal.tenantId, params.providerId)
      }),
    )
    .handle(
      'deleteAuthProvider',
      Effect.fn('iam.deleteAuthProvider.handler')(function* ({ params, query }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.manage')
        yield* iam.providers.remove(
          principal.tenantId,
          params.providerId,
          Number(query.version),
          principal,
        )
        return { ok: true as const }
      }),
    )
    .handle(
      'deleteAuthProviderSecret',
      Effect.fn('iam.deleteAuthProviderSecret.handler')(function* ({ params, query }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.manage')
        return {
          version: yield* iam.providers.clearSecret(
            principal.tenantId,
            params.providerId,
            params.key,
            Number(query.version),
            principal,
          ),
        }
      }),
    )
    .handle(
      'updateAuthProvider',
      Effect.fn('iam.updateAuthProvider.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.manage')
        return {
          version: yield* iam.providers.update(
            principal.tenantId,
            params.providerId,
            { expectedVersion: payload.version, name: payload.name, values: payload.values },
            principal,
          ),
        }
      }),
    )
    .handle(
      'setAuthProviderStatus',
      Effect.fn('iam.setAuthProviderStatus.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.manage')
        return {
          version: yield* iam.providers.setStatus(
            principal.tenantId,
            params.providerId,
            payload.status,
            payload.version,
            principal,
          ),
        }
      }),
    )
    .handle(
      'setAuthProviderOrder',
      Effect.fn('iam.setAuthProviderOrder.handler')(function* ({ payload }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.manage')
        yield* iam.providers.reorder(principal.tenantId, payload.providerIds, principal)
        return { ok: true as const }
      }),
    )
    .handle(
      'setAuthProviderAudience',
      Effect.fn('iam.setAuthProviderAudience.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const rbac = yield* Rbac
        const principal = yield* CurrentUser
        yield* rbac.require(principal, 'auth.provider.manage')
        return {
          version: yield* iam.providers.setAudience(
            principal.tenantId,
            params.providerId,
            payload.audience,
            payload.version,
            principal,
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
            principal,
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
            principal,
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
        const { version, ...fields } = payload
        yield* iam.users.update(principal.tenantId, params.userId, fields, version, principal)
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
          payload.version,
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
        yield* iam.users.setStatus(
          principal.tenantId,
          params.userId,
          { status: payload.status, expectedVersion: payload.version },
          principal,
        )
        return { ok: true as const }
      }),
    )
    .handle(
      'deleteUser',
      Effect.fn('iam.deleteUser.handler')(function* ({ params, query }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* iam.users.remove(principal.tenantId, params.userId, Number(query.version), principal)
        return { ok: true as const }
      }),
    )
    .handle(
      'listUserEntrances',
      Effect.fn('iam.listUserEntrances.handler')(function* ({ params }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* requireUserRead(principal)
        const found = yield* iam.users.entrances(principal, params.userId)
        return {
          manageable: found.manageable,
          entrances: found.entrances.map((entrance) => ({
            providerId: entrance.providerId,
            name: entrance.name,
            type: entrance.type,
            status: entrance.enabled ? ('active' as const) : ('disabled' as const),
            // Kysely types a boolean expression as SqlBool, which is a
            // number on some drivers; the wire says boolean
            admits: entrance.admits === true,
            resolution: entrance.resolution ?? null,
            // the declaration without its function: what to ask for, never how
            binding:
              entrance.binding === undefined
                ? null
                : entrance.binding.mode === 'managed'
                  ? {
                      mode: 'managed' as const,
                      secret: {
                        label: entrance.binding.secret.label,
                        hint: entrance.binding.secret.hint ?? null,
                        minLength: entrance.binding.secret.minLength,
                        maxLength: entrance.binding.secret.maxLength,
                      },
                    }
                  : { mode: 'self' as const },
            bound:
              entrance.bindingId === null
                ? null
                : {
                    id: entrance.bindingId,
                    subject: entrance.subject,
                    displayLabel: entrance.displayLabel,
                    boundAt: instant(entrance.boundAt) ?? '',
                    lastUsedAt: instant(entrance.lastUsedAt),
                    hasCredential: entrance.hasCredential === true,
                  },
          })),
        }
      }),
    )
    .handle(
      'putUserAuthBinding',
      Effect.fn('iam.putUserAuthBinding.handler')(function* ({ params, payload }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        const id = yield* iam.users.putBinding(
          principal.tenantId,
          params.userId,
          params.providerId,
          { secret: payload.secret },
          principal,
        )
        return { id }
      }),
    )
    .handle(
      'deleteUserAuthBinding',
      Effect.fn('iam.deleteUserAuthBinding.handler')(function* ({ params }) {
        const iam = yield* Iam
        const principal = yield* CurrentUser
        yield* iam.users.revokeBinding(
          principal.tenantId,
          params.userId,
          params.providerId,
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
          policy: mode === 'allow-list' ? { mode, orgTypeIds: type.allowedOrgTypes } : { mode },
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
            principal,
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
        yield* iam.userTypes.remove(
          principal.tenantId,
          params.userTypeId,
          Number(query.version),
          principal,
        )
        return { ok: true as const }
      }),
    ),
)
