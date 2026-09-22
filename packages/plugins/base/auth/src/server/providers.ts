import { Effect, Schema } from 'effect'
import { sql } from 'kysely'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { Audit } from '@qualy/audit-contract/effect'
import { LoginDrivers } from '@qualy/auth-contract/login'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import {
  ProviderAudienceUpdated,
  ProviderCreated,
  ProvidersReordered,
  ProviderStatusChanged,
  ProviderUpdated,
} from '../actions.ts'
import { actorOf } from './audit-actor.ts'
import { db, lockTenant } from './db.ts'
import { recoveryChannelIntact, recoveryDoorTypes } from './recovery.ts'
import {
  ProviderConfigInvalid,
  providerConstraints,
  ProviderKindUnavailable,
  ProviderNotFound,
  ProviderVersionConflict,
  RecoveryChannelRequired,
  UserTypeNotFound,
} from './errors.ts'

// The ways into a tenant, administered.
//
// The password door is provisioned by the platform, one per tenant; doors of
// the other kinds are added by the tenant. What a tenant administers about
// any of them is its name, whether it is in service, its place on the
// sign-in page and who may use it. The audience lives here and not on the
// user type, because "may use the school CAS" and "may use a password" are
// facts about the doors: two booleans on the type could never say which of
// three doors a kind of person is welcome at.

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
      // a door taken out of service for good is history, not a door
      .where('p.deletedAt', 'is', null)
      .orderBy('p.sortOrder')
      .orderBy('p.code')
      .execute(),
  )

