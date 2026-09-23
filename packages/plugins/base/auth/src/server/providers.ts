import { Effect, Redacted, Schema } from 'effect'
import { sql } from 'kysely'
import { transaction, withDatabase } from '@qualy/plugin-database/server'
import type { Principal } from '@qualy/rbac-contract'
import { Audit } from '@qualy/audit-contract/effect'
import {
  DERIVED_CONFIG_KEY,
  LoginDrivers,
  MAX_PRIMARY_LOGIN_METHODS,
  type LoginProminence,
} from '@qualy/auth-contract/login'
import { Secrets } from '@qualy/plugin-secrets/plugin'
import { translateConstraints } from '@qualy/plugin-database/server/constraints'
import {
  ProviderAudienceUpdated,
  ProviderCreated,
  ProviderDeleted,
  ProvidersReordered,
  ProviderRecommended,
  ProviderStatusChanged,
  ProviderUpdated,
} from '../actions.ts'
import { actorOf } from './audit-actor.ts'
import { iconOf } from './login-icons.ts'
import { db, lockTenant } from './db.ts'
import { endFlowsOfProvider } from './flows.ts'
import { PublicOriginResolver } from './public-origin.ts'
import { configOf, entranceSecrets, makeReadiness, type ReadinessGap } from './readiness.ts'
import {
  effectiveValues,
  explicitValues,
  parseTyped,
  visibleIn,
  wireOf,
} from './entrance-values.ts'
import { recoveryChannelIntact, recoveryDoorTypes } from './recovery.ts'
import {
  ProviderConfigIncomplete,
  ProviderConfigInvalid,
  providerConstraints,
  ProviderIdentityNamespaceInUse,
  ProviderIsSystem,
  ProviderKindUnavailable,
  ProviderNotFound,
  ProviderArrangementInvalid,
  ProviderVersionConflict,
  RecoveryChannelRequired,
  UserTypeNotFound,
} from './errors.ts'

// The ways into a tenant, administered.
//
// The password door is provisioned by the platform, one per tenant; doors of
// the other kinds are added by the tenant. A door is added as an empty shell,
// out of service, and told what its kind needs over as many saves as that
// takes; it can be put in service once it has everything, and while it is in
// service nothing may take a required setting away. What a tenant administers
// about any door is its name, whether it is in service, its place on the
// sign-in page and who may use it. The audience lives here and not on the
// user type, because "may use the school CAS" and "may use a password" are
// facts about the doors.

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
        'p.tenantId',
        'p.code',
        'p.type',
        'p.name',
        'p.config',
        'p.enabled',
        'p.isSystem',
        'p.sortOrder',
        'p.recommended',
        'p.icon',
        eb.ref('p.prominence').$castTo<LoginProminence>().as('prominence'),
        'p.version',
        eb.ref('p.audienceMode').$castTo<'unrestricted' | 'allow-list'>().as('audienceMode'),
        sql<string[]>`coalesce((select array_agg(a.user_type_id::text order by a.user_type_id)
          from auth_provider_user_types a
          where a.tenant_id = p.tenant_id and a.auth_provider_id = p.id), '{}')`.as('userTypeIds'),
      ])
      // a door taken out of service for good is history, not a door
      .where('p.deletedAt', 'is', null)
      // the order of the sign-in page: the doors listed in full, then the rest
      .orderBy(sql`p.prominence = 'primary'`, 'desc')
      .orderBy('p.sortOrder')
      .orderBy('p.code')
      .execute(),
  )

