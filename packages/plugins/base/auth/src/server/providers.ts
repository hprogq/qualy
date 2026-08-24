import { Effect, Schema } from 'effect'
import { sql } from 'kysely'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import { Rbac } from '@qualy/rbac-contract/effect'
import type { Principal } from '@qualy/rbac-contract'
import { Audit } from '@qualy/audit-contract/effect'
import { SYSTEM_ACCOUNT_USER_TYPE } from '../constants.ts'
import { ProviderAudienceUpdated } from '../actions.ts'
import { actorOf } from './audit-actor.ts'
import { db, lockTenant } from './db.ts'
import {
  ProviderNotFound,
  ProviderVersionConflict,
  RecoveryChannelRequired,
  UserTypeNotFound,
} from './errors.ts'

// The ways into a tenant, administered.
//
// A provider row is created by the platform (local today, cas and friends
// later); what a tenant administers about it is who may use it. The audience
// lives here and not on the user type, because "may use the school CAS" and
// "may use a password" are facts about the doors: two booleans on the type
// could never say which of three doors a kind of person is welcome at.

export type AudiencePolicy =
  | { readonly mode: 'unrestricted' }
  | { readonly mode: 'allow-list'; readonly userTypeIds: readonly string[] }

const providerRows = (tenantId: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider as p')
      .where('p.tenantId', '=', tenantId)
      .select((eb) => [
        'p.id',
        'p.code',
        'p.type',
        'p.name',
        'p.enabled',
        'p.isSystem',
        'p.sortOrder',
        'p.version',
        eb.ref('p.audienceMode').$castTo<'unrestricted' | 'allow-list'>().as('audienceMode'),
        sql<string[]>`coalesce((select array_agg(a.user_type_id::text order by a.user_type_id)
          from auth_provider_user_types a
          where a.tenant_id = p.tenant_id and a.auth_provider_id = p.id), '{}')`.as('userTypeIds'),
      ])
      .orderBy('p.sortOrder')
      .orderBy('p.code')
      .execute(),
  )

const oneProvider = (tenantId: string, providerId: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select(['id', 'name', 'version'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', providerId)
      .executeTakeFirst(),
  )

const countUserTypes = (tenantId: string, ids: readonly string[]) =>
  db
    .query((k) =>
      k
        .selectFrom('UserType')
        .select(sql<number>`count(*)::int`.as('count'))
        .where('tenantId', '=', tenantId)
        .where('id', 'in', [...ids])
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row?.count ?? 0))

const replaceAudience = (
  tenantId: string,
  providerId: string,
  mode: 'unrestricted' | 'allow-list',
  userTypeIds: readonly string[],
) =>
  Effect.gen(function* () {
    yield* db.query((k) =>
      k
        .deleteFrom('AuthProviderUserType')
        .where('tenantId', '=', tenantId)
        .where('authProviderId', '=', providerId)
        .execute(),
    )
    if (userTypeIds.length > 0) {
      yield* db.query((k) =>
        k
          .insertInto('AuthProviderUserType')
          .values(
            userTypeIds.map((userTypeId) => ({ tenantId, authProviderId: providerId, userTypeId })),
          )
          .execute(),
      )
    }
    yield* db.query((k) =>
      k
        .updateTable('AuthProvider')
        .set((eb) => ({
          audienceMode: mode,
          version: eb('version', '+', 1),
          updatedAt: sql<Date>`now()`,
        }))
        .where('tenantId', '=', tenantId)
        .where('id', '=', providerId)
        .execute(),
    )
  })

/** whether any enabled door still admits the recovery account's type */
const recoveryTypeAdmitted = (tenantId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('UserType as t')
        .where('t.tenantId', '=', tenantId)
        .where('t.code', '=', SYSTEM_ACCOUNT_USER_TYPE)
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('AuthProvider as p')
              .select('p.id')
              .whereRef('p.tenantId', '=', 't.tenantId')
              .where('p.enabled', '=', true)
              .where((inner) =>
                inner.or([
                  inner('p.audienceMode', '=', 'unrestricted'),
                  inner.exists(
                    inner
                      .selectFrom('AuthProviderUserType as a')
                      .select('a.id')
                      .whereRef('a.tenantId', '=', 'p.tenantId')
                      .whereRef('a.authProviderId', '=', 'p.id')
                      .whereRef('a.userTypeId', '=', 't.id'),
                  ),
                ]),
              ),
          ),
        )
        .select('t.id')
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

export const makeProviders = Effect.fn('Auth.makeProviders')(function* () {
  const withDb = yield* withDatabase
  const rbac = yield* Rbac
  const audit = yield* Audit

  return {
    list: Effect.fn('Iam.providers.list')(function* (tenantId: string) {
      const found = yield* withDb(providerRows(tenantId)).pipe(
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
      return found.map((row) => ({
        id: row.id,
        code: row.code,
        type: row.type,
        name: row.name,
        status: row.enabled ? ('active' as const) : ('disabled' as const),
        isSystem: row.isSystem,
        sortOrder: row.sortOrder,
        version: row.version,
        audience:
          row.audienceMode === 'unrestricted'
            ? ({ mode: 'unrestricted' } as const)
            : ({ mode: 'allow-list', userTypeIds: row.userTypeIds } as const),
      }))
    }),

    /**
     * The audience, replaced whole.
     *
     * Checked after the write, on the state being committed: narrowing a
     * door can lock a tenant out exactly as disabling its users would, so
     * the recovery account's own way in and the survival of a signable
     * administrator are both re-read inside the transaction.
     */
    setAudience: Effect.fn('Iam.providers.setAudience')(function* (
      tenantId: string,
      providerId: string,
      policy: AudiencePolicy,
      expectedVersion: number,
      as: Principal,
    ) {
      return yield* withDb(
        transaction(
          Effect.gen(function* () {
            yield* lockTenant(tenantId)
            const provider = yield* oneProvider(tenantId, providerId)
            if (!provider) return yield* new ProviderNotFound()
            if (provider.version !== expectedVersion) {
              return yield* new ProviderVersionConflict({ currentVersion: provider.version })
            }
            const userTypeIds = policy.mode === 'allow-list' ? [...new Set(policy.userTypeIds)] : []
            if (userTypeIds.length > 0) {
              const found = yield* countUserTypes(tenantId, userTypeIds)
              if (found !== userTypeIds.length) return yield* new UserTypeNotFound()
            }
            yield* replaceAudience(tenantId, providerId, policy.mode, userTypeIds)
            if (!(yield* recoveryTypeAdmitted(tenantId))) {
              return yield* new RecoveryChannelRequired()
            }
            yield* rbac.assertTenantKeepsAdministrator(tenantId)
            yield* audit.record(ProviderAudienceUpdated, {
              tenantId,
              actor: yield* actorOf(tenantId, as),
              target: { id: provider.id, label: provider.name },
              details: { mode: policy.mode, userTypeCount: userTypeIds.length },
            })
            return provider.version + 1
          }),
        ),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
    }),
  }
})

// the schema the api group shares with this service, kept beside it so the
// wire and the write cannot drift apart
export const audiencePolicySchema = Schema.Union([
  Schema.Struct({ mode: Schema.Literal('unrestricted') }),
  Schema.Struct({
    mode: Schema.Literal('allow-list'),
    userTypeIds: Schema.Array(Schema.String).check(Schema.isMaxLength(50)),
  }),
])