const oneProvider = (tenantId: string, providerId: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select(['id', 'name', 'version', 'type', 'config', 'enabled', 'isSystem'])
      .where('tenantId', '=', tenantId)
      .where('id', '=', providerId)
      .where('deletedAt', 'is', null)
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

export const makeProviders = Effect.fn('Auth.makeProviders')(function* () {
  const withDb = yield* withDatabase
  const audit = yield* Audit
  const drivers = yield* LoginDrivers

  /**
   * Whether the tenant can still recover itself on the state being
   * committed: asked after every write that could close its door.
   */
  const recoveryRemains = Effect.fn('Iam.providers.recoveryRemains')(function* (
    tenantId: string,
  ) {
    const doorTypes = recoveryDoorTypes(yield* drivers.all)
    if (!(yield* recoveryChannelIntact(tenantId, doorTypes))) {
      return yield* new RecoveryChannelRequired()
    }
  })

  /** one write under the tenant's lock, with a taken address said as one */
  const write = <A, E, R>(tenantId: string, body: () => Effect.Effect<A, E, R>) =>
    withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          return yield* body()
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))

  /**
   * The driver's own say on what an entrance of its kind is made of; only a
   * kind a tenant adds for itself has one. The platform's own door is
   * provisioned, never added.
   */
  const kindOf = Effect.fn('Iam.providers.kindOf')(function* (type: string) {
    const provisioning = (yield* drivers.forType(type))?.driver.provisioning
    if (provisioning?.mode !== 'tenant-managed') return yield* new ProviderKindUnavailable()
    return provisioning.entrance
  })

  /** what was typed, turned by the driver into what it will read at sign-in */
  const configFrom = Effect.fn('Iam.providers.configFrom')(function* (
    type: string,
    values: Readonly<Record<string, string>>,
    previous: Readonly<Record<string, unknown>> | undefined,
  ) {
    const kind = yield* kindOf(type)
    for (const field of kind.fields) {
      const typed = (values[field.key] ?? '').trim()
      // a secret left empty on an edit means "as it was"
      const kept = field.kind === 'secret' && previous?.[field.key] !== undefined
      if (field.required && typed === '' && !kept) {
        return yield* new ProviderConfigInvalid({ field: field.key })
      }
    }
    if (kind.prepare === undefined) return {}
    const prepared = yield* kind.prepare({ values, previous })
    if (!prepared.ok) return yield* new ProviderConfigInvalid({ field: prepared.invalid })
    return prepared.config
  })

  return {
    /**
     * The kinds of entrance an administrator may add, each with what it
     * needs to be told. Only drivers that say entrances of their kind can be
     * made are listed; the rest are provisioned and never offered.
     */
    kinds: Effect.gen(function* () {
      return (yield* drivers.all).flatMap(({ driver }) =>
        driver.provisioning.mode !== 'tenant-managed'
          ? []
          : [
              {
                type: driver.type,
                label: driver.provisioning.entrance.label,
                fields: driver.provisioning.entrance.fields.map((field) => ({
                  key: field.key,
                  label: field.label,
                  hint: field.hint ?? null,
                  kind: field.kind,
                  required: field.required,
                })),
              },
            ],
      )
    }),

    create: Effect.fn('Iam.providers.create')(function* (
      tenantId: string,
      input: {
        type: string
        code: string
        name: string
        values: Readonly<Record<string, string>>
      },
      as: Principal,
    ) {
      const config = yield* configFrom(input.type, input.values, undefined)
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          // a new entrance goes to the end of the sign-in page
          const last = yield* db.query((k) =>
            k
              .selectFrom('AuthProvider')
              .select((eb) => eb.fn.max('sortOrder').as('sortOrder'))
              .where('tenantId', '=', tenantId)
              .executeTakeFirst(),
          )
          // only an insert can land on an address already taken
          const created = yield* db
            .query((k) =>
            k
              .insertInto('AuthProvider')
              .values({
                tenantId,
                code: input.code,
                type: input.type,
                name: input.name,
                config: JSON.stringify(config) as never,
                sortOrder: Number(last?.sortOrder ?? -1) + 1,
              })
              .returning('id')
              .executeTakeFirstOrThrow(),
            )
            .pipe(translateConstraints(providerConstraints))
          yield* audit.record(ProviderCreated, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: created.id, label: input.name },
            details: { type: input.type, code: input.code },
          })
          return created.id
        }),
      )
    }),

    /** the name and what the driver was told; the address and the kind never move */
    update: Effect.fn('Iam.providers.update')(function* (
      tenantId: string,
      providerId: string,
      input: {
        expectedVersion: number
        name?: string | undefined
        values?: Readonly<Record<string, string>> | undefined
      },
      as: Principal,
    ) {
      const before = yield* withDb(oneProvider(tenantId, providerId)).pipe(Effect.orDie)
      if (!before) return yield* new ProviderNotFound()
      const config =
        input.values === undefined
          ? undefined
          : yield* configFrom(
              before.type,
              input.values,
              (before.config ?? {}) as Readonly<Record<string, unknown>>,
            )
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const provider = yield* oneProvider(tenantId, providerId)
          if (!provider) return yield* new ProviderNotFound()
          if (provider.version !== input.expectedVersion) {
            return yield* new ProviderVersionConflict({ currentVersion: provider.version })
          }
          yield* db.query((k) =>
            k
              .updateTable('AuthProvider')
              .set({
                ...(input.name === undefined ? {} : { name: input.name }),
                ...(config === undefined ? {} : { config: JSON.stringify(config) as never }),
                version: provider.version + 1,
              })
              .where('tenantId', '=', tenantId)
              .where('id', '=', providerId)
              .execute(),
          )
          yield* audit.record(ProviderUpdated, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: provider.id, label: input.name ?? provider.name },
            details: {
              fields: [
                ...(input.name === undefined ? [] : ['name']),
                ...(config === undefined ? [] : ['config']),
              ],
            },
          })
          return provider.version + 1
        }),
      )
    }),

    /**
     * In service or out of it. Closing the platform's door can strand the
     * tenant's recovery account exactly as narrowing it can, so that is
     * re-read on the state being committed.
     */
    setStatus: Effect.fn('Iam.providers.setStatus')(function* (
      tenantId: string,
      providerId: string,
      status: 'active' | 'disabled',
      expectedVersion: number,
      as: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const provider = yield* oneProvider(tenantId, providerId)
          if (!provider) return yield* new ProviderNotFound()
          if (provider.version !== expectedVersion) {
            return yield* new ProviderVersionConflict({ currentVersion: provider.version })
          }
          yield* db.query((k) =>
            k
              .updateTable('AuthProvider')
              .set({ enabled: status === 'active', version: provider.version + 1 })
              .where('tenantId', '=', tenantId)
              .where('id', '=', providerId)
              .execute(),
          )
          yield* recoveryRemains(tenantId)
          yield* audit.record(ProviderStatusChanged, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: provider.id, label: provider.name },
            details: { status },
          })
          return provider.version + 1
        }),
      )
    }),

    /**
     * The order of the sign-in page, said whole: every entrance, first to
     * last. A list that names a stranger or leaves one out is refused rather
     * than half applied.
     */
    reorder: Effect.fn('Iam.providers.reorder')(function* (
      tenantId: string,
      providerIds: readonly string[],
      as: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const standing = yield* providerRows(tenantId)
          const known = new Set(standing.map((row) => row.id))
          const asked = [...new Set(providerIds)]
          if (asked.length !== standing.length || asked.some((id) => !known.has(id))) {
            return yield* new ProviderNotFound()
          }
          for (const [index, id] of asked.entries()) {
            yield* db.query((k) =>
              k
                .updateTable('AuthProvider')
                .set({ sortOrder: index })
                .where('tenantId', '=', tenantId)
                .where('id', '=', id)
                .execute(),
            )
          }
          yield* audit.record(ProvidersReordered, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: tenantId },
            details: { order: asked },
          })
        }),
      )
    }),

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
     * Checked after the write, on the state being committed: narrowing the
     * platform's door can shut out the recovery account, so its own way in
     * is re-read inside the transaction.
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
            yield* recoveryRemains(tenantId)
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