const oneProvider = (tenantId: string, providerId: string) =>
  db.query((k) =>
    k
      .selectFrom('AuthProvider')
      .select(['id', 'tenantId', 'code', 'name', 'version', 'type', 'config', 'enabled', 'isSystem'])
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

/** the tenant's name for itself, which a public address is resolved for */
const tenantSlug = (tenantId: string) =>
  db
    .query((k) =>
      k.selectFrom('Tenant').select('slug').where('id', '=', tenantId).executeTakeFirstOrThrow(),
    )
    .pipe(Effect.map((row) => row.slug))

/** whether anybody has ever bound an account through the door, withdrawn or not */
const everBound = (tenantId: string, providerId: string) =>
  db
    .query((k) =>
      k
        .selectFrom('UserAuthBinding')
        .select('id')
        .where('tenantId', '=', tenantId)
        .where('authProviderId', '=', providerId)
        .limit(1)
        .executeTakeFirst(),
    )
    .pipe(Effect.map((row) => row !== undefined))

/** what deleting the door would take down with it */
const usageOf = (tenantId: string, providerId: string) =>
  db
    .query((k) =>
      k
        .selectNoFrom((eb) => [
          eb
            .selectFrom('UserAuthBinding')
            .select(sql<number>`count(*)::int`.as('count'))
            .where('tenantId', '=', tenantId)
            .where('authProviderId', '=', providerId)
            .where('revokedAt', 'is', null)
            .as('bindings'),
          eb
            .selectFrom('Session')
            .select(sql<number>`count(*)::int`.as('count'))
            .where('tenantId', '=', tenantId)
            .where('authProviderId', '=', providerId)
            .where('expiresAt', '>', sql<Date>`now()`)
            .as('sessions'),
        ])
        .executeTakeFirstOrThrow(),
    )
    .pipe(
      Effect.map((row) => ({ bindings: Number(row.bindings ?? 0), sessions: Number(row.sessions ?? 0) })),
    )

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

/**
 * A value bound as jsonb.
 *
 * The column's own type would convert a value handed to the builder, so a
 * string went in as a json string and came back as one: the settings read as
 * empty while the row plainly held them.
 */
const jsonb = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`

export const makeProviders = Effect.fn('Auth.makeProviders')(function* () {
  const withDb = yield* withDatabase
  const audit = yield* Audit
  const drivers = yield* LoginDrivers
  const secrets = yield* Secrets
  const readiness = yield* makeReadiness
  const origin = yield* PublicOriginResolver

  /**
   * Whether the tenant can still recover itself on the state being
   * committed: asked after every write that could close its door.
   */
  const recoveryRemains = Effect.fn('Iam.providers.recoveryRemains')(function* (
    tenantId: string,
  ) {
    const doorTypes = recoveryDoorTypes(yield* drivers.all)
    if (!(yield* recoveryChannelIntact(tenantId, doorTypes, readiness))) {
      return yield* new RecoveryChannelRequired()
    }
  })

  /** one write under the tenant's lock */
  const write = <A, E, R>(tenantId: string, body: () => Effect.Effect<A, E, R>) =>
    withDb(
      transaction(
        Effect.gen(function* () {
          yield* lockTenant(tenantId)
          return yield* body()
        }),
      ),
    ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))

  /** the door as it stands, at the version the caller read */
  const current = Effect.fn('Iam.providers.current')(function* (
    tenantId: string,
    providerId: string,
    expectedVersion: number,
  ) {
    const provider = yield* oneProvider(tenantId, providerId)
    if (!provider) return yield* new ProviderNotFound()
    if (provider.version !== expectedVersion) {
      return yield* new ProviderVersionConflict({ currentVersion: provider.version })
    }
    return provider
  })

  /**
   * The driver's own say on what an entrance of its kind is made of; only a
   * kind a tenant adds for itself has one. The platform's own door is
   * provisioned, never added and never configured.
   */
  const kindOf = Effect.fn('Iam.providers.kindOf')(function* (type: string) {
    const provisioning = (yield* drivers.forType(type))?.driver.provisioning
    if (provisioning?.mode !== 'tenant-managed') return yield* new ProviderKindUnavailable()
    return provisioning.entrance
  })

  /**
   * A door in service stays able to let people in: asked on the state being
   * committed, after any write that could take something it needs away.
   */
  const stillReady = Effect.fn('Iam.providers.stillReady')(function* (
    provider: { tenantId: string; id: string; type: string; enabled: boolean },
    config: unknown,
  ) {
    if (!provider.enabled) return
    const answer = yield* readiness({ ...provider, config })
    if (!answer.ready) return yield* new ProviderConfigIncomplete({ missing: answer.missing })
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
                // flat rather than a union per kind: a screen reads every
                // field the same way and ignores what its kind does not use
                fields: driver.provisioning.entrance.fields.map((field) => ({
                  key: field.key,
                  label: field.label,
                  hint: field.hint ?? null,
                  kind: field.kind,
                  required: field.required,
                  section: field.section ?? ('basic' as const),
                  visibleWhen:
                    field.visibleWhen === undefined
                      ? null
                      : { field: field.visibleWhen.field, equals: wireOf(field.visibleWhen.equals) },
                  options:
                    field.kind === 'choice'
                      ? field.options.map((option) => ({ value: option.value, label: option.label }))
                      : [],
                  defaultValue:
                    (field.kind === 'choice' || field.kind === 'toggle' || field.kind === 'number') &&
                    field.defaultValue !== undefined
                      ? wireOf(field.defaultValue)
                      : null,
                  min: field.kind === 'number' ? (field.min ?? null) : null,
                  max: field.kind === 'number' ? (field.max ?? null) : null,
                  step: field.kind === 'number' ? (field.step ?? null) : null,
                })),
              },
            ],
      )
    }),

    /** a new door: its kind, its name and its address, and nothing else yet */
    create: Effect.fn('Iam.providers.create')(function* (
      tenantId: string,
      input: { type: string; code: string; name: string },
      as: Principal,
    ) {
      yield* kindOf(input.type)
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          // a new entrance goes to the end of the sign-in page
          const last = yield* db.query((k) =>
            k
              .selectFrom('AuthProvider')
              .select((eb) => eb.fn.max('sortOrder').as('sortOrder'))
              .where('tenantId', '=', tenantId)
              .where('deletedAt', 'is', null)
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
                  config: jsonb({}),
                  // out of service until it has what its kind needs
                  enabled: false,
                  sortOrder: Number(last?.sortOrder ?? -1) + 1,
                } as never)
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

    /**
     * The name, and whichever settings were sent.
     *
     * A text or url box sent empty clears that setting; a box not sent keeps
     * it. A secret sent empty, or not sent, keeps what is stored - clearing
     * one is its own request. What is saved need not be complete: only a
     * door in service has to stay ready. The address and the kind never move.
     */
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
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const provider = yield* current(tenantId, providerId, input.expectedVersion)
          const previous = configOf(provider.config)
          const changed: string[] = []
          const renamed = input.name !== undefined && input.name !== provider.name
          if (renamed) changed.push('name')
          let config: Readonly<Record<string, unknown>> = previous
          const replacedSecrets: [string, string][] = []

          if (input.values !== undefined) {
            const kind = yield* kindOf(provider.type)
            const fields = new Map(kind.fields.map((field) => [field.key, field]))
            const next = explicitValues(kind, previous)
            let typedChanged = false
            for (const [key, raw] of Object.entries(input.values)) {
              const field = fields.get(key)
              if (field === undefined) return yield* new ProviderConfigInvalid({ field: key })
              if (field.kind === 'secret') {
                const typed = raw.trim()
                if (typed === '') continue
                replacedSecrets.push([key, typed])
                changed.push(key)
                continue
              }
              const parsed = parseTyped(field, raw)
              if (!parsed.ok) return yield* new ProviderConfigInvalid({ field: key })
              if (next[key] === parsed.value) continue
              if (parsed.value === undefined) delete next[key]
              else next[key] = parsed.value
              typedChanged = true
              changed.push(key)
            }
            if (typedChanged) {
              // what the driver derives is worked out from the values as the
              // form will show them: defaults applied, hidden fields left out
              const effective = effectiveValues(kind, next)
              const shown = Object.fromEntries(
                kind.fields
                  .filter((field) => field.kind !== 'secret' && visibleIn(field, effective))
                  .flatMap((field) =>
                    effective[field.key] === undefined ? [] : [[field.key, effective[field.key]!]],
                  ),
              )
              let derived: Readonly<Record<string, unknown>> | undefined
              if (kind.prepareConfig !== undefined) {
                const prepared = yield* kind.prepareConfig({ values: shown })
                if (!prepared.ok) return yield* new ProviderConfigInvalid({ field: prepared.invalid })
                derived = prepared.derived
              }
              config = { ...next, ...(derived === undefined ? {} : { [DERIVED_CONFIG_KEY]: derived }) }
              // whose accounts the door speaks for is fixed once anybody's is bound
              const before = effectiveValues(kind, previous)
              const moved = (kind.identityNamespaceKeys ?? []).find(
                (key) => before[key] !== effective[key],
              )
              if (moved !== undefined && (yield* everBound(tenantId, providerId))) {
                return yield* new ProviderIdentityNamespaceInUse({ field: moved })
              }
            }
          }

          if (changed.length === 0) return provider.version
          yield* db.query((k) =>
            k
              .updateTable('AuthProvider')
              .set({
                ...(renamed ? { name: input.name! } : {}),
                ...(config === previous ? {} : { config: jsonb(config) }),
                version: provider.version + 1,
                updatedAt: sql<Date>`now()`,
              } as never)
              .where('tenantId', '=', tenantId)
              .where('id', '=', providerId)
              .execute(),
          )
          for (const [key, value] of replacedSecrets) {
            yield* secrets.put(
              { ...entranceSecrets(tenantId, providerId), key },
              Redacted.make(value),
            )
          }
          yield* stillReady(provider, config)
          yield* audit.record(ProviderUpdated, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: provider.id, label: renamed ? input.name! : provider.name },
            details: { fields: changed },
          })
          return provider.version + 1
        }),
      )
    }),

    /** one stored secret, taken away; refused while the door needs it in service */
    clearSecret: Effect.fn('Iam.providers.clearSecret')(function* (
      tenantId: string,
      providerId: string,
      key: string,
      expectedVersion: number,
      as: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const provider = yield* current(tenantId, providerId, expectedVersion)
          const kind = yield* kindOf(provider.type)
          if (!kind.fields.some((field) => field.key === key && field.kind === 'secret')) {
            return yield* new ProviderConfigInvalid({ field: key })
          }
          const removed = yield* secrets.delete({ ...entranceSecrets(tenantId, providerId), key })
          if (!removed) return provider.version
          yield* stillReady(provider, provider.config)
          yield* db.query((k) =>
            k
              .updateTable('AuthProvider')
              .set({ version: provider.version + 1, updatedAt: sql<Date>`now()` })
              .where('tenantId', '=', tenantId)
              .where('id', '=', providerId)
              .execute(),
          )
          yield* audit.record(ProviderUpdated, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: provider.id, label: provider.name },
            details: { fields: [key] },
          })
          return provider.version + 1
        }),
      )
    }),

    /**
     * In service or out of it. Only a door with everything its kind needs
     * may go in; closing the platform's door can strand the tenant's
     * recovery account exactly as narrowing it can, so that is re-read on
     * the state being committed.
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
          const provider = yield* current(tenantId, providerId, expectedVersion)
          yield* stillReady({ ...provider, enabled: status === 'active' }, provider.config)
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
     * The door, gone for good.
     *
     * The row stays so the history that names it keeps a name to show; what
     * it let people do ends now - the bindings made through it are
     * withdrawn, the sessions it opened end and its secrets are destroyed.
     * The platform's own door is not the tenant's to delete.
     */
    remove: Effect.fn('Iam.providers.remove')(function* (
      tenantId: string,
      providerId: string,
      expectedVersion: number,
      as: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const provider = yield* current(tenantId, providerId, expectedVersion)
          if (provider.isSystem) return yield* new ProviderIsSystem()
          yield* db.query((k) =>
            k
              .updateTable('AuthProvider')
              .set({
                enabled: false,
                deletedAt: sql<Date>`now()`,
                version: provider.version + 1,
                updatedAt: sql<Date>`now()`,
              })
              .where('tenantId', '=', tenantId)
              .where('id', '=', providerId)
              .execute(),
          )
          const revoked = yield* db.query((k) =>
            k
              .updateTable('UserAuthBinding')
              .set({ revokedAt: sql<Date>`now()` })
              .where('tenantId', '=', tenantId)
              .where('authProviderId', '=', providerId)
              .where('revokedAt', 'is', null)
              .returning('id')
              .execute(),
          )
          const ended = yield* db.query((k) =>
            k
              .deleteFrom('Session')
              .where('tenantId', '=', tenantId)
              .where('authProviderId', '=', providerId)
              .returning('id')
              .execute(),
          )
          // a redirect somebody left on has nothing to come back to
          yield* endFlowsOfProvider(tenantId, providerId)
          yield* secrets.deleteOwner(entranceSecrets(tenantId, providerId))
          yield* recoveryRemains(tenantId)
          yield* audit.record(ProviderDeleted, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: provider.id, label: provider.name },
            details: {
              type: provider.type,
              code: provider.code,
              revokedBindings: revoked.length,
              endedSessions: ended.length,
            },
          })
        }),
      )
    }),

    /**
     * How the sign-in page presents its doors, said whole: the ones listed in
     * full in their order, then the rest in theirs. A list that names a
     * stranger or leaves a door out is refused rather than half applied, and
     * so is one that lists more doors in full than the page has room for.
     * A recommended door moved out of the full list stops being recommended:
     * only a door listed in full can be.
     */
    reorder: Effect.fn('Iam.providers.reorder')(function* (
      tenantId: string,
      arrangement: { readonly primary: readonly string[]; readonly secondary: readonly string[] },
      as: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const standing = yield* providerRows(tenantId)
          const known = new Set(standing.map((row) => row.id))
          const primary = [...new Set(arrangement.primary)]
          const secondary = [...new Set(arrangement.secondary)].filter((id) => !primary.includes(id))
          const asked = [...primary, ...secondary]
          if (asked.length !== standing.length || asked.some((id) => !known.has(id))) {
            return yield* new ProviderNotFound()
          }
          if (primary.length > MAX_PRIMARY_LOGIN_METHODS) {
            return yield* new ProviderArrangementInvalid({ reason: 'primary-full' })
          }
          for (const [index, id] of asked.entries()) {
            const listed = index < primary.length
            yield* db.query((k) =>
              k
                .updateTable('AuthProvider')
                .set({
                  sortOrder: index,
                  prominence: listed ? 'primary' : 'secondary',
                  // in one statement with the prominence, or the check that
                  // a recommended door is a primary one refuses the move
                  ...(listed ? {} : { recommended: false }),
                })
                .where('tenantId', '=', tenantId)
                .where('id', '=', id)
                .execute(),
            )
          }
          yield* audit.record(ProvidersReordered, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target: { id: tenantId },
            details: { order: asked, primary },
          })
        }),
      )
    }),

    /**
     * The one door the tenant recommends, or none. Only a door listed in full
     * can be it; choosing another takes the recommendation from the last.
     */
    recommend: Effect.fn('Iam.providers.recommend')(function* (
      tenantId: string,
      providerId: string | null,
      as: Principal,
    ) {
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const standing = yield* providerRows(tenantId)
          const chosen =
            providerId === null ? undefined : standing.find((row) => row.id === providerId)
          if (providerId !== null && chosen === undefined) return yield* new ProviderNotFound()
          if (chosen !== undefined && chosen.prominence !== 'primary') {
            return yield* new ProviderArrangementInvalid({ reason: 'not-primary' })
          }
          const previous = standing.find((row) => row.recommended)
          if (previous?.id === providerId) return
          // cleared first: one recommended door per tenant is an index, and
          // for a moment there would otherwise be two
          yield* db.query((k) =>
            k
              .updateTable('AuthProvider')
              .set({ recommended: false })
              .where('tenantId', '=', tenantId)
              .where('recommended', '=', true)
              .execute(),
          )
          if (chosen !== undefined) {
            yield* db.query((k) =>
              k
                .updateTable('AuthProvider')
                .set({ recommended: true })
                .where('tenantId', '=', tenantId)
                .where('id', '=', chosen.id)
                .execute(),
            )
          }
          yield* audit.record(ProviderRecommended, {
            tenantId,
            actor: yield* actorOf(tenantId, as),
            target:
              chosen === undefined
                ? { id: tenantId }
                : { id: chosen.id, label: chosen.name },
            details: { providerId: chosen?.id ?? null },
          })
        }),
      )
    }),

    list: Effect.fn('Iam.providers.list')(function* (tenantId: string) {
      const found = yield* withDb(providerRows(tenantId)).pipe(
        Effect.catchTag('QueryFailed', (error) => Effect.die(error)),
      )
      const rows = []
      for (const row of found) {
        const answer = yield* readiness(row)
        const driver = (yield* drivers.forType(row.type))?.driver
        const provisioning = driver?.provisioning
        rows.push({
          id: row.id,
          code: row.code,
          type: row.type,
          // what its driver calls the kind; none where no installed driver claims it
          kindLabel:
            provisioning === undefined
              ? null
              : provisioning.mode === 'tenant-managed'
                ? provisioning.entrance.label
                : provisioning.label,
          name: row.name,
          status: row.enabled ? ('active' as const) : ('disabled' as const),
          setup: answer.ready ? ('complete' as const) : ('incomplete' as const),
          isSystem: row.isSystem,
          sortOrder: row.sortOrder,
          prominence: row.prominence,
          recommended: row.recommended,
          icon: iconOf(row.icon, driver?.icon),
          iconChosen: row.icon !== null,
          version: row.version,
          audience:
            row.audienceMode === 'unrestricted'
              ? ({ mode: 'unrestricted' } as const)
              : ({ mode: 'allow-list', userTypeIds: row.userTypeIds } as const),
        })
      }
      return rows
    }),

    /**
     * One door as its settings screen reads it: what it still lacks, the
     * settings it holds, which secrets are stored (never what they are), and
     * what deleting it would end.
     */
    detail: Effect.fn('Iam.providers.detail')(function* (tenantId: string, providerId: string) {
      return yield* withDb(
        Effect.gen(function* () {
          const provider = (yield* providerRows(tenantId)).find((row) => row.id === providerId)
          if (provider === undefined) return yield* new ProviderNotFound()
          const answer = yield* readiness(provider)
          const kind = (yield* drivers.forType(provider.type))?.driver.provisioning
          const fields = kind?.mode === 'tenant-managed' ? kind.entrance.fields : []
          const stored = fields.some((field) => field.kind === 'secret')
            ? yield* secrets.keysOf(entranceSecrets(tenantId, providerId))
            : []
          const config = configOf(provider.config)
          // where its kind expects to be called back, when it has one and
          // this deployment has an address to be called back at
          const driver = (yield* drivers.forType(provider.type))?.driver
          const callbackPath = driver?.callback?.({ code: provider.code })
          const callbackUrl =
            callbackPath === undefined
              ? null
              : yield* origin.resolve({ id: tenantId, slug: yield* tenantSlug(tenantId) }).pipe(
                  Effect.map((base) => new URL(callbackPath, base).toString()),
                  Effect.catchTag('PublicOriginUnavailable', () => Effect.succeed(null)),
                )
          return {
            callbackUrl,
            provider: {
              id: provider.id,
              code: provider.code,
              type: provider.type,
              kindLabel:
                kind === undefined
                  ? null
                  : kind.mode === 'tenant-managed'
                    ? kind.entrance.label
                    : kind.label,
              name: provider.name,
              status: provider.enabled ? ('active' as const) : ('disabled' as const),
              setup: answer.ready ? ('complete' as const) : ('incomplete' as const),
              isSystem: provider.isSystem,
              sortOrder: provider.sortOrder,
              prominence: provider.prominence,
              recommended: provider.recommended,
              icon: iconOf(provider.icon, driver?.icon),
              iconChosen: provider.icon !== null,
              version: provider.version,
              audience:
                provider.audienceMode === 'unrestricted'
                  ? ({ mode: 'unrestricted' } as const)
                  : ({ mode: 'allow-list', userTypeIds: provider.userTypeIds } as const),
            },
            missing: answer.missing as ReadinessGap[],
            // every setting as its box shows it, defaults included, so the
            // form and the fields it shows conditionally read the same values
            config:
              kind?.mode === 'tenant-managed'
                ? Object.fromEntries(
                    Object.entries(effectiveValues(kind.entrance, config)).map(([key, value]) => [
                      key,
                      wireOf(value),
                    ]),
                  )
                : {},
            secrets: fields
              .filter((field) => field.kind === 'secret')
              .map((field) => ({ key: field.key, stored: stored.includes(field.key) })),
            usage: yield* usageOf(tenantId, providerId),
          }
        }),
      ).pipe(Effect.catchTag('QueryFailed', (error) => Effect.die(error)))
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
      return yield* write(tenantId, () =>
        Effect.gen(function* () {
          const provider = yield* current(tenantId, providerId, expectedVersion)
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
      )
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
